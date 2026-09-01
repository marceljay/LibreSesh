/**
 * Build a whole event — rooms, tracks, tags and a full grid of sessions —
 * from one JSON document.
 *
 * The document is written for a *transcriber*, not for the database. A printed
 * schedule, a photo of a wall, a conference website: whatever it is read from
 * has room names and wall-clock times and no ids at all, so this format has
 * none either. Rooms, tracks and tags are declared once by name and referred
 * to by that name; times are the local times printed on the schedule, and the
 * event's own timezone turns them into instants. That is also why it is not
 * `export.json` read backwards — an export is a record of ids, this is a
 * description of a schedule, and only the second one can be typed by hand or
 * produced from a picture.
 *
 * Two rules make it safe to point at a production database:
 *
 * - **All or nothing.** Everything lands in one transaction. A document that
 *   fails on its last session leaves no half-built event behind, so the fix is
 *   always "correct the file and run it again".
 * - **Dry run.** `dryRun` does the entire import, collects the same counts,
 *   warnings and errors, and rolls back. Nothing else tells you a transcription
 *   is right except doing it.
 *
 * Contradictions inside the document are errors; things that are merely
 * suspicious are warnings, returned alongside the result rather than thrown.
 */
import { z } from 'zod';
import { hashPassword, setRole } from './auth.js';
import { audit } from './audit.js';
import { type Config, isDemoEvent } from './config.js';
import type { Db, EventRow } from './db.js';
import { badRequest, conflict, HttpError } from './errors.js';
import { resolveEventPasswords } from './eventPasswords.js';
import { assertValidTimes } from './sessionRules.js';
import { describeRepeat, repeatDays, repeatSchema } from './repeat.js';
import { slugTaken } from './slugs.js';
import { nextRoomColor } from './shared/roomColors.js';
import type { ImportResult } from './shared/types.js';
import { localDate, localMinuteOfDay, zonedTimeToUtc } from './shared/time.js';
import { resolveSpeakers } from './speakers.js';
import {
  colorSchema,
  dateSchema,
  defaultViewSchema,
  distinctPasswordsRefinement,
  isoInstantSchema,
  minuteOfDaySchema,
  optionalTrimmed,
  passwordSchema,
  roleLabelSchema,
  slugSchema,
  timezoneSchema,
  trimmed,
} from './validation.js';

/** 24-hour wall clock. `24:00` is allowed as an end: it means midnight closing
 *  the day, which is how a last session of the evening is usually printed. */
const startTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM (24-hour)');
const endTimeSchema = z
  .string()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Expected HH:MM (24-hour), or 24:00 for midnight');

const importRoomSchema = z.object({
  name: trimmed(80),
  description: optionalTrimmed(500).optional(),
  capacity: z.number().int().min(0).max(100000).nullable().optional(),
  color: colorSchema.optional(),
  openBooking: z.boolean().optional(),
});

/**
 * A strand, optionally with the hours it keeps: "Workshops, 09:00–13:00". A
 * day named in `windows` replaces those hours for that date. Wall-clock times
 * like everything else in this document; omit them and the track takes a
 * session at any hour, which is what every track did before.
 */
const importTrackSchema = z
  .object({
    name: trimmed(60),
    description: optionalTrimmed(500).optional(),
    color: colorSchema.optional(),
    start: startTimeSchema.optional(),
    end: endTimeSchema.optional(),
    windows: z
      .array(z.object({ date: dateSchema, start: startTimeSchema, end: endTimeSchema }))
      .max(60)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.start === undefined) !== (v.end === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'Give both ends of the hours, or neither',
      });
    }
    if (v.start && v.end && minuteOfDay(v.end) <= minuteOfDay(v.start)) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'A track must close after it opens' });
    }
    for (const [i, w] of (v.windows ?? []).entries()) {
      if (minuteOfDay(w.end) <= minuteOfDay(w.start)) {
        ctx.addIssue({
          code: 'custom',
          path: ['windows', i, 'end'],
          message: 'A track must close after it opens',
        });
      }
    }
    const dates = (v.windows ?? []).map((w) => w.date);
    if (new Set(dates).size !== dates.length) {
      ctx.addIssue({ code: 'custom', path: ['windows'], message: 'One window per day' });
    }
  });

