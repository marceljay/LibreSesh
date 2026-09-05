import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { timeChoices } from '../web/src/lib/timeChoices';

/**
 * The time picker is the app's own list, not the browser's clock widget —
 * the last native control that still looked like the browser, replaced for
 * the same reasons as the native `<select>`. The list is a pure function,
 * tested as one; the rest is text, since there is no DOM in this suite.
 */
describe('timeChoices: the day in steps', () => {
  it('walks the window in 5-minute steps, inclusive at both ends', () => {
    const list = timeChoices({ from: 9 * 60, to: 9 * 60 + 15, beyond: null });
    expect(list).toEqual(['09:00', '09:05', '09:10', '09:15']);
  });

  it('adds the rest of the clock in coarse steps around the window', () => {
    const list = timeChoices({ from: 9 * 60, to: 10 * 60, beyond: 60 });
    expect(list[0]).toBe('00:00');
    expect(list).toContain('08:00');
    expect(list).not.toContain('08:05'); // coarse outside
    expect(list).toContain('09:05'); // fine inside
    expect(list).toContain('11:00');
    expect(list.at(-1)).toBe('23:00');
  });

  it('offers nothing outside the window when told so', () => {
    const list = timeChoices({ from: 9 * 60, to: 10 * 60, beyond: null });
    expect(list[0]).toBe('09:00');
    expect(list.at(-1)).toBe('10:00');
  });

  it('keeps an off-grid current value in its place rather than snapping it', () => {
    const list = timeChoices({ from: 9 * 60, to: 10 * 60, beyond: null, current: '09:03' });
    expect(list.indexOf('09:03')).toBe(1);
    // And a current value outside the window is still there to re-save.
    expect(timeChoices({ from: 9 * 60, to: 10 * 60, beyond: null, current: '07:30' })[0]).toBe('07:30');
  });

  it('ignores a current value that is not a time', () => {
    expect(timeChoices({ from: 0, to: 5, beyond: null, current: '' })).toEqual(['00:00', '00:05']);
    expect(timeChoices({ from: 0, to: 5, beyond: null, current: 'noon' })).toEqual(['00:00', '00:05']);
  });

  it('never runs past midnight', () => {
    const list = timeChoices({ from: 23 * 60, to: 25 * 60, beyond: null });
    expect(list.at(-1)).toBe('23:55');
  });
});

const WEB_SRC = join(__dirname, '..', 'web', 'src');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('no time field is the browser\'s', () => {
  it('has no <input type="time"> left in web/src', () => {
    const strays = tsxFiles(WEB_SRC)
      .filter((path) => /<(?:input|TextInput)\b[^>]*type="time"/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(WEB_SRC.length + 1));
    expect(strays).toEqual([]);
  });

  it('builds TimeSelect on the same Select every other dropdown uses', () => {
    const src = readFileSync(join(WEB_SRC, 'components', 'TimeSelect.tsx'), 'utf8');
    expect(src).toContain("from './ui/select'");
    expect(src).toContain('timeChoices({');
    expect(src).not.toContain('<input');
  });
});
