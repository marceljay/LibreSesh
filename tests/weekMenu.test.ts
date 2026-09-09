import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A long event navigates in two rows: a rail of week chips, and that week's
 * days below it. On a phone those two rows are most of what stands between
 * the event bar and the first session, and of the two the rail is the one
 * that can be said in a single chip — you are in week 2, there are 3, here
 * are the others.
 *
 * So below `sm` the rail is gone and `WeekMenu` stands at the head of the day
 * strip. A desktop keeps the rail, where a line is worth the whole shape of
 * the event at a glance.
 *
 * The strip itself finally gets the arrows the rail has had since it was
 * written. It is a hidden-scrollbar scroller, so a day past its edge was a
 * day you never found — and once the weeks fold into a button, this row is
 * the only day navigation left, so it carries the whole burden.
 *
 * Layout and composition, so there is no DOM here. LIB-189.
 */
const WEB = join(__dirname, '..', 'web', 'src');
const schedule = readFileSync(join(WEB, 'pages', 'SchedulePage.tsx'), 'utf8');
const rail = readFileSync(join(WEB, 'components', 'Rail.tsx'), 'utf8');
const menu = readFileSync(join(WEB, 'components', 'WeekMenu.tsx'), 'utf8');

/** The day strip's box, from its tour marker to the view toggle after it. */
const strip = ((): string => {
  const from = schedule.indexOf('data-tour="days"');
  const to = schedule.indexOf('data-tour="view"');
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return schedule.slice(from, to);
})();

describe('the week rail folds into a button on a phone', () => {
  it('keeps the rail for a desktop and hides it below sm', () => {
    expect(schedule).toContain('<div className="mx-auto hidden max-w-6xl pb-2 sm:block">');
  });

  it('puts the menu at the head of the day strip, below sm only', () => {
    expect(strip).toContain('<WeekMenu');
    expect(strip).toContain('className="sm:hidden"');
    // Above `sm` the rail is still on screen; two ways to pick the same week
    // is one too many.
    const menuAt = strip.indexOf('<WeekMenu');
    const firstDay = strip.indexOf('stripDays.map');
    expect(menuAt).toBeLessThan(firstDay);
  });

  it('shows it only when there are weeks to pick between', () => {
    // Same guard as the rail: under `weekRailFrom` there are no weeks.
    expect(strip).toMatch(/\{weeks\.length > 1 && \(\s*<WeekMenu/);
  });

  it('carries what the chips carried', () => {
    // The range, the count and the dot on the week holding today. The point of
    // the rail was never the chips — it was knowing where you are without
    // leaving the day you are reading.
    expect(menu).toContain('dayRangeLabel(first, last)');
    expect(menu).toContain('countFor(week)');
    expect(menu).toMatch(/holdsToday && !week\.includes\(day\)/);
    // "Wk2" has no width for the rest, so the accessible name says all of it.
    expect(menu).toMatch(/aria-label=\{`Week \$\{weekIndex \+ 1\} of \$\{weeks\.length\}/);
    // Wk, not W: a lone W beside a number reads as an initial or a column
    // header, on a row that otherwise holds Mon/Tue/Wed.
    expect(menu).toMatch(/^\s*Wk\{weekIndex \+ 1\}$/m);
  });

  it('lands on today when the week holds it, like the chips did', () => {
    expect(menu).toContain('onPick(holdsToday ? today : first)');
  });
});

describe('the day strip says when the line goes on', () => {
  it('wraps the strip in a Rail', () => {
    expect(strip).toContain('<Rail label="Days"');
  });

  it('puts the border outside the arrows, not under them', () => {
    // `Rail` positions its arrows against its own edges. With the border on
    // the Rail they would sit on it and spill past its radius; with the box
    // outside, they fade to the card's inner edge.
    const box = strip.slice(0, strip.indexOf('<Rail'));
    expect(box).toContain('rounded-lg border');
    expect(box).toContain('p-0.5');
    // The scroller moved into the Rail, so the box must not still be one.
    expect(box).not.toContain('overflow-x-auto');
  });

  it('fades to the card it sits on, not to the page behind it', () => {
    // `stone-50` on a white box leaves a seam exactly where the gradient ends.
    expect(strip).toContain('fade={RAIL_FADE_CARD}');
    expect(rail).toContain("RAIL_FADE_CARD = 'from-white via-white/90");
    expect(rail).toContain("RAIL_FADE_PAGE =\n  'from-stone-50 via-stone-50/90");
    // The hardcoded page ground is gone from the arrow itself.
    expect(rail).toMatch(/\} \$\{fade\} to-transparent/);
  });

  it('lets the box shrink instead of wrapping the view toggle', () => {
    // Without `min-w-0` a flex item refuses to go below its content width, and
    // the toggle drops to a second line — the line this whole change saves.
    const box = strip.slice(0, strip.indexOf('<Rail'));
    expect(box).toContain('min-w-0');
  });
});
