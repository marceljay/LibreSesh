import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nowLineIndex } from '../web/src/lib/nowLine.js';

/**
 * The grid has a yellow line at the current minute; the list had a "next /
 * now" pill on one row's time and no line at all, so a reader switching views
 * on the day of the event lost the one thing that said where they were
 * (reported 2026-09-07). The list has no minute axis, so its line sits
 * between rows — this pins where.
 */
const rows = [{ start: 9 * 60 }, { start: 10 * 60 }, { start: 14 * 60 }];

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

  it('is the same yellow rule, carrying the time, and is where Now scrolls to', () => {
    expect(list).toContain('nowLineIndex(rows, nowMin)');
    expect(list).toMatch(
      /id="now-anchor"[\s\S]{0,200}bg-highlight[\s\S]{0,200}\{fmtMin\(nowMin\)\}/,
    );
    expect(list).toContain('<div className="h-0.5 flex-1 bg-highlight" />');
  });

  it('no longer says "next / now" on a row instead', () => {
    expect(list).not.toMatch(/next \/ now\s*<\/span>/);
  });
});
