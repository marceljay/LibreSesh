import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_PEOPLE_COLUMNS,
  BY_NAME,
  COMPACT_PEOPLE_COLUMNS,
  PEOPLE_OPTIONAL_COLUMNS,
  defaultPeopleColumns,
  parsePeopleColumns,
  sortForColumns,
  togglePeopleColumn,
  type PeopleSortColumn,
} from '../web/src/lib/people.js';

/**
 * The People table showed six columns at every width, two of which — the UID
 * and the last seen time — answer questions an organiser asks a handful of
 * times an event. They were `hidden sm:block`, which is that admission made
 * silently: on a phone the table simply had different columns, and there was
 * no way to disagree with it in either direction.
 *
 * Now the same two are off by default and in a menu. What is pinned here is
 * the model behind that menu, and the wiring in the page it drives.
 */
describe('which People columns are showing', () => {
  it('starts with everything on a desktop, as it always did', () => {
    expect(defaultPeopleColumns(true)).toEqual(['name', 'username', 'uid', 'role', 'seen']);
    expect(ALL_PEOPLE_COLUMNS).toEqual(defaultPeopleColumns(true));
  });

  it('starts on a phone with the row and what it is for, and nothing else', () => {
    expect(defaultPeopleColumns(false)).toEqual(['name', 'username', 'role']);
    expect(COMPACT_PEOPLE_COLUMNS).toEqual(defaultPeopleColumns(false));
  });

  it('offers every column but the name, which is the row itself', () => {
    expect(PEOPLE_OPTIONAL_COLUMNS.map((c) => c.id)).toEqual(['username', 'uid', 'role', 'seen']);
    expect(PEOPLE_OPTIONAL_COLUMNS.map((c) => c.id)).not.toContain('name');
    // Each says what the column is for; a bare word is not a reason to want it.
    for (const column of PEOPLE_OPTIONAL_COLUMNS) expect(column.hint.length, column.id).toBeGreaterThan(10);
  });

  describe('reading back what was stored', () => {
    it('takes the screen\'s default when nothing was stored', () => {
      expect(parsePeopleColumns(null, ALL_PEOPLE_COLUMNS)).toEqual(ALL_PEOPLE_COLUMNS);
      expect(parsePeopleColumns(null, COMPACT_PEOPLE_COLUMNS)).toEqual(COMPACT_PEOPLE_COLUMNS);
    });

    it('takes it rather than an empty table when the value is junk', () => {
      for (const raw of ['', 'not json', '"name"', '{"name":true}', '17']) {
        expect(parsePeopleColumns(raw, COMPACT_PEOPLE_COLUMNS), raw).toEqual(
          COMPACT_PEOPLE_COLUMNS,
        );
      }
    });

    /** A stored choice is the organiser's, and outranks the screen at every
     *  width — including the choice to have almost nothing. */
    it('keeps the name however the stored value was written', () => {
      expect(parsePeopleColumns('[]', ALL_PEOPLE_COLUMNS)).toEqual(['name']);
      expect(parsePeopleColumns('["seen"]', ALL_PEOPLE_COLUMNS)).toEqual(['name', 'seen']);
    });

    it('drops columns that no longer exist, and puts the rest back in order', () => {
      expect(parsePeopleColumns('["seen","email","name","username"]', ALL_PEOPLE_COLUMNS)).toEqual([
        'name',
        'username',
        'seen',
      ]);
    });
  });

  describe('turning one on and off', () => {
    it('returns a column to where it was, not to the end', () => {
      const off = togglePeopleColumn(COMPACT_PEOPLE_COLUMNS, 'username');
      expect(off).toEqual(['name', 'role']);
      expect(togglePeopleColumn(off, 'username')).toEqual(COMPACT_PEOPLE_COLUMNS);
      expect(togglePeopleColumn(['name', 'seen'], 'uid')).toEqual(['name', 'uid', 'seen']);
    });

    it('will not take the name away, however hard it is asked', () => {
      expect(togglePeopleColumn(COMPACT_PEOPLE_COLUMNS, 'name')).toEqual(COMPACT_PEOPLE_COLUMNS);
      expect(togglePeopleColumn(['name'], 'name')).toEqual(['name']);
    });
  });

  /**
   * Hiding the column a list is sorted by would leave the rows in an order
   * with nothing on screen to explain it — and no control to undo it, because
   * the control went with the column.
   */
  describe('the order in force', () => {
    const bySeen = { column: 'seen', dir: 'desc' } as const;

    it('is what was asked for while that column is on screen', () => {
      expect(sortForColumns(bySeen, ['name', 'seen'])).toBe(bySeen);
    });

    it('comes home to the name when its column leaves', () => {
      expect(sortForColumns(bySeen, COMPACT_PEOPLE_COLUMNS)).toEqual(BY_NAME);
    });
  });
});

