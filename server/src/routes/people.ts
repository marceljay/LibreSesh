import { Router } from 'express';
import { atLeast, requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import {
  mintSpeakerCode,
  revokeSpeakerCode,
  settleSpeakerCodeAfterMerge,
} from '../deviceLink.js';
import type { PersonRow, SessionRow } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { rekeyIdentityWork } from '../mergeIdentityWork.js';
import { loadProposalDtos, loadSessionDto, toPersonDto } from '../mappers.js';
import { requireCapability } from '../permissions.js';
import { limit } from '../ratelimit.js';
import {
  mergePersonSchema,
  myProfileSchema,
  parse,
  personPatchSchema,
  personSchema,
} from '../validation.js';
import type { PersonDetailDto } from '../shared/types.js';

/**
 * Speaker and host profiles, scoped to one event (SPEC follow-up to §4).
 * Organisers curate the roster; an attendee owns at most one profile per event
 * and may edit that one whatever their role — viewers included.
 */
export function peopleRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  const load = (eventId: number, id: number): PersonRow => {
    const row = ctx.db
      .prepare<[number, number], PersonRow>(
        'SELECT * FROM people WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(id, eventId);
    if (!row) throw notFound('No such profile');
    return row;
  };

  const nameClash = (eventId: number, name: string, excludeId?: number): PersonRow | undefined =>
    ctx.db
      .prepare<[number, string, number], PersonRow>(
        'SELECT * FROM people WHERE event_id = ? AND name = ? AND deleted_at IS NULL AND id != ?',
      )
      .get(eventId, name, excludeId ?? -1);

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
      person: toPersonDto(person, req.identity.id),
      sessions: sessions.map((s) => loadSessionDto(ctx.db, s)),
    };
    res.json(detail);
  });

  /** Your own profile for this event, created on first edit. */
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

      const name = body.name ?? existing?.name ?? req.identity.display_name;
      const clash = nameClash(req.event.id, name, existing?.id);
      // Naming yourself as the speaker on a session or a pitch auto-creates an
      // unclaimed person under your display name. Refusing the collision would
      // lock you out of your own profile for good, since every retry defaults
      // to the same name — so claim that record instead. It is the same person,
      // and it folds the speaker entry into the profile.
      if (clash && clash.identity_id !== null) {
        throw conflict('Someone else here already goes by that name', 'name_taken');
      }

      let id: number;
      if (existing) {
        write(existing, { ...body, name });
        id = existing.id;
      } else if (clash) {
        ctx.db
          .prepare('UPDATE people SET identity_id = ? WHERE id = ?')
          .run(req.identity.id, clash.id);
        write(clash, { ...body, name });
        id = clash.id;
      } else {
        const now = new Date().toISOString();
        id = Number(
          ctx.db
            .prepare(
              `INSERT INTO people (event_id, identity_id, name, bio, links, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              req.event.id,
              req.identity.id,
              name,
              body.bio ?? '',
              JSON.stringify(body.links ?? []),
              now,
              now,
            ).lastInsertRowid,
        );
      }

      const dto = toPersonDto(load(req.event.id, id), req.identity.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: existing ? 'update' : 'create',
        entity: 'person',
        entityId: id,
      });
      ctx.broker.publish(req.event.slug, existing ? 'person.updated' : 'person.created', dto);
      res.status(existing ? 200 : 201).json(dto);
    },
  );

  router.post(
    '/people',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const body = parse(personSchema, req.body);
      if (nameClash(req.event.id, body.name)) {
        throw conflict('Someone here already goes by that name', 'name_taken');
      }
      const now = new Date().toISOString();
      const id = Number(
        ctx.db
          .prepare(
            `INSERT INTO people (event_id, identity_id, name, bio, links, created_at, updated_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?)`,
          )
          .run(
            req.event.id,
            body.name,
            body.bio ?? '',
            JSON.stringify(body.links ?? []),
            now,
            now,
          ).lastInsertRowid,
      );
      const dto = toPersonDto(load(req.event.id, id), req.identity.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'create',
        entity: 'person',
        entityId: id,
      });
      ctx.broker.publish(req.event.slug, 'person.created', dto);
      res.status(201).json(dto);
    },
  );

  router.patch(
    '/people/:id',
    requireRole(ctx.db, 'viewer'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const person = load(req.event.id, Number(req.params.id));
      // Organisers edit anyone; everyone else edits only the profile they own.
      const mine = person.identity_id !== null && person.identity_id === req.identity.id;
      if (!atLeast(req.role, 'admin') && !mine) {
        throw forbidden('That is not your profile');
      }

      const body = parse(personPatchSchema, req.body);
      if (body.name && nameClash(req.event.id, body.name, person.id)) {
        throw conflict('Someone here already goes by that name', 'name_taken');
      }
      write(person, body);

      const dto = toPersonDto(load(req.event.id, person.id), req.identity.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'update',
        entity: 'person',
        entityId: person.id,
      });
      ctx.broker.publish(req.event.slug, 'person.updated', dto);
      res.json(dto);
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

      const now = new Date().toISOString();
      const movedSessions = ctx.db
        .prepare<[number], { id: number }>(
          'SELECT session_id AS id FROM session_speakers WHERE person_id = ?',
        )
        .all(loser.id)
        .map((r) => r.id);
      let rekeyed = { sessionIds: [] as number[], proposalIds: [] as number[] };

      ctx.db.transaction(() => {
        // A session billed to both halves of a merge must not end up billed
        // to the survivor twice — which the primary key would refuse anyway,
        // taking the whole merge down with it. Drop the duplicate, then move
        // what is left.
        ctx.db
          .prepare(
            `DELETE FROM session_speakers
              WHERE person_id = ?
                AND session_id IN (SELECT session_id FROM session_speakers WHERE person_id = ?)`,
          )
          .run(loser.id, survivor.id);
        ctx.db
          .prepare('UPDATE session_speakers SET person_id = ? WHERE person_id = ?')
          .run(survivor.id, loser.id);
        ctx.db
          .prepare('UPDATE proposals SET speaker_id = ? WHERE speaker_id = ?')
          .run(survivor.id, loser.id);
        // The loser's claim must be nulled before the survivor takes it:
        // (event_id, identity_id) is unique among live rows, and the loser is
        // still live at this point in the transaction.
        ctx.db
          .prepare('UPDATE people SET identity_id = NULL, deleted_at = ? WHERE id = ?')
          .run(now, loser.id);
        const survivingIdentity = survivor.identity_id ?? loser.identity_id;
        ctx.db
          .prepare(
            'UPDATE people SET identity_id = ?, bio = ?, links = ?, updated_at = ? WHERE id = ?',
          )
          .run(
            survivingIdentity,
            survivor.bio || loser.bio,
            survivor.links === '[]' ? loser.links : survivor.links,
            now,
            survivor.id,
          );
        // The loser's row is gone from the roster; its speaker code must not
        // outlive it as a phrase nobody can revoke.
        settleSpeakerCodeAfterMerge(ctx.db, loser.id, survivor.id, survivingIdentity);
        // Only a both-claimed merge leaves a second identity behind to strip.
        // When the survivor inherited the loser's identity, the work already
        // belongs to the surviving pair and there is nothing to move.
        if (
          loser.identity_id !== null &&
          survivor.identity_id !== null &&
          survivor.identity_id !== loser.identity_id
        ) {
          rekeyed = rekeyIdentityWork(ctx.db, req.event.id, loser.identity_id, survivor.identity_id);
        }
      })();

      const dto = toPersonDto(load(req.event.id, survivor.id), req.identity.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'merge',
        entity: 'person',
        entityId: loser.id,
      });
      ctx.broker.publish(req.event.slug, 'person.deleted', { id: loser.id });
      ctx.broker.publish(req.event.slug, 'person.updated', dto);
      if (rekeyed.proposalIds.length > 0) {
        const changed = new Set(rekeyed.proposalIds);
        for (const proposal of loadProposalDtos(ctx.db, req.event.id, req.identity.id)) {
          if (changed.has(proposal.id)) {
            ctx.broker.publish(req.event.slug, 'proposal.updated', proposal);
          }
        }
      }
      for (const sessionId of new Set([...movedSessions, ...rekeyed.sessionIds])) {
        const row = ctx.db
          .prepare<[number], SessionRow>('SELECT * FROM sessions WHERE id = ?')
          .get(sessionId);
        if (row && row.deleted_at === null) {
          ctx.broker.publish(req.event.slug, 'session.updated', loadSessionDto(ctx.db, row));
        }
      }
      res.json(dto);
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
      ctx.broker.publish(
        req.event.slug,
        'person.updated',
        toPersonDto(load(req.event.id, person.id), req.identity.id),
      );
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
