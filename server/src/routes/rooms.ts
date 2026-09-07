import { Router } from 'express';
import { requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { RoomRow } from '../db.js';
import { conflict, notFound } from '../errors.js';
import { toRoomDto } from '../mappers.js';
import { limit } from '../ratelimit.js';
import { nextRoomColor } from '../shared/roomColors.js';
import { parse, roomPatchSchema, roomSchema } from '../validation.js';

export function roomRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });
  const adminWrite = [requireRole(ctx.db, 'admin'), requireWritable, limit(ctx.limiter, 'write')];

  const load = (eventId: number, id: number): RoomRow => {
    const row = ctx.db
      .prepare<[number, number], RoomRow>(
        'SELECT * FROM rooms WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(id, eventId);
    if (!row) throw notFound('No such room');
    return row;
  };

  router.post('/rooms', ...adminWrite, (req, res) => {
    const body = parse(roomSchema, req.body);
    // Default to a colour none of this event's rooms is using, so a new room
    // is distinguishable without anyone picking one.
    const taken = ctx.db
      .prepare<[number], { color: string }>(
        'SELECT color FROM rooms WHERE event_id = ? AND deleted_at IS NULL',
      )
      .all(req.event.id)
      .map((r) => r.color);
    const info = ctx.db
      .prepare(
        `INSERT INTO rooms (event_id, name, description, capacity, color, open_booking, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        req.event.id,
        body.name,
        body.description ?? '',
        body.capacity ?? null,
        body.color ?? nextRoomColor(taken),
        body.openBooking ? 1 : 0,
        body.sortOrder ?? 0,
      );
    const room = load(req.event.id, Number(info.lastInsertRowid));
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'create',
      entity: 'room',
      entityId: room.id,
    });
    const dto = toRoomDto(room);
    ctx.broker.publish(req.event.slug, 'room.created', dto);
    res.status(201).json(dto);
  });

  router.patch('/rooms/:id', ...adminWrite, (req, res) => {
    const existing = load(req.event.id, Number(req.params.id));
    const body = parse(roomPatchSchema, req.body);
    ctx.db
      .prepare(
        `UPDATE rooms SET name = ?, description = ?, capacity = ?, color = ?,
                open_booking = ?, sort_order = ?
          WHERE id = ?`,
      )
      .run(
        body.name ?? existing.name,
        body.description ?? existing.description,
        body.capacity === undefined ? existing.capacity : body.capacity,
        body.color ?? existing.color,
        body.openBooking === undefined ? existing.open_booking : body.openBooking ? 1 : 0,
        body.sortOrder ?? existing.sort_order,
        existing.id,
      );
    const room = load(req.event.id, existing.id);
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'update',
      entity: 'room',
      entityId: room.id,
    });
    const dto = toRoomDto(room);
    ctx.broker.publish(req.event.slug, 'room.updated', dto);
    res.json(dto);
  });

  router.delete('/rooms/:id', ...adminWrite, (req, res) => {
    const room = load(req.event.id, Number(req.params.id));
    const inUse = ctx.db
      .prepare<[number], { n: number }>(
        'SELECT COUNT(*) AS n FROM sessions WHERE room_id = ? AND deleted_at IS NULL',
      )
      .get(room.id);
    if ((inUse?.n ?? 0) > 0) {
      throw conflict('Move or remove this room’s sessions first', 'room_in_use');
    }
    ctx.db
      .prepare('UPDATE rooms SET deleted_at = ? WHERE id = ?')
      .run(new Date().toISOString(), room.id);
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'delete',
      entity: 'room',
      entityId: room.id,
    });
    ctx.broker.publish(req.event.slug, 'room.deleted', { id: room.id });
    res.status(204).end();
  });

  return router;
}
