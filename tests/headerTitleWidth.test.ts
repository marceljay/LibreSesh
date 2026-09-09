import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * On a phone the event name is the only thing in the header that truncates,
 * so every pixel spent on padding and gaps is a pixel taken off the title.
 * Below `sm` the row gives back 18px — the page padding, the two gaps beside
 * the name, and the gap between the bell and the profile chip — which is
 * around three characters at `text-sm`.
 *
 * There is no DOM here, so what is pinned is the responsive shape: tightened
 * below `sm`, unchanged from `sm` up, and the same left edge on all three
 * header rows.
 *
 * The bar itself is `EventBar` now — one row on every page of an event — so
 * its classes are read from there, and the schedule's own two rows from the
 * schedule.
 */
const WEB_SRC = join(import.meta.dirname, '..', 'web', 'src');
const schedule = readFileSync(join(WEB_SRC, 'pages', 'SchedulePage.tsx'), 'utf8');
const bar = readFileSync(join(WEB_SRC, 'components', 'EventBar.tsx'), 'utf8');

/** The three rows stacked inside `<header>`, which share a left edge: the
 *  bar, at its default width, and the schedule's filter and action rows. */
const HEADER_ROWS = [
  ...[...bar.matchAll(/mx-auto[^"`]*\$\{width\}[^"`]*/g)].map((m) => m[0]),
  ...[...schedule.matchAll(/mx-auto[^"`]*max-w-6xl[^"`]*/g)].map((m) => m[0]),
];

describe('the header gives its width to the event name on a phone', () => {
  it('tightens the page padding below sm, and only below sm', () => {
    const rows = HEADER_ROWS.filter((r) => r.includes('px-3'));
    // The bar, the filter row and the action row.
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toContain('sm:px-4');
  });

  it('keeps all three rows on one left edge', () => {
    // A header row 4px out of step with the one under it reads as a wonky
    // logo, which costs more than the characters it buys back.
    const padded = HEADER_ROWS.filter((r) => /\bpx-\d/.test(r) && !r.includes('px-0'));
    for (const row of padded) expect(row).toMatch(/px-3\b/);
  });

  it('tightens the gaps around the name, and restores them from sm up', () => {
    expect(bar).toContain('items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4');
  });

  it('tightens the gap between the bell and the profile chip', () => {
    expect(bar).toContain('ms-auto flex items-center justify-end gap-1.5 sm:gap-2');
  });

  it('sizes the bar to the page under it', () => {
    // The schedule is the widest page; every other one hands the bar its own
    // narrower measure so the logo lines up with the content's left edge.
    expect(bar).toContain("width = 'max-w-6xl'");
    expect(schedule).not.toMatch(/<EventBar[\s\S]*?width=/);
  });

  it('leaves the grid body full-bleed, which was already right', () => {
    // The grid scrolls its own columns and wants the whole width on a phone;
    // it is not one of the rows above and does not move with them.
    expect(schedule).toContain('overflow-y-auto px-0 sm:px-4');
  });
});
