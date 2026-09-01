import { readFileSync } from 'node:fs';
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

describe('the tour is asked for, never imposed', () => {
  it('never opens itself', () => {
    // The only `setTourOpen(true)` in the file is the "?" button's onClick.
    const opens = schedule.match(/setTourOpen\(true\)/g) ?? [];
    expect(opens).toHaveLength(1);
    expect(schedule).toMatch(/onClick=\{\(\) => setTourOpen\(true\)\}/);
    expect(schedule).toMatch(/aria-label="Take the tour"/);
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
