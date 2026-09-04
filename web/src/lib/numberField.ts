/**
 * The one numeric input in the app.
 *
 * `type="number"` looked like it did this job and does not: the browser
 * enforces `min`/`max` on the spinner and on form submit, but never on a typed
 * or pasted value, and a React form reading `e.target.value` never submits. Two
 * things went wrong because of that. Nonsense went in — `1e5`, `--3`, a pasted
 * word — and came back out of `e.target.value` as `''`, silently emptying a
 * field the person thought they were filling. And a number outside the range
 * went all the way to the server before anyone said so: `Number('')` is `0`, so
 * "keep 0 audit entries — that is, keep everything, forever" is what an
 * organiser got for clearing the box to retype it.
 *
 * So the value is a string the whole way, digits are the only thing that can
 * enter it, and the range is checked where it is typed rather than after a
 * round trip. Every numeric field in the app is a non-negative integer, which
 * is why there is no sign or decimal here to strip.
 */

export interface NumberFieldSpec {
  min: number;
  max: number;
  /**
   * Values allowed outside `[min, max]`. Audit retention's `0` is the only one:
   * it means "keep everything", which is not a smaller version of a hundred,
   * so the range cannot simply start at zero.
   */
  alsoAllow?: readonly number[];
  /** Whether blank is an answer ("no capacity set") or an unfinished field. */
  allowEmpty?: boolean;
  /** What is being counted, for the message: "seats", "days", "entries". */
  unit?: string;
}

/**
 * Why a value was refused, as a code and its parameters rather than a finished
 * sentence. Building the sentence here would mean assembling it from fragments
 * ("Must be " + extras + ", or " + range), which is the shape a translator
 * cannot work with: word order and list punctuation differ by language. The
 * caller renders it through `numberFieldMessage`, where each case is one whole
 * template (forms strategy, i18n readiness rule 3).
 */
export type NumberFieldError =
  | { code: 'required' }
  | { code: 'digits_only' }
  | { code: 'range'; min: number; max: number; unit?: string; alsoAllow: readonly number[] };

export interface NumberFieldValue {
  /** `null` when blank, or when the text is not a number we can use. */
  value: number | null;
  /** Why it was refused, or `null` when there is nothing wrong. */
  error: NumberFieldError | null;
}

const group = (n: number): string => n.toLocaleString('en-US');

/** The widest a legitimate answer can be, so the field stops accepting digits
 *  at that point rather than letting someone type past the maximum. */
export const maxDigits = (spec: NumberFieldSpec): number =>
  String(Math.max(spec.max, ...(spec.alsoAllow ?? []))).length;

/**
 * What the field is allowed to contain after a keystroke or a paste.
 *
 * Leading zeros collapse as you type ("08" → "8") so they cannot eat the digit
 * budget, but a lone "0" survives — it is a real answer for both capacity and
 * audit retention.
 */
export const sanitizeNumberInput = (raw: string, spec: NumberFieldSpec): string =>
  raw
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, maxDigits(spec));

/** Why this spec would refuse a number, as data. */
export const rangeError = (spec: NumberFieldSpec): NumberFieldError => ({
  code: 'range',
  min: spec.min,
  max: spec.max,
  unit: spec.unit,
  alsoAllow: spec.alsoAllow ?? [],
});

/**
 * The sentence for a refusal. Each case is one complete message with its values
 * filled in — never a stem with clauses appended — so a translation can reorder
 * it freely. The list of extra allowed values goes through `Intl.ListFormat`
 * rather than `join(' or ')`, because "a or b" is not how every language joins
 * a list.
 */
export const numberFieldMessage = (error: NumberFieldError): string => {
  if (error.code === 'required') return 'Enter a number';
  if (error.code === 'digits_only') return 'Digits only';

  const min = group(error.min);
  const max = group(error.max);
  const extras = new Intl.ListFormat('en', { style: 'short', type: 'disjunction' }).format(
    error.alsoAllow.map(group),
  );
  if (error.alsoAllow.length > 0) {
    return error.unit
      ? `Must be ${extras}, or between ${min} and ${max} ${error.unit}`
      : `Must be ${extras}, or between ${min} and ${max}`;
  }
  return error.unit
    ? `Must be between ${min} and ${max} ${error.unit}`
    : `Must be between ${min} and ${max}`;
};

/** The number a field's text stands for, and why it does not stand for one. */
export const parseNumberField = (raw: string, spec: NumberFieldSpec): NumberFieldValue => {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null, error: spec.allowEmpty ? null : { code: 'required' } };
  }
  // Unreachable from the input, which sanitizes every change — but a value can
  // also arrive from props, and this is the function callers trust.
  if (!/^\d+$/.test(trimmed)) return { value: null, error: { code: 'digits_only' } };

  const n = Number(trimmed);
  const allowed = (spec.alsoAllow ?? []).includes(n) || (n >= spec.min && n <= spec.max);
  return allowed ? { value: n, error: null } : { value: null, error: rangeError(spec) };
};

/* ------------------- The numeric fields this app has ------------------- */

/**
 * Room capacity. The server takes up to 100,000; four digits is a deliberate
 * client-side tightening, because no venue this tool is for seats ten thousand
 * and a typo of that size is worth catching where it is made. Blank is a real
 * answer — most unconference rooms never get a capacity at all.
 */
export const capacityField: NumberFieldSpec = {
  min: 0,
  max: 9999,
  allowEmpty: true,
  unit: 'seats',
};

/** Mirrors `weekRailFromSchema`. */
export const weekRailFromField: NumberFieldSpec = { min: 1, max: 90, unit: 'days' };

/** Mirrors `auditKeepSchema`, `0` (keep everything) and all. */
export const auditKeepField: NumberFieldSpec = {
  min: 100,
  max: 1_000_000,
  alsoAllow: [0],
  unit: 'entries',
};
