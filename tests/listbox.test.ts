import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stepActive } from '../web/src/lib/listbox';

/**
 * Phase 5 of the form-layer overhaul, the part the Base UI pivot left: the
 * three comboboxes share one listbox behaviour, and each tells a screen reader
 * which row the arrow keys are on.
 *
 * The movement is a pure function, tested as one. The wiring is text: there is
 * no DOM here, so what is pinned is that every combobox goes through the hook
 * and none has grown its own arrow handling back.
 */
describe('stepActive: where the highlight goes at the ends of the list', () => {
  it('wraps through every row when the highlight must sit on one', () => {
    expect(stepActive(0, 1, 3)).toBe(1);
    expect(stepActive(2, 1, 3)).toBe(0);
    expect(stepActive(0, -1, 3)).toBe(2);
  });

  it('wraps through "no row" as well when that is a position', () => {
    // The schedule search: Enter with nothing highlighted means "show me
    // everything", so the highlight has to be able to rest there.
    expect(stepActive(-1, 1, 3, true)).toBe(0);
    expect(stepActive(2, 1, 3, true)).toBe(-1);
    expect(stepActive(0, -1, 3, true)).toBe(-1);
    expect(stepActive(-1, -1, 3, true)).toBe(2);
  });

  it('rests when there is nothing to move through', () => {
    expect(stepActive(4, 1, 0)).toBe(0);
    expect(stepActive(4, 1, 0, true)).toBe(-1);
  });
});

const WEB_SRC = join(__dirname, '..', 'web', 'src');
const read = (...parts: string[]) => readFileSync(join(WEB_SRC, ...parts), 'utf8');

describe('useListbox names the highlighted row to the input', () => {
  const hook = read('components', 'useListbox.ts');

  it('sets aria-activedescendant and aria-controls only while the list exists', () => {
    // A reference to a node that is not rendered is worse than none.
    expect(hook).toContain("'aria-controls': open ? listboxId : undefined");
    expect(hook).toContain("'aria-activedescendant': highlighted ? optionId(active) : undefined");
    expect(hook).toContain('const highlighted = open && active >= 0 && active < count;');
  });

  it('puts the id on whichever element carries role="option"', () => {
    expect(hook).toMatch(/optionProps: \(index: number\) => \(\{\s*id: optionId\(index\),\s*role: 'option'/);
  });

  it('keeps Enter from the form and Escape from the dialog', () => {
    const enter = hook.slice(hook.indexOf("e.key === 'Enter'"), hook.indexOf("e.key === 'Escape'"));
    expect(enter).toContain('e.preventDefault();');
    const escape = hook.slice(hook.indexOf("e.key === 'Escape'"));
    expect(escape).toContain('e.stopPropagation();');
  });
});

describe('every combobox goes through the hook', () => {
  const comboboxes = [
    ['components', 'SpeakerCombobox.tsx'],
    ['components', 'SearchBox.tsx'],
    ['pages', 'AdminSearch.tsx'],
  ] as const;

  it.each(comboboxes)('%s/%s spreads the input, list and row props', (dir, file) => {
    const src = read(dir, file);
    expect(src).toContain('useListbox({');
    expect(src).toContain('{...list.comboboxProps}');
    expect(src).toContain('{...list.listboxProps}');
    expect(src).toContain('{...list.optionProps(');
  });

  it.each(comboboxes)('%s/%s has no arrow handling of its own', (dir, file) => {
    const src = read(dir, file);
    // The arrow keys are the hook's. A file may still *mention* them to reopen
    // a closed list, but it must not move the highlight itself.
    expect(src).not.toContain('setActive');
    expect(src).not.toMatch(/role="(?:combobox|listbox|option)"/);
    expect(src).not.toContain('aria-activedescendant');
  });
});
