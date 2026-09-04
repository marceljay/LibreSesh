import type { Role } from './shared/types.js';
import { atLeast } from './auth.js';
import { can, type PermissionMatrix } from './permissions.js';
import type { Db, EventRow, RoomRow, SessionRow, TrackRow } from './db.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { durationMinutes, localDate, localMinuteOfDay } from './shared/time.js';
import { trackWindows, windowLabel, windowOn } from './trackHours.js';
import {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SNAP_MINUTES,
} from './shared/sessionLimits.js';

export {
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SNAP_MINUTES,
} from './shared/sessionLimits.js';

export interface TimeWindow {
  startsAt: Date;
  endsAt: Date;
}

export function getRoom(db: Db, eventId: number, roomId: number): RoomRow {
  const room = db
    .prepare<[number, number], RoomRow>(
      'SELECT * FROM rooms WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
    )
    .get(roomId, eventId);
  if (!room) throw notFound('No such room');
  return room;
}

export function getSession(db: Db, eventId: number, sessionId: number): SessionRow {
  const row = db
    .prepare<[number, number], SessionRow>(
      'SELECT * FROM sessions WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
    )
    .get(sessionId, eventId);
  if (!row) throw notFound('No such session');
  return row;
}

/** Reject tag ids that belong to another event or have been deleted. */
export function assertTagsBelong(db: Db, eventId: number, tagIds: number[]): void {
  if (tagIds.length === 0) return;
  const placeholders = tagIds.map(() => '?').join(',');
  const found = db
    .prepare<number[], { id: number }>(
      `SELECT id FROM tags WHERE event_id = ? AND deleted_at IS NULL AND id IN (${placeholders})`,
    )
    .all(eventId, ...tagIds);
  if (found.length !== new Set(tagIds).size) throw badRequest('Unknown tag');
}

/** Reject a format id from another event, or one that has been deleted. */
export function assertFormatBelongs(db: Db, eventId: number, formatId: number | null): void {
  if (formatId === null) return;
  const found = db
    .prepare<[number, number], { id: number }>(
      'SELECT id FROM session_formats WHERE event_id = ? AND id = ? AND deleted_at IS NULL',
    )
    .get(eventId, formatId);
  if (!found) throw badRequest('Unknown format');
}

/** Reject a track id from another event, or one that has been deleted. */
export function assertTrackBelongs(db: Db, eventId: number, trackId: number | null): void {
  if (trackId === null) return;
  const found = db
    .prepare<[number, number], { id: number }>(
      'SELECT id FROM tracks WHERE event_id = ? AND id = ? AND deleted_at IS NULL',
    )
    .get(eventId, trackId);
  if (!found) throw badRequest('Unknown track');
}

/**
 * Shape checks that apply to every writer: 5-minute snap in the event's
 * timezone and a sane duration (SPEC §5.1).
 */
export function assertValidTimes(event: EventRow, window: TimeWindow): void {
  const { startsAt, endsAt } = window;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    throw badRequest('Invalid start or end time');
  }
  for (const [label, instant] of [
    ['Start', startsAt],
    ['End', endsAt],
  ] as const) {
    if (localMinuteOfDay(instant, event.timezone) % SNAP_MINUTES !== 0) {
      throw badRequest(`${label} time must land on a ${SNAP_MINUTES}-minute step`);
    }
    if (instant.getUTCSeconds() !== 0 || instant.getUTCMilliseconds() !== 0) {
      throw badRequest(`${label} time must land on a whole minute`);
    }
  }
  const minutes = durationMinutes(startsAt, endsAt);
  if (minutes < MIN_DURATION_MINUTES) {
    throw badRequest(`Sessions must run at least ${MIN_DURATION_MINUTES} minutes`);
  }
  if (minutes > MAX_DURATION_MINUTES) {
    throw badRequest(`Sessions may run at most ${MAX_DURATION_MINUTES} minutes`);
  }
}

/**
 * Extra placement limits for the `user` role: inside the event's dates and
 * inside the day viewport. Admins may place sessions anywhere.
 */
