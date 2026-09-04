import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lensParams } from '../web/src/lib/useFilters.js';
import { UNTRACKED } from '../web/src/lib/tracks.js';

/**
 * Taking the day's filters to the whole event. A filter narrowed the day on
 * screen, so "everything tagged design" meant setting the tag and then walking
 * the day strip; the search page holds the same panel with no day scope, and
 * the hand-off is a link because every filter already lives in the URL.
 * See `_planning/specs/search.md`.
 */
describe('lensParams — the hand-off to the search page', () => {
  const filters = {
    day: '2026-06-02',
    view: 'cal' as const,
    axis: 'room' as const,
    rooms: [1, 2],
    tags: [3],
    tracks: [UNTRACKED],
    q: ' design ',
    soon: true,
    mine: true,
  };

  it('carries every filter across, under the keys the URL already uses', () => {
    const params = lensParams(filters);
    expect(params.get('room')).toBe('1,2');
    expect(params.get('tag')).toBe('3');
    expect(params.get('track')).toBe(String(UNTRACKED));
    expect(params.get('q')).toBe('design');
    expect(params.get('soon')).toBe('1');
    expect(params.get('mine')).toBe('1');
  });

  it('drops the day and the grid', () => {
    // `day`, `view` and `axis` are facts about a grid the search page has not
    // got — and the day scope is the thing being escaped.
    const params = lensParams(filters);
    expect(params.get('day')).toBeNull();
    expect(params.get('view')).toBeNull();
    expect(params.get('axis')).toBeNull();
  });

  it('writes nothing for an empty lens', () => {
    expect(
      lensParams({ ...filters, rooms: [], tags: [], tracks: [], q: '', soon: false, mine: false })
        .toString(),
    ).toBe('');
  });
});

/**
 * There is no DOM in this suite, so the wiring is pinned by shape: what matters
 * is that both surfaces go through the one predicate, and that the way across
 * exists on the schedule and not on the page that is already everywhere.
 */
describe('both surfaces share the lens', () => {
  const read = (...parts: string[]) =>
    readFileSync(join(__dirname, '..', 'web', 'src', ...parts), 'utf8');
  const schedule = read('pages', 'SchedulePage.tsx');
  const search = read('pages', 'SearchPage.tsx');
  const menu = read('components', 'FilterMenu.tsx');

  it('the schedule filters through matchesLens, then narrows to the day', () => {
    expect(schedule).toMatch(/matchesLens\(s, filters, \{/);
    expect(schedule).toMatch(/place\(s, timezone\)\.date === day/);
  });

  it('the search page filters through matchesLens and never narrows to a day', () => {
    expect(search).toMatch(/matchesLens\(session, filters, \{/);
    expect(search).not.toMatch(/=== day\b/);
  });

  it('"now / next" spans dates on the page and one day on the grid', () => {
    expect(search).toMatch(/at\.date > nowDate \|\| \(at\.date === nowDate && at\.endMin > nowMin\)/);
    expect(schedule).toMatch(/soonNow !== null && place\(x, timezone\)\.endMin > soonNow/);
  });

  it('offers Search everywhere from the schedule only', () => {
    expect(menu).toMatch(/onSearchEverywhere\?: \(\) => void;/);
    expect(schedule).toMatch(/onSearchEverywhere=\{searchEverywhere\}/);
    expect(schedule).toMatch(/lensParams\(filters\)\.toString\(\)/);
    expect(search).not.toMatch(/onSearchEverywhere=/);
  });

  it('keeps the chips when the results page writes its query', () => {
    // The page held its query in its own `useSearchParams`, and writing it
    // dropped every filter sitting beside it. One owner now: `useFilters`.
    expect(search).toMatch(/onSeeAll=\{\(q\) => filters\.set\(\{ q \}\)\}/);
    expect(search).not.toMatch(/useSearchParams/);
  });
});
