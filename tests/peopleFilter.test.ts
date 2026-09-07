import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PersonDto } from '../server/src/shared/types.js';
import {
  BY_NAME,
  NATURAL_DIR,
  PEOPLE_FILTERS,
  filterCounts,
  filterPeople,
  matchesFilter,
  matchesSearch,
  personStatus,
  sortPeople,
  type PeopleSortColumn,
} from '../web/src/lib/people.js';

/**
 * The People list is one list now, holding both the people who have arrived
 * and the shells an organiser is expecting. These are the decisions that tell
 * them apart, kept out of the component so they can be checked without a DOM.
 */
const person = (over: Partial<PersonDto> & { id: number; name: string }): PersonDto => ({
  bio: '',
  links: [],
  isMine: false,
  claimed: false,
  archivedAt: null,
  username: null,
  creditable: true,
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...over,
});

const organiser = person({
  id: 1,
  name: 'Ada Lovelace',
  claimed: true,
  username: 'ada',
  role: 'admin',
  holderUid: 'a1b2c',
  lastSeenAt: '2026-09-02T12:00:00.000Z',
  sessionCount: 3,
});
const speaker = person({
  id: 2,
  name: 'Grace Hopper',
  claimed: true,
  username: 'grace',
  role: 'speaker',
  holderUid: 'f9e8d',
  lastSeenAt: '2026-09-02T09:00:00.000Z',
});
const attendee = person({
  id: 3,
  name: 'Sam Chen',
  claimed: true,
  username: 'sam',
  role: 'user',
  holderUid: '11111',
  lastSeenAt: '2026-09-02T11:00:00.000Z',
});
const departed = person({
  id: 4,
  name: 'Jo Park',
  claimed: true,
  username: 'jo',
  role: null,
  holderUid: '22222',
  lastSeenAt: '2026-09-01T08:00:00.000Z',
});
const shell = person({ id: 5, name: 'Alan Turing' });
const everyone = [organiser, speaker, attendee, departed, shell];

