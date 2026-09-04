import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Moving to another day should land on that day's first session.
 *
 * The grid runs from the event's earliest hour to its latest — the edges of the
 * whole event, not of any one day — so a day whose programme starts after lunch
 * opened on a screenful of empty rows and read as an empty day until you
 * scrolled. Every way of changing the day goes through one place now.
 *
 * There is no DOM in this suite, so what is pinned here is the shape of the
 * rule rather than the pixels it produces.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const schedule = readFileSync(join(WEB_SRC, 'pages', 'SchedulePage.tsx'), 'utf8');

const goToDay = (() => {
  const from = schedule.indexOf('const goToDay = useCallback(');
  expect(from).toBeGreaterThan(-1);
  return schedule.slice(from, schedule.indexOf('\n  );', from));
})();

describe('a day opens on its first session', () => {
  it('scrolls the grid to the earliest session on the day it is given', () => {
    // The minimum over the day's own sessions, not over the day's hours.
    expect(goToDay).toMatch(/at\.date === date && \(first === null \|\| at\.startMin < first\)/);
    expect(goToDay).toMatch(
      /\(first - event\.dayStartMin\) \* PX_PER_MIN - DAY_LEAD_IN/,
    );
    // No header offset in that arithmetic: the room cards are sticky inside the
    // same scroller, so scrolling by the session's distance into the day leaves
    // it just under them.
    expect(goToDay).not.toMatch(/offsetHeight|clientHeight/);
  });

  it('leaves a little air above it rather than clipping it to the edge', () => {
    expect(schedule).toMatch(/const DAY_LEAD_IN = \d+;/);
    // And never scrolls to a negative offset for a session at the day's start.
    expect(goToDay).toMatch(/Math\.max\(0,/);
  });

  it('falls back to the top for a day with nothing on it, and for the list', () => {
    // `calRef` is null in list view, and the list is only ever as long as its
    // own rows — there is nothing above the first one to skip.
    expect(goToDay).toMatch(/el\?\.scrollTo\(\{ top: 0 \}\)/);
    expect(goToDay).toMatch(/mainRef\.current\?\.scrollTo\(\{ top: 0 \}\)/);
  });

  it('waits for the new day to be on screen before measuring it', () => {
    expect(goToDay).toMatch(/requestAnimationFrame/);
  });

  it('is the one way in: day strip, week rail, and both views’ end-of-day button', () => {
    expect(schedule).toMatch(/onClick=\{\(\) => goToDay\(d\)\}/);
    expect(schedule).toMatch(/onClick=\{\(\) => goToDay\(holdsToday \? today : first\)\}/);
    // Both the list and the grid are handed the same callback and the same day.
    expect([...schedule.matchAll(/onGoToDay=\{goToDay\}/g)]).toHaveLength(2);
    expect([...schedule.matchAll(/nextDay=\{nextDay\}/g)]).toHaveLength(2);
  });

  it('offers the next day at the bottom of the grid, not only the list', () => {
    // It was a list-only affordance from the day it was added (`83c54bd`), so
    // in the grid the only way on was the day strip at the top of the page.
    const calendar = readFileSync(
      join(WEB_SRC, 'components', 'Calendar.tsx'),
      'utf8',
    );
    expect(calendar).toMatch(/Next day · \{nextDay\.label\}/);
    // Centred under the day, not tacked to its left margin.
    expect(calendar).toMatch(/mx-auto w-\[min\(24rem,100%\)\]/);
    expect(calendar).not.toMatch(/sticky start-0 w-\[min/);
  });
});
