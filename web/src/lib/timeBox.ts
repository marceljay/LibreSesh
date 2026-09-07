/**
 * The time box's editing model: what it shows, and where the caret is, after
 * each thing a person does to it. Pure, so it can be typed into in a test one
 * key at a time; `TimeField` is the wiring.
 *
 * The box is two segments with a colon between them, the way the browser's
 * own time widget is, and every edit is read as an edit to one segment. That
 * is the difference from a mask that only filters digits: a mask sees `0` go
 * into `12:30` and must decide where five digits go into four places — the
 * answer it gave was `10:23`, the old minutes leaking into the new time. A
 * segment knows the `0` went into the hour, and the hour is what changes.
 *
 * Typing into an empty box reads left to right: `0`, `07:`, `07:2`, `07:25` —
 * the colon is typed for you after the hour, and `9` becomes `09:` at once
 * because no hour starts with nine. Typing into a segment that is already
 * full overtypes it, digit for digit, and a digit at the very end of a full
 * box starts its minutes over — `11:10` and then `4`, `5` is `11:45`, which is
 * what the browser's widget does and what someone who has just clicked at the
 * end of a time means. A finished hour hands the caret to the minutes, with
 * the minutes selected if there are any, so `0725` typed over the hour of
 * `11:10` is `07:25` and not `07:10` with two digits lost.
 *
 * Text is the `HH:MM` the callers know, or less while it is being typed: `1`,
 * `08:`, `08:3`. The colon is never typed and never deleted — a backspace over
 * it takes the hour digit before it, a delete the minute digit after it — so
 * the box's shape cannot drift from what `parseTime` reads.
 */

export interface TimeBox {
  hours: string;
  minutes: string;
}

export interface Span {
  start: number;
  end: number;
}

/** What the box shows, and what is selected in it. */
export interface BoxState extends Span {
  text: string;
}

type Segment = 'hours' | 'minutes';

interface Edit {
  box: TimeBox;
  start: number;
  end: number;
}

const DIGIT = /^\d$/;
/** What may stand between hour and minute when a time is typed or pasted:
 *  `9:30`, `9.30`, `9h30`, `9 30`. Any other letter is nothing. */
const SEPARATOR = /^[:.hH\s]$/;

export function splitTime(text: string): TimeBox {
  const colon = text.indexOf(':');
  if (colon < 0) return { hours: text, minutes: '' };
  return { hours: text.slice(0, colon), minutes: text.slice(colon + 1) };
}

/** The colon appears once the hour is complete or a minute exists: `1`,
 *  `08:`, `08:3`, `1:30`, `:30`. */
export function joinTime({ hours, minutes }: TimeBox): string {
  if (minutes === '') return hours.length === 2 ? `${hours}:` : hours;
  return `${hours}:${minutes}`;
}

/** Which segment a caret at `pos` is in. The colon itself counts as the end
 *  of the hour, which is where a caret sits after typing one. */
export function segmentAt(text: string, pos: number): Segment {
  const colon = text.indexOf(':');
  return colon < 0 || pos <= colon ? 'hours' : 'minutes';
}

/**
 * What a click at `pos` selects: the segment under it, whole, so the digits
 * typed next replace it — a person who clicks into the hour of `11:10` and
 * types `09` means `09:10`, not `1109:10` cut to fit. A segment with nothing
 * in it leaves the caret where the click put it.
 */
export function segmentSpan(text: string, pos: number): Span {
  const { hours, minutes } = splitTime(text);
  const colon = text.indexOf(':');
  if (segmentAt(text, pos) === 'hours') {
    return hours === '' ? { start: pos, end: pos } : { start: 0, end: hours.length };
  }
  return minutes === '' ? { start: pos, end: pos } : { start: colon + 1, end: text.length };
}

/**
 * The box after the browser has applied an edit to it.
 *
 * `previous` is what the box showed, `before` what was selected in it (or
 * null if that was not seen), `typed` is what the browser made of the
 * keystroke, and `caret` where it left the caret. From those four the edit is
 * recovered — what was inserted, what was removed — and replayed onto the
 * segments, which is more reliable than guessing at the result: a mask that
 * only sees `typed` cannot tell `12:30` with the `2` overtyped from `12:30`
 * with a digit wedged in.
 */
export function editTime(
  previous: string,
  before: Span | null,
  typed: string,
  caret: number,
): BoxState {
  if (typed === previous) return { text: previous, start: caret, end: caret };

  const change = recover(previous, before, typed, caret);
  const box = splitTime(previous);

  if (change.inserted === '') {
    return done(deleteSpan(box, change.start, change.end, change.backward));
  }

  // Three or more digits at once is a paste, or a whole time typed over a
  // selection: read it fresh, left to right, like typing into an empty box.
  const digits = change.inserted.replace(/\D/g, '');
  let state: Edit =
    digits.length >= 3
      ? { box: { hours: '', minutes: '' }, start: 0, end: 0 }
      : change.end > change.start
        ? deleteSpan(box, change.start, change.end, false)
        : { box, start: change.start, end: change.start };
  for (const ch of change.inserted) state = type(state, ch);
  return done(state);
}

interface Change {
  start: number;
  end: number;
  inserted: string;
  /** A backspace rather than a delete — only matters over the colon. */
  backward: boolean;
}

/** The edit that turned `previous` into `typed`, as the span of `previous`
 *  that went and the text that came in its place. */