describe('the People list', () => {
  describe('segments', () => {
    it('splits arrived from unclaimed, and that split covers everyone', () => {
      expect(everyone.filter((p) => matchesFilter(p, 'arrived')).map((p) => p.id)).toEqual([
        1, 2, 3, 4,
      ]);
      expect(everyone.filter((p) => matchesFilter(p, 'unclaimed')).map((p) => p.id)).toEqual([5]);
    });

    it('treats organisers and speakers as lenses, not a third state', () => {
      // Both have arrived, so both are under "arrived" too — the counts say so
      // rather than the segments pretending to partition.
      expect(matchesFilter(organiser, 'arrived')).toBe(true);
      expect(matchesFilter(organiser, 'organisers')).toBe(true);
      expect(matchesFilter(speaker, 'speakers')).toBe(true);
      expect(matchesFilter(attendee, 'organisers')).toBe(false);
      expect(matchesFilter(shell, 'speakers')).toBe(false);
    });

    it('counts every segment in one pass', () => {
      expect(filterCounts(everyone)).toEqual({
        all: 5,
        arrived: 4,
        unclaimed: 1,
        organisers: 1,
        speakers: 1,
        archived: 0,
      });
    });

    /**
     * Archived is the one segment that is not a lens over the others. A
     * segment that still showed the profiles an organiser has put away would
     * put the clutter straight back, which is the whole thing archiving is
     * for — so every other segment drops them, and the count under Archived
     * is how an organiser sees what they have down there.
     */
    it('keeps archived profiles out of every other segment, and counts them under their own', () => {
      const filed = { ...speaker, archivedAt: '2026-09-02T13:00:00.000Z' };
      const list = [organiser, filed, attendee, departed, shell];

      expect(matchesFilter(filed, 'archived')).toBe(true);
      for (const segment of ['all', 'arrived', 'speakers', 'organisers', 'unclaimed'] as const) {
        expect(matchesFilter(filed, segment), segment).toBe(false);
      }
      expect(matchesFilter(speaker, 'archived')).toBe(false);

      expect(filterCounts(list)).toEqual({
        all: 4,
        arrived: 3,
        unclaimed: 1,
        organisers: 1,
        speakers: 0,
        archived: 1,
      });
      expect(filterPeople(list, 'archived', '', BY_NAME).map((p) => p.id)).toEqual([filed.id]);
    });

    it('offers every segment it can count', () => {
      expect(PEOPLE_FILTERS.map((f) => f.id).sort()).toEqual(
        Object.keys(filterCounts(everyone)).sort(),
      );
    });
  });

  describe('search', () => {
    it('matches the full name, the username or the UID, case-insensitively', () => {
      expect(matchesSearch(organiser, 'lovel')).toBe(true);
      expect(matchesSearch(organiser, 'ADA')).toBe(true);
      expect(matchesSearch(organiser, 'A1B2C')).toBe(true);
      expect(matchesSearch(organiser, 'grace')).toBe(false);
    });

    it('matches everyone when it is empty or only spaces', () => {
      for (const p of everyone) expect(matchesSearch(p, '   ')).toBe(true);
    });

    it('does not exclude a shell for having no username or UID', () => {
      expect(matchesSearch(shell, 'turing')).toBe(true);
      expect(matchesSearch(shell, 'a1b2c')).toBe(false);
    });
  });

  /**
   * Every column of the table orders by itself, both ways. One button used to
   * offer two of the five orders, so "who has no username yet" and "who is
   * still only a viewer" could only be answered by reading the whole list.
   */
  describe('order', () => {
    const ids = (column: PeopleSortColumn, dir: 'asc' | 'desc') =>
      sortPeople(everyone, { column, dir }).map((p) => p.id);

    it('sorts by full name by default', () => {
      expect(sortPeople(everyone).map((p) => p.name)).toEqual([
        'Ada Lovelace',
        'Alan Turing',
        'Grace Hopper',
        'Jo Park',
        'Sam Chen',
      ]);
    });

    it('sorts by who was here most recently, leaving the never-seen last', () => {
      expect(ids('seen', 'desc')).toEqual([1, 3, 2, 4, 5]);
    });

    it('reverses every column, and keeps the empty rows at the bottom of both', () => {
      // The shell (5) has no username, no UID and no last-seen. It stays last
      // whichever way the arrow points: a column of em dashes at the top is
      // noise either way, and reversing to escape it would be odd to learn.
      expect(ids('username', 'asc')).toEqual([1, 2, 4, 3, 5]);
      expect(ids('username', 'desc')).toEqual([3, 4, 2, 1, 5]);
      expect(ids('uid', 'asc')).toEqual([3, 4, 1, 2, 5]);
      expect(ids('uid', 'desc')).toEqual([2, 1, 4, 3, 5]);
      expect(ids('seen', 'asc')).toEqual([4, 2, 3, 1, 5]);
    });

    /**
     * By what they hold, not by the word: "admin, speaker, user, viewer" is
     * alphabetical backwards by coincidence, and an event that renames `user`
     * to "participant" breaks the coincidence while the ladder holds.
     */
    it('sorts roles as a ladder, with the two non-roles at the bottom', () => {
      expect(ids('role', 'desc')).toEqual([1, 2, 3, 4, 5]);
      expect(ids('role', 'asc')).toEqual([5, 4, 3, 2, 1]);
    });

    it('breaks every tie by name, so an unrelated change cannot shuffle rows', () => {
      const zoe = person({
        id: 6,
        name: 'Zoe Adams',
        claimed: true,
        username: 'zoe',
        role: 'admin',
      });
      const abe = person({
        id: 7,
        name: 'Abe Bell',
        claimed: true,
        username: 'abe',
        role: 'admin',
      });
      const sorted = sortPeople([zoe, organiser, abe], { column: 'role', dir: 'desc' });
      expect(sorted.map((p) => p.name)).toEqual(['Abe Bell', 'Ada Lovelace', 'Zoe Adams']);
    });

    it('does not reorder the list it was given', () => {
      const before = everyone.map((p) => p.id);
      sortPeople(everyone, { column: 'seen', dir: 'desc' });
      expect(everyone.map((p) => p.id)).toEqual(before);
    });

    /** A date read oldest-first is nobody's question, and a role column is
     *  opened to find the organisers. Both reverse on the second click. */
    it('opens each column the way that column is usually asked', () => {
      expect(NATURAL_DIR).toEqual({
        name: 'asc',
        username: 'asc',
        uid: 'asc',
        role: 'desc',
        seen: 'desc',
      });
    });
  });

  /** You are the row you most often want and the one you can identify
   *  without reading it, so hunting for yourself alphabetically in a room of
   *  two hundred is friction with nothing to show for it. */
  it('puts you first, whatever the order or segment', () => {
    const me = { ...attendee, isMine: true };
    const withMe = [organiser, speaker, me, departed, shell];
    expect(filterPeople(withMe, 'all', '', BY_NAME)[0]?.id).toBe(me.id);
    expect(filterPeople(withMe, 'all', '', { column: 'seen', dir: 'desc' })[0]?.id).toBe(me.id);
    expect(filterPeople(withMe, 'arrived', '', BY_NAME)[0]?.id).toBe(me.id);
    // And keeps the rest in the order they asked for.
    expect(filterPeople(withMe, 'all', '', BY_NAME).map((p) => p.name)).toEqual([
      'Sam Chen',
      'Ada Lovelace',
      'Alan Turing',
      'Grace Hopper',
      'Jo Park',
    ]);
  });

  it('leaves you out when the segment does not hold you', () => {
    const me = { ...attendee, isMine: true };
    expect(filterPeople([organiser, me, shell], 'unclaimed', '', BY_NAME).map((p) => p.id)).toEqual(
      [shell.id],
    );
  });

  it('applies the segment, the search and the order together', () => {
    expect(filterPeople(everyone, 'arrived', 'a', BY_NAME).map((p) => p.name)).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
      'Jo Park',
      'Sam Chen',
    ]);
    expect(filterPeople(everyone, 'unclaimed', 'ada', BY_NAME)).toEqual([]);
  });

  /**
   * There is no DOM in this suite, so the ordering above is checked as a
   * function and the wiring is checked as text: the header is the control,
   * and it is not hidden from a screen reader any more now that it is one.
   */
  describe('the header that drives it', () => {
    const admin = readFileSync(
      join(import.meta.dirname, '..', 'web', 'src', 'pages', 'AdminPage.tsx'),
      'utf8',
    );

    it('offers every column, and no longer a single two-way toggle', () => {
      for (const column of ['name', 'username', 'uid', 'role', 'seen']) {
        expect(admin, column).toContain(`['${column}', '`);
      }
      expect(admin).not.toContain("s === 'name' ? 'seen' : 'name'");
      expect(admin).not.toContain("'By last seen'");
    });

    it('stopped hiding the header once the header became the control', () => {
      expect(admin).not.toMatch(
        /aria-hidden="true"\s*\n\s*className="flex items-center gap-2 border-b/,
      );
      expect(admin).toContain('function PeopleHeader');
    });
  });

  describe('the badge a row wears', () => {
    it('names the three states an organiser acts on differently', () => {
      expect(personStatus(shell)).toEqual({ kind: 'unclaimed' });
      expect(personStatus(departed)).toEqual({ kind: 'signed-out' });
      expect(personStatus(speaker)).toEqual({ kind: 'role', role: 'speaker' });
    });
  });
});

