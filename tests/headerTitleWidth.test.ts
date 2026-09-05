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
 */
const schedule = readFileSync(
  join(import.meta.dirname, '..', 'web', 'src', 'pages', 'SchedulePage.tsx'),
  'utf8',
);

/** The three rows stacked inside `<header>`, which share a left edge. */
const HEADER_ROWS = [...schedule.matchAll(/mx-auto[^"`]*max-w-6xl[^"`]*/g)].map((m) => m[0]);

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
    expect(schedule).toContain('items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4');
  });

  it('tightens the gap between the bell and the profile chip', () => {
    expect(schedule).toContain('ms-auto flex items-center justify-end gap-1.5 sm:gap-2');
  });

  it('leaves the grid body full-bleed, which was already right', () => {
    // The grid scrolls its own columns and wants the whole width on a phone;
    // it is not one of the rows above and does not move with them.
    expect(schedule).toContain('overflow-y-auto px-0 sm:px-4');
  });
});
