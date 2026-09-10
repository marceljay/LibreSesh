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
const search = readFileSync(join(WEB, 'components', 'SearchBox.tsx'), 'utf8');

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

describe('Now keeps its words at every width', () => {
  it('does not hide them for space', () => {
    // They briefly went on a phone while the search field had focus. Hiding
    // them only helps where it actually prevents the wrap, and on the
    // narrowest screens the row wrapped anyway — a bare dot on a second line
    // is worse than the label on a second line, so the trade never paid.
    expect(schedule).not.toContain('group-has-[.search-box_input:focus]');
    expect(schedule).toMatch(
      /<span className="ms-1">Now \{fmtMin\(nowMinuteOfDay\(timezone\)\)\}<\/span>/,
    );
  });

  it('lets the search field take slack rather than demand space', () => {
    // Elastic, it absorbs whatever the row has left and gives it back when
    // there is none, so nothing else has to move or shrink to make room.
    expect(schedule).toMatch(/<SearchBox\s+fill/);
    expect(search).toContain("fill ? 'min-w-[7rem] flex-1 sm:flex-none' : 'shrink-0'");
  });

  it('keeps a floor small enough for the row it has to fit in', () => {
    // A flex line breaks on each item's *hypothetical* main size, which for
    // `flex: 1 1 0%` is the min-width. At 9rem the line went over 360px — a
    // Galaxy S8 — so Now wrapped before anything was typed, and the field then
    // grew into the space Now had left. The rest of the row is about 207px
    // there; 7rem clears it, 9rem does not.
    const floor = search.match(/min-w-\[(\d+)rem\]/);
    expect(floor).not.toBeNull();
    expect(Number((floor as RegExpMatchArray)[1])).toBeLessThanOrEqual(7);
  });

  it('does not reserve the clear button’s gutter until there is one', () => {
    // The × only renders with a query in the box, so 32px of `pe-8` was dead
    // space in the state the field spends most of its life in — and on a phone
    // that is a third of the text it can show.
    expect(search).toContain("${query ? 'pe-8' : 'pe-3'}");
  });

  it('leaves the desktop widths alone', () => {
    // The row is only tight on a phone. A search field grown across half a
    // desktop is not an improvement.
    expect(search).toContain("'w-full sm:w-44 sm:transition-[width] sm:focus:w-72'");
  });

  it('keeps flex-wrap as the safety valve underneath it', () => {
    // If even the field's floor will not fit, the row wraps. A second line is
    // always better than a control off the edge of the screen.
    expect(schedule).toContain(
      '<div data-tour="filters" className="flex flex-wrap items-center gap-1.5">',
    );
  });

  it('keeps the time in the accessible name, which has no width to save', () => {
    expect(schedule).toMatch(
      /aria-label=\{`Jump to now, \$\{fmtMin\(nowMinuteOfDay\(timezone\)\)\}`\}/,
    );
  });
});
