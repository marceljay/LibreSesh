import { Router } from 'express';
import { requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import { markDirty } from '../nostr/queue.js';
import type { Ctx } from '../context.js';
import type { FormatRow } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { toFormatDto } from '../mappers.js';
import { limit } from '../ratelimit.js';
import { nextTagColor } from '../shared/tagColors.js';
import { formatPatchSchema, formatSchema, parse } from '../validation.js';

/**
 * Formats — what kind of session a session is. Managed exactly the way tags
 * are: admin-only, soft-deleted, unique by name per event. The one difference
 * is order, which is the organiser's running order (keynote, talk, lightning)
 * rather than alphabetical, so a new format goes on the end.
 */
export function formatRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });
  const adminWrite = [requireRole(ctx.db, 'admin'), requireWritable, limit(ctx.limiter, 'write')];

  const load = (eventId: number, id: number): FormatRow => {
    const row = ctx.db
      .prepare<[number, number], FormatRow>(
        'SELECT * FROM session_formats WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(id, eventId);
    if (!row) throw notFound('No such format');
    return row;
  };

  /** Names are unique per event, and the UNIQUE index counts soft-deleted rows
   *  too — so a name that clashes with a deleted format revives it. */
  const nameClash = (eventId: number, name: string, excludeId?: number): FormatRow | undefined =>
    ctx.db
      .prepare<[number, string, number], FormatRow>(
        'SELECT * FROM session_formats WHERE event_id = ? AND name = ? AND id != ?',
      )
      .get(eventId, name, excludeId ?? -1);

  router.post('/formats', ...adminWrite, (req, res) => {
    const body = parse(formatSchema, req.body);
    const clash = nameClash(req.event.id, body.name);
    let id: number;
    if (clash && clash.deleted_at !== null) {
      ctx.db
        .prepare('UPDATE session_formats SET color = ?, deleted_at = NULL WHERE id = ?')
        .run(body.color ?? clash.color, clash.id);
      id = clash.id;
    } else if (clash) {
      throw conflict('A format with that name already exists', 'format_exists');
    } else {
      // Same palette as tags, and the same rule: the first colour no live
      // format is wearing, so a list of them is legible without anyone
      // picking colours by hand.
      const live = ctx.db
        .prepare<[number], { color: string }>(
          'SELECT color FROM session_formats WHERE event_id = ? AND deleted_at IS NULL',
        )
        .all(req.event.id);
      const last = ctx.db
        .prepare<[number], { max: number | null }>(
          'SELECT MAX(sort_order) AS max FROM session_formats WHERE event_id = ?',
        )
        .get(req.event.id);
      const info = ctx.db
        .prepare(
          `INSERT INTO session_formats (event_id, name, color, sort_order)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          req.event.id,
          body.name,
          body.color ?? nextTagColor(live.map((f) => f.color)),
          (last?.max ?? -1) + 1,
        );
      id = Number(info.lastInsertRowid);
    }
    const dto = toFormatDto(load(req.event.id, id));
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'create',
      entity: 'format',
      entityId: id,
    });
    ctx.broker.publish(req.event.slug, 'format.created', dto);
    res.status(201).json(dto);
  });

  router.patch('/formats/:id', ...adminWrite, (req, res) => {
    const existing = load(req.event.id, Number(req.params.id));
    const body = parse(formatPatchSchema, req.body);
    if (body.name && nameClash(req.event.id, body.name, existing.id)) {
      throw conflict('A format with that name already exists', 'format_exists');
    }
    ctx.db
      .prepare('UPDATE session_formats SET name = ?, color = ? WHERE id = ?')
      .run(body.name ?? existing.name, body.color ?? existing.color, existing.id);
    const dto = toFormatDto(load(req.event.id, existing.id));
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'update',
      entity: 'format',
      entityId: existing.id,
    });
    markDirty(ctx.db, req.event.id);
    ctx.broker.publish(req.event.slug, 'format.updated', dto);
    res.json(dto);
  });

  router.delete('/formats/:id', ...adminWrite, (req, res) => {
    const format = load(req.event.id, Number(req.params.id));
    ctx.db.transaction(() => {
      // The sessions keep existing and keep their slot; they simply stop
      // saying what kind of thing they are, which is the state every session
      // in the app was in before formats existed.
      ctx.db.prepare('UPDATE sessions SET format_id = NULL WHERE format_id = ?').run(format.id);
      ctx.db
        .prepare('UPDATE session_formats SET deleted_at = ? WHERE id = ?')
        .run(new Date().toISOString(), format.id);
    })();
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'delete',
      entity: 'format',
      entityId: format.id,
    });
    markDirty(ctx.db, req.event.id);
    ctx.broker.publish(req.event.slug, 'format.deleted', { id: format.id });
    res.status(204).end();
  });

  return router;
}
