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
const list = readFileSync(join(WEB, 'components', 'ListView.tsx'), 'utf8');

describe('the grid names the day it is showing', () => {
  it('writes it out in the locale’s own order', () => {
    // Not "12th of November": the ordinal-and-"of" form is English-only and
    // would need hand-building per language, for a label nobody reads twice.
    const label = dayFullLabel('2026-11-12');
    expect(label).toMatch(/Thursday/);
    expect(label).toMatch(/November/);
    expect(label).toMatch(/12/);
  });

  it('sits in the band above the first session, costing no height', () => {
    // Not a heading row of its own. The space it needs is already on screen.
    expect(calendar).toContain('dayFullLabel(day)');
    expect(calendar).toMatch(/insetInlineStart: GUTTER_W/);
    expect(calendar).toContain('...dayLabelStyle');
  });

  it('clears the block rather than being centred across it', () => {
    // Centred on an hour line, half of it sat behind whatever started there.
    // Anchored by `bottom`, CSS works out its own height — a constant for the
    // line box goes stale the first time the type scale moves.
    expect(calendar).toContain('const dayLabelStyle = useMemo(');
    expect(calendar).toMatch(
      /bottom: height - Math\.max\(0, \(first - dayStartMin\) \* PX_PER_MIN\) \+ 2/,
    );
    expect(calendar).not.toContain('-translate-y-1/2 whitespace-nowrap');
  });

  it('measures from the first session, not the opening hour', () => {
    // Next day scrolls the grid to the first session, so the top of the day
    // window is usually off screen by the time anybody looks.
    expect(calendar).toMatch(/min === null \|\| p\.startMin < min/);
    // An empty day has nothing to sit above, so it says the day at the top.
    expect(calendar).toMatch(/if \(first === null\) return \{ top: 0 \};/);
  });

  it('is loud enough to read beside the hours', () => {
    // `text-stone-400` at `font-medium` was a whisper next to labels of the
    // same colour, and read as a stray note rather than the name of the day.
    const label = calendar.slice(
      calendar.indexOf('insetInlineStart: GUTTER_W') - 400,
      calendar.indexOf('insetInlineStart: GUTTER_W'),
    );
    expect(label).toContain('font-semibold');
    expect(label).toContain('text-stone-500');
  });

  it('is a sibling of the gutter, not a child of it', () => {
    // The gutter is `z-10` so it can slide over the grid, and inside it the
    // day inherited that and painted over the first column's blocks. Out here
    // it is an ordinary earlier sibling, so blocks drawn after it cover it.
    const gutter = calendar.indexOf('sticky start-0 z-10 shrink-0');
    const gutterEnd = calendar.indexOf('halfHourCount', gutter);
    const label = calendar.indexOf('insetInlineStart: GUTTER_W');
    expect(label).toBeGreaterThan(calendar.indexOf('{fmtMin(nowMin)}', gutter));
    expect(label).toBeLessThan(gutterEnd);
  });

  it('lets a block paint over it rather than the other way round', () => {
    // Where a session starts on the stroke of that hour the programme wins,
    // and it is never a target either way.
    const label = calendar.slice(
      calendar.indexOf('insetInlineStart: GUTTER_W') - 400,
      calendar.indexOf('insetInlineStart: GUTTER_W'),
    );
    expect(label).toContain('pointer-events-none');
    expect(label).toContain('aria-hidden="true"');
  });

  it('says it on the list’s first time row, also for free', () => {
    expect(list).toContain('dayFullLabel(day)');
    expect(list).toContain('{rowIndex === firstGroupIndex && (');
  });

  it('survives a day that opens with lunch', () => {
    // Breaks carry no time heading to hang the day on, so the first *group*
    // is the anchor rather than the first row.
    expect(list).toMatch(/rows\.findIndex\(\(r\) => r\.kind !== 'break'\)/);
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
    expect(search).toContain("fill ? 'min-w-[6rem] flex-1 sm:flex-none' : 'shrink-0'");
  });

  it('keeps a floor small enough for the row it has to fit in', () => {
    // A flex line breaks on each item's *hypothetical* main size, which for
    // `flex: 1 1 0%` is the min-width. At 9rem the line went over 360px — a
    // Galaxy S8 — so Now wrapped before anything was typed, and the field then
    // grew into the space Now had left.
    //
    // 7rem fits that row with real fonts. 6rem is headroom: the rest of the row
    // is about 224px against 336px of usable width, so it is within a few
    // pixels of full, and a system font as wide as DejaVu Sans — the only one
    // in the dev container, where a measurement at 7rem did wrap — can tip it
    // over. At 320px it wraps regardless, which is the safety valve working:
    // Now keeps its label on the second line rather than being clipped.
    const floor = search.match(/min-w-\[(\d+)rem\]/);
    expect(floor).not.toBeNull();
    expect(Number((floor as RegExpMatchArray)[1])).toBeLessThanOrEqual(6);
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
