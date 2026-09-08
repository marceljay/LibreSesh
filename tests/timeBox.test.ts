import { describe, expect, it } from 'vitest';
import { editTime, segmentSpan, type Span } from '../web/src/lib/timeBox';

/**
 * The time box, typed into one key at a time the way a browser would apply
 * each key — insert at the selection, put the caret after it — and then read
 * back through `editTime`, which is what the field does with every
 * keystroke. `before` is the selection the browser saw before the key; the
 * cases that pass `null` are what the field falls back to when no keydown or
 * `beforeinput` recorded one.
 *
 * "if i enter all valid numbers from left to right, e.g. 0725, it would
 * sometimes turn into 07:23" (2026-09-07) — the old mask saw the fifth digit
 * go into a full box and kept the first four, so a `0` typed into `12:30`
 * became `10:23` and the rest fell off. A box that knows which segment the
 * caret is in has no such case.
 */
class Box {
  text: string;
  start: number;
  end: number;
  /** Whether the field saw the selection before each key. */
  seen: boolean;

  constructor(text = '', seen = true) {
    this.text = text;
    this.start = this.end = text.length;
    this.seen = seen;
  }

  press(key: string): this {
    const { text, start, end } = this;
    let typed: string;
    let caret: number;
    if (key === 'Backspace' || key === 'Delete') {
      if (start !== end) {
        typed = text.slice(0, start) + text.slice(end);
        caret = start;
      } else if (key === 'Backspace') {
        if (start === 0) return this;
        typed = text.slice(0, start - 1) + text.slice(start);
        caret = start - 1;
      } else {
        if (start === text.length) return this;
        typed = text.slice(0, start) + text.slice(start + 1);
        caret = start;
      }
    } else {
      typed = text.slice(0, start) + key + text.slice(end);
      caret = start + key.length;
    }
    return this.apply(editTime(text, this.seen ? { start, end } : null, typed, caret));
  }

  type(keys: string): this {
    for (const key of keys) this.press(key);
    return this;
  }

  /** A paste replaces the selection in one edit. */
  paste(clip: string): this {
    return this.press(clip);
  }

  click(pos: number): this {
    return this.select(segmentSpan(this.text, pos));
  }

  select({ start, end }: Span): this {
    this.start = start;
    this.end = end;
    return this;
  }

  all(): this {
    return this.select({ start: 0, end: this.text.length });
  }

  caret(pos: number): this {
    return this.select({ start: pos, end: pos });
  }

  private apply(next: { text: string; start: number; end: number }): this {
    this.text = next.text;
    this.start = next.start;
    this.end = next.end;
    return this;
  }

  /** `text|` for a caret, `te[xt]` for a selection. */
  get shown(): string {
    const { text, start, end } = this;
    if (start === end) return `${text.slice(0, start)}|${text.slice(start)}`;
    return `${text.slice(0, start)}[${text.slice(start, end)}]${text.slice(end)}`;
  }
}

const typed = (keys: string, from = ''): string => new Box(from).type(keys).shown;

describe('editTime: typing into an empty box', () => {
  it('reads left to right, and types the colon after the hour', () => {
    expect(typed('0')).toBe('0|');
    expect(typed('07')).toBe('07:|');
    expect(typed('072')).toBe('07:2|');
    expect(typed('0725')).toBe('07:25|');
    expect(typed('2359')).toBe('23:59|');
  });

  it('knows an hour that cannot go on, and pads it', () => {
    expect(typed('9')).toBe('09:|');
    expect(typed('93')).toBe('09:3|');
    expect(typed('930')).toBe('09:30|');
    expect(typed('24')).toBe('02:4|');
    expect(typed('245')).toBe('02:45|');
    expect(typed('1')).toBe('1|'); // 1 or 2 could still be the first of two
    expect(typed('2')).toBe('2|');
  });

  it('knows a minute that cannot go on, and pads it', () => {
    expect(typed('087')).toBe('08:07|');
    expect(typed('0875')).toBe('08:5|'); // the 5 starts the minutes over
  });

  it('closes a half-typed hour on a colon or a dot, so 1:30 is 01:30', () => {
    expect(typed('1:30')).toBe('01:30|');
    expect(typed('1.30')).toBe('01:30|');
    expect(typed('9:30')).toBe('09:30|'); // the colon after a full hour is nothing
    expect(typed('11:10')).toBe('11:10|');
  });

  it('lets no letter in, and no second colon', () => {
    expect(typed('a')).toBe('|');
    expect(typed('2pm')).toBe('2|');
    expect(typed('08:a')).toBe('08:|');
    expect(typed('08::')).toBe('08:|');
    expect(typed('x9x3x0x')).toBe('09:30|');
  });

  it('starts the minutes over when typed past the end of a full box', () => {
    // "if you type 11:10 and then just 4 zeros, it will have a remaining 0"
    expect(typed('11100000')).toBe('11:00|');
    expect(typed('111045')).toBe('11:45|');
    expect(typed('12345678')).toBe('12:08|');
  });
});

