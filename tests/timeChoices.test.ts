import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { maskTime, parseTime, timeChoices } from '../web/src/lib/timeChoices';

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
    ['9:30', '09:30'],
    ['14:30', '14:30'],
    [' 14:30 ', '14:30'],
    // The box after `maskTime` put the colon in, and before the minutes.
    ['08:', '08:00'],
  ])('reads %s as %s', (typed, hhmm) => {
    expect(parseTime(typed)).toBe(hhmm);
  });

  it('settles onto the five-minute grid the calendar keeps', () => {
    expect(parseTime('9:32')).toBe('09:30');
    expect(parseTime('9:33')).toBe('09:35');
    expect(parseTime('23:59')).toBe('23:55'); // never rounds past midnight
  });

  it('refuses what is not a time', () => {
    // `930` and `2pm` are refused here because the mask never lets them
    // reach this far: `930` has become `09:30` and the `pm` never got in.
    for (const bad of ['', 'noon', '25:00', '9:60', '930', '12:3', '9:30:00', '2pm', '9.30']) {
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
    expect(timeChoices({ from: 0, to: 5, beyond: null, current: 'noon' })).toEqual([
      '00:00',
      '00:05',
    ]);
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

describe("the field is capped to the event's day", () => {
  const field = readFileSync(join(WEB_SRC, 'components', 'TimeField.tsx'), 'utf8');

  it('offers only the window, and lands a typed or nudged time on its edge', () => {
    // Matched by shape rather than by one line: the call is long enough that
    // the formatter breaks it across lines, and what matters is the arguments.
    expect(field).toMatch(
      /timeChoices\(\{\s*from: min,\s*to: max,\s*step: LIST_STEP,\s*beyond: null,\s*current: value,?\s*\}\)/,
    );
    expect(field).toContain('const next = capped(minutesOf(parsed));');
    expect(field).toContain('onChange(capped(minutesOf(base) + delta));');
  });

  it('is capped everywhere except the two fields that define the day', () => {
    const uncapped: string[] = [];
    for (const path of tsxFiles(WEB_SRC)) {
      const src = readFileSync(path, 'utf8');
      for (const el of src.match(/<TimeField\b[\s\S]*?\/>/g) ?? []) {
        const label = /aria-label="([^"]+)"/.exec(el)?.[1] ?? '?';
        if (/Day (?:starts|ends)/.test(label)) {
          expect(el, label).not.toContain('min=');
          continue;
        }
        if (!el.includes('min={dayStartMin}') || !el.includes('max={dayEndMin}')) {
          uncapped.push(`${path.slice(WEB_SRC.length + 1)}: ${label}`);
        }
      }
    }
    expect(uncapped).toEqual([]);
  });
});

/**
 * "After writing 08 it should jump to the minutes" (2026-09-07), and then:
 * "you can enter even letters into the time field, or 8 digits, it never
 * jumps to minutes". A box with no segments has nothing to jump to, so it is
 * masked instead: digits only, four at most, the colon typed for you. Typed
 * one key at a time here, the way the box sees it.
 */
function type(keys: string, from = ''): string {
  let text = from;
  for (const key of keys) text = maskTime(text, text + key);
  return text;
}

describe('maskTime: what the box shows as you type', () => {
  it('types the colon after the hour, so the next digits are the minutes', () => {
    expect(type('0')).toBe('0');
    expect(type('08')).toBe('08:');
    expect(type('083')).toBe('08:3');
    expect(type('0830')).toBe('08:30');
    expect(type('2359')).toBe('23:59');
  });

  it('knows an hour that cannot go on, and pads it', () => {
    expect(type('9')).toBe('09:');
    expect(type('93')).toBe('09:3');
    expect(type('930')).toBe('09:30');
    expect(type('24')).toBe('02:4');
    expect(type('245')).toBe('02:45');
    expect(type('1')).toBe('1'); // 1 or 2 could still be the first of two
    expect(type('2')).toBe('2');
  });

  it('stops at four digits', () => {
    expect(type('12345678')).toBe('12:34');
    expect(type('08300')).toBe('08:30');
  });

  it('lets no letter in, and no second colon', () => {
    expect(type('a')).toBe('');
    expect(type('2pm')).toBe('2');
    expect(type('08:a')).toBe('08:');
    expect(type('08::')).toBe('08:');
    expect(type('x9x3x0x')).toBe('09:30');
  });

  it('takes a paste through the same door', () => {
    expect(maskTime('', '9.30')).toBe('09:30');
    expect(maskTime('', '14h30')).toBe('14:30');
    expect(maskTime('', '9:30')).toBe('09:30');
  });

  it('leaves a deletion alone, colon included', () => {
    expect(maskTime('08:30', '08:3')).toBe('08:3');
    expect(maskTime('08:3', '08:')).toBe('08:');
    expect(maskTime('08:', '08')).toBe('08'); // the colon is not put straight back
    expect(maskTime('08', '0')).toBe('0');
    expect(maskTime('0', '')).toBe('');
    expect(maskTime('08:30', '0830')).toBe('0830'); // the colon itself removed
  });

  it('lets typing carry on after a deletion', () => {
    expect(type('30', '08:')).toBe('08:30');
    expect(type('5', '08')).toBe('08:5');
  });
});
