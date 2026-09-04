import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { plural, pluralForm } from '../web/src/lib/plural.js';

/**
 * i18n readiness rule 3 (forms strategy): a counted thing is said by picking a
 * form, never by appending an "s".
 *
 * `${n} session${n === 1 ? '' : 's'}` is right in English and wrong nearly
 * everywhere else — Polish picks a different form at 2–4 than at 5, Arabic has
 * six, Japanese has one. The concatenation is also unreachable from a
 * translation file: there is no string to translate, only two fragments and a
 * ternary. So the rule is the shape, and the last test here is what keeps the
 * old shape from coming back.
 */
describe('a count picks a form', () => {
  it('groups the number and puts the right word after it', () => {
    expect(plural(1, { one: 'session', other: 'sessions' })).toBe('1 session');
    expect(plural(2, { one: 'session', other: 'sessions' })).toBe('2 sessions');
    // Grouped for the locale — a schedule can hold more than a thousand of
    // something, and "1000 entries" is not how a number is written.
    expect(plural(1000, { one: 'entry', other: 'entries' })).toBe('1,000 entries');
  });

  it('says zero as a word only where a caller asked for one', () => {
    const forms = { one: 'session', other: 'sessions', zero: 'no sessions' };
    expect(plural(0, forms)).toBe('no sessions');
    // Without `zero` it stays a digit: "0 results" is the honest line in a
    // table of counts, where "no results" would not line up with its column.
    expect(plural(0, { one: 'result', other: 'results' })).toBe('0 results');
  });

  it('falls back to `other` for a category English never asks for', () => {
    // `few`/`many` exist for languages that need them; an English caller gives
    // neither, and must not get `undefined` for it.
    expect(pluralForm(3, { one: 'day', other: 'days' })).toBe('days');
  });

  it('picks between whole sentences, not only words', () => {
    // Where the count changes the shape of the sentence rather than one word,
    // the forms are the sentences. Same operation, so it is the same function.
    const forms = { one: 'See the result on one page', other: 'See all results on one page' };
    expect(pluralForm(1, forms)).toBe('See the result on one page');
    expect(pluralForm(4, forms)).toBe('See all results on one page');
  });
});

describe('the old shape is gone from the client', () => {
  /** Every `.ts`/`.tsx` under `web/src`. */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return sources(path);
      return /\.tsx?$/.test(e.name) ? [path] : [];
    });
  }

  const WEB_SRC = join(import.meta.dirname, '..', 'web', 'src');

  it("has no `n === 1 ? '' : 's'` left anywhere", () => {
    // The four shapes the sweep found: a bare suffix, a word pair, and either
    // of those written with the comparison the other way round.
    const concatenated = /(===|!==|[<>]=?)\s*1\s*\?\s*'[^']*'\s*:\s*'[^']*'/;
    const offenders = sources(WEB_SRC)
      // The module that replaces the shape quotes it in its own doc comment.
      .filter((path) => !path.endsWith(join('lib', 'plural.ts')))
      .filter((path) => concatenated.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(WEB_SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('has one plural helper, not one per page', () => {
    // AdminPage and ImportPage each grew their own `plural(n, one, many)`, and
    // the two had already drifted apart in how they took the irregular case.
    const offenders = sources(WEB_SRC)
      .filter((path) => !path.endsWith(join('lib', 'plural.ts')))
      .filter((path) => /\b(?:const|function)\s+plural\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(WEB_SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});
