import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nowLineIndex } from '../web/src/lib/nowLine.js';

/**
 * The grid has a yellow line at the current minute; the list had a "next /
 * now" pill on one row's time and no line at all, so a reader switching views
 * on the day of the event lost the one thing that said where they were
 * (reported 2026-09-07). The list has no minute axis, so its line crosses
 * every card that is running, at the minute, and, when none is, sits in a gap
 * between rows — this pins the gap, and the card's line (2026-09-08 review:
 * one row wearing the line while parallel sessions did not was confusing, and
 * a line snapped to the card's text was a border below where the minute was).
 */
const rows = [
  { start: 9 * 60, end: 10 * 60 },
  { start: 10 * 60, end: 11 * 60 },
  { start: 14 * 60, end: 15 * 60 },
];

describe('where the now line sits in a list', () => {
  it('is nowhere on any day but today', () => {
    expect(nowLineIndex(rows, null)).toBe(-1);
  });

  it('sits before the first row that has not started', () => {
    expect(nowLineIndex(rows, 8 * 60)).toBe(0);
    expect(nowLineIndex(rows, 9 * 60 + 30)).toBe(1);
    expect(nowLineIndex(rows, 12 * 60)).toBe(2);
  });

  it('keeps a row that is running above the line, not below it', () => {
    // 10:00 has started: its cards say "now"; the line follows them.
    expect(nowLineIndex(rows, 10 * 60)).toBe(2);
  });

  it('goes after everything once the last row has started', () => {
    expect(nowLineIndex(rows, 15 * 60)).toBe(rows.length);
    expect(nowLineIndex([], 12 * 60)).toBe(0);
  });
});

describe('the list draws the line the grid draws', () => {
  const list = readFileSync(
    join(__dirname, '..', 'web', 'src', 'components', 'ListView.tsx'),
    'utf8',
  );

  it('is the same yellow rule, named for the time but not wearing it, where Now scrolls to', () => {
    expect(list).toContain('nowLineIndex(rows, nowMin)');
    expect(list).toMatch(
      /id="now-anchor"[\s\S]{0,120}aria-label=\{nowLabel\}[\s\S]{0,80}bg-highlight/,
    );
    // No chip in the list: the header's Now button says the time, and a chip
    // beside the cards cost the row a gutter (reviewed 2026-09-08).
    expect(list).not.toMatch(/bg-highlight[^\n]*\n?[^\n]*\{fmtMin\(nowMin\)\}/);
    expect(list).not.toContain('ps-12');
  });

  it('crosses every running card at the minute, and the gap only when none is running', () => {
    expect(list).toContain('const nowAt = firstLiveId === null ? nowLineIndex(rows, nowMin) : -1;');
    expect(list).toMatch(
      /\{live && \([\s\S]{0,40}<NowLine[\s\S]{0,120}progress=\{\(nowMin - startMin\) \/ \(endMin - startMin\)\}/,
    );
    // Where the minute is, held inside the card: a session in its last
    // minutes has its line on the card's bottom edge, not below the border.
    expect(list).toContain('top: `clamp(0px, calc(${pct} - 1px), calc(100% - 2px))`');
    expect(list).not.toMatch(/ResizeObserver|getBoundingClientRect|data-now-/);
    // Behind the card's text and paler than the grid's: the card isolates its
    // stacking, the line sits under everything but the background.
    expect(list).toContain("live ? 'relative isolate overflow-hidden ring-2");
    expect(list).toMatch(/absolute inset-x-0 -z-10 h-0\.5 bg-highlight\/50/);
    // One line is the Now button's target: the first running card's.
    expect(list).toContain("id={anchor ? 'now-anchor' : undefined}");
    expect(list).toContain('anchor={session.id === firstLiveId}');
  });

  it('no longer says "next / now" on a row instead', () => {
    expect(list).not.toMatch(/next \/ now\s*<\/span>/);
  });
});

describe('the grid keeps its time in the gutter', () => {
  const grid = readFileSync(
    join(__dirname, '..', 'web', 'src', 'components', 'Calendar.tsx'),
    'utf8',
  );

  it('draws the chip in the sticky time column, and the line from its edge', () => {
    // The chip used to sit at `left: GUTTER_W` — over the first column's
    // block — and scrolled away with it. It is in the gutter now, and the
    // line starts where the gutter ends rather than under the chip.
    const gutter = grid.slice(
      grid.indexOf('className="sticky start-0 z-10 shrink-0'),
      grid.indexOf('{Array.from({ length: halfHourCount }'),
    );
    expect(gutter).toMatch(/showNow && \([\s\S]{0,400}\{fmtMin\(nowMin\)\}/);
    expect(grid).toMatch(
      /absolute end-0 z-10 h-0\.5 bg-highlight mix-blend-multiply dark:mix-blend-screen"[\s\S]{0,120}left: GUTTER_W/,
    );
    expect(grid).not.toMatch(/-top-2\.5[\s\S]{0,200}left: GUTTER_W/);
  });
});