const importTagSchema = z.object({ name: trimmed(40), color: colorSchema.optional() });

/**
 * Lunch, dinner, coffee. Wall-clock times like everything else in this
 * document, and no `date` means every day of the event — which is how a
 * printed schedule says it, and usually the only thing anyone has to type.
 */
const importBreakSchema = z
  .object({
    label: trimmed(60),
    start: startTimeSchema,
    end: endTimeSchema,
    /** One day only. Omit for every day. */
    date: dateSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (minuteOfDay(v.end) <= minuteOfDay(v.start)) {
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'A break must end after it starts' });
    }
  });

/**
 * A session names its room; a room is never invented from a session. A typo
 * that quietly grew a fourth column would be far harder to spot in a grid than
 * a rejection naming the row it came from.
 */
const importSessionSchema = z
  .object({
    room: trimmed(80),
    track: trimmed(60).nullish(),
    tags: z.array(trimmed(40)).max(20).optional(),
    type: z.enum(['official', 'open']).optional(),
    /** Holds the floor: attendees can place nothing while this one runs. */
    blocksOpenBooking: z.boolean().optional(),
    /** Retired: breaks are their own top-level list now, not a session flag.
     *  Still accepted so an older document imports, and warned about. */
    background: z.boolean().optional(),
    title: trimmed(120),
    description: optionalTrimmed(5000).optional(),
    /** Free text, matched to an existing profile or given a new unclaimed one. */
    speaker: optionalTrimmed(120).optional(),
    /** The same, for a session given by more than one person, in billing
     *  order. `speaker` remains the one-name spelling; a document may use
     *  either, and a document that uses both is billed to the list. */
    speakers: z.array(trimmed(120)).max(12).optional(),
    /** Local date and times, as printed on the schedule. */
    date: dateSchema.optional(),
    start: startTimeSchema.optional(),
    end: endTimeSchema.optional(),
    /** The alternative: instants, for a document a program wrote. */
    startsAt: isoInstantSchema.optional(),
    endsAt: isoInstantSchema.optional(),
    /** Say the row once, land it on every day it happens. */
    repeat: repeatSchema.optional(),
  })
  .superRefine((v, ctx) => {
    const local = v.date !== undefined || v.start !== undefined || v.end !== undefined;
    const instants = v.startsAt !== undefined || v.endsAt !== undefined;
    if (local && instants) {
      ctx.addIssue({
        code: 'custom',
        message: 'Give either date/start/end or startsAt/endsAt, not both',
      });
      return;
    }
    if (instants) {
      if (v.startsAt === undefined || v.endsAt === undefined) {
        ctx.addIssue({ code: 'custom', message: 'startsAt and endsAt go together' });
      }
      // An instant cannot say "the same time tomorrow": across a clock change
      // it would move the session by an hour, silently, on one day of the run.
      if (v.repeat) {
        ctx.addIssue({
          code: 'custom',
          message: 'repeat needs date/start/end, not startsAt/endsAt',
          path: ['repeat'],
        });
      }
      return;
    }
    if (v.date === undefined || v.start === undefined || v.end === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Needs date, start and end (or startsAt/endsAt)' });
    }
  });

export const eventImportSchema = z
  .object({
    /** Present on a document this app produced; ignored, but not rejected. */
    format: z.literal('libresesh.event').optional(),
    version: z.literal(1).optional(),
    event: z
      .object({
        name: trimmed(120),
        slug: slugSchema,
        timezone: timezoneSchema,
        startDate: dateSchema,
        endDate: dateSchema,
        dayStartMin: minuteOfDaySchema.optional(),
        dayEndMin: minuteOfDaySchema.optional(),
        userRoleLabel: roleLabelSchema.optional(),
        defaultView: defaultViewSchema.optional(),
        // Blank fields are filled in and handed back once, exactly as when an
        // event is created by hand — nobody transcribing a schedule should
        // have to invent three passwords to get it in.
        viewerPassword: passwordSchema.optional(),
        userPassword: passwordSchema.optional(),
        adminPassword: passwordSchema.optional(),
      })
      .refine((v) => v.endDate >= v.startDate, {
        message: 'End date must not be before the start date',
        path: ['endDate'],
      })
      .refine((v) => (v.dayEndMin ?? 1320) > (v.dayStartMin ?? 480), {
        message: 'Day end must be after day start',
        path: ['dayEndMin'],
      })
      .superRefine(distinctPasswordsRefinement),
    /** Array order is column order on the grid — the order they are printed in. */
    rooms: z.array(importRoomSchema).max(100).optional(),
    tracks: z.array(importTrackSchema).max(60).optional(),
    tags: z.array(importTagSchema).max(200).optional(),
    breaks: z.array(importBreakSchema).max(40).optional(),
    sessions: z.array(importSessionSchema).max(1000).optional(),
  })
  .strict();

