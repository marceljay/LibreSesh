import { Router } from 'express';
import { requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { ContributionRow, SessionRow } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { NameResolver } from '../eventIdentity.js';
import { loadSessionDto, toContributionDto } from '../mappers.js';
import { limit } from '../ratelimit.js';

/**
 * Undo for soft deletes. SPEC §8 keeps deleted rows precisely so an organiser
 * can reverse vandalism; without this they were unreachable once removed.
 */
export function trashRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });
  const adminWrite = [requireRole(ctx.db, 'admin'), requireWritable, limit(ctx.limiter, 'write')];

  router.get('/trash', requireRole(ctx.db, 'admin'), limit(ctx.limiter, 'read'), (req, res) => {
    const names = new NameResolver(ctx.db, req.event.id);
    const sessions = ctx.db
      .prepare<[number], SessionRow>(
        `SELECT * FROM sessions WHERE event_id = ? AND deleted_at IS NOT NULL
          ORDER BY deleted_at DESC LIMIT 100`,
      )
      .all(req.event.id);
    const contributions = ctx.db
      .prepare<[number], ContributionRow>(
        `SELECT c.* FROM contributions c JOIN sessions s ON s.id = c.session_id
          WHERE s.event_id = ? AND c.deleted_at IS NOT NULL
          ORDER BY c.deleted_at DESC LIMIT 100`,
      )
      .all(req.event.id);

    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        deletedAt: s.deleted_at,
        deletedByName: names.get(s.created_by),
      })),
      contributions: contributions.map((c) => ({
        id: c.id,
        sessionId: c.session_id,
        kind: c.kind,
        body: c.body,
        deletedAt: c.deleted_at,
        createdByName: names.get(c.created_by),
      })),
    });
  });

  router.post('/sessions/:id/restore', ...adminWrite, (req, res) => {
    const id = Number(req.params.id);
    const row = ctx.db
      .prepare<[number, number], SessionRow>(
        'SELECT * FROM sessions WHERE id = ? AND event_id = ? AND deleted_at IS NOT NULL',
      )
      .get(id, req.event.id);
    if (!row) throw notFound('No deleted session with that id');

    // Its room may have been removed in the meantime; refuse rather than
    // resurrect a session pointing at nothing.
    const room = ctx.db
      .prepare<[number], { id: number }>('SELECT id FROM rooms WHERE id = ? AND deleted_at IS NULL')
      .get(row.room_id);
    if (!room) throw conflict('That session’s room is gone — recreate it first', 'room_missing');

    ctx.db
      .prepare('UPDATE sessions SET deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), row.id);

    const dto = loadSessionDto(ctx.db, { ...row, deleted_at: null });
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'restore',
      entity: 'session',
      entityId: row.id,
    });
    ctx.broker.publish(req.event.slug, 'session.created', dto);
    res.json(dto);
  });

  router.post('/contributions/:id/restore', ...adminWrite, (req, res) => {
    const id = Number(req.params.id);
    const row = ctx.db
      .prepare<[number, number], ContributionRow>(
        `SELECT c.* FROM contributions c JOIN sessions s ON s.id = c.session_id
          WHERE c.id = ? AND s.event_id = ? AND c.deleted_at IS NOT NULL`,
      )
      .get(id, req.event.id);
    if (!row) throw notFound('No deleted contribution with that id');

    ctx.db.prepare('UPDATE contributions SET deleted_at = NULL WHERE id = ?').run(row.id);

    const dto = toContributionDto(
      { ...row, deleted_at: null },
      new NameResolver(ctx.db, req.event.id).get(row.created_by),
    );
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'restore',
      entity: 'contribution',
      entityId: row.id,
    });
    ctx.broker.publish(req.event.slug, 'contribution.created', dto);
    res.status(200).json(dto);
  });

  return router;
}
