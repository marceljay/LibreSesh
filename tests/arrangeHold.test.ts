import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A dropped block flashed back to its old slot for a whole round trip, then
 * jumped forward when the PATCH landed. `Calendar` had the fix since
 * 2026-08-30 — hold the block at the drop position until `onMove` resolves —
 * but `SchedulePage` passed `(…) => void moveSession(…)`, which resolves to
 * `undefined` at once, so the hold released on the next microtask. The looser
 * `void | Promise<void>` type let that compile.
 *
 * No DOM here; what is pinned is that the promise reaches the hold.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const calendar = readFileSync(join(WEB_SRC, 'components', 'Calendar.tsx'), 'utf8');
const schedule = readFileSync(join(WEB_SRC, 'pages', 'SchedulePage.tsx'), 'utf8');

describe('a dropped block waits for the server', () => {
  it('demands a promise from onMove, so a void wrapper cannot compile', () => {
    const prop = calendar.slice(calendar.indexOf('onMove: ('), calendar.indexOf('export function Calendar'));
    expect(prop).toContain(') => Promise<void>;');
    expect(prop).not.toContain('void | Promise');
  });

  it('releases the hold only when that promise settles', () => {
    const settle = calendar.slice(calendar.indexOf('const settle = '), calendar.indexOf('const onUp = '));
    expect(settle).toContain('result: Promise<void>');
    expect(settle).toMatch(/result\.finally\(\(\) => \{[\s\S]*setDrag\(\(d\) => \(d\?\.id === session\.id \? null : d\)\);/);
  });

  it('is handed the real save from the page, not a wrapper that drops it', () => {
    expect(schedule).toContain('onMove={moveSession}');
    expect(schedule).not.toMatch(/onMove=\{[^}]*void moveSession/);
  });
});
