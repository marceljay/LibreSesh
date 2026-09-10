import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dayFullLabel } from '../web/src/lib/format';

/**
 * Two things the header's row was not saying.
 *
 * **The day.** The day picker folds away the moment you scroll into the day,
 * and after that nothing on screen names the day the grid is showing — a tab
 * left open overnight, or a screenshot of the grid, said nothing at all. The
 * first hour's line has an empty band to the right of it, because `dayStartMin`
 * is the event's opening hour rather than the first session's, so the day goes
 * there.
 *
 * **The Now button.** The search field grows on focus, and on a phone this row
 * has nothing to give it — field, Filter and Now already fill the width, so
 * something wrapped to a second line. The dot alone still says what the button
 * is and where it goes, so the words step aside while the field is in use, and
 * never at all above `sm`.
 */
const WEB = join(__dirname, '..', 'web', 'src');
const schedule = readFileSync(join(WEB, 'pages', 'SchedulePage.tsx'), 'utf8');
const calendar = readFileSync(join(WEB, 'components', 'Calendar.tsx'), 'utf8');

describe('the grid names the day it is showing', () => {
  it('writes it out in the locale’s own order', () => {
    // Not "12th of November": the ordinal-and-"of" form is English-only and
    // would need hand-building per language, for a label nobody reads twice.
    const label = dayFullLabel('2026-11-12');
    expect(label).toMatch(/Thursday/);
    expect(label).toMatch(/November/);
    expect(label).toMatch(/12/);
  });

  it('puts it on the first hour’s line, past the gutter', () => {
    expect(calendar).toContain('dayFullLabel(day)');
    expect(calendar).toMatch(/insetInlineStart: GUTTER_W/);
    expect(calendar).toMatch(/top: 0/);
  });

  it('lets a block paint over it rather than the other way round', () => {
    // Where a session does start on the stroke of the opening hour, the label
    // is the thing that gives way — and it is never a target either way.
    const label = calendar.slice(calendar.indexOf('insetInlineStart: GUTTER_W') - 600);
    expect(label.slice(0, 700)).toContain('pointer-events-none');
    expect(label.slice(0, 700)).toContain('aria-hidden="true"');
  });
});

describe('Now gives way to the search field on a phone', () => {
  it('keeps the dot and drops the words while the field has focus', () => {
    expect(schedule).toMatch(
      /group-has-\[\.search-box_input:focus\]:hidden sm:group-has-\[\.search-box_input:focus\]:inline/,
    );
  });

  it('scopes it to the search box, not to any focused input', () => {
    // The filter panel has a text field of its own and is a descendant of this
    // same row, so a bare `input:focus` would narrow Now when you filter too.
    expect(schedule).toContain('<div data-tour="filters" className="group flex');
    expect(schedule).toContain('className="search-box"');
  });

  it('keeps the time in the accessible name, which has no width to save', () => {
    expect(schedule).toMatch(
      /aria-label=\{`Jump to now, \$\{fmtMin\(nowMinuteOfDay\(timezone\)\)\}`\}/,
    );
  });
});
