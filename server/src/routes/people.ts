import { Router } from 'express';
import { atLeast, getRole, requireRole, requireWritable, setRole } from '../auth.js';
import { audit } from '../audit.js';
import { notifyMentionsIn } from '../notifications.js';
import type { Ctx } from '../context.js';
import { mintSpeakerCode, revokeSpeakerCode } from '../deviceLink.js';
import type { PersonRow, SessionRow } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { auditMerge, broadcastMerge, mergePeople } from '../mergePeople.js';
import { factsFor, loadSessionDto, toPersonDto } from '../mappers.js';
import { ensureOwnProfile } from '../people.js';
import { can, getPermissions, requireCapability } from '../permissions.js';
import { limit } from '../ratelimit.js';
import {
  mergePersonSchema,
  myProfileSchema,
  parse,
  personRoleSchema,
  personPatchSchema,
  personSchema,
} from '../validation.js';
import type { PersonDetailDto, Role } from '../shared/types.js';

/**
 * Speaker and host profiles, scoped to one event (SPEC follow-up to §4).
 * Organisers curate the roster; an attendee owns at most one profile per event
 * and may edit that one whatever their role — viewers included.
 */
export function peopleRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  /**
   * Two views of one row. `own` answers the caller, so an organiser gets the
   * private facts — the People list needs the role back after it changes one.
   * `pub` goes on the wire to every subscriber of the event, admin or not, so
   * it can never carry them.
   *
   * `isMine` is in the same boat: it is a fact about the reader, and the
   * broadcast computes it for whoever caused the change. The client keeps its
   * own answer rather than believing that one — see `applyPersonChange`.
   */
  const views = (
    req: { event: { id: number }; identity: { id: number }; role: Role },
    id: number,
  ) => {
    const row = load(req.event.id, id);
    const facts = factsFor(ctx.db, req.event.id, id);
    return {
      own: toPersonDto(row, req.identity.id, facts, req.role === 'admin'),
      pub: toPersonDto(row, req.identity.id, facts),
    };
  };

  const load = (eventId: number, id: number): PersonRow => {
    const row = ctx.db
      .prepare<[number, number], PersonRow>(
        'SELECT * FROM people WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(id, eventId);
    if (!row) throw notFound('No such profile');
    return row;
  };

  /** Someone newly named in a bio hears about it — the same parse and the
   *  same silence rules as a session description. `row` is the profile as it
   *  was before the write, so only a name the old bio did not hold rings. */
  const bioMentions = (
    req: { event: { id: number; slug: string }; identity: { id: number } },
    row: PersonRow,
    bio: string | undefined,
    where: string,
  ) => {
    if (bio === undefined || bio === row.bio) return;
    notifyMentionsIn(
      ctx.db,
      {
        eventId: req.event.id,
        subjectType: 'person',
        subjectId: row.id,
        actorId: req.identity.id,
        text: bio,
        previous: row.bio,
        where,
      },
      (identityId) => ctx.broker.publishTo(req.event.slug, identityId, 'notification.ping', {}),
    );
  };

  const write = (row: PersonRow, patch: { name?: string; bio?: string; links?: unknown[] }) => {
    ctx.db
      .prepare('UPDATE people SET name = ?, bio = ?, links = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name ?? row.name,
        patch.bio ?? row.bio,
        patch.links === undefined ? row.links : JSON.stringify(patch.links),
        new Date().toISOString(),
        row.id,
      );
  };

  router.get('/people/:id', limit(ctx.limiter, 'read'), (req, res) => {
    const person = load(req.event.id, Number(req.params.id));
    const sessions = ctx.db
      .prepare<[number, number], SessionRow>(
        `SELECT s.* FROM sessions s
           JOIN session_speakers ss ON ss.session_id = s.id
          WHERE s.event_id = ? AND ss.person_id = ? AND s.deleted_at IS NULL
          ORDER BY s.starts_at`,
      )
      .all(req.event.id, person.id);

    const detail: PersonDetailDto = {
      person: views(req, person.id).own,
      sessions: sessions.map((s) => loadSessionDto(ctx.db, s)),
    };
    res.json(detail);
  });

  /**
   * Your own profile for this event. Since migration 010 it exists from the
   * moment you enter, so this is an edit; the create branch is kept for an
   * identity that got in before that and has not been through a gate since.
   * The full name is free — two people may share one — so there is nothing
   * to clash with; the username is the unique thing, and it lives on the
   * event membership, not here.
   */
  router.patch(
    '/me/profile',
    requireCapability(ctx.db, 'person.edit_own'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const body = parse(myProfileSchema, req.body);
      const existing = ctx.db
        .prepare<[number, number], PersonRow>(
          'SELECT * FROM people WHERE event_id = ? AND identity_id = ? AND deleted_at IS NULL',
        )
        .get(req.event.id, req.identity.id);
      const row =
        existing ??
        ensureOwnProfile(
          ctx.db,
          req.event.id,
          req.identity.id,
          body.name ?? (req.identity.display_name || req.identity.public_id),
        );
      write(row, body);
      bioMentions(req, row, body.bio, 'in their bio');

      const { own, pub } = views(req, row.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: existing ? 'update' : 'create',
        entity: 'person',
        entityId: row.id,
      });
      ctx.broker.publish(req.event.slug, existing ? 'person.updated' : 'person.created', pub);
      res.status(existing ? 200 : 201).json(own);
    },
  );

  router.post(
    '/people',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const body = parse(personSchema, req.body);
      const now = new Date().toISOString();
      const id = Number(
        ctx.db
          .prepare(
            `INSERT INTO people (event_id, identity_id, name, bio, links, created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?)`,
          )
          .run(req.event.id, body.name, body.bio ?? '', JSON.stringify(body.links ?? []), now, now)
          .lastInsertRowid,
      );
      const { own, pub } = views(req, id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'create',
        entity: 'person',
        entityId: id,
      });
      ctx.broker.publish(req.event.slug, 'person.created', pub);
      res.status(201).json(own);
    },
  );

  router.patch(
    '/people/:id',
    requireRole(ctx.db, 'viewer'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const person = load(req.event.id, Number(req.params.id));
      // Organisers edit anyone; everyone else edits only the profile they own,
      // and only while the matrix grants their role `person.edit_own` — the
      // same switch `/me/profile` honours. Without this line the switch was
      // decorative for anyone who addressed their profile by id instead.
      const mine = person.identity_id !== null && person.identity_id === req.identity.id;
      if (!atLeast(req.role, 'admin')) {
        if (!mine) throw forbidden('That is not your profile');
        if (!can(getPermissions(ctx.db, req.event.id), req.role, 'person.edit_own')) {
          throw forbidden();
        }
      }

      const body = parse(personPatchSchema, req.body);
      write(person, body);
      bioMentions(req, person, body.bio, mine ? 'in their bio' : `in ${person.name}’s bio`);

      const { own, pub } = views(req, person.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'update',
        entity: 'person',
        entityId: person.id,
      });
      ctx.broker.publish(req.event.slug, 'person.updated', pub);
      res.json(own);
    },
  );

  /**
   * Set the role held by whoever holds this profile. Now that everyone who
   * enters is a person, the People list is where roles are handed out — the
   * alternative was telling somebody a different password and asking them to
   * enter again.
   *
   * The one refusal is demoting the last organiser: an event with no admin
   * can be administered by nobody and repaired by nobody, which is the same
   * reasoning `getPermissions` uses to force admin on for every capability.
   * Whoever knows the organiser password can still enter as one.
   */
  router.put(
    '/people/:id/role',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const person = load(req.event.id, Number(req.params.id));
      const { role } = parse(personRoleSchema, req.body);
      if (person.identity_id === null) {
        throw badRequest('Nobody holds that profile yet — a role needs a person to hold it');
      }
      if (role !== 'admin' && getRole(ctx.db, person.identity_id, req.event.id) === 'admin') {
        const others = ctx.db
          .prepare<[number, number], { n: number }>(
            `SELECT COUNT(*) AS n FROM roles
              WHERE event_id = ? AND role = 'admin' AND identity_id != ?`,
          )
          .get(req.event.id, person.identity_id);
        if ((others?.n ?? 0) === 0) {
          throw conflict(
            'That is the last organiser — make someone else an organiser first',
            'last_admin',
          );
        }
      }
      setRole(ctx.db, person.identity_id, req.event.id, role);

      const { own, pub } = views(req, person.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'role_set',
        entity: 'person',
        entityId: person.id,
      });
      ctx.broker.publish(req.event.slug, 'person.updated', pub);
      // The person themselves learn their new role now, not at their next
      // reload: a demoted attendee would otherwise keep every button the
      // server has started refusing, and a promoted one would see nothing new.
      ctx.broker.publishTo(req.event.slug, person.identity_id, 'role.updated', { role });
      res.json(own);
    },
  );

  /**
   * Archive a profile: out of the organiser's lists, still a live profile.
   *
   * Deleting was the only tidy-up there was, and it is the wrong tool for the
   * profiles that actually accumulate — the ones made while testing the room,
   * a walk-in who never came back. It cannot be undone, it strips the name off
   * every session it was credited on, and it refuses outright for anyone who
   * holds their own profile. Archiving keeps all of that and only stops the
   * profile turning up in the People list and the speaker picker.
   *
   * Nothing about permission changes: the holder keeps their role, their
   * cookie and their way in, which is what makes the route below theirs to
   * use as well as an organiser's.
   */
  router.post(
    '/people/:id/archive',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const person = load(req.event.id, Number(req.params.id));
      if (person.archived_at === null) {
        ctx.db
          .prepare('UPDATE people SET archived_at = ? WHERE id = ?')
          .run(new Date().toISOString(), person.id);
      }
      const { own, pub } = views(req, person.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'archive',
        entity: 'person',
        entityId: person.id,
      });
      ctx.broker.publish(req.event.slug, 'person.updated', pub);
      res.json(own);
    },
  );

  /**
   * Out of the archive again — an organiser's doing, or the holder's own.
   *
   * The holder is the reason this is not admin-only. An organiser tidying up
   * at the end of a day cannot tell a profile that is finished with from one
   * whose person is coming back tomorrow, and the person themselves can: they
   * still hold the cookie, so they open their profile, see that it was put
   * away, and take it back out without having to find an organiser. Archiving
   * is a filing decision, and this is the appeal against it.
   *
   * `requireRole(user)` rather than `viewer`: a livestream audience has no
   * profile of its own to be archived, and the check below is what actually
   * grants it — you may unarchive your own profile, or any if you run the
   * event.
   */
  router.delete(
    '/people/:id/archive',
    requireRole(ctx.db, 'user'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const person = load(req.event.id, Number(req.params.id));
      const mine = person.identity_id !== null && person.identity_id === req.identity.id;
      if (!mine && req.role !== 'admin') {
        throw forbidden(
          'Only an organiser, or whoever holds it, can take a profile out of the archive',
        );
      }
      if (person.archived_at !== null) {
        ctx.db.prepare('UPDATE people SET archived_at = NULL WHERE id = ?').run(person.id);
      }
      const { own, pub } = views(req, person.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'unarchive',
        entity: 'person',
        entityId: person.id,
      });
      ctx.broker.publish(req.event.slug, 'person.updated', pub);
      res.json(own);
    },
  );

  /**
   * Fold a duplicate profile into this one (identity spec, B2): sessions and
   * pitches are repointed, blanks on the survivor fill from the duplicate, the
   * duplicate is soft-deleted. When only one side is claimed, the claim moves
   * to the survivor. When both are claimed, picking the survivor *is* picking
   * whose identity wins: everything the losing identity did in this event —
   * stars, contributions, interest, authorship — is re-keyed onto the
   * survivor's, and the losing device is signed out of the event (decided
   * 2026-08-31; see `rekeyIdentityWork`). Not reversible through /trash,
   * hence admin-only and audited.
   */
  router.post(
    '/people/:id/merge',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const survivor = load(req.event.id, Number(req.params.id));
      const { from } = parse(mergePersonSchema, req.body);
      if (from === survivor.id) throw badRequest('A profile cannot be merged into itself');
      const loser = load(req.event.id, from);

      const result = mergePeople(ctx.db, req.event.id, survivor, loser);
      const { own, pub } = views(req, survivor.id);
      auditMerge(ctx.db, req.identity.id, req.event.id, loser.id, 'merge');
      broadcastMerge(
        ctx.db,
        ctx.broker,
        req.event.slug,
        req.event.id,
        req.identity.id,
        loser.id,
        pub,
        result,
      );
      res.json(own);
    },
  );

  /**
   * Mint (or replace) this person's speaker code (identity spec, follow-up).
   * The phrase is returned once and stored only as a hash; minting attaches an
   * identity to an unclaimed person and raises it to the speaker role, so the
   * fresh person DTO is broadcast.
   */
  router.post(
    '/people/:id/speaker-code',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const person = load(req.event.id, Number(req.params.id));
      const { phrase } = mintSpeakerCode(ctx.db, req.event.id, person);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'speaker_code_mint',
        entity: 'person',
        entityId: person.id,
      });
      ctx.broker.publish(req.event.slug, 'person.updated', views(req, person.id).pub);
      res.json({ phrase });
    },
  );

  /** Revoke the code. Devices that already redeemed it keep the identity —
   *  taking the *role* away is a separate, deliberate act. */
  router.delete(
    '/people/:id/speaker-code',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const person = load(req.event.id, Number(req.params.id));
      revokeSpeakerCode(ctx.db, person.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'speaker_code_revoke',
        entity: 'person',
        entityId: person.id,
      });
      res.status(204).end();
    },
  );

  router.delete(
    '/people/:id',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const person = load(req.event.id, Number(req.params.id));
      // Sessions keep their slot; they just lose the speaker.
      ctx.db.transaction(() => {
        ctx.db.prepare('DELETE FROM session_speakers WHERE person_id = ?').run(person.id);
        ctx.db
          .prepare('UPDATE people SET deleted_at = ? WHERE id = ?')
          .run(new Date().toISOString(), person.id);
        // Removing a profile removes the way in that was minted for it —
        // otherwise the phrase stays live and the revoke route, which loads
        // the person first, can no longer reach it.
        revokeSpeakerCode(ctx.db, person.id);
      })();
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'delete',
        entity: 'person',
        entityId: person.id,
      });
      ctx.broker.publish(req.event.slug, 'person.deleted', { id: person.id });
      res.status(204).end();
    },
  );

  return router;
}