describe('the People table that uses it', () => {
  const WEB = join(import.meta.dirname, '..', 'web', 'src');
  const read = (...parts: string[]) => readFileSync(join(WEB, ...parts), 'utf8');
  const admin = read('pages', 'AdminPage.tsx');
  const icons = read('components', 'icons.tsx');

  it('starts a wide screen with everything, and a narrow one without the two rare ones', () => {
    const hook = read('lib', 'usePeopleColumns.ts');
    expect(hook).toContain("'(min-width: 640px)'");
    expect(hook).toContain('defaultPeopleColumns(isWide())');
  });

  it('draws every optional cell only when its column is on', () => {
    for (const column of ['username', 'uid', 'role', 'seen'] as PeopleSortColumn[]) {
      expect(admin, column).toContain(`peopleColumns.showing('${column}')`);
    }
    // The old rule, which said the same thing without being asked.
    expect(admin).not.toContain("uid: 'hidden w-16 shrink-0 sm:block'");
    expect(admin).not.toContain("seen: 'hidden w-14 shrink-0 sm:block'");
  });

  it('orders by what is on screen, not by what was last clicked', () => {
    expect(admin).toContain('const peopleOrder = sortForColumns(peopleSort, peopleColumns.shown)');
    expect(admin).toContain('sort={peopleOrder}');
  });

  it('opens the profile from the name and the username, not a button beside them', () => {
    // One component holds the link and the way back, so all three agree.
    expect(admin).toContain('function PersonLink');
    expect(admin).toMatch(/state=\{\{ back: \{ to: `\/e\/\$\{slug\}\/admin\?tab=people`/);
    // The 56-pixel "Open" that used to sit four columns from the name.
    expect(admin).not.toMatch(/className=\{`\$\{peopleActionClass\} text-center`\}/);
    expect(admin).not.toMatch(/>\s*Open\s*<\/Link>/);
  });

  it('puts Edit profile in the row menu, and draws the menu as an icon', () => {
    expect(admin).toContain('>Edit profile<');
    expect(admin).toMatch(/<PersonLink[^>]*role="menuitem"/);
    expect(admin).toContain('<MoreIcon');
    // The glyph it replaced, which needed a button five times the width.
    expect(admin).not.toContain('⋯');
    expect(icons).toContain('export function MoreIcon');
    expect(icons).toContain('export function ColumnsIcon');
  });

  it('gives the actions column its heading back, and the width to hold it', () => {
    expect(admin).toContain("actions: { className: 'w-9 shrink-0', min: 36 }");
    // Named like every column beside it, at every width — an unlabelled cell
    // at the end of a row is a column an organiser has to guess at. Not a
    // button, though: there is no fact in it to order by.
    expect(admin).toContain('text-end`}>Edit</span>');
    expect(admin).not.toContain('<span className="sr-only">Actions</span>');
  });

  /**
   * The two things a person is looked up by, and neither is the other's
   * margin. A username squeezed to `@margarethami…` is not a lookup, and it
   * was in a fixed `w-24` while the name took every pixel that was going.
   */
  it('splits what is left equally between the name and the username', () => {
    expect(admin).toContain("name: { className: 'min-w-0 flex-1', min: 140 }");
    expect(admin).toContain("username: { className: 'min-w-0 flex-1', min: 140 }");
  });

  /**
   * The grid already makes this bargain on a phone. A table that fits 375
   * pixels by giving every column sixty of them is not a table anybody can
   * read; one that scrolls keeps each column at a width that can be, and the
   * header scrolls with the rows so nothing is ever read under the wrong
   * heading.
   */
  it('scrolls sideways rather than squeeze, and only when it has to', () => {
    expect(admin).toContain('<div className="overflow-x-auto">');
    expect(admin).toContain('minWidth: peopleTableWidth(peopleColumns.shown)');
    // Computed from the columns actually on, so a desktop — where the sum is
    // under `max-w-3xl` — never scrolls and hands the slack to the two.
    expect(admin).toMatch(/const peopleTableWidth = \(shown: PeopleSortColumn\[\]\): number/);
  });
});
