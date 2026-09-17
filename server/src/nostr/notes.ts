/**
 * Nostr as a transport of the shared announcer (`announcer.ts`): kind-1
 * notes, the change log a follower reads — history, not state. The calendar
 * events in `queue.ts` are the state; every note points at them by
 * coordinate, so a capable client can open the session it names.
 *
 * Plain text, times in the event's timezone, no hashtags, no mentions. One
 * `a` tag per session mentioned plus the same reference inline as
 * `nostr:naddr…` (NIP-21); the site link last, only with `PUBLIC_URL`. No
 * retry: a note that failed is logged and dropped, since the calendar
 * events are the durable copy and a late note is a stale one.
 */
import { finalizeEvent } from 'nostr-tools/pure';
import type { Announcement, Transport, Trigger } from '../announcer.js';
import type { Config } from '../config.js';
import type { Db, EventRow, ProposalRow, SessionRow } from '../db.js';
import { NameResolver } from '../eventIdentity.js';
import { localDate, zonedParts } from '../shared/time.js';
import {
  eventUrl,
  KIND_SESSION,
  loadSessionFacts,
  naddrFor,
  sessionDTag,
  sessionUrl,
} from './build.js';
import { openEventKey } from './keys.js';
import type { Pool } from './pool.js';

/** No per-event columns for these in v1: the spec gives Nostr one setting, the triggers. */
export const NOSTR_LEAD_MIN = 15;
export const NOSTR_DIGEST_MIN = 8 * 60;
/** A digest longer than this is cut, with a line saying how many more. */
export const DIGEST_MAX_LINES = 40;

export const triggersOf = (event: EventRow): Trigger[] => {
  try {
    const parsed: unknown = JSON.parse(event.nostr_triggers);
    return Array.isArray(parsed) ? (parsed as Trigger[]) : [];
  } catch {
    return [];
  }
};
const relaysOf = (event: EventRow): string[] =>
  event.nostr_relays ? (JSON.parse(event.nostr_relays) as string[]) : [];

export const hhmm = (iso: string, timeZone: string): string => {
  const p = zonedParts(new Date(iso), timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

/** "Today", "Tomorrow", or "Wed 17 Sep", as the venue reads it. */
export function dayWord(iso: string, nowIso: string, timeZone: string): string {
  const day = localDate(new Date(iso), timeZone);
  const today = localDate(new Date(nowIso), timeZone);
  if (day === today) return 'Today';
  const tomorrow = localDate(new Date(Date.parse(nowIso) + 24 * 60 * 60_000), timeZone);
  if (day === tomorrow) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(iso));
}

/** 'Tuesday 16 September', for the digest's first line. */
const dayLabel = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(iso));

interface Line {
  id: number;
  title: string;
  room: string | null;
  speakers: string[];
  startsAt: string;
}

const lineOf = (db: Db, s: SessionRow): Line => {
  const f = loadSessionFacts(db, s.id);
  return {
    id: s.id,
    title: s.title,
    room: f?.room ?? null,
    speakers: f?.speakers ?? [],
    startsAt: s.starts_at,
  };
};

const withSpeakers = (l: Line): string =>
  l.speakers.length > 0 ? `${l.title} (${l.speakers.join(', ')})` : l.title;
const roomLine = (l: Line): string => `${l.room ?? '—'} — ${withSpeakers(l)}`;

export interface Note {
  content: string;
  tags: string[][];
}

/** Which day's breaks belong in a digest: the ones on that date, or every day's. */
function breaksOn(db: Db, event: EventRow, day: string): { label: string; startMin: number }[] {
  return db
    .prepare(
      `SELECT label, start_min AS startMin FROM breaks
          WHERE event_id = ? AND (date IS NULL OR date = ?) ORDER BY start_min`,
    )
    .all(event.id, day) as { label: string; startMin: number }[];
}

const pad = (n: number): string => String(n).padStart(2, '0');
const minuteText = (min: number): string => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

/**
 * The note for one announcement, or null when there is nothing to say.
 * Pure apart from reading names, rooms and breaks out of the database.
 */
