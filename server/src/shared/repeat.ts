/**
 * What "every weekday until the 20th" means — the calendar half, shared by the
 * server and the session form.
 *
 * A repeat is a statement about a wall calendar, so everything here works on
 * `YYYY-MM-DD` strings and never goes near a timezone. It hands back the days;
 * the caller turns each one into an instant through the event's own timezone,
 * separately, one at a time. That is what keeps 14:00 at 14:00 across a clock
 * change, and it is why nothing in this file knows what time a session starts.
 *
 * It lives in `shared/` so the form can count the sessions a run would create
 * before anyone commits to it, and count them the same way the server will.
 * The server's own `repeat.ts` adds the zod schema and turns `checkRepeat`
 * into a 400.
 *
 * **Nothing here persists.** These dates become ordinary sessions with no
 * series, no series id and no link between them. See ARCHITECTURE.md
 * §Importing a schedule for why.
 */

export const DAY_MS = 86_400_000;

/** How many days one repeat may land on. The form counts against it before
 *  submitting, so the limit is stated once and read in both places. */
export const MAX_REPEAT_DAYS = 120;

/** Indexed by `getUTCDay()`, so Sunday is first whatever a calendar prints. */
export const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type Weekday = (typeof WEEKDAY_NAMES)[number];

/** Monday first, which is how a programme is read. */
export const WEEKDAYS_MONDAY_FIRST: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export const dateToUtcMs = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
export const utcMsToDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, days: number): string =>
  utcMsToDate(dateToUtcMs(iso) + days * DAY_MS);
export const weekdayOf = (iso: string): Weekday =>
  WEEKDAY_NAMES[new Date(dateToUtcMs(iso)).getUTCDay()] as Weekday;

/**
 * Omitting `days` means every day, which is the common case: a standup, a meal,
 * a track that runs the same hours throughout. `except` lists the days a
 * programme skips — a holiday, an excursion — rather than inferring them,
 * because a gap in a printed schedule is a decision somebody made.
 */
export interface Repeat {
  /** Inclusive last day of the run. */
  until: string;
  days?: Weekday[];
  except?: string[];
}

export const describeRepeat = (repeat: Repeat): string =>
  repeat.days && repeat.days.length < 7 ? `repeats ${repeat.days.join(', ')}` : 'repeats every day';

export interface RepeatLimits {
  /** The last day the run may reach: the event's own end date. */
  eventEndDate: string;
  /** How many days one run may land on. */
  max: number;
}

/**
 * The reason this run cannot be created, or `null` if it can.
 *
 * Every one of these is a disagreement *within one request*: a run that ends
 * before it starts, a weekday list that leaves out the day it starts on, a run
 * that outlives the event. They are refused rather than silently narrowed,
 * because each means the person meant something they did not say and there is
 * no way to guess which half was the mistake.
 */
export function checkRepeat(first: string, repeat: Repeat, limits: RepeatLimits): string | null {
  if (repeat.until < first) {
    return `repeats until ${repeat.until}, before this session's own date ${first}`;
  }
  if (repeat.until > limits.eventEndDate) {
    return `repeats until ${repeat.until}, after the event ends ${limits.eventEndDate}`;
  }
  // The session's own day is the first occurrence, so a `days` list that leaves
  // it out contradicts the day above it rather than narrowing it.
  const startsOn = weekdayOf(first);
  if (repeat.days && !repeat.days.includes(startsOn)) {
    return `repeat.days does not include ${startsOn}, the weekday this session starts on`;
  }
  const { dates } = repeatDates(first, repeat);
  if (dates.length === 0) {
    return `repeats until ${repeat.until} but lands on no day at all`;
  }
  if (dates.length > limits.max) {
    return `repeats onto ${dates.length} days, more than the ${limits.max} allowed at once`;
  }
  return null;
}

export interface RepeatDates {
  /** Every day the run lands on, in order. */
  dates: string[];
  /** `except` entries the run never reached — the shape a mistyped date takes. */
  unusedExcepts: string[];
}

/**
 * The days a run lands on. Answers whatever it is given, including nothing:
 * judging a run is `checkRepeat`'s job, and keeping the two apart is what lets
 * the form show a live count of a run it is not yet willing to submit.
 */
export function repeatDates(first: string, repeat: Repeat): RepeatDates {
  const onlyOn = repeat.days ? new Set<string>(repeat.days) : null;
  const skipped = new Set(repeat.except ?? []);
  const skipsUsed = new Set<string>();
  const dates: string[] = [];

  for (let ms = dateToUtcMs(first); ms <= dateToUtcMs(repeat.until); ms += DAY_MS) {
    const date = utcMsToDate(ms);
    if (onlyOn && !onlyOn.has(weekdayOf(date))) continue;
    if (skipped.has(date)) {
      skipsUsed.add(date);
      continue;
    }
    dates.push(date);
  }

  return {
    dates,
    unusedExcepts: (repeat.except ?? []).filter((date) => !skipsUsed.has(date)),
  };
}