/**
 * Archiving is the tidy-up now, and Delete is not offered at all.
 *
 * Delete refused outright for anybody holding their own profile — which is
 * most of a live event — and where it did go through it stripped the name off
 * every session that person was credited on, with no way back. Archiving is
 * the same tidy-up with none of that: the row leaves the list (`All`
 * included, checked above), the sessions keep their speaker, the holder keeps
 * their role and their way in, and either of them can undo it.
 */
describe('putting a profile away', () => {
  const admin = readFileSync(
    join(import.meta.dirname, '..', 'web', 'src', 'pages', 'AdminPage.tsx'),
    'utf8',
  );

  it('archives, and no longer offers to delete', () => {
    expect(admin).toContain('void toggleArchive(person)');
    expect(admin).toContain('api.archivePerson(slug, person.id)');
    expect(admin).toContain('api.unarchivePerson(slug, person.id)');

    // The row's menu, on its own: rooms, tracks and tags are still deletable,
    // and they are things rather than people.
    const menu = admin.slice(
      admin.indexOf('function PersonActions'),
      admin.indexOf('function PeopleColumnsMenu'),
    );
    expect(menu).not.toBe('');
    expect(menu).not.toContain('onDelete');
    expect(menu).not.toContain('>Delete<');

    // Its handler, and the call underneath it.
    expect(admin).not.toContain('removePerson');
    expect(admin).not.toContain('api.deletePerson');
  });

  it('leaves nothing in the client that can delete a profile', () => {
    const api = readFileSync(
      join(import.meta.dirname, '..', 'web', 'src', 'lib', 'api.ts'),
      'utf8',
    );
    expect(api).not.toContain('deletePerson:');
  });

  it('says where the row went, since it leaves every segment but one', () => {
    expect(admin).toContain('find them under Archived');
    expect(admin).toContain('including “All”');
  });
});
