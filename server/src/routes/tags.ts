import { Router } from 'express';
import { requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { TagRow } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { toTagDto } from '../mappers.js';
import { limit } from '../ratelimit.js';
import { nextTagColor } from '../shared/tagColors.js';
import { parse, tagPatchSchema, tagSchema } from '../validation.js';

export function tagRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });
  const adminWrite = [requireRole(ctx.db, 'admin'), requireWritable, limit(ctx.limiter, 'write')];

  const load = (eventId: number, id: number): TagRow => {
    const row = ctx.db
      .prepare<[number, number], TagRow>(
        'SELECT * FROM tags WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(id, eventId);
    if (!row) throw notFound('No such tag');
    return row;
  };

  /** Tag names are unique per event — including against soft-deleted rows,
   *  which the schema's UNIQUE index still counts. Revive rather than clash. */
  const nameClash = (eventId: number, name: string, excludeId?: number): TagRow | undefined =>
    ctx.db
      .prepare<[number, string, number], TagRow>(
        'SELECT * FROM tags WHERE event_id = ? AND name = ? AND id != ?',
      )
      .get(eventId, name, excludeId ?? -1);

  router.post('/tags', ...adminWrite, (req, res) => {
    const body = parse(tagSchema, req.body);
    const clash = nameClash(req.event.id, body.name);
    let id: number;
    if (clash && clash.deleted_at !== null) {
      ctx.db
        .prepare('UPDATE tags SET color = ?, deleted_at = NULL WHERE id = ?')
        .run(body.color ?? clash.color, clash.id);
      id = clash.id;
    } else if (clash) {
      throw conflict('A tag with that name already exists', 'tag_exists');
    } else {
      // A tag with no colour asked for gets the first one no live tag is
      // using, the way a room and a track already do. Every tag used to start
      // the same grey, so an event's tags were told apart by reading them —
      // which is most of what a colour on a chip is for.
      const live = ctx.db
        .prepare<[number], { color: string }>(
          'SELECT color FROM tags WHERE event_id = ? AND deleted_at IS NULL',
        )
        .all(req.event.id);
      const info = ctx.db
        .prepare('INSERT INTO tags (event_id, name, color) VALUES (?, ?, ?)')
        .run(req.event.id, body.name, body.color ?? nextTagColor(live.map((t) => t.color)));
      id = Number(info.lastInsertRowid);
    }
    const dto = toTagDto(load(req.event.id, id));
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'create',
      entity: 'tag',
      entityId: id,
    });
    ctx.broker.publish(req.event.slug, 'tag.created', dto);
    res.status(201).json(dto);
  });

  router.patch('/tags/:id', ...adminWrite, (req, res) => {
    const existing = load(req.event.id, Number(req.params.id));
    const body = parse(tagPatchSchema, req.body);
    if (body.name && nameClash(req.event.id, body.name, existing.id)) {
      throw conflict('A tag with that name already exists', 'tag_exists');
    }
    ctx.db
      .prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?')
      .run(body.name ?? existing.name, body.color ?? existing.color, existing.id);
    const dto = toTagDto(load(req.event.id, existing.id));
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'update',
      entity: 'tag',
      entityId: existing.id,
    });
    ctx.broker.publish(req.event.slug, 'tag.updated', dto);
    res.json(dto);
  });

  router.delete('/tags/:id', ...adminWrite, (req, res) => {
    const tag = load(req.event.id, Number(req.params.id));
    ctx.db.transaction(() => {
      ctx.db.prepare('DELETE FROM session_tags WHERE tag_id = ?').run(tag.id);
      ctx.db
        .prepare('UPDATE tags SET deleted_at = ? WHERE id = ?')
        .run(new Date().toISOString(), tag.id);
    })();
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'delete',
      entity: 'tag',
      entityId: tag.id,
    });
    ctx.broker.publish(req.event.slug, 'tag.deleted', { id: tag.id });
    res.status(204).end();
  });

  return router;
}
