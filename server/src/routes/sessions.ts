import { Router } from 'express';
import { requireRole, requireWritable } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { SessionRow } from '../db.js';
import { badRequest, forbidden } from '../errors.js';
import { loadSessionDto } from '../mappers.js';
import { getPermissions, requireCapability } from '../permissions.js';
import { limit } from '../ratelimit.js';
import {
    assertMayBlock,
  assertMayMutate,
  assertMayPlace,
  assertNoOverlap,
  assertNotBlocked,
  assertNotStale,
  assertTagsBelong,
  assertTrackBelongs,
  assertValidTimes,
  assertWithinEventWindow,
  assertWithinTrackHours,
  getRoom,
  getSession,
} from '../sessionRules.js';
import { MAX_REPEAT_DAYS, repeatDays, repeatSchema } from '../repeat.js';
import { addDays, dateToUtcMs, DAY_MS } from '../shared/repeat.js';
import { localDate, localMinuteOfDay, zonedTimeToUtc } from '../shared/time.js';
import { resolveSpeakers, setSessionSpeakers, speaksFor } from '../speakers.js';
import { parse, sessionPatchSchema, sessionSchema } from '../validation.js';

/** The session form's fields, plus the run of days to put them on. */
const sessionRepeatSchema = sessionSchema.extend({ repeat: repeatSchema });

function setTags(ctx: Ctx, sessionId: number, tagIds: number[]): void {
  ctx.db.prepare('DELETE FROM session_tags WHERE session_id = ?').run(sessionId);
  const insert = ctx.db.prepare(
    'INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)',
  );
  for (const tagId of new Set(tagIds)) insert.run(sessionId, tagId);
}

