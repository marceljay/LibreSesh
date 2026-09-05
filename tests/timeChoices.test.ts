import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTime, timeChoices } from '../web/src/lib/timeChoices';

/**
 * The time field is the app's own — a box you type into with a list of
 * quarter-hours beside it — not the browser's clock widget, the last native
 * control that still looked like the browser. The two pure halves are tested
 * as functions; the wiring is text, since there is no DOM in this suite.
 */
describe('parseTime: what the box accepts', () => {
  it.each([
    ['9', '09:00'],
    ['09', '09:00'],
    ['930', '09:30'],
    ['1430', '14:30'],
    ['9:30', '09:30'],
    ['9.30', '09:30'],
    ['14h30', '14:30'],
    [' 14:30 ', '14:30'],
    ['2pm', '14:00'],
    ['2:15 PM', '14:15'],
    ['12am', '00:00'],
    ['12pm', '12:00'],
  ])('reads %s as %s', (typed, hhmm) => {
    expect(parseTime(typed)).toBe(hhmm);
  });

  it('settles onto the five-minute grid the calendar keeps', () => {
    expect(parseTime('9:32')).toBe('09:30');
    expect(parseTime('9:33')).toBe('09:35');
    expect(parseTime('23:59')).toBe('23:55'); // never rounds past midnight
  });

  it('refuses what is not a time', () => {
    for (const bad of ['', 'noon', '25:00', '9:60', '2400', '12:3', '9:30:00', '13pm']) {
      expect(parseTime(bad), bad).toBeNull();
    }
  });
});

describe('timeChoices: the list beside the box', () => {
  it('walks the window in steps, inclusive at both ends', () => {
    expect(timeChoices({ from: 9 * 60, to: 9 * 60 + 15, beyond: null })).toEqual([
      '09:00',
      '09:05',
      '09:10',
      '09:15',
    ]);
  });

  it('covers the whole day in quarter hours when asked', () => {
    const list = timeChoices({ from: 0, to: 24 * 60, step: 15, beyond: null });
    expect(list).toHaveLength(96);
    expect(list[0]).toBe('00:00');
    expect(list.at(-1)).toBe('23:45');
  });

  it('keeps an off-grid current value in its place rather than snapping it', () => {
    const list = timeChoices({ from: 0, to: 60, step: 15, beyond: null, current: '00:35' });
    expect(list).toEqual(['00:00', '00:15', '00:30', '00:35', '00:45', '01:00']);
  });

  it('ignores a current value that is not a time', () => {
    expect(timeChoices({ from: 0, to: 5, beyond: null, current: 'noon' })).toEqual(['00:00', '00:05']);
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

describe("no time field is the browser's", () => {
  it('has no native time input left in web/src', () => {
    const strays = tsxFiles(WEB_SRC)
      .filter((path) => /<(?:input|TextInput)\b[^>]*type="time"/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(WEB_SRC.length + 1));
    expect(strays).toEqual([]);
  });

  it('is a box in the field shell with the same list every other dropdown uses', () => {
    const src = readFileSync(join(WEB_SRC, 'components', 'TimeField.tsx'), 'utf8');
    expect(src).toContain('<ControlShell');
    expect(src).toContain('<TextInput');
    expect(src).toContain("from './ui/select'");
    expect(src).toContain('const LIST_STEP = 15;');
    // Typing commits on blur and Enter, never per keystroke — see the comment.
    expect(src).toContain('onBlur={commit}');
    expect(src).not.toMatch(/onChange=\{\(e\) => \{?\s*commit/);
    // Enter settles the time; it must not also save the dialog around it.
    expect(src).toMatch(/e\.key === 'Enter'[\s\S]{0,60}e\.preventDefault\(\);\s*commit\(\);/);
  });
});