export function renderNote(
  db: Db,
  a: Announcement,
  pubkey: string,
  publicUrl: string | null | undefined,
): Note | null {
  const e = a.event;
  const tz = e.timezone;
  const relays = relaysOf(e);
  const lines = a.sessions.map((s) => lineOf(db, s));
  const refs = lines.map(
    (l) => `nostr:${naddrFor(KIND_SESSION, pubkey, sessionDTag(e.id, l.id), relays)}`,
  );
  const tags = lines.map((l) => ['a', `${KIND_SESSION}:${pubkey}:${sessionDTag(e.id, l.id)}`]);
  const footer = (...links: (string | null)[]): string =>
    [...refs, ...links].filter((x): x is string => !!x).join(' · ');

  switch (a.trigger) {
    case 'up_next': {
      if (lines.length === 0) return null;
      const body = lines.map(roomLine).join('\n');
      return {
        tags,
        content: `Up next at ${hhmm(a.at, tz)} at ${e.name}\n\n${body}\n\n${footer(eventUrl(publicUrl, e))}`,
      };
    }
    case 'digest': {
      if (lines.length === 0) return null;
      const day = localDate(new Date(a.at), tz);
      const rows: { min: number; text: string }[] = lines.map((l) => {
        const p = zonedParts(new Date(l.startsAt), tz);
        return {
          min: p.hour * 60 + p.minute,
          text: `${hhmm(l.startsAt, tz)} · ${l.room ?? '—'} — ${l.title}`,
        };
      });
      for (const b of breaksOn(db, e, day)) {
        rows.push({ min: b.startMin, text: `${minuteText(b.startMin)} · ${b.label}` });
      }
      rows.sort((x, y) => x.min - y.min);
      const shown = rows.slice(0, DIGEST_MAX_LINES).map((r) => r.text);
      if (rows.length > DIGEST_MAX_LINES)
        shown.push(`… and ${rows.length - DIGEST_MAX_LINES} more`);
      return {
        tags,
        content: `${dayLabel(a.at, tz)} at ${e.name}\n\n${shown.join('\n')}\n\n${footer(eventUrl(publicUrl, e))}`,
      };
    }
    case 'added':
    case 'placed': {
      const l = lines[0];
      if (!l) return null;
      const head =
        a.trigger === 'placed'
          ? `Placed from the pitch board: ${l.title}`
          : `Added to the programme: ${l.title}`;
      const when = `${dayWord(l.startsAt, a.at, tz)} ${hhmm(l.startsAt, tz)}`;
      const where = [`${when}${l.room ? ` in ${l.room}` : ''}`, l.speakers.join(', ')]
        .filter(Boolean)
        .join(' · ');
      return { tags, content: `${head}\n${where}\n\n${footer(sessionUrl(publicUrl, e, l.id))}` };
    }
    case 'changed': {
      if (lines.length === 0) return null;
      const body = lines
        .map(
          (l) =>
            `${dayWord(l.startsAt, a.at, tz)} ${hhmm(l.startsAt, tz)} · ${l.room ?? '—'} — ${l.title}`,
        )
        .join('\n');
      return {
        tags,
        content: `Moved on the schedule\n\n${body}\n\n${footer(eventUrl(publicUrl, e))}`,
      };
    }
    case 'pitched': {
      const p = a.proposal;
      if (!p) return null;
      const pitcher = pitcherName(db, e, p);
      const teaser =
        p.description
          .split('\n')
          .map((x) => x.trim())
          .find((x) => x.length > 0) ?? '';
      const board = publicUrl ? `${publicUrl}/e/${e.slug}/proposals` : null;
      const parts = [`Pitched: ${p.title}`, pitcher ? `by ${pitcher}` : '', teaser].filter(Boolean);
      return { tags: [], content: [parts.join('\n'), board].filter(Boolean).join('\n\n') };
    }
  }
}

/** The speaker the pitch names, else whoever wrote it, by their display name here. */
function pitcherName(db: Db, event: EventRow, p: ProposalRow): string {
  if (p.speaker_id !== null) {
    const row = db
      .prepare<[number], { name: string }>(
        'SELECT name FROM people WHERE id = ? AND deleted_at IS NULL',
      )
      .get(p.speaker_id);
    if (row) return row.name;
  }
  return new NameResolver(db, event.id).get(p.created_by);
}

/** The announcer's Nostr transport: kind-1 notes signed by the event's key. */
export function nostrTransport(db: Db, config: Config, pool: Pool): Transport {
  return {
    name: 'nostr',
    enabled: (event, trigger) =>
      event.nostr_enabled === 1 &&
      event.nostr_seckey !== null &&
      triggersOf(event).includes(trigger),
    timing: () => ({ leadMin: NOSTR_LEAD_MIN, digestMin: NOSTR_DIGEST_MIN }),
    async send(event: EventRow, a: Announcement): Promise<void> {
      const seckey = openEventKey(event, config);
      if (!seckey) throw new Error('the key does not decrypt');
      const note = renderNote(db, a, event.nostr_pubkey!, config.publicUrl);
      if (!note) return;
      const signed = finalizeEvent(
        {
          kind: 1,
          created_at: Math.floor(Date.now() / 1000),
          tags: note.tags,
          content: note.content,
        },
        seckey,
      );
      const relays = relaysOf(event);
      if (relays.length === 0) throw new Error('no relays configured');
      const results = await Promise.allSettled(pool.publish(relays, signed));
      if (results.every((r) => r.status === 'rejected')) {
        const first = results[0] as PromiseRejectedResult;
        throw new Error(
          `no relay accepted the note: ${String(first.reason?.message ?? first.reason)}`,
        );
      }
    },
  };
}
