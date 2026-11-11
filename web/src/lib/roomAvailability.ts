import type { SessionDto } from '@shared/types';
import { localMinuteOfDay, zonedTimeToUtc } from '@shared/time';
import { fmtMin } from './format';

/** A stretch of the clock something already occupies, as epoch milliseconds. */
export interface Busy {
  startsAt: number;
  endsAt: number;
  title: string;
  /** It is here because it holds the floor, not because it is in the room. */
  hold: boolean;
}

/**
 * What a session being placed in `roomId` could collide with — the form's copy
 * of `assertNoOverlap` and `findBlockingSession` in `server/src/sessionRules.ts`,
 * so the list can say "taken" before Save does.
 *
 * Same exclusions as the server: a draft holds nothing, and a session does not
 * collide with itself. `holdsCount` adds the sessions that hold the floor,
 * whatever room they are in — the rule an attendee is held to and a speaker or
 * organiser is not.
 */
export function roomBusy(
  sessions: readonly SessionDto[],
  {
    roomId,
    excludeId,
    holdsCount = false,
  }: { roomId: number; excludeId?: number; holdsCount?: boolean },
): Busy[] {
  const out: Busy[] = [];
  for (const s of sessions) {
    if (s.draft || s.id === excludeId) continue;
    const inRoom = s.roomId === roomId;
    if (!inRoom && !(holdsCount && s.blocksOpenBooking)) continue;
    out.push({
      startsAt: Date.parse(s.startsAt),
      endsAt: Date.parse(s.endsAt),
      title: s.title,
      hold: !inRoom,
    });
  }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * The first thing a session of `durMin` starting at `startMin` on `day` would
 * run into, or null when the slot is free.
 *
 * Half-open, as on the server: starting exactly as something ends is fine.
 * Compared as instants rather than minutes of the day, so the answer is the
 * server's on the day the clocks change too.
 */
export function clashAt(
  busy: readonly Busy[],
  day: string,
  startMin: number,
  durMin: number,
  timezone: string,
): Busy | null {
  if (busy.length === 0) return null;
  const from = instantOf(day, startMin, timezone);
  const to = instantOf(day, startMin + durMin, timezone);
  return busy.find((b) => b.startsAt < to && b.endsAt > from) ?? null;
}

// A form asks about every row of two lists on every render, and each answer
// costs an `Intl` lookup. The questions repeat — the same few hundred minutes
// of the same few days — so the answers are kept.
const instants = new Map<string, number>();
function instantOf(day: string, minute: number, timezone: string): number {
  const key = `${timezone}|${day}|${minute}`;
  let ms = instants.get(key);
  if (ms === undefined) {
    if (instants.size > 5000) instants.clear();
    ms = zonedTimeToUtc(day, minute, timezone).getTime();
    instants.set(key, ms);
  }
  return ms;
}

/** “Opening keynote” (09:00–10:00) — what is in the way, on the event's clock. */
export function clashLabel(clash: Busy, timezone: string): string {
  const at = (ms: number) => fmtMin(localMinuteOfDay(new Date(ms), timezone));
  return `“${clash.title}” (${at(clash.startsAt)}–${at(clash.endsAt)})`;
}