export type EventImport = z.infer<typeof eventImportSchema>;
type ImportSession = z.infer<typeof importSessionSchema>;

/** How many sessions one document may write, repeats expanded. */
export const MAX_IMPORT_SESSIONS = 1000;

export type { ImportCounts, ImportResult } from './shared/types.js';

/** Thrown to roll a dry run back once it has produced its answer. */
class DryRunFinished extends Error {
  constructor(readonly result: ImportResult) {
    super('dry run');
  }
}

const minuteOfDay = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** The 5-minute grid the calendar snaps to, which the rest of the app enforces
 *  on every write. An import is no exception — a track opening at 09:02 could
 *  never be edited back to itself in the UI. */
const assertSnapped = (startMin: number, endMin: number, label: string): void => {
  if (startMin % 5 !== 0 || endMin % 5 !== 0) {
    throw badRequest(`${label}: times land on a 5-minute step`);
  }
};

/** A track's own hours, in minutes, or nulls when it keeps none. */
const trackHoursOf = (
  track: { start?: string; end?: string },
  label: string,
): { startMin: number | null; endMin: number | null } => {
  if (track.start === undefined || track.end === undefined) {
    return { startMin: null, endMin: null };
  }
  const startMin = minuteOfDay(track.start);
  const endMin = minuteOfDay(track.end);
  assertSnapped(startMin, endMin, label);
  return { startMin, endMin };
};

/** `sessions[3] "Opening keynote"` — every message says which row it came from. */
const rowLabel = (index: number, title: string): string => `sessions[${index}] "${title}"`;

/** Case- and whitespace-insensitive, because a transcription is not consistent. */
const key = (name: string): string => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** Names are the only handle the document has, so two of them must not collide. */
function assertNamesDistinct(items: { name: string }[], kind: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(key(item.name))) throw badRequest(`Two ${kind} are both called "${item.name}"`);
    seen.add(key(item.name));
  }
}

/** One session the importer will actually write. */
interface PlannedSession {
  row: ImportSession;
  /** Names the occurrence: which day failed is the whole question. */
  errorLabel: string;
  /** Names the rule instead. A warning about 14:00 is true of every occurrence
   *  of a repeat, and saying it twenty times would bury the ones that differ. */
  warnLabel: string;
}

/**
 * Turn each row of the document into the sessions it stands for. A row with no
 * `repeat` is itself; a row with one becomes a session per day it lands on.
 *
 * Expansion happens here, once, and nothing downstream knows a repeat existed:
 * what lands in the database is twenty ordinary sessions, each of which can be
 * dragged, retitled or deleted on its own. That is the point. A schedule is
 * edited constantly, and a series that fought back the first time one day's
 * keynote moved would cost more than the typing it saved.
 */
export function planSessions(
  sessions: ImportSession[],
  eventEndDate: string,
  warn: (message: string) => void,
): PlannedSession[] {
  const planned: PlannedSession[] = [];

  for (const [index, session] of sessions.entries()) {
    const label = rowLabel(index, session.title);
    const { repeat, ...row } = session;
    if (!repeat) {
      planned.push({ row: session, errorLabel: label, warnLabel: label });
      continue;
    }

    const { dates, unusedExcepts } = repeatDays(session.date as string, repeat, {
      eventEndDate,
      // A row may not expand past what the whole document is allowed, and the
      // rows already planned have spent part of that budget.
      max: MAX_IMPORT_SESSIONS - planned.length,
      label,
    });
    const warnLabel = `${label} (${describeRepeat(repeat)})`;
    for (const date of dates) {
      planned.push({ row: { ...row, date }, errorLabel: `${label} on ${date}`, warnLabel });
    }
    // A skip that skips nothing is the shape a mistyped date takes, and it is
    // invisible in the result otherwise: the grid just quietly has that day.
    for (const date of unusedExcepts) {
      warn(`${warnLabel} does not fall on ${date}, so excepting that day does nothing`);
    }
  }

  return planned;
}

