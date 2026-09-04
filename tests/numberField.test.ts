import { describe, expect, it } from 'vitest';
import {
  auditKeepField,
  capacityField,
  maxDigits,
  numberFieldMessage,
  parseNumberField,
  rangeError,
  sanitizeNumberInput,
  weekRailFromField,
  type NumberFieldSpec,
} from '../web/src/lib/numberField.js';
import { auditKeepSchema, roomSchema, weekRailFromSchema } from '../server/src/validation.js';

/** A plain bounded field, to test the primitive without an app concept in it. */
const plain: NumberFieldSpec = { min: 1, max: 90, unit: 'days' };

describe('sanitizeNumberInput', () => {
  it('keeps digits and drops everything else', () => {
    expect(sanitizeNumberInput('42', plain)).toBe('42');
    expect(sanitizeNumberInput('4 2', plain)).toBe('42');
  });

  it('drops the characters a type="number" would silently swallow', () => {
    // Each of these leaves `e.target.value` as '' in a real number input, so
    // the field emptied itself and said nothing. Here what survives is typed.
    expect(sanitizeNumberInput('1e5', plain)).toBe('15');
    expect(sanitizeNumberInput('--3', plain)).toBe('3');
    expect(sanitizeNumberInput('3.5', plain)).toBe('35');
    expect(sanitizeNumberInput('+7', plain)).toBe('7');
  });

  it('drops a pasted word entirely rather than half-reading it', () => {
    expect(sanitizeNumberInput('lots', plain)).toBe('');
  });

  it('stops at the digits the maximum needs', () => {
    expect(maxDigits(plain)).toBe(2);
    expect(sanitizeNumberInput('12345', plain)).toBe('12');
    expect(maxDigits(capacityField)).toBe(4);
    expect(sanitizeNumberInput('123456', capacityField)).toBe('1234');
  });

  it('counts the widest allowed value, not just the range', () => {
    // auditKeep also allows 0, which must not shrink the budget below 1000000.
    expect(maxDigits(auditKeepField)).toBe(7);
  });

  it('collapses leading zeros so they cannot eat the digit budget', () => {
    expect(sanitizeNumberInput('08', plain)).toBe('8');
    expect(sanitizeNumberInput('000012', plain)).toBe('12');
  });

  it('keeps a lone zero, which is a real answer', () => {
    expect(sanitizeNumberInput('0', capacityField)).toBe('0');
  });
});

describe('parseNumberField', () => {
  it('reads a number inside the range', () => {
    expect(parseNumberField('8', plain)).toEqual({ value: 8, error: null });
  });

  it('takes both ends of the range', () => {
    expect(parseNumberField('1', plain).value).toBe(1);
    expect(parseNumberField('90', plain).value).toBe(90);
  });

  it('refuses a number past either end, and says what it wants', () => {
    // The refusal is data — a code and its parameters — and the sentence is
    // rendered from it, so a translation can reorder the whole thing.
    expect(parseNumberField('0', plain)).toEqual({
      value: null,
      error: { code: 'range', min: 1, max: 90, unit: 'days', alsoAllow: [] },
    });
    const refused = parseNumberField('91', plain).error;
    expect(refused).not.toBeNull();
    expect(numberFieldMessage(refused!)).toBe('Must be between 1 and 90 days');
  });

  it('gives no value for a number it refuses', () => {
    // The caller must not be able to save a rejected field by reading `value`:
    // that is how an out-of-range entry became a default nobody typed.
    expect(parseNumberField('91', plain).value).toBeNull();
  });

  it('asks for a number when blank is not an answer', () => {
    expect(parseNumberField('', plain)).toEqual({ value: null, error: { code: 'required' } });
    expect(numberFieldMessage({ code: 'required' })).toBe('Enter a number');
  });

  it('accepts blank where blank means "not set"', () => {
    expect(parseNumberField('', capacityField)).toEqual({ value: null, error: null });
  });

  it('rejects text that never went through the input', () => {
    expect(parseNumberField('1e5', plain).error).toEqual({ code: 'digits_only' });
    expect(numberFieldMessage({ code: 'digits_only' })).toBe('Digits only');
  });

  it('allows a value outside the range that the spec names', () => {
    expect(parseNumberField('0', auditKeepField)).toEqual({ value: 0, error: null });
    const refused = parseNumberField('99', auditKeepField).error;
    expect(refused).not.toBeNull();
    expect(numberFieldMessage(refused!)).toBe('Must be 0, or between 100 and 1,000,000 entries');
  });

  it('groups thousands in the message it shows', () => {
    expect(numberFieldMessage(rangeError(auditKeepField))).toContain('1,000,000');
  });
});

/**
 * The client range is a copy of a server rule, and a copy can drift. These
 * check the two agree on the values either side of every boundary — the server
 * is still the one that decides, so a client that is merely *stricter* is fine
 * and a client that is looser is the bug.
 */
describe('the client specs against the schemas they mirror', () => {
  const serverTakes = (schema: { safeParse: (v: unknown) => { success: boolean } }, n: number) =>
    schema.safeParse(n).success;
  const clientTakes = (spec: NumberFieldSpec, n: number) =>
    parseNumberField(String(n), spec).error === null;

  it('agrees with weekRailFromSchema at both boundaries', () => {
    for (const n of [0, 1, 2, 89, 90, 91]) {
      expect(clientTakes(weekRailFromField, n)).toBe(serverTakes(weekRailFromSchema, n));
    }
  });

  it('agrees with auditKeepSchema, including the 0 that means "everything"', () => {
    for (const n of [0, 1, 99, 100, 101, 999_999, 1_000_000, 1_000_001]) {
      expect(clientTakes(auditKeepField, n)).toBe(serverTakes(auditKeepSchema, n));
    }
  });

  it('never lets capacity through something the server would refuse', () => {
    for (const n of [0, 1, 9999, 10_000]) {
      if (clientTakes(capacityField, n)) {
        expect(roomSchema.safeParse({ name: 'Hall', capacity: n }).success).toBe(true);
      }
    }
  });

  it('holds capacity to four digits, tighter than the server on purpose', () => {
    // No venue this tool is for seats ten thousand; a typo that size is worth
    // catching in the field rather than storing.
    expect(clientTakes(capacityField, 10_000)).toBe(false);
    expect(roomSchema.safeParse({ name: 'Hall', capacity: 10_000 }).success).toBe(true);
  });
});
