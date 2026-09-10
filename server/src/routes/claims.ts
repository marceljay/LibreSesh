import { Router } from 'express';
import { requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import { claimById, loadClaims, openClaimOf } from '../claims.js';
import type { Ctx } from '../context.js';
import type { PersonRow } from '../db.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { factsFor, toPersonDto } from '../mappers.js';
import { auditMerge, broadcastMerge, mergePeople } from '../mergePeople.js';
import { adoptProfile, ownProfile } from '../people.js';
import { limit } from '../ratelimit.js';

/**
 * Asking for the profile an organiser left for you, and an organiser
 * answering.
 *
 * The other three ways in all need somebody else to act first — a minted
 * speaker phrase, an organiser merging two profiles, or the login page happening to
 * offer the shell because the username you typed matched its full name. This
 * is the one that starts with the person it concerns.
 *
 * It stops at a request rather than doing the thing, because a shell is
 * usually credited on sessions, and holding the profile a session credits is
 * the right to rewrite that talk. An organiser approving one is the same
 * decision they make when merging by hand, and it runs the same code.
 */
export function claimRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  const loadPerson = (eventId: number, id: number): PersonRow => {
    const row = ctx.db
      .prepare<[number, number], PersonRow>(
        'SELECT * FROM people WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(id, eventId);
    if (!row) throw notFound('No such profile');
    return row;
  };

  const mine = (req: { event: { id: number }; identity: { id: number }; role: string }) =>
    loadClaims(ctx.db, req.event.id, req.identity.id, req.role === 'admin');

  /** "That profile is me." */
  router.post(
    '/people/:id/claim',
    requireRole(ctx.db, 'viewer'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const person = loadPerson(req.event.id, Number(req.params.id));
      if (person.identity_id !== null) {
        throw conflict(
          person.identity_id === req.identity.id
            ? 'That profile is already yours'
            : 'Somebody already holds that profile',
          'already_claimed',
        );
      }
      const open = openClaimOf(ctx.db, req.event.id, req.identity.id);
      if (open) {
        throw conflict(
          open.person_id === person.id
            ? 'You have already asked for that one — an organiser has not answered yet'
            : 'You are already waiting on another profile. Withdraw that request first.',
          'claim_pending',
        );
      }

      ctx.db
        .prepare(
          'INSERT INTO profile_claims (event_id, person_id, identity_id, requested_at) VALUES (?, ?, ?, ?)',
        )
        .run(req.event.id, person.id, req.identity.id, new Date().toISOString());
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'claim_request',
        entity: 'person',
        entityId: person.id,
      });
      res.status(201).json(mine(req));
    },
  );

  /**
   * Yes, that is them. Runs the merge an organiser would otherwise have run
   * by hand, with the shell surviving so it keeps the name and the sessions
   * it was created for, and the asker's own profile folded into it.
   */
  router.post(
    '/claims/:id/approve',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const claim = claimById(ctx.db, req.event.id, Number(req.params.id));
      if (!claim || claim.declined_at !== null) throw notFound('No such request');
      const shell = loadPerson(req.event.id, claim.person_id);
      if (shell.identity_id !== null) {
        throw conflict('Somebody already holds that profile', 'already_claimed');
      }

      const theirs = ownProfile(ctx.db, req.event.id, claim.identity_id);
      const now = new Date().toISOString();
      const result = ctx.db.transaction(() => {
        // Everybody else who asked for this one has just lost it, and should
        // be told rather than left waiting on a queue that will never move.
        ctx.db
          .prepare(
            `UPDATE profile_claims SET declined_at = ?
              WHERE event_id = ? AND person_id = ? AND declined_at IS NULL AND id != ?`,
          )
          .run(now, req.event.id, shell.id, claim.id);
        ctx.db.prepare('DELETE FROM profile_claims WHERE id = ?').run(claim.id);
        // Everyone who enters holds a profile, so there is nearly always one
        // to fold in. The bare adoption is for an identity that somehow has
        // none — one that entered before migration 010 and has not been
        // through a login page since.
        if (theirs && theirs.id !== shell.id) {
          return mergePeople(ctx.db, req.event.id, shell, theirs);
        }
        adoptProfile(ctx.db, shell.id, claim.identity_id);
        return null;
      })();

      const dto = toPersonDto(
        loadPerson(req.event.id, shell.id),
        req.identity.id,
        factsFor(ctx.db, req.event.id, shell.id),
      );
      if (result && theirs) {
        auditMerge(ctx.db, req.identity.id, req.event.id, theirs.id, 'claim_approve');
        broadcastMerge(
          ctx.db,
          ctx.broker,
          req.event.slug,
          req.event.id,
          req.identity.id,
          theirs.id,
          dto,
          result,
        );
      } else {
        audit(ctx.db, {
          identityId: req.identity.id,
          eventId: req.event.id,
          action: 'claim_approve',
          entity: 'person',
          entityId: shell.id,
        });
        ctx.broker.publish(req.event.slug, 'person.updated', dto);
      }
      res.json(mine(req));
    },
  );

  /** No. The asker is told, once, rather than left refreshing. */
  router.post(
    '/claims/:id/decline',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const claim = claimById(ctx.db, req.event.id, Number(req.params.id));
      if (!claim || claim.declined_at !== null) throw notFound('No such request');
      ctx.db
        .prepare('UPDATE profile_claims SET declined_at = ? WHERE id = ?')
        .run(new Date().toISOString(), claim.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'claim_decline',
        entity: 'person',
        entityId: claim.person_id,
      });
      res.json(mine(req));
    },
  );

  /** Withdrawing your own request, or clearing one you were refused. An
   *  organiser may also clear a request that has gone stale. */
  router.delete(
    '/claims/:id',
    requireRole(ctx.db, 'viewer'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const claim = claimById(ctx.db, req.event.id, Number(req.params.id));
      if (!claim) throw notFound('No such request');
      if (claim.identity_id !== req.identity.id && req.role !== 'admin') {
        throw forbidden('That is not your request');
      }
      ctx.db.prepare('DELETE FROM profile_claims WHERE id = ?').run(claim.id);
      res.json(mine(req));
    },
  );

  return router;
}
