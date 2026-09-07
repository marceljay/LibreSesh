import { fmtMin, minutesOf, snapMinute } from './format';

const DAY = 24 * 60;

/**
 * The times a `TimeSelect` offers, as `HH:MM` strings in order.
 *
 * Fine-grained inside the window that matters — the event's day, in the
 * 5-minute steps the grid and the server use — and, when `beyond` is given,
 * coarse steps over the rest of the clock so an organiser can still put a
 * breakfast at 07:30 on a day that starts at nine without scrolling through
 * 288 rows to get there. `null` offers nothing outside the window, which is
 * what an attendee placing a session gets: the server would refuse the rest.
 *
 * `current` is always in the list, on the grid or not. A value that arrived
 * off-grid — an import, an older event — must still be shown and re-saveable
 * rather than silently snapped to the nearest row the moment the form opens.
 */
export function timeChoices({
  from,
  to,
  step = 5,
  beyond = 30,
  current,
}: {
  /** Minutes since midnight, inclusive. */
  from: number;
  to: number;
  step?: number;
  /** Step outside `from`–`to`, or `null` for none. */
  beyond?: number | null;
  current?: string | null;
}): string[] {
  const minutes = new Set<number>();
  for (let m = Math.max(0, from); m <= Math.min(to, DAY - 1); m += step) minutes.add(m);
  if (beyond !== null) {
    for (let m = 0; m < DAY; m += beyond) {
      if (m < from || m > to) minutes.add(m);
    }
  }
  if (current && /^\d{1,2}:\d{2}$/.test(current)) {
    const m = minutesOf(current);
    if (m >= 0 && m < DAY) minutes.add(m);
  }
  return [...minutes].sort((a, b) => a - b).map(fmtMin);
}

/**
 * What somebody typed into a time box, as `HH:MM` on the five-minute grid, or
 * `null` if it is not a time.
 *
 * Generous on the way in — `9`, `930`, `9:30`, `9.30`, `14h30`, `2pm`,
 * `2:15 PM` — because a box that only takes `09:30` is a worse version of the
 * clock widget it replaced. Strict on the way out: one shape, on the grid the
 * calendar and the server keep, never past 23:55.
 */
export function parseTime(text: string): string | null {
  // A separator with nothing after it (`08:`) is the box mid-word, after
  // `completeHour` put the colon in: an hour, minutes to come.
  const m = /^\s*(\d{1,2})(?:[:.h]?(\d{2})|[:.h])?\s*(am|pm)?\s*$/i.exec(text);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = m[3]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  }
  if (hours > 23 || minutes > 59) return null;
  return fmtMin(Math.min(DAY - 5, snapMinute(hours * 60 + minutes)));
}

/**
 * The colon, typed for you. After the second digit of an hour the box reads
 * `08:` and the next digits are minutes — which is what "jump to the minutes"
 * means in a box with no segments, and what a phone's numeric keyboard, which
 * has no colon key, needs. Two digits that are not an hour (`93`) were the
 * start of `9:30`, so they are split as such. Only on an insertion: a backspace
 * that took the colon away must not put it straight back.
 */
export function completeHour(previous: string, typed: string): string {
  if (typed.length <= previous.length || !/^\d{2}$/.test(typed)) return typed;
  return Number(typed) <= 23 ? `${typed}:` : `0${typed[0]}:${typed[1]}`;
}
