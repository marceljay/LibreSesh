import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every control in the schedule header is one row of siblings, and they came
 * out three different heights: 30px, 32px and 34px.
 *
 * The padding matched everywhere. The **box model** did not. `px-3 py-2` on a
 * bordered button is 34px and on a filled one is 32px, because the border is
 * two pixels nobody counted; and the search field was shorter again at
 * `py-1.5`. Worse on a phone, where `index.css` floors input text at 16px so
 * Safari does not zoom the page — which makes the field grow by line-height
 * alone, so no amount of padding could ever have matched it to its neighbours.
 *
 * So the height is stated rather than arrived at: **34px**, the height the
 * bordered controls and the segmented boxes already were. Filled buttons get
 * a transparent border to square the box model, and the search field gets an
 * explicit box so its floored font cannot change its size.
 *
 * Pinned as source, because a height that only holds by arithmetic is exactly
 * the thing that drifts back.
 */
const WEB = join(__dirname, '..', 'web', 'src');
const read = (...p: string[]): string => readFileSync(join(WEB, ...p), 'utf8');

const schedule = read('pages', 'SchedulePage.tsx');
const search = read('components', 'SearchBox.tsx');
const filter = read('components', 'FilterMenu.tsx');
const menu = read('components', 'NewSessionMenu.tsx');

describe('the header row is one height', () => {
  it('states it on the filled buttons, with a border to square the box', () => {
    // Now, and the + Session button. Filled, so without this they are the two
    // pixels of border short of everything beside them.
    expect(schedule).toMatch(/h-\[34px\][^"]*border border-transparent bg-highlight/);
    expect(menu).toMatch(/h-\[34px\][^']*border border-transparent bg-stone-900/);
  });

  it('states it on the outlined ones too, rather than leaving it to padding', () => {
    expect(menu).toMatch(/h-\[34px\][^']*border border-stone-300 bg-white/);
    expect(filter).toMatch(/h-\[34px\][^`]*rounded-full border/);
  });

  it('gives the search field a box its floored font cannot change', () => {
    // `index.css` raises input text to 16px on a coarse pointer, so on a phone
    // line-height alone made this taller than the row. A stated height and no
    // vertical padding leaves the 16px text centred inside the same 34px.
    expect(search).toMatch(/h-\[34px\][^`]*py-0/);
    expect(read('index.css')).toContain('font-size: 16px;');
  });

  it('leaves no vertical padding behind to fight the height', () => {
    // py-* and a stated height on the same control is two answers to one
    // question, and the taller wins silently.
    for (const [name, source] of [
      ['the Now button', schedule.slice(schedule.indexOf('data-tour="now"'))],
      ['the filter trigger', filter],
      ['the session menu', menu],
    ] as const) {
      const control = source.slice(0, source.indexOf('h-[34px]') + 400);
      expect(control, name).not.toMatch(/h-\[34px\][^"'`]*\bpy-[0-9]/);
    }
  });
});
