import { Router } from 'express';
import { atLeast, requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { ProposalRow } from '../db.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { NameResolver } from '../eventIdentity.js';
import {
  loadSessionDto,
  speakerNames,
  toProposalDto,
} from '../mappers.js';
import { getPermissions, requireCapability } from '../permissions.js';
import { limit } from '../ratelimit.js';
import { resolveSpeaker, setSessionSpeakers } from '../speakers.js';
import {
  assertMayPlace,
  assertNoOverlap,
  assertTagsBelong,
  assertValidTimes,
  getRoom,
  getSession,
} from '../sessionRules.js';
import { parse, placeSchema, proposalPatchSchema, proposalSchema } from '../validation.js';

/**
 * The unconference flow: anyone may pitch a session with no room or time, the
 * room shows interest, and an organiser places the popular ones on the grid.
 */
export function proposalRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  const load = (eventId: number, id: number): ProposalRow => {
    const row = ctx.db
      .prepare<[number, number], ProposalRow>(
        'SELECT * FROM proposals WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(id, eventId);
    if (!row) throw notFound('No such proposal');
    return row;
  };

  /** Rebuild one proposal's DTO for the given viewer. */
  const dtoFor = (row: ProposalRow, viewerId: number) => {
    const tagIds = ctx.db
      .prepare<[number], { tag_id: number }>(
        'SELECT tag_id FROM proposal_tags WHERE proposal_id = ?',
      )
      .all(row.id)
      .map((r) => r.tag_id);
    const count = ctx.db
      .prepare<[number], { n: number }>(
        'SELECT COUNT(*) AS n FROM proposal_interest WHERE proposal_id = ?',
      )
      .get(row.id);
    const mine = ctx.db
      .prepare<[number, number], { proposal_id: number }>(
        'SELECT proposal_id FROM proposal_interest WHERE proposal_id = ? AND identity_id = ?',
      )
      .get(row.id, viewerId);
    return toProposalDto(row, {
      tagIds,
      authorName: new NameResolver(ctx.db, row.event_id).get(row.created_by),
      speakerName:
        row.speaker_id === null
          ? ''
          : (speakerNames(ctx.db, row.event_id).get(row.speaker_id) ?? ''),
      interestCount: count?.n ?? 0,
      interested: mine !== undefined,
    });
  };

  const setTags = (proposalId: number, tagIds: number[]) => {
    ctx.db.prepare('DELETE FROM proposal_tags WHERE proposal_id = ?').run(proposalId);
    const insert = ctx.db.prepare(
      'INSERT OR IGNORE INTO proposal_tags (proposal_id, tag_id) VALUES (?, ?)',
    );
    for (const tagId of new Set(tagIds)) insert.run(proposalId, tagId);
  };

  router.post(
    '/proposals',
    requireCapability(ctx.db, 'proposal.create'),
    requireWritable,
    limit(ctx.limiter, 'session'),
    (req, res) => {
      const body = parse(proposalSchema, req.body);
      const tagIds = body.tagIds ?? [];
      assertTagsBelong(ctx.db, req.event.id, tagIds);

      const now = new Date().toISOString();
      const id = ctx.db.transaction((): number => {
        const speakerId = resolveSpeaker(ctx.db, req.event.id, body, null);
        const newId = Number(
          ctx.db
            .prepare(
              `INSERT INTO proposals
                (event_id, title, description, speaker_id, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              req.event.id,
              body.title,
              body.description ?? '',
              speakerId,
              req.identity.id,
              now,
              now,
            ).lastInsertRowid,
        );
        setTags(newId, tagIds);
        return newId;
      })();

      const dto = dtoFor(load(req.event.id, id), req.identity.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'create',
        entity: 'proposal',
        entityId: id,
      });
      ctx.broker.publish(req.event.slug, 'proposal.created', dto);
      res.status(201).json(dto);
    },
  );

  router.patch(
    '/proposals/:id',
    requireCapability(ctx.db, 'proposal.create'),
    requireWritable,
    limit(ctx.limiter, 'session'),
    (req, res) => {
      const row = load(req.event.id, Number(req.params.id));
      if (!atLeast(req.role, 'admin') && row.created_by !== req.identity.id) {
        throw forbidden('That is not your proposal');
      }
      if (row.placed_session_id !== null) {
        throw conflict('That pitch is already on the grid — edit the session instead', 'placed');
      }

      const body = parse(proposalPatchSchema, req.body);
      if (body.tagIds) assertTagsBelong(ctx.db, req.event.id, body.tagIds);

      ctx.db.transaction(() => {
        const speakerId = resolveSpeaker(ctx.db, req.event.id, body, row.speaker_id);
        ctx.db
          .prepare(
            `UPDATE proposals SET title = ?, description = ?, speaker_id = ?, updated_at = ?
              WHERE id = ?`,
          )
          .run(
            body.title ?? row.title,
            body.description ?? row.description,
            speakerId,
            new Date().toISOString(),
            row.id,
          );
        if (body.tagIds) setTags(row.id, body.tagIds);
      })();

      const dto = dtoFor(load(req.event.id, row.id), req.identity.id);
      ctx.broker.publish(req.event.slug, 'proposal.updated', dto);
      res.json(dto);
    },
  );

  router.delete(
    '/proposals/:id',
    requireCapability(ctx.db, 'proposal.create'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const row = load(req.event.id, Number(req.params.id));
      if (!atLeast(req.role, 'admin') && row.created_by !== req.identity.id) {
        throw forbidden('That is not your proposal');
      }
      ctx.db
        .prepare('UPDATE proposals SET deleted_at = ? WHERE id = ?')
        .run(new Date().toISOString(), row.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'delete',
        entity: 'proposal',
        entityId: row.id,
      });
      ctx.broker.publish(req.event.slug, 'proposal.deleted', { id: row.id });
      res.status(204).end();
    },
  );

  /** "I would come to this." Viewers included — interest is not a write to the
   *  programme, and it is the whole point of a pitch board. */
  const interest = [requireCapability(ctx.db, 'proposal.vote'), limit(ctx.limiter, 'write')];

  router.put('/proposals/:id/interest', ...interest, (req, res) => {
    const row = load(req.event.id, Number(req.params.id));
    ctx.db
      .prepare(
        `INSERT INTO proposal_interest (identity_id, proposal_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT(identity_id, proposal_id) DO NOTHING`,
      )
      .run(req.identity.id, row.id, new Date().toISOString());
    ctx.broker.publish(req.event.slug, 'proposal.updated', dtoFor(row, req.identity.id));
    res.status(204).end();
  });

  router.delete('/proposals/:id/interest', ...interest, (req, res) => {
    const row = load(req.event.id, Number(req.params.id));
    ctx.db
      .prepare('DELETE FROM proposal_interest WHERE identity_id = ? AND proposal_id = ?')
      .run(req.identity.id, row.id);
    ctx.broker.publish(req.event.slug, 'proposal.updated', dtoFor(row, req.identity.id));
    res.status(204).end();
  });

  /** Place a pitch on the grid: creates the session and links the two. */
  router.post(
    '/proposals/:id/place',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'session'),
    (req, res) => {
      const row = load(req.event.id, Number(req.params.id));
      if (row.placed_session_id !== null) {
        throw conflict('That pitch is already on the grid', 'placed');
      }

      const body = parse(placeSchema, req.body);
      const room = getRoom(ctx.db, req.event.id, body.roomId);
      const type = body.type ?? (room.open_booking === 1 ? 'open' : 'official');
      assertMayPlace(getPermissions(ctx.db, req.event.id), req.role, room, type);

      const window = { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) };
      assertValidTimes(req.event, window);
      assertNoOverlap(ctx.db, req.event.id, room.id, window);

      const now = new Date().toISOString();
      const sessionId = ctx.db.transaction((): number => {
        const id = Number(
          ctx.db
            .prepare(
              `INSERT INTO sessions
                (event_id, room_id, type, title, description, speaker,
                 starts_at, ends_at, created_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
            )
            .run(
              req.event.id,
              room.id,
              type,
              row.title,
              row.description,
              window.startsAt.toISOString(),
              window.endsAt.toISOString(),
              // The pitcher keeps ownership, so they can still edit an open session.
              row.created_by,
              now,
              now,
            ).lastInsertRowid,
        );
        // And its speaker. A pitch names one person; the session it becomes
        // can be given more later, which is the point of the join table.
        if (row.speaker_id !== null) {
          setSessionSpeakers(ctx.db, id, [row.speaker_id]);
        }

        // Carry the pitch's tags onto the session.
        const tagIds = ctx.db
          .prepare<[number], { tag_id: number }>(
            'SELECT tag_id FROM proposal_tags WHERE proposal_id = ?',
          )
          .all(row.id)
          .map((r) => r.tag_id);
        const insert = ctx.db.prepare(
          'INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)',
        );
        for (const tagId of tagIds) insert.run(id, tagId);

        // Everyone who said they would come now has it on their agenda —
        // otherwise the signal is lost exactly when it becomes actionable.
        ctx.db
          .prepare(
            `INSERT OR IGNORE INTO stars (identity_id, session_id, created_at)
             SELECT identity_id, ?, ? FROM proposal_interest WHERE proposal_id = ?`,
          )
          .run(id, now, row.id);

        ctx.db
          .prepare('UPDATE proposals SET placed_session_id = ?, updated_at = ? WHERE id = ?')
          .run(id, now, row.id);
        return id;
      })();

      const session = loadSessionDto(ctx.db, getSession(ctx.db, req.event.id, sessionId));
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'place',
        entity: 'proposal',
        entityId: row.id,
      });
      ctx.broker.publish(req.event.slug, 'session.created', session);
      ctx.broker.publish(
        req.event.slug,
        'proposal.updated',
        dtoFor(load(req.event.id, row.id), req.identity.id),
      );
      res.status(201).json({ session, proposalId: row.id });
    },
  );

  return router;
}
