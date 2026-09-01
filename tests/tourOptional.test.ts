import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The schedule used to put a stack of coach-marks over itself on a first
 * visit, before anyone had seen the thing they came for. The tour is good; it
 * is standing in front of the schedule that is not. It is the "?" button now,
 * and only that.
 *
 * There is no DOM in this suite, so what is pinned here is the shape of the
 * rule rather than what it paints.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const schedule = readFileSync(join(WEB_SRC, 'pages', 'SchedulePage.tsx'), 'utf8');
const tour = readFileSync(join(WEB_SRC, 'components', 'Tour.tsx'), 'utf8');
const help = readFileSync(join(WEB_SRC, 'components', 'HelpMenu.tsx'), 'utf8');

describe('the tour is asked for, never imposed', () => {
  it('never opens itself', () => {
    // The only `setTourOpen(true)` in the file is what the help menu's "Take
    // the tour" item is handed.
    const opens = schedule.match(/setTourOpen\(true\)/g) ?? [];
    expect(opens).toHaveLength(1);
    expect(schedule).toMatch(/<HelpMenu\n\s*onTour=\{\(\) => setTourOpen\(true\)\}/);
    expect(help).toContain('Take the tour');
  });

  it('has no first-visit rule left to fire', () => {
    expect(schedule).not.toContain('tourSeen');
    expect(tour).not.toContain('tourSeen');
  });

  it('remembers nothing about having been taken', () => {
    // Seen-state only ever existed to decide whether to auto-start. With the
    // tour on request, the next press of "?" must give you the same tour.
    expect(tour).not.toContain('localStorage');
    expect(tour).not.toContain('markSeen');
  });
});

/**
 * The build stamp used to be a pill pinned to the bottom-right of every page:
 * a permanent fixture for a question asked twice a year, sitting over the
 * corner of the grid on a phone. It moved behind the same "?" as the tour,
 * which is where someone who wants it goes looking.
 */
describe('the version is somewhere, not everywhere', () => {
  const app = readFileSync(join(WEB_SRC, 'App.tsx'), 'utf8');

  it('is no longer pinned to the corner of every page', () => {
    expect(app).not.toContain('BuildInfo');
    expect(existsSync(join(WEB_SRC, 'components', 'BuildInfo.tsx'))).toBe(false);
  });

  it('is in About LibreSesh, with what a bug report needs', () => {
    expect(help).toContain('About LibreSesh');
    expect(help).toContain('VITE_BUILD_TAG');
    expect(help).toContain('VITE_BUILD_COMMIT');
    expect(help).toContain('VITE_BUILD_TIME');
    // Selectable: the first thing anyone is asked for is which build they were
    // on, and reading a commit hash back off a screen is nobody's idea of fun.
    expect(help).toContain('select-all');
  });
});