describe('editTime: typing into a time that is already there', () => {
  it('replaces the hour when the hour was clicked', () => {
    const box = new Box('12:30').click(1);
    expect(box.shown).toBe('[12]:30');
    expect(box.type('0').shown).toBe('0|:30');
    expect(box.type('7').shown).toBe('07:[30]'); // the hour is done: minutes are next
    expect(box.type('2').shown).toBe('07:2|');
    expect(box.type('5').shown).toBe('07:25|');
  });

  it('replaces the minutes when the minutes were clicked', () => {
    expect(new Box('11:10').click(4).type('45').shown).toBe('11:45|');
    expect(new Box('11:10').click(5).type('4').shown).toBe('11:4|');
    expect(new Box('11:10').click(3).type('7').shown).toBe('11:07|');
  });

  it('keeps the minutes when only the hour is retyped', () => {
    expect(new Box('11:10').click(0).type('09').shown).toBe('09:[10]');
    expect(new Box('11:10').click(0).type('9').shown).toBe('09:[10]');
  });

  it('replaces everything when everything was selected', () => {
    expect(new Box('11:10').all().type('0000').shown).toBe('00:00|');
    expect(new Box('11:10').all().type('7').shown).toBe('07:|');
    expect(new Box('11:10').all().type('0725').shown).toBe('07:25|');
  });

  it('starts the minutes over from a caret at the end', () => {
    expect(new Box('11:10').caret(5).type('45').shown).toBe('11:45|');
    expect(new Box('11:10').caret(5).type('0000').shown).toBe('11:00|');
  });

  it('overtypes a digit under a bare caret', () => {
    expect(new Box('11:10').caret(0).type('2').shown).toBe('21:[10]'); // a full hour moves on
    expect(new Box('11:10').caret(1).type('4').shown).toBe('14:[10]');
    expect(new Box('11:10').caret(3).type('3').shown).toBe('11:30|'); // and so does a full minute
    expect(new Box('11:10').caret(4).type('5').shown).toBe('11:15|');
  });

  it('starts a segment over when overtyping would make nonsense of it', () => {
    expect(new Box('18:30').caret(0).type('2').shown).toBe('2|:30'); // 28 is no hour
    expect(new Box('21:30').caret(1).type('9').shown).toBe('09:[30]'); // 29 is no hour
    expect(new Box('11:30').caret(3).type('7').shown).toBe('11:07|'); // 70 is no minute
  });

  it('takes a paste as a whole time', () => {
    expect(new Box().paste('9.30').shown).toBe('09:30|');
    expect(new Box().paste('14h30').shown).toBe('14:30|');
    expect(new Box().paste('9:30').shown).toBe('09:30|');
    expect(new Box('11:10').all().paste('0725').shown).toBe('07:25|');
    expect(new Box('11:10').click(4).paste('45').shown).toBe('11:45|');
  });
});

describe('editTime: deleting', () => {
  it('backspaces digit by digit, and over the colon takes the hour digit before it', () => {
    const box = new Box('08:30');
    expect(box.press('Backspace').shown).toBe('08:3|');
    expect(box.press('Backspace').shown).toBe('08:|');
    expect(box.press('Backspace').shown).toBe('0|');
    expect(box.press('Backspace').shown).toBe('|');
    expect(box.press('Backspace').shown).toBe('|');
  });

  it('deletes forward, and over the colon takes the minute digit after it', () => {
    expect(new Box('08:30').caret(2).press('Delete').shown).toBe('08:|0');
    expect(new Box('08:30').caret(3).press('Delete').shown).toBe('08:|0');
    expect(new Box('08:30').caret(0).press('Delete').shown).toBe('|8:30');
  });

  it('removes a selection, colon and all, and the colon comes back on its own', () => {
    expect(new Box('08:30').select({ start: 1, end: 4 }).press('Backspace').shown).toBe('0|:0');
    expect(new Box('08:30').all().press('Backspace').shown).toBe('|');
    expect(new Box('08:30').click(0).press('Backspace').shown).toBe('|:30');
    expect(new Box('08:30').click(4).press('Backspace').shown).toBe('08:|');
  });

  it('lets typing carry on after a deletion', () => {
    expect(new Box('08:30').click(0).press('Backspace').type('14').shown).toBe('14:[30]');
    expect(new Box('08:').press('Backspace').type('9').shown).toBe('09:|');
    expect(new Box('08:30').select({ start: 1, end: 4 }).press('Backspace').type('9').shown).toBe(
      '09:[0]',
    );
  });
});

describe('editTime: when the selection before the key was not seen', () => {
  const blind = (text: string) => new Box(text, false);

  it('still reads a digit typed at the end', () => {
    expect(blind('').type('0725').shown).toBe('07:25|');
    expect(blind('07:2').type('5').shown).toBe('07:25|');
  });

  it('still reads a digit typed over a selection, even the same digit', () => {
    expect(blind('11:10').click(0).type('1').shown).toBe('1|:10');
    expect(blind('11:10').click(0).type('09').shown).toBe('09:[10]');
    expect(blind('08:30').click(4).type('3').shown).toBe('08:3|');
  });

  it('takes a deletion over the colon as a backspace', () => {
    expect(blind('08:').press('Backspace').shown).toBe('0|');
    expect(blind('08:30').caret(3).press('Backspace').shown).toBe('0|:30');
  });
});

describe('segmentSpan: what a click selects', () => {
  it('selects the hour or the minutes under the click', () => {
    for (const pos of [0, 1, 2]) expect(segmentSpan('11:10', pos)).toEqual({ start: 0, end: 2 });
    for (const pos of [3, 4, 5]) expect(segmentSpan('11:10', pos)).toEqual({ start: 3, end: 5 });
    expect(segmentSpan('1', 1)).toEqual({ start: 0, end: 1 });
    expect(segmentSpan('08:3', 4)).toEqual({ start: 3, end: 4 });
  });

  it('leaves the caret alone where there is nothing to select', () => {
    expect(segmentSpan('', 0)).toEqual({ start: 0, end: 0 });
    expect(segmentSpan('08:', 3)).toEqual({ start: 3, end: 3 });
    expect(segmentSpan(':30', 0)).toEqual({ start: 0, end: 0 });
  });
});