export function assertWithinEventWindow(event: EventRow, window: TimeWindow): void {
  const startDate = localDate(window.startsAt, event.timezone);
  const endDate = localDate(window.endsAt, event.timezone);
  if (startDate < event.start_date || startDate > event.end_date) {
    throw badRequest('That is outside the event dates');
  }
  const startMin = localMinuteOfDay(window.startsAt, event.timezone);
  let endMin = localMinuteOfDay(window.endsAt, event.timezone);
  // An end exactly at local midnight belongs to the day that is closing.
  if (endMin === 0 && endDate > startDate) endMin = 1440;
  if (endDate !== startDate && endMin !== 1440) {
    throw badRequest('Sessions must start and end on the same day');
  }
  if (startMin < event.day_start_min || endMin > event.day_end_min) {
    throw badRequest('That is outside the hours shown on the schedule');
  }
}

/**
 * Hold a session to the hours its track keeps (SPEC §5.1).
 *
 * A track is a strand with a shape — workshops in the mornings, the
 * unconference floor after lunch — and this is where that shape stops being a
 * convention and becomes a rule. Admins pass: the grid is the organiser's
 * instrument, and an organiser who states the hours is the same person who
 * occasionally has to place the exception. Speakers do *not* pass, unlike the
 * blocking-session rule: running against a plenary is a judgement call about
 * the programme, while a track's hours are what the strand *is*, and a talk
 * outside them is on the wrong strand rather than an awkward one.
 *
 * A session with no track is unconstrained, and so is a track with no window —
 * which is every track until an organiser fills one in.
 */
export function assertWithinTrackHours(
  db: Db,
  event: EventRow,
  role: Role,
  trackId: number | null,
  window: TimeWindow,
): void {
  if (role === 'admin' || trackId === null) return;
  const track = db
    .prepare<[number, number], TrackRow>(
      'SELECT * FROM tracks WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
    )
    .get(trackId, event.id);
  if (!track) return; // assertTrackBelongs has the say on unknown tracks.

  const startDate = localDate(window.startsAt, event.timezone);
  const hours = windowOn(
    {
      startMin: track.start_min,
      endMin: track.end_min,
      windows: trackWindows(db, track.id),
    },
    startDate,
  );
  if (!hours) return;

  const startMin = localMinuteOfDay(window.startsAt, event.timezone);
  let endMin = localMinuteOfDay(window.endsAt, event.timezone);
  // As in assertWithinEventWindow: an end exactly at local midnight closes the
  // day it belongs to rather than opening the next one.
  if (endMin === 0 && localDate(window.endsAt, event.timezone) > startDate) endMin = 1440;
  if (startMin < hours.startMin || endMin > hours.endMin) {
    throw badRequest(
      `“${track.name}” only takes sessions between ${windowLabel(hours)}`,
    );
  }
}

/**
 * Reject a session that would overlap another in the same room. Applied to
 * `user` writes only — admins may double-book, and the client badges the clash.
 *
 * Breaks are not sessions and never reach this rule: lunch does not occupy a
 * room, and an attendee who wants to run something through it may.
 */
export function assertNoOverlap(
  db: Db,
  eventId: number,
  roomId: number,
  window: TimeWindow,
  excludeSessionId?: number,
): void {
  const clash = db
    .prepare<[number, number, string, string, number], { id: number }>(
      `SELECT id FROM sessions
        WHERE event_id = ? AND room_id = ? AND deleted_at IS NULL
          AND starts_at < ? AND ends_at > ?
          AND id != ?`,
    )
    .get(
      eventId,
      roomId,
      window.endsAt.toISOString(),
      window.startsAt.toISOString(),
      excludeSessionId ?? -1,
    );
  if (clash) throw conflict('That slot is already taken in this room', 'overlap');
}

/**
 * The flag is a claim the programme makes about itself, so it only fits a
 * session the programme owns. An *open* session that stopped everyone else
 * from booking would be an attendee-shaped hole in the rule — anyone who could
 * place one could close the grid. Returns what to store, so callers read as
 * `const blocks = assertMayBlock(type, body.blocksOpenBooking)`.
 */
export function assertMayBlock(type: 'official' | 'open', blocks: boolean | undefined): boolean {
  if (!blocks) return false;
  if (type !== 'official') throw badRequest('Only an official session can hold the floor');
  return true;
}

