import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A schedule opened while the event is running should open at the current
 * time. The day already defaulted to today, but the grid still started at the
 * day's first hour, so anyone arriving mid-afternoon scrolled past the whole
 * morning — or found the Now button — before seeing what was on.
 *
 * There is no DOM in this suite, so what is pinned here is the shape of the
 * rule rather than the pixels it produces.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const schedule = readFileSync(join(WEB_SRC, 'pages', 'SchedulePage.tsx'), 'utf8');

describe('a running event opens at the current time', () => {
  it('scrolls the grid to now once the schedule is ready', () => {
    expect(schedule).toMatch(/if \(jumped\.current \|\| data\.status !== "ready" \|\| !event\) return;/);
    expect(schedule).toMatch(
      /el\.scrollTop =\n\s*\(nowMin - event\.dayStartMin\) \* PX_PER_MIN - el\.clientHeight \/ 2;/,
    );
    // The list view has no grid to scroll; it carries the same anchor the Now
    // button uses.
    expect(schedule).toMatch(/getElementById\("now-anchor"\)\?\.scrollIntoView\(\{ block: "center" \}\)/);
  });

  it('only when now is a place in the day', () => {
    // `nowMin` is null unless the day on screen is today, and outside the
    // day's hours there is no now line in the grid to jump to.
    expect(schedule).toMatch(
      /nowMin === null \|\| nowMin < event\.dayStartMin \|\| nowMin > event\.dayEndMin/,
    );
  });

  it('never overrides a position the reader asked for', () => {
    // An explicit ?day= or a link to one session both mean the URL already
    // says where to be.
    expect(schedule).toMatch(/if \(sessionId \|\| filters\.day\) return;/);
  });

  it('happens once, and lands rather than travels', () => {
    expect(schedule).toMatch(/jumped\.current = true;/);
    // The clock ticks every minute and would otherwise drag the reader back to
    // now each time. And a smooth scroll here is a journey to nowhere: this is
    // where the page opens.
    const jump = schedule.slice(schedule.indexOf('const jumped = useRef(false);'));
    const body = jump.slice(0, jump.indexOf('const jumpToNow'));
    expect(body).not.toContain('behavior: "smooth"');
  });
});