export function sessionRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });
  const userWrite = [
    requireCapability(ctx.db, 'session.create_open'),
    requireWritable,
    limit(ctx.limiter, 'session'),
  ];

  router.post('/sessions', ...userWrite, (req, res) => {
    const body = parse(sessionSchema, req.body);
    const room = getRoom(ctx.db, req.event.id, body.roomId);
    // Only admins choose the type; anyone else is placing an open session.
    const type = req.role === 'admin' ? (body.type ?? 'official') : 'open';
    assertMayPlace(getPermissions(ctx.db, req.event.id), req.role, room, type);
    const blocks = req.role === 'admin' && assertMayBlock(type, body.blocksOpenBooking);

    const window = { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) };
    assertValidTimes(req.event, window);
    if (req.role !== 'admin') {
      assertWithinEventWindow(req.event, window);
      assertNoOverlap(ctx.db, req.event.id, room.id, window);
      assertNotBlocked(ctx.db, req.event.id, req.role, window);
    }
    const tagIds = body.tagIds ?? [];
    assertTagsBelong(ctx.db, req.event.id, tagIds);
    const trackId = body.trackId ?? null;
    assertTrackBelongs(ctx.db, req.event.id, trackId);
    assertWithinTrackHours(ctx.db, req.event, req.role, trackId, window);

    const now = new Date().toISOString();
    const id = ctx.db.transaction((): number => {
      const speakerIds = resolveSpeakers(ctx.db, req.event.id, body.speakers ?? []);
      const info = ctx.db
        .prepare(
          `INSERT INTO sessions
            (event_id, room_id, track_id, type, blocks_open_booking, title,
             description, speaker, livestream_url, starts_at, ends_at,
             created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          req.event.id,
          room.id,
          trackId,
          type,
          blocks ? 1 : 0,
          body.title,
          body.description ?? '',
          body.livestreamUrl ?? '',
          window.startsAt.toISOString(),
          window.endsAt.toISOString(),
          req.identity.id,
          now,
          now,
        );
      const newId = Number(info.lastInsertRowid);
      setTags(ctx, newId, tagIds);
      setSessionSpeakers(ctx.db, newId, speakerIds);
      return newId;
    })();

    const dto = loadSessionDto(ctx.db, getSession(ctx.db, req.event.id, id));
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'create',
      entity: 'session',
      entityId: id,
    });
    ctx.broker.publish(req.event.slug, 'session.created', dto);
    res.status(201).json(dto);
  });

  /**
   * Create the same session on every day of a run — "every weekday until the
   * 20th" — in one request.
   *
   * What lands is **ordinary sessions**. There is no series, no series id and
   * no link between them: each one can be dragged, retimed, retitled or
   * deleted on its own, which is what a programme whose sessions drift from
   * their planned times actually needs. The rule is spent here and forgotten.
   * `repeat.ts` holds it, so a run the JSON importer refuses is refused here
   * too.
   *
   * Organisers only. Placing sixty sessions is programme-building, and the
   * `session.create_open` capability is for an attendee putting one session on
   * a board.
   */
  router.post(
    '/sessions/repeat',
    requireRole(ctx.db, 'admin'),
    requireWritable,
    limit(ctx.limiter, 'session'),
    (req, res) => {
      const body = parse(sessionRepeatSchema, req.body);
      const room = getRoom(ctx.db, req.event.id, body.roomId);
      const type = body.type ?? 'official';
      assertMayPlace(getPermissions(ctx.db, req.event.id), req.role, room, type);
      // A plenary that happens every morning is a run like any other; the flag
      // rides along so each occurrence holds its own day.
      const blocks = assertMayBlock(type, body.blocksOpenBooking);

      const first = { startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) };
      assertValidTimes(req.event, first);
      const tagIds = body.tagIds ?? [];
      assertTagsBelong(ctx.db, req.event.id, tagIds);
      const trackId = body.trackId ?? null;
      assertTrackBelongs(ctx.db, req.event.id, trackId);

      // The run is a claim about the printed clock, so it is the wall-clock
      // start and end that repeat, not the instants. Each day is resolved
      // through the event's timezone separately, which is what keeps 14:00 at
      // 14:00 when the clocks change partway through a long programme.
      const tz = req.event.timezone;
      const firstDate = localDate(first.startsAt, tz);
      const startMin = localMinuteOfDay(first.startsAt, tz);
      const endMin = localMinuteOfDay(first.endsAt, tz);
      // A session ending at or past local midnight belongs to the next date;
      // every occurrence keeps that same offset.
      const endOffset =
        (dateToUtcMs(localDate(first.endsAt, tz)) - dateToUtcMs(firstDate)) / DAY_MS;

      const { dates } = repeatDays(firstDate, body.repeat, {
        eventEndDate: req.event.end_date,
        max: MAX_REPEAT_DAYS,
      });

      const windows = dates.map((date) => {
        const window = {
          startsAt: zonedTimeToUtc(date, startMin, tz),
          endsAt: zonedTimeToUtc(addDays(date, endOffset), endMin, tz),
        };
        // Checked per day rather than once: a wall-clock span that is 90
        // minutes most days is 30 on the day the clocks go forward, and a
        // session that quietly changed length is worse than a refusal.
        try {
          assertValidTimes(req.event, window);
        } catch (err) {
          throw badRequest(`${date}: ${(err as Error).message}`);
        }
        return window;
      });

      const now = new Date().toISOString();
      const ids = ctx.db.transaction((): number[] => {
        const speakerIds = resolveSpeakers(ctx.db, req.event.id, body.speakers ?? []);
        const insert = ctx.db.prepare(
          `INSERT INTO sessions
            (event_id, room_id, track_id, type, blocks_open_booking, title,
             description, speaker, livestream_url, starts_at, ends_at,
             created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
        );
        return windows.map((window) => {
          const newId = Number(
            insert.run(
              req.event.id,
              room.id,
              trackId,
              type,
              blocks ? 1 : 0,
              body.title,
              body.description ?? '',
              body.livestreamUrl ?? '',
              window.startsAt.toISOString(),
              window.endsAt.toISOString(),
              req.identity.id,
              now,
              now,
            ).lastInsertRowid,
          );
          setTags(ctx, newId, tagIds);
          // Each repeat is its own session from the moment it exists, billing
          // included — the same people, written once per row.
          setSessionSpeakers(ctx.db, newId, speakerIds);
          return newId;
        });
      })();

      // One audit row and one broadcast each: they are separate sessions from
      // the moment they exist, and every later edit or deletion will name one.
      const dtos = ids.map((id) => loadSessionDto(ctx.db, getSession(ctx.db, req.event.id, id)));
      for (const dto of dtos) {
        audit(ctx.db, {
          identityId: req.identity.id,
          eventId: req.event.id,
          action: 'create',
          entity: 'session',
          entityId: dto.id,
        });
        ctx.broker.publish(req.event.slug, 'session.created', dto);
      }
      res.status(201).json({ sessions: dtos });
    },
  );

  router.patch('/sessions/:id', ...userWrite, (req, res) => {
    const existing = getSession(ctx.db, req.event.id, Number(req.params.id));
    const speaksHere = speaksFor(ctx.db, req.identity.id, existing);
    assertMayMutate(getPermissions(ctx.db, req.event.id), req.role, req.identity.id, existing, speaksHere);

    const body = parse(sessionPatchSchema, req.body);
    assertNotStale(existing, body.expectedUpdatedAt);

    // A speaker may rewrite their talk's words, not its slot: placement of an
    // official session stays with organisers.
    if (
      req.role !== 'admin' &&
      existing.type === 'official' &&
      (body.roomId !== undefined ||
        body.type !== undefined ||
        body.startsAt !== undefined ||
        body.endsAt !== undefined)
    ) {
      throw forbidden('Only organisers can move official sessions');
    }

    const room = getRoom(ctx.db, req.event.id, body.roomId ?? existing.room_id);
    const type = req.role === 'admin' ? (body.type ?? existing.type) : existing.type;
    if (body.roomId !== undefined || body.type !== undefined) {
      assertMayPlace(getPermissions(ctx.db, req.event.id), req.role, room, type);
    }
    // A patch that would leave the hold on an open session is refused, not
    // quietly fixed — same as the create path. Lifting the hold and opening
    // the session are two separate decisions, and an organiser who meant both
    // sends both; the form does exactly that when the type chip changes.
    const blocks =
      req.role === 'admin'
        ? assertMayBlock(type, body.blocksOpenBooking ?? existing.blocks_open_booking === 1)
        : existing.blocks_open_booking === 1;

    const window = {
      startsAt: new Date(body.startsAt ?? existing.starts_at),
      endsAt: new Date(body.endsAt ?? existing.ends_at),
    };
    assertValidTimes(req.event, window);
    if (req.role !== 'admin') {
      assertWithinEventWindow(req.event, window);
      assertNoOverlap(ctx.db, req.event.id, room.id, window, existing.id);
      // Only a session that actually moves is re-checked. A plenary announced
      // after someone had already booked that hour leaves their session where
      // it is — badged as competing — and refusing to let them fix a typo in
      // it afterwards would punish them for the organiser's later decision.
      const retimed =
        window.startsAt.toISOString() !== existing.starts_at ||
        window.endsAt.toISOString() !== existing.ends_at;
      if (retimed) assertNotBlocked(ctx.db, req.event.id, req.role, window, existing.id);
    }
    if (body.tagIds) assertTagsBelong(ctx.db, req.event.id, body.tagIds);
    // `undefined` leaves the track alone; an explicit `null` clears it.
    const nextTrackId = body.trackId === undefined ? existing.track_id : body.trackId;
    assertTrackBelongs(ctx.db, req.event.id, nextTrackId);
    // Only a placement that actually changes is held to the track's hours.
    // Narrowing a window leaves the sessions already inside it alone, so the
    // one thing that must keep working is editing them: a title fixed on a
    // session that predates the window is not a booking being made.
    const replaced =
      nextTrackId !== existing.track_id ||
      window.startsAt.toISOString() !== existing.starts_at ||
      window.endsAt.toISOString() !== existing.ends_at;
    if (replaced) {
      assertWithinTrackHours(ctx.db, req.event, req.role, nextTrackId, window);
    }

    const now = new Date().toISOString();
    ctx.db.transaction(() => {
      ctx.db
        .prepare(
          `UPDATE sessions SET room_id = ?, track_id = ?, type = ?, blocks_open_booking = ?,
                  title = ?, description = ?,
                  livestream_url = ?, starts_at = ?, ends_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          room.id,
          nextTrackId,
          type,
          blocks ? 1 : 0,
          body.title ?? existing.title,
          body.description ?? existing.description,
          body.livestreamUrl ?? existing.livestream_url,
          window.startsAt.toISOString(),
          window.endsAt.toISOString(),
          now,
          existing.id,
        );
      if (body.tagIds) setTags(ctx, existing.id, body.tagIds);
      // Absent means "leave the billing alone"; an empty array means "nobody",
      // which is a thing an organiser is allowed to say.
      if (body.speakers !== undefined) {
        setSessionSpeakers(
          ctx.db,
          existing.id,
          resolveSpeakers(ctx.db, req.event.id, body.speakers),
        );
      }
    })();

    const dto = loadSessionDto(ctx.db, getSession(ctx.db, req.event.id, existing.id));
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'update',
      entity: 'session',
      entityId: existing.id,
    });
    ctx.broker.publish(req.event.slug, 'session.updated', dto);
    res.json(dto);
  });

  router.delete('/sessions/:id', ...userWrite, (req, res) => {
    const existing: SessionRow = getSession(ctx.db, req.event.id, Number(req.params.id));
    assertMayMutate(getPermissions(ctx.db, req.event.id), req.role, req.identity.id, existing);
    ctx.db
      .prepare('UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), new Date().toISOString(), existing.id);
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'delete',
      entity: 'session',
      entityId: existing.id,
    });
    ctx.broker.publish(req.event.slug, 'session.deleted', { id: existing.id });
    res.status(204).end();
  });

  return router;
}
