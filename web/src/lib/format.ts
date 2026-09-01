import type { SessionDto } from '@shared/types';
import { localDate, localMinuteOfDay } from '@shared/time';

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Ids, rendered so two different id spaces are never mistaken for each other.
 *
 * A **UID** is an identity: one human, the same code at every event on this
 * instance, and the only thing about them that never changes. It arrives from
 * the server as 5 random hex chars and is shown uppercased, so it reads as a
 * code and not a word. An **ID** is the row that was acted on — a profile, a
 * session, a tag — and is a per-event integer, zero-padded so a column of
 * them lines up.
 */
export const uid = (publicId: string): string => `UID: ${publicId.toUpperCase()}`;
export const rowId = (id: number): string => `ID: ${String(id).padStart(5, '0')}`;

/** 'HH:MM' from minutes since local midnight. */
export const fmtMin = (minute: number): string =>
  `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;

/** Minutes since local midnight from an `<input type="time">` value. */
export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Snapped to the same 5-minute grid the calendar uses, which is what the
 *  server accepts — `step` alone is advisory in some browsers. */
export const snapMinute = (minute: number): number => Math.round(minute / 5) * 5;

export interface Placed {
  date: string;
  startMin: number;
  endMin: number;
  durMin: number;
}

/** Where a session sits on the grid, in the event's timezone. */
export function place(session: SessionDto, timezone: string): Placed {
  const startsAt = new Date(session.startsAt);
  const endsAt = new Date(session.endsAt);
  const date = localDate(startsAt, timezone);
  const startMin = localMinuteOfDay(startsAt, timezone);
  const durMin = Math.round((endsAt.getTime() - startsAt.getTime()) / 60000);
  return { date, startMin, endMin: startMin + durMin, durMin };
}

/** Day-tab label: "Today"/"Tomorrow"/weekday, plus a short date. `date` and
 *  `today` are already local to the event, so this is pure string work. */
export function dayLabel(date: string, today: string): { top: string; sub: string } {
  const d = new Date(`${date}T12:00:00Z`);
  const sub = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (date === today) return { top: 'Today', sub };
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date === tomorrow.toISOString().slice(0, 10)) return { top: 'Tomorrow', sub };
  return {
    top: d.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
    sub,
  };
}

/**
 * A span of days as one label: "1–7 Jun", or "29 Jun – 5 Jul" when it straddles
 * a month. Used by the week rail, where a week has to name itself in the width
 * of a chip.
 */
export function dayRangeLabel(from: string, to: string): string {
  const utc = { timeZone: 'UTC' } as const;
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  const aDay = a.toLocaleDateString(undefined, { day: 'numeric', ...utc });
  const bDay = b.toLocaleDateString(undefined, { day: 'numeric', ...utc });
  const aMonth = a.toLocaleDateString(undefined, { month: 'short', ...utc });
  const bMonth = b.toLocaleDateString(undefined, { month: 'short', ...utc });
  if (from === to) return `${aDay} ${aMonth}`;
  return aMonth === bMonth
    ? `${aDay}–${bDay} ${bMonth}`
    : `${aDay} ${aMonth} – ${bDay} ${bMonth}`;
}

/** "just now" / "5m ago" / "2h ago" / a date, for contribution timestamps. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Minutes since midnight in the event's timezone, at `instant`. */
export const nowMinuteOfDay = (timezone: string, instant: Date = new Date()): number =>
  localMinuteOfDay(instant, timezone);

/** The date `instant` falls on in the event's timezone. */
export const todayInZone = (timezone: string, instant: Date = new Date()): string =>
  localDate(instant, timezone);

/**
 * The bill as one line: "Ada Lovelace", "Ada Lovelace & Grace Hopper", "Ada
 * Lovelace, Grace Hopper & Radia Perlman". Empty when nobody is credited, so a
 * caller can treat it as the whole "is there a speaker?" question.
 *
 * The ampersand on the last pair is how a poster reads, and it is one
 * character where "and" is three — this line is drawn inside a grid block a
 * couple of hundred pixels wide.
 */
export function speakerLine(speakers: readonly { name: string }[]): string {
  if (speakers.length === 0) return '';
  if (speakers.length === 1) return speakers[0].name;
  const names = speakers.map((p) => p.name);
  const last = names.pop() as string;
  return `${names.join(', ')} & ${last}`;
}