function recover(previous: string, before: Span | null, typed: string, caret: number): Change {
  const from = (start: number): Change => {
    const inserted = caret > start ? typed.slice(start, caret) : '';
    const begin = Math.min(start, caret);
    const end = previous.length - (typed.length - caret);
    return { start: begin, end, inserted, backward: false };
  };
  const fits = (c: Change): boolean =>
    c.end >= c.start &&
    previous.slice(0, c.start) === typed.slice(0, c.start) &&
    previous.slice(c.end) === typed.slice(caret);

  if (before) {
    const c = from(before.start);
    if (fits(c)) {
      c.backward = before.start === before.end && caret < before.start;
      return c;
    }
  }
  // The selection before the edit was not seen: the edit starts where the two
  // texts part ways, or at the caret if that comes first. A backspace is the
  // likelier of the two ways to delete, so it is assumed.
  let same = 0;
  while (same < caret && same < previous.length && previous[same] === typed[same]) same++;
  const c = from(same);
  if (fits(c)) {
    c.backward = c.inserted === '';
    return c;
  }
  // Nothing consistent: read the whole box again.
  return { start: 0, end: previous.length, inserted: typed, backward: false };
}

function done({ box, start, end }: Edit): BoxState {
  return { text: joinTime(box), start, end };
}

const at = (box: TimeBox, segment: Segment, offset: number): number => {
  if (segment === 'hours') return offset;
  const colon = box.minutes !== '' || box.hours.length === 2 ? 1 : 0;
  return box.hours.length + colon + offset;
};

const caretIn = (box: TimeBox, segment: Segment, offset: number): Edit => {
  const pos = at(box, segment, offset);
  return { box, start: pos, end: pos };
};

/** The hour is done: the minutes are next. Existing minutes are selected so
 *  the next digit replaces them rather than being wedged in front. */
const toMinutes = (box: TimeBox): Edit => {
  const start = at(box, 'minutes', 0);
  return { box, start, end: start + box.minutes.length };
};

/** One character typed at the state's selection. */
function type(state: Edit, ch: string): Edit {
  const base =
    state.start === state.end ? state : deleteSpan(state.box, state.start, state.end, false);
  const { box, start: pos } = base;
  const hl = box.hours.length;
  // A caret at the end of a full hour is in the minutes: nothing more fits.
  const inHours = pos < hl || (pos === hl && hl < 2);

  if (!DIGIT.test(ch)) {
    // A separator closes a half-typed hour: `1:` is `01:`. Anything else is nothing.
    if (SEPARATOR.test(ch) && inHours && hl === 1 && pos === 1) {
      return toMinutes({ ...box, hours: `0${box.hours}` });
    }
    return caretIn(box, inHours ? 'hours' : 'minutes', inHours ? pos : minuteOffset(box, pos));
  }
  return inHours ? typeHour(box, pos, ch) : typeMinute(box, minuteOffset(box, pos), ch);
}

const minuteOffset = (box: TimeBox, pos: number): number => {
  const colon = box.minutes !== '' || box.hours.length === 2 ? 1 : 0;
  return Math.max(0, Math.min(box.minutes.length, pos - box.hours.length - colon));
};

function typeHour(box: TimeBox, offset: number, ch: string): Edit {
  const h = box.hours;
  const next =
    h.length < 2
      ? h.slice(0, offset) + ch + h.slice(offset)
      : h.slice(0, offset) + ch + h.slice(offset + 1);
  if (next.length === 1) {
    // 3–9 cannot start a two-digit hour: it is 03–09 at once.
    if (next > '2') return toMinutes({ ...box, hours: `0${next}` });
    return caretIn({ ...box, hours: next }, 'hours', 1);
  }
  if (Number(next) > 23) {
    if (h.length < 2) {
      // `24` was `02` and the first digit of its minutes.
      return type(toMinutes({ ...box, hours: `0${next[0]}` }), next[1]);
    }
    // Overtyping made nonsense of the hour: start it over from this digit.
    return typeHour({ ...box, hours: '' }, 0, ch);
  }
  return toMinutes({ ...box, hours: next });
}

function typeMinute(box: TimeBox, offset: number, ch: string): Edit {
  const m = box.minutes;
  const next =
    m.length < 2
      ? m.slice(0, offset) + ch + m.slice(offset)
      : offset < 2
        ? m.slice(0, offset) + ch + m.slice(offset + 1)
        : // The box is full and the caret at its end: the minutes start over.
          ch;
  if (next.length === 1) {
    // 6–9 cannot start a minute: it is 06–09 at once.
    if (next > '5') return caretIn({ ...box, minutes: `0${next}` }, 'minutes', 2);
    return caretIn({ ...box, minutes: next }, 'minutes', 1);
  }
  if (Number(next) > 59) return typeMinute({ ...box, minutes: '' }, 0, ch);
  return caretIn({ ...box, minutes: next }, 'minutes', 2);
}

/**
 * Remove `[start, end)` of the box's text. Digits in the span go; the colon
 * is not a thing that can go, so a span that is only the colon takes the
 * digit beside it instead — the one before for a backspace, after for a
 * delete — and the colon comes back on its own when there is an hour or a
 * minute to separate.
 */
function deleteSpan(box: TimeBox, start: number, end: number, backward: boolean): Edit {
  const text = joinTime(box);
  const colon = text.indexOf(':');
  if (colon >= 0 && start === colon && end === colon + 1) {
    if (backward) {
      const next = { ...box, hours: box.hours.slice(0, -1) };
      return caretIn(next, 'hours', next.hours.length);
    }
    return caretIn({ ...box, minutes: box.minutes.slice(1) }, 'minutes', 0);
  }
  let hours = '';
  let minutes = '';
  for (let i = 0; i < text.length; i++) {
    if (i === colon || (i >= start && i < end)) continue;
    if (colon < 0 || i < colon) hours += text[i];
    else minutes += text[i];
  }
  const next = { hours, minutes };
  if (colon < 0 || start < colon) return caretIn(next, 'hours', Math.min(start, hours.length));
  return caretIn(next, 'minutes', Math.max(0, start - colon - 1));
}
