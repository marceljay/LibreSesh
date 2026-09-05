import { fmtMin, minutesOf } from './format';

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
