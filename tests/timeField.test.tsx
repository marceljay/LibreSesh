// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeField } from '../web/src/components/TimeField';
import { installBrowserShims } from './dom';

/**
 * The time box in a real DOM, typed into the way a browser types: the key
 * goes down, the browser edits the value at the selection and moves the
 * caret, the input event fires, and React does whatever it does with a
 * controlled input. What is asserted is what the box shows afterwards and
 * where its caret is — the two things `timeBox.test.ts` cannot see, because
 * they depend on React putting the value back and the field putting the
 * caret where the model said.
 */

const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

function press(input: HTMLInputElement, key: string): boolean {
  const { selectionStart, selectionEnd, value: text } = input;
  const start = selectionStart ?? text.length;
  const end = selectionEnd ?? start;
  // fireEvent returns false when a handler called preventDefault — the
  // browser would then make no edit, and neither does this.
  const proceed = fireEvent.keyDown(input, { key });
  if (!proceed) return false;
  let typed: string;
  let caret: number;
  if (key === 'Backspace') {
    if (start === end && start === 0) return true;
    typed =
      start === end
        ? text.slice(0, start - 1) + text.slice(start)
        : text.slice(0, start) + text.slice(end);
    caret = start === end ? start - 1 : start;
  } else if (key.length === 1 || !/^[A-Z]/.test(key)) {
    // A character, or a paste: anything that is not a named key.
    typed = text.slice(0, start) + key + text.slice(end);
    caret = start + key.length;
  } else {
    return true;
  }
  input.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: key === 'Backspace' ? 'deleteContentBackward' : 'insertText',
      data: key === 'Backspace' ? null : key,
    }),
  );
  setValue.call(input, typed);
  input.setSelectionRange(caret, caret);
  fireEvent.input(input);
  return true;
}

const type = (input: HTMLInputElement, keys: string) => {
  for (const key of keys) press(input, key);
};

/** A click: the browser puts the caret where the click landed, then mouseup. */
const click = (input: HTMLInputElement, pos: number) => {
  input.focus();
  input.setSelectionRange(pos, pos);
  fireEvent.mouseUp(input);
};

const shown = (input: HTMLInputElement) =>
  `${input.value.slice(0, input.selectionStart!)}${
    input.selectionStart === input.selectionEnd ? '|' : '['
  }${input.value.slice(input.selectionStart!, input.selectionEnd!)}${
    input.selectionStart === input.selectionEnd ? '' : ']'
  }${input.value.slice(input.selectionEnd!)}`;

function Host({
  initial,
  onChange,
  min,
  max,
}: {
  initial: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TimeField
      aria-label="Start"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      min={min}
      max={max}
    />
  );
}

function mount(initial = '', range: { min?: number; max?: number } = {}) {
  const onChange = vi.fn<(v: string) => void>();
  const utils = render(<Host initial={initial} onChange={onChange} {...range} />);
  const input = utils.getByLabelText('Start') as HTMLInputElement;
  return { input, onChange };
}

let errors: unknown[][];

beforeEach(() => {
  installBrowserShims();
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  expect(errors).toEqual([]);
});