/**
 * The blocking session, if any, that is live at some point in `window`.
 *
 * The overlap test is half-open — `starts_at < end AND ends_at > start` — so a
 * session that begins exactly as the keynote ends does not count as competing
 * with it. Any other overlap does, however partial: a session that starts ten
 * minutes before the keynote and runs through it is the case the rule exists
 * for, and letting it through would make the rule decorative.
 *
 * Event-wide, deliberately. The room is not a parameter, because the point of
 * a plenary is that there is nowhere else to be.
 */
export function findBlockingSession(
  db: Db,
  eventId: number,
  window: TimeWindow,
  excludeSessionId?: number,
): SessionRow | undefined {
  return db
    .prepare<[number, string, string, number], SessionRow>(
      `SELECT * FROM sessions
        WHERE event_id = ? AND blocks_open_booking = 1 AND deleted_at IS NULL
          AND starts_at < ? AND ends_at > ?
          AND id != ?
        ORDER BY starts_at
        LIMIT 1`,
    )
    .get(
      eventId,
      window.endsAt.toISOString(),
      window.startsAt.toISOString(),
      excludeSessionId ?? -1,
    );
}

/**
 * Refuse an attendee's placement that would run against a session holding the
 * floor.
 *
 * Speakers and organisers pass. A speaker with a talk to give is part of the
 * programme rather than someone the programme is being protected from, and the
 * cases where one legitimately runs alongside a plenary — a workshop that has
 * to start before the closing remarks end — are real. What they place is
 * badged as competing on the schedule instead, which is the honest outcome:
 * visible to everyone, refused to nobody who ought to be able to do it.
 */
export function assertNotBlocked(
  db: Db,
  eventId: number,
  role: Role,
  window: TimeWindow,
  excludeSessionId?: number,
): void {
  if (atLeast(role, 'speaker')) return;
  const blocker = findBlockingSession(db, eventId, window, excludeSessionId);
  if (!blocker) return;
  throw conflict(
    `“${blocker.title}” is on then, and everyone should be at it — nothing else can be booked while it runs`,
    'blocked',
    { title: blocker.title },
  );
}

/**
 * Who may create a session of this type in this room (SPEC §3.2, §5.1).
 * Which roles hold `session.create_open` is per-event policy; the rest —
 * official sessions are organiser-only, open sessions need an open-track room
 * — is structural and not configurable.
 */
export function assertMayPlace(
  matrix: PermissionMatrix,
  role: Role,
  room: RoomRow,
  type: 'official' | 'open',
): void {
  if (role === 'admin') return;
  if (!can(matrix, role, 'session.create_open')) throw forbidden('You cannot add sessions');
  if (type !== 'open') throw forbidden('Only organisers can add official sessions');
  if (room.open_booking !== 1) throw forbidden('That room is not open for booking');
}

/**
 * Who may edit or delete an existing session. `speaksHere` — the caller's
 * claimed profile is this session's speaker — lets a speaker edit a talk an
 * organiser created for them, official or not; the PATCH route separately
 * fences placement (room, time, type) of official sessions to organisers,
 * and deletion never passes `speaksHere`.
 */
export function assertMayMutate(
  matrix: PermissionMatrix,
  role: Role,
  identityId: number,
  session: SessionRow,
  speaksHere = false,
): void {
  if (role === 'admin') return;
  // Being on the bill is the qualification, whatever role the person holds.
  // This used to demand `atLeast(role, 'speaker')` as well, which locked a
  // speaker out of their own talk for the ordinary reason that they came in
  // through the gate as an attendee — the role most speakers hold, since the
  // speaker role is only handed out by a code an organiser has to remember to
  // send. One of five co-hosts is as credited as the only one, and an official
  // session is exactly the case that matters: it is the one an organiser typed
  // their name onto. What a non-organiser still may not do is *move* it; the
  // PATCH route holds the slot separately.
  if (speaksHere) return;
  if (!can(matrix, role, 'session.edit_own')) throw forbidden('You cannot change sessions');
  if (session.created_by !== identityId) throw forbidden('That is not your session');
  if (session.type !== 'open') throw forbidden('Only organisers can change official sessions');
}

/** Optimistic concurrency: refuse a write built on a stale copy (SPEC §5.1). */
export function assertNotStale(session: SessionRow, expectedUpdatedAt?: string): void {
  if (!expectedUpdatedAt) return;
  if (session.updated_at !== expectedUpdatedAt) {
    throw conflict('Someone else changed this session while you were editing', 'stale');
  }
}
