/**
 * Pure builders: a session, an event or a deletion in, an unsigned Nostr
 * event template out. Nothing here touches a relay or a key; `queue.ts`
 * signs and sends what these return.
 *
 * Kind 31923 is NIP-52's time-based calendar event, 31924 the calendar that
 * lists them, kind 0 the profile a follower sees instead of a bare npub, and
 * kind 5 a deletion request. All but kind 5 are addressable: the relay keeps
 * one per `(pubkey, kind, d)`, newest `created_at` wins, so republishing a
 * changed session is an update and not a second entry.
 */
import * as nip19 from 'nostr-tools/nip19';
import type { Db, EventRow, SessionRow } from '../db.js';
import { parseLinks } from '../mappers.js';
import { localDate, zonedTimeToUtc } from '../shared/time.js';

export interface SessionFacts {
  session: SessionRow;
  event: EventRow;
  room: string | null;
  format: string | null;
  tags: string[];
  speakers: string[];
}

/** What `finalizeEvent` takes: everything but `pubkey`, `id` and `sig`. */
export interface Template {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export const KIND_PROFILE = 0;
export const KIND_DELETION = 5;
export const KIND_SESSION = 31923;
export const KIND_CALENDAR = 31924;

/** Stable for the life of the session; not the slug, which can be renamed. */
export const sessionDTag = (eventId: number, sessionId: number): string =>
  `e${eventId}-s${sessionId}`;
export const CALENDAR_D = 'programme';

export const eventUrl = (publicUrl: string | null | undefined, event: EventRow): string | null =>
  publicUrl ? `${publicUrl}/e/${event.slug}` : null;
export const sessionUrl = (
  publicUrl: string | null | undefined,
  event: EventRow,
  sessionId: number,
): string | null => (publicUrl ? `${publicUrl}/e/${event.slug}/s/${sessionId}` : null);

const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** Unix seconds of local midnight of the day `iso` falls on in `timeZone`. */
export const dayStartUnix = (iso: string, timeZone: string): number =>
  Math.floor(zonedTimeToUtc(localDate(new Date(iso), timeZone), 0, timeZone).getTime() / 1000);

const present = (parts: (string | null | undefined)[]): string[] =>
  parts.filter((p): p is string => typeof p === 'string' && p.length > 0);

/** "1–2 June 2026", "30 June – 2 July 2026", "1 June 2026". */
export function dateRangeText(startDate: string, endDate: string): string {
  const day = (d: string) => Number(d.slice(8, 10));
  const monthYear = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  if (startDate === endDate) return `${day(startDate)} ${monthYear(startDate)}`;
  if (startDate.slice(0, 7) === endDate.slice(0, 7)) {
    return `${day(startDate)}–${day(endDate)} ${monthYear(endDate)}`;
  }
  const month = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return startDate.slice(0, 4) === endDate.slice(0, 4)
    ? `${day(startDate)} ${month(startDate)} – ${day(endDate)} ${monthYear(endDate)}`
    : `${day(startDate)} ${monthYear(startDate)} – ${day(endDate)} ${monthYear(endDate)}`;
}

export function buildSessionEvent(
  facts: SessionFacts,
  pubkey: string,
  publicUrl: string | null | undefined,
  nowSec: number,
): Template {
  const { session: s, event: e } = facts;
  const link = sessionUrl(publicUrl, e, s.id);
  const speakers = facts.speakers.join(', ');
  const tags: string[][] = [
    ['d', sessionDTag(e.id, s.id)],
    ['title', s.title],
    ['start', String(unix(s.starts_at))],
    ['end', String(unix(s.ends_at))],
    ['start_tzid', e.timezone],
    ['end_tzid', e.timezone],
    ['D', String(dayStartUnix(s.starts_at, e.timezone))],
    ['location', present([facts.room, e.name]).join(' · ')],
  ];
  const summary = present([facts.format, facts.room, speakers]).join(' · ');
  if (summary) tags.push(['summary', summary]);
  for (const t of facts.tags) tags.push(['t', t.toLowerCase()]);
  if (link) tags.push(['r', link]);
  for (const l of parseLinks(s.livestreams)) tags.push(['r', l.url]);
  tags.push(['a', `${KIND_CALENDAR}:${pubkey}:${CALENDAR_D}`]);
  const content = present([speakers, s.description.trim(), link]).join('\n\n');
  return { kind: KIND_SESSION, created_at: nowSec, tags, content };
}

export function buildCalendarEvent(
  event: EventRow,
  sessionDTags: string[],
  pubkey: string,
  publicUrl: string | null | undefined,
  nowSec: number,
): Template {
  const tags: string[][] = [
    ['d', CALENDAR_D],
    ['title', event.name],
  ];
  for (const d of sessionDTags) tags.push(['a', `${KIND_SESSION}:${pubkey}:${d}`]);
  const content = present([
    `${event.name}, ${dateRangeText(event.start_date, event.end_date)}.`,
    eventUrl(publicUrl, event),
  ]).join(' ');
  return { kind: KIND_CALENDAR, created_at: nowSec, tags, content };
}

export function buildProfileEvent(
  event: EventRow,
  publicUrl: string | null | undefined,
  nowSec: number,
): Template {
  const about = present([
    dateRangeText(event.start_date, event.end_date),
    eventUrl(publicUrl, event),
  ]).join('. ');
  return {
    kind: KIND_PROFILE,
    created_at: nowSec,
    tags: [],
    content: JSON.stringify({ name: event.name, about }),
  };
}

/**
 * NIP-09: an `a` tag names every version of the addressable event up to the
 * deletion's `created_at`; a later version is accepted again, which is what
 * lets a restored session reappear. `k` says which kind, as the NIP asks.
 */
export function buildDeletion(
  kind: number,
  pubkey: string,
  dTag: string,
  nowSec: number,
): Template {
  return {
    kind: KIND_DELETION,
    created_at: nowSec,
    tags: [
      ['a', `${kind}:${pubkey}:${dTag}`],
      ['k', String(kind)],
    ],
    content: '',
  };
}

/** The shareable address of an addressable event, with relay hints. */
export const naddrFor = (kind: number, pubkey: string, dTag: string, relays: string[]): string =>
  nip19.naddrEncode({ kind, pubkey, identifier: dTag, relays });

/** Sessions a calendar client may see: on the schedule, kept, not opted out. */
export function publishableSessionIds(db: Db, eventId: number): number[] {
  return (
    db
      .prepare(
        `SELECT id FROM sessions
          WHERE event_id = ? AND draft = 0 AND deleted_at IS NULL AND nostr_optout = 0
          ORDER BY starts_at, id`,
      )
      .all(eventId) as { id: number }[]
  ).map((r) => r.id);
}

/** Everything a 31923 needs, from the row as it is now; null when it is gone. */
export function loadSessionFacts(db: Db, sessionId: number): SessionFacts | null {
  const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as
    SessionRow | undefined;
  if (!session) return null;
  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(session.event_id) as EventRow;
  const name = (table: string, id: number | null): string | null =>
    id === null
      ? null
      : ((
          db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) as
            { name: string } | undefined
        )?.name ?? null);
  const tags = (
    db
      .prepare(
        `SELECT t.name FROM session_tags st JOIN tags t ON t.id = st.tag_id
          WHERE st.session_id = ? AND t.deleted_at IS NULL ORDER BY t.name`,
      )
      .all(sessionId) as { name: string }[]
  ).map((r) => r.name);
  const speakers = (
    db
      .prepare(
        `SELECT p.name FROM session_speakers ss JOIN people p ON p.id = ss.person_id
          WHERE ss.session_id = ? AND p.deleted_at IS NULL ORDER BY ss.sort_order, p.id`,
      )
      .all(sessionId) as { name: string }[]
  ).map((r) => r.name);
  return {
    session,
    event,
    room: name('rooms', session.room_id),
    format: name('session_formats', session.format_id),
    tags,
    speakers,
  };
}
