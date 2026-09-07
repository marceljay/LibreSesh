/**
 * Timezone helpers. Instants are stored as UTC ISO-8601; every user-visible
 * time and every validation rule (5-minute snap, day viewport, event date
 * range) is expressed in the event's IANA timezone. Uses Intl only — no
 * timezone library.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimezone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant as seen in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  // Intl renders midnight as hour 24 in some engines/locales.
  const hour = get('hour') % 24;
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** 'YYYY-MM-DD' of an instant in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since local midnight of an instant in `timeZone`. */
export function localMinuteOfDay(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  return p.hour * 60 + p.minute;
}

/** Offset of `timeZone` from UTC, in minutes, at `instant`. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000;
}

/**
 * Convert a wall-clock time in `timeZone` to the corresponding instant.
 * Iterates twice so a DST transition between the guess and the answer settles.
 * Ambiguous times (the repeated hour when clocks go back) resolve to the first
 * occurrence; skipped times (spring forward) resolve to the instant after the
 * gap — both acceptable for scheduling.
 */
export function zonedTimeToUtc(dateStr: string, minuteOfDay: number, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number) as [number, number, number];
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  let guess = new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0));
  for (let i = 0; i < 2; i++) {
    const offset = offsetMinutes(guess, timeZone);
    const corrected = new Date(Date.UTC(y, m - 1, d, hour, minute, 0, 0) - offset * 60000);
    if (corrected.getTime() === guess.getTime()) break;
    guess = corrected;
  }
  return guess;
}

/** Inclusive list of 'YYYY-MM-DD' between two dates. */
export function dateRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const [sy, sm, sd] = startDate.split('-').map(Number) as [number, number, number];
  const end = endDate;
  const cursor = new Date(Date.UTC(sy, sm - 1, sd));
  for (let guard = 0; guard < 400; guard++) {
    const iso = cursor.toISOString().slice(0, 10);
    out.push(iso);
    if (iso >= end) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export const MINUTE_MS = 60_000;

/** Whole minutes between two instants. */
export function durationMinutes(startsAt: Date, endsAt: Date): number {
  return Math.round((endsAt.getTime() - startsAt.getTime()) / MINUTE_MS);
}