describe('TimeField: typing', () => {
  it('reads 0725 as 07:25, left to right, and commits it on blur', () => {
    const { input, onChange } = mount();
    input.focus();
    type(input, '0');
    expect(shown(input)).toBe('0|');
    type(input, '7');
    expect(shown(input)).toBe('07:|');
    type(input, '25');
    expect(shown(input)).toBe('07:25|');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(input.value).toBe('07:25');
    expect(onChange).toHaveBeenCalledWith('07:25');
  });

  it('replaces the hour of a time that is there when the hour is clicked', () => {
    const { input, onChange } = mount('12:30');
    click(input, 1);
    expect(shown(input)).toBe('[12]:30');
    type(input, '0725');
    expect(shown(input)).toBe('07:25|');
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith('07:25');
  });

  it('replaces the minutes when the minutes are clicked', () => {
    const { input } = mount('11:10');
    click(input, 4);
    expect(shown(input)).toBe('11:[10]');
    type(input, '45');
    expect(shown(input)).toBe('11:45|');
  });

  it('starts the minutes over at the end of a full box, and leaves no digit behind', () => {
    const { input } = mount('11:10');
    input.focus();
    input.setSelectionRange(5, 5);
    type(input, '0000');
    expect(shown(input)).toBe('11:00|');
    input.setSelectionRange(0, 5);
    type(input, '0000');
    expect(shown(input)).toBe('00:00|');
  });

  it('puts a refused letter back out, caret where it was', () => {
    const { input } = mount();
    input.focus();
    type(input, '08a');
    expect(shown(input)).toBe('08:|');
  });

  it('moves the caret even when the text did not change', () => {
    const { input } = mount('11:10');
    input.focus();
    input.setSelectionRange(1, 1);
    type(input, '1'); // overtypes the 1 that was there: the hour is done
    expect(shown(input)).toBe('11:[10]');
  });

  it('takes a paste as a whole time', () => {
    const { input } = mount();
    input.focus();
    press(input, '9.30');
    expect(shown(input)).toBe('09:30|');
  });

  it('backspaces over the colon into the hour', () => {
    const { input } = mount();
    input.focus();
    type(input, '08');
    press(input, 'Backspace');
    expect(shown(input)).toBe('0|');
    type(input, '9');
    expect(shown(input)).toBe('09:|');
  });
});

describe('TimeField: settling', () => {
  it('lands a typed time on the five-minute grid and inside the day', () => {
    const { input, onChange } = mount('10:00', { min: 9 * 60, max: 17 * 60 });
    click(input, 0);
    type(input, '0723');
    fireEvent.blur(input);
    expect(input.value).toBe('09:00');
    expect(onChange).toHaveBeenCalledWith('09:00');
    click(input, 3);
    type(input, '23');
    fireEvent.blur(input);
    expect(input.value).toBe('09:25');
  });

  it('puts back the last good value when what is in the box is not a time', () => {
    const { input, onChange } = mount('11:10');
    click(input, 0);
    press(input, 'Backspace'); // the hour is gone from under the minutes
    expect(shown(input)).toBe('|:10');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.blur(input);
    expect(input.value).toBe('11:10');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('settles on Enter and lets the key go on to the form', () => {
    const { input, onChange } = mount();
    input.focus();
    type(input, '0725');
    const passed = fireEvent.keyDown(input, { key: 'Enter' });
    expect(passed).toBe(true); // not preventDefault-ed: the form around it submits
    expect(onChange).toHaveBeenCalledWith('07:25');
    expect(input.value).toBe('07:25');
  });
});

describe('TimeField: arrow keys', () => {
  it('step the hour when the caret is in the hour, and keep it selected', () => {
    const { input, onChange } = mount('10:30');
    click(input, 0);
    press(input, 'ArrowUp');
    expect(shown(input)).toBe('[11]:30');
    expect(onChange).toHaveBeenLastCalledWith('11:30');
    press(input, 'ArrowDown');
    press(input, 'ArrowDown');
    expect(shown(input)).toBe('[09]:30');
  });

  it('step five minutes when the caret is in the minutes', () => {
    const { input, onChange } = mount('10:30');
    click(input, 4);
    press(input, 'ArrowDown');
    expect(shown(input)).toBe('10:[25]');
    expect(onChange).toHaveBeenLastCalledWith('10:25');
    press(input, 'ArrowUp');
    press(input, 'ArrowUp');
    expect(shown(input)).toBe('10:[35]');
  });

  it('stop at the edges of the day', () => {
    const { input } = mount('09:05', { min: 9 * 60, max: 17 * 60 });
    click(input, 0);
    press(input, 'ArrowDown');
    expect(input.value).toBe('09:00');
    press(input, 'ArrowDown');
    expect(input.value).toBe('09:00');
  });
});
