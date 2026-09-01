import { Router } from 'express';
import { requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { TrackRow } from '../db.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { toTrackDto } from '../mappers.js';
import { limit } from '../ratelimit.js';
import { nextRoomColor } from '../shared/roomColors.js';
import { replaceTrackWindows, trackWindows, trackWindowsFor } from '../trackHours.js';
import { parse, trackOrderSchema, trackPatchSchema, trackSchema } from '../validation.js';

/**
 * Tracks — thematic strands the schedule can use as its columns instead of
 * rooms. Ordered like rooms, because that order *is* the column order; named
 * uniquely per event like tags, because a duplicate strand is a mistake.
 */
export function trackRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });
  const adminWrite = [requireRole(ctx.db, 'admin'), requireWritable, limit(ctx.limiter, 'write')];

  const load = (eventId: number, id: number): TrackRow => {
    const row = ctx.db
      .prepare<[number, number], TrackRow>(
        'SELECT * FROM tracks WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(id, eventId);
    if (!row) throw notFound('No such track');
    return row;
  };

  /** A track always travels with its overrides — the client draws the hours
   *  from the DTO, so a reply without them would read as "limit lifted". */
  const dtoOf = (eventId: number, id: number) =>
    toTrackDto(load(eventId, id), trackWindows(ctx.db, id));

  /** Names are unique per event, and the index counts soft-deleted rows too —
   *  so revive rather than clash, exactly as tags do. */
  const nameClash = (eventId: number, name: string, excludeId?: number): TrackRow | undefined =>
    ctx.db
      .prepare<[number, string, number], TrackRow>(
        'SELECT * FROM tracks WHERE event_id = ? AND name = ? AND id != ?',
      )
      .get(eventId, name, excludeId ?? -1);

  router.post('/tracks', ...adminWrite, (req, res) => {
    const body = parse(trackSchema, req.body);
    const live = ctx.db
      .prepare<[number], TrackRow>(
        'SELECT * FROM tracks WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
      )
      .all(req.event.id);
    const color = body.color ?? nextRoomColor(live.map((t) => t.color));
    const clash = nameClash(req.event.id, body.name);

    // A window is a pair or nothing; the schema has already refused a half.
    const startMin = body.startMin ?? null;
    const endMin = body.endMin ?? null;

    let id: number;
    if (clash && clash.deleted_at !== null) {
      ctx.db
        .prepare(
          `UPDATE tracks SET description = ?, color = ?, deleted_at = NULL, sort_order = ?,
            start_min = ?, end_min = ? WHERE id = ?`,
        )
        .run(
          body.description ?? '',
          body.color ?? clash.color,
          live.length,
          startMin,
          endMin,
          clash.id,
        );
      id = clash.id;
    } else if (clash) {
      throw conflict('A track with that name already exists', 'track_exists');
    } else {
      id = Number(
        ctx.db
          .prepare(
            `INSERT INTO tracks (event_id, name, description, color, sort_order, start_min, end_min)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            req.event.id,
            body.name,
            body.description ?? '',
            color,
            live.length,
            startMin,
            endMin,
          ).lastInsertRowid,
      );
    }
    // A revived track keeps nothing of the hours it kept before it was deleted.
    replaceTrackWindows(ctx.db, id, body.windows ?? []);

    const dto = dtoOf(req.event.id, id);
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'create',
      entity: 'track',
      entityId: id,
    });
    ctx.broker.publish(req.event.slug, 'track.created', dto);
    res.status(201).json(dto);
  });

  router.patch('/tracks/:id', ...adminWrite, (req, res) => {
    const existing = load(req.event.id, Number(req.params.id));
    const body = parse(trackPatchSchema, req.body);
    if (body.name && nameClash(req.event.id, body.name, existing.id)) {
      throw conflict('A track with that name already exists', 'track_exists');
    }
    // `startMin: null` lifts the limit; omitting it leaves the stored one
    // alone, so renaming a track never quietly opens its hours.
    const startMin = body.startMin === undefined ? existing.start_min : body.startMin;
    const endMin = body.endMin === undefined ? existing.end_min : body.endMin;
    ctx.db
      .prepare(
        `UPDATE tracks SET name = ?, description = ?, color = ?, start_min = ?, end_min = ?
          WHERE id = ?`,
      )
      .run(
        body.name ?? existing.name,
        // '' is a real value here — it is how a description is cleared — so
        // only an omitted field falls back to what is stored.
        body.description ?? existing.description,
        body.color ?? existing.color,
        startMin,
        endMin,
        existing.id,
      );
    if (body.windows) replaceTrackWindows(ctx.db, existing.id, body.windows);

    // Sessions already on the track are left exactly where they are, whatever
    // the new hours say. Narrowing a window is a statement about what may be
    // booked next, not an instruction to move a programme that already exists.
    const dto = dtoOf(req.event.id, existing.id);
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'update',
      entity: 'track',
      entityId: existing.id,
    });
    ctx.broker.publish(req.event.slug, 'track.updated', dto);
    res.json(dto);
  });

  /** Reorder wholesale: the client sends every id in the order it wants. */
  router.patch('/tracks', ...adminWrite, (req, res) => {
    const { ids } = parse(trackOrderSchema, req.body);
    const live = ctx.db
      .prepare<[number], TrackRow>(
        'SELECT * FROM tracks WHERE event_id = ? AND deleted_at IS NULL',
      )
      .all(req.event.id);
    const known = new Set(live.map((t) => t.id));
    // Length and membership alone would let [a, a] through for two tracks,
    // silently leaving the other one unordered.
    const sent = new Set(ids);
    if (sent.size !== ids.length || sent.size !== known.size || ids.some((id) => !known.has(id))) {
      throw badRequest('Send every track of this event exactly once');
    }
    const update = ctx.db.prepare('UPDATE tracks SET sort_order = ? WHERE id = ?');
    ctx.db.transaction(() => ids.forEach((id, i) => update.run(i, id)))();

    const rows = ctx.db
      .prepare<[number], TrackRow>(
        'SELECT * FROM tracks WHERE event_id = ? AND deleted_at IS NULL ORDER BY sort_order, id',
      )
      .all(req.event.id);
    const windows = trackWindowsFor(
      ctx.db,
      rows.map((t) => t.id),
    );
    const ordered = rows.map((t) => toTrackDto(t, windows.get(t.id) ?? []));
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'reorder',
      entity: 'track',
      entityId: req.event.id,
    });
    for (const dto of ordered) ctx.broker.publish(req.event.slug, 'track.updated', dto);
    res.json(ordered);
  });

  router.delete('/tracks/:id', ...adminWrite, (req, res) => {
    const track = load(req.event.id, Number(req.params.id));
    // Unlike a room, a track is not load-bearing: a session without one still
    // has somewhere to be. So deleting clears it from its sessions rather than
    // refusing, which is how tags behave too.
    ctx.db.transaction(() => {
      ctx.db.prepare('UPDATE sessions SET track_id = NULL WHERE track_id = ?').run(track.id);
      // The overrides go with it: a revived track states its hours afresh.
      ctx.db.prepare('DELETE FROM track_windows WHERE track_id = ?').run(track.id);
      ctx.db
        .prepare('UPDATE tracks SET deleted_at = ? WHERE id = ?')
        .run(new Date().toISOString(), track.id);
    })();
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'delete',
      entity: 'track',
      entityId: track.id,
    });
    ctx.broker.publish(req.event.slug, 'track.deleted', { id: track.id });
    res.status(204).end();
  });

  return router;
}