export interface ImportOptions {
  /** Whose import this is: creator of every row, and admin of the new event. */
  actorIdentityId: number;
  dryRun?: boolean;
}

export function importEvent(
  db: Db,
  config: Config,
  doc: EventImport,
  { actorIdentityId, dryRun = false }: ImportOptions,
): ImportResult {
  const rooms = doc.rooms ?? [];
  const tracks = doc.tracks ?? [];
  const tags = doc.tags ?? [];
  const breaks = doc.breaks ?? [];
  const sessions = doc.sessions ?? [];

  if (rooms.length === 0 && sessions.length > 0) {
    throw badRequest('Sessions need rooms — none are declared');
  }

  const existing = db
    .prepare<[string], { id: number }>('SELECT id FROM events WHERE slug = ?')
    .get(doc.event.slug);
  // Also refuse a slug that some other event has been renamed away from: it
  // still resolves to that event, and handing it to a new one would silently
  // steal every old link pointing at it.
  if (existing || slugTaken(db, doc.event.slug)) {
    throw conflict('That slug is already taken', 'slug_taken');
  }

  const { passwords, generated } = resolveEventPasswords(
    doc.event,
    isDemoEvent(config, doc.event.slug),
  );

  const warnings: string[] = [];
  /** Every occurrence of a repeat earns the same warning; one of it is the
   *  useful number. */
  const warn = (message: string): void => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  const now = new Date().toISOString();

  const run = (): ImportResult => {
    const eventId = Number(
      db
        .prepare(
          `INSERT INTO events
            (slug, name, timezone, start_date, end_date, day_start_min, day_end_min,
             viewer_pw_hash, user_pw_hash, admin_pw_hash, archived, user_role_label,
             default_view, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .run(
          doc.event.slug,
          doc.event.name,
          doc.event.timezone,
          doc.event.startDate,
          doc.event.endDate,
          doc.event.dayStartMin ?? 480,
          doc.event.dayEndMin ?? 1320,
          hashPassword(passwords.viewerPassword),
          hashPassword(passwords.userPassword),
          hashPassword(passwords.adminPassword),
          doc.event.userRoleLabel ?? 'attendee',
          doc.event.defaultView ?? 'list',
          now,
        ).lastInsertRowid,
    );
    const event = db
      .prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?')
      .get(eventId) as EventRow;

    assertNamesDistinct(rooms, 'rooms');
    const roomIds = new Map<string, number>();
    const insertRoom = db.prepare(
      `INSERT INTO rooms (event_id, name, description, capacity, color, open_booking, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const roomColors: string[] = [];
    for (const [order, room] of rooms.entries()) {
      const color = room.color ?? nextRoomColor(roomColors);
      roomColors.push(color);
      const id = insertRoom.run(
        eventId,
        room.name,
        room.description ?? '',
        room.capacity ?? null,
        color,
        room.openBooking ? 1 : 0,
        order,
      ).lastInsertRowid;
      roomIds.set(key(room.name), Number(id));
    }

    assertNamesDistinct(tracks, 'tracks');
    const trackIds = new Map<string, number>();
    const insertTrack = db.prepare(
      `INSERT INTO tracks (event_id, name, description, color, sort_order, start_min, end_min)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertTrackWindow = db.prepare(
      `INSERT INTO track_windows (track_id, date, start_min, end_min, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const trackColors: string[] = [];
    for (const [order, track] of tracks.entries()) {
      const color = track.color ?? nextRoomColor(trackColors);
      trackColors.push(color);
      const hours = trackHoursOf(track, `tracks[${order}] "${track.name}"`);
      const id = insertTrack.run(
        eventId,
        track.name,
        track.description ?? '',
        color,
        order,
        hours.startMin,
        hours.endMin,
      ).lastInsertRowid;
      trackIds.set(key(track.name), Number(id));
      for (const [i, w] of (track.windows ?? []).entries()) {
        const label = `tracks[${order}] "${track.name}" windows[${i}]`;
        if (w.date < event.start_date || w.date > event.end_date) {
          throw badRequest(
            `${label}: ${w.date} is outside the event dates ${event.start_date}…${event.end_date}`,
          );
        }
        const startMin = minuteOfDay(w.start);
        const endMin = minuteOfDay(w.end);
        assertSnapped(startMin, endMin, label);
        insertTrackWindow.run(Number(id), w.date, startMin, endMin, now);
      }
    }

    assertNamesDistinct(tags, 'tags');
    const tagIds = new Map<string, number>();
    const insertTag = db.prepare('INSERT INTO tags (event_id, name, color) VALUES (?, ?, ?)');
    for (const tag of tags) {
      const id = insertTag.run(eventId, tag.name, tag.color ?? '#6B7280').lastInsertRowid;
      tagIds.set(key(tag.name), Number(id));
    }

    // Breaks name no room and reference nothing, so they land before the grid
    // and nothing downstream has to know about them.
    const insertBreak = db.prepare(
      `INSERT INTO breaks (event_id, label, start_min, end_min, date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const [index, row] of breaks.entries()) {
      if (row.date && (row.date < event.start_date || row.date > event.end_date)) {
        throw badRequest(
          `breaks[${index}] "${row.label}": ${row.date} is outside the event dates ` +
            `${event.start_date}…${event.end_date}`,
        );
      }
      const startMin = minuteOfDay(row.start);
      const endMin = minuteOfDay(row.end);
      if (startMin % 5 !== 0 || endMin % 5 !== 0) {
        throw badRequest(
          `breaks[${index}] "${row.label}": times land on a 5-minute step`,
        );
      }
      // Same reasoning as a session outside the viewport: in the database and
      // off the top of the grid reads as an import that failed.
      if (startMin < event.day_start_min || endMin > event.day_end_min) {
        warn(
          `breaks[${index}] "${row.label}" runs outside the hours the schedule shows and will ` +
            'not be visible until you widen them in Settings',
        );
      }
      insertBreak.run(eventId, row.label, startMin, endMin, row.date ?? null, now);
    }

    const insertSession = db.prepare(
      `INSERT INTO sessions
        (event_id, room_id, track_id, type, blocks_open_booking, title,
         description, speaker, livestream_url, starts_at, ends_at,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?)`,
    );
    const insertSessionSpeaker = db.prepare(
      'INSERT OR IGNORE INTO session_speakers (session_id, person_id, sort_order) VALUES (?, ?, ?)',
    );
    const linkTag = db.prepare(
      'INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)',
    );
    /** Placed sessions per room, to notice a double booking after the fact. */
    const placed = new Map<number, { startsAt: number; endsAt: number; label: string }[]>();

    const planned = planSessions(sessions, event.end_date, warn);

    for (const { row: session, errorLabel, warnLabel } of planned) {
      const roomId = roomIds.get(key(session.room));
      if (roomId === undefined) {
        throw badRequest(`${errorLabel}: no room called "${session.room}" is declared`);
      }

      let trackId: number | null = null;
      if (session.track) {
        const found = trackIds.get(key(session.track));
        if (found === undefined) {
          throw badRequest(`${errorLabel}: no track called "${session.track}" is declared`);
        }
        trackId = found;
      }

      const startsAt =
        session.startsAt !== undefined
          ? new Date(session.startsAt)
          : zonedTimeToUtc(session.date as string, minuteOfDay(session.start as string), event.timezone);
      const endsAt =
        session.endsAt !== undefined
          ? new Date(session.endsAt)
          : zonedTimeToUtc(session.date as string, minuteOfDay(session.end as string), event.timezone);

      if (endsAt <= startsAt) throw badRequest(`${errorLabel}: ends before it starts`);
      try {
        assertValidTimes(event, { startsAt, endsAt });
      } catch (err) {
        throw badRequest(`${errorLabel}: ${(err as HttpError).message}`);
      }

      // The dates are declared in this same document, so a session outside them
      // means one of the two is a transcription error. Refusing says which.
      const localStart = localDate(startsAt, event.timezone);
      if (localStart < event.start_date || localStart > event.end_date) {
        throw badRequest(
          `${errorLabel}: ${localStart} is outside the event dates ${event.start_date}…${event.end_date}`,
        );
      }

      const resolvedTags: number[] = [];
      for (const name of session.tags ?? []) {
        const tagId = tagIds.get(key(name));
        if (tagId === undefined) throw badRequest(`${errorLabel}: no tag called "${name}" is declared`);
        resolvedTags.push(tagId);
      }

      // `speakers` is the list; `speaker` is the one-name spelling every
      // document written before this used, and still the common case. Either
      // is accepted, neither is required, and both together is the list.
      const billed = session.speakers ?? (session.speaker ? [session.speaker] : []);
      const speakerIds = resolveSpeakers(db, eventId, billed);
      const sessionType = session.type ?? 'official';
      if (session.blocksOpenBooking && sessionType !== 'official') {
        throw badRequest(`${errorLabel}: only an official session can hold the floor`);
      }
      if (session.background) {
        warn(
          'A session marked `background` was imported as an ordinary session — breaks are ' +
            'their own list now, declared once with `breaks` and drawn behind the whole grid',
        );
      }
      const sessionId = Number(
        insertSession.run(
          eventId,
          roomId,
          trackId,
          sessionType,
          session.blocksOpenBooking ? 1 : 0,
          session.title,
          session.description ?? '',
          startsAt.toISOString(),
          endsAt.toISOString(),
          actorIdentityId,
          now,
          now,
        ).lastInsertRowid,
      );
      for (const tagId of new Set(resolvedTags)) linkTag.run(sessionId, tagId);
      speakerIds.forEach((personId, order) =>
        insertSessionSpeaker.run(sessionId, personId, order),
      );

      // Outside the day viewport a session is in the database and off the top
      // or bottom of the grid — invisible, which reads as a failed import.
      const startMin = localMinuteOfDay(startsAt, event.timezone);
      let endMin = localMinuteOfDay(endsAt, event.timezone);
      if (endMin === 0 && localDate(endsAt, event.timezone) > localStart) endMin = 1440;
      if (startMin < event.day_start_min || endMin > event.day_end_min) {
        warn(
          `${warnLabel} runs outside the hours the schedule shows (${event.day_start_min / 60}:00–${
            event.day_end_min / 60
          }:00) and will not be visible until you widen them in Settings`,
        );
      }

      const inRoom = placed.get(roomId) ?? [];
      const clash = inRoom.find(
        (other) => other.startsAt < endsAt.getTime() && other.endsAt > startsAt.getTime(),
      );
      if (clash) {
        warn(`${warnLabel} overlaps ${clash.label} in "${session.room}"`);
      }
      inRoom.push({ startsAt: startsAt.getTime(), endsAt: endsAt.getTime(), label: warnLabel });
      placed.set(roomId, inRoom);
    }

    // Every profile in a brand-new event was made by this import, from a
    // speaker name that matched nobody already in it.
    const people = db
      .prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM people WHERE event_id = ?')
      .get(eventId) as { n: number };

    const result: ImportResult = {
      slug: doc.event.slug,
      eventId,
      dryRun,
      counts: {
        rooms: rooms.length,
        tracks: tracks.length,
        tags: tags.length,
        breaks: breaks.length,
        sessions: planned.length,
        people: people.n,
      },
      warnings,
      generatedPasswords: generated,
    };

    if (dryRun) throw new DryRunFinished({ ...result, eventId: null });

    setRole(db, actorIdentityId, eventId, 'admin');
    audit(db, {
      identityId: actorIdentityId,
      eventId,
      action: 'import',
      entity: 'event',
      entityId: eventId,
    });
    return result;
  };

  try {
    return db.transaction(run)();
  } catch (err) {
    if (err instanceof DryRunFinished) return err.result;
    throw err;
  }
}
