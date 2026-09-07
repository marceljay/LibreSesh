import type { PersonDto, Role } from '@shared/types';

/**
 * The People list, as decisions that can be made without a DOM.
 *
 * Everyone who enters an event is a person in it, so one list now holds both
 * halves of what used to be two: the people who have arrived, and the shells
 * an organiser typed in for people they are expecting. These predicates are
 * what tells them apart, and the merge dialog reuses them for its search.
 */

export type PeopleFilter = 'all' | 'arrived' | 'unclaimed' | 'organisers' | 'speakers' | 'archived';

/**
 * The segments are lenses, not a partition: an organiser has also arrived, so
 * they are counted under both. The one real split is arrived vs unclaimed.
 *
 * "Arrived" rather than "attendees" on purpose — `user` is a role whose label
 * an organiser can change, and this segment is not that role, it is everyone
 * whose profile somebody holds.
 *
 * **Archived is the exception, and the only one.** Every other segment leaves
 * archived profiles out, because a segment showing them would put the clutter
 * straight back — tidying a profile away has to mean it is away. So Archived
 * is not a lens over the list, it is the other list, and it sits last with
 * its count so an organiser can always see how much they have put down there.
 */
export const PEOPLE_FILTERS: { id: PeopleFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'arrived', label: 'Arrived' },
  { id: 'unclaimed', label: 'Unclaimed' },
  { id: 'organisers', label: 'Organisers' },
  { id: 'speakers', label: 'Speakers' },
  { id: 'archived', label: 'Archived' },
];

export const isArchived = (person: PersonDto): boolean => person.archivedAt !== null;

export function matchesFilter(person: PersonDto, filter: PeopleFilter): boolean {
  if (filter === 'archived') return isArchived(person);
  if (isArchived(person)) return false;
  switch (filter) {
    case 'all':
      return true;
    case 'arrived':
      return person.claimed;
    case 'unclaimed':
      return !person.claimed;
    case 'organisers':
      return person.role === 'admin';
    case 'speakers':
      return person.role === 'speaker';
  }
}

/** Free text against the three things that identify somebody: their full
 *  name, their username, and the UID the audit log calls them. */
export function matchesSearch(person: PersonDto, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return [person.name, person.username ?? '', person.holderUid ?? ''].some((field) =>
    field.toLowerCase().includes(q),
  );
}

/** Every column of the People table that answers a question about order.
 *  Actions is not one of them: it holds three buttons, not a fact. */
export type PeopleSortColumn = 'name' | 'username' | 'uid' | 'role' | 'seen';

export interface PeopleSort {
  column: PeopleSortColumn;
  dir: 'asc' | 'desc';
}

/**
 * Which way round a column goes when it is first clicked.
 *
 * Not all ascending. A date column opened oldest-first is nobody's question —
 * "who is actually still here" is, and that is the newest end. The role ladder
 * is the same: an organiser sorting by role is looking for the organisers.
 * Clicking again reverses whichever way it started, so both ends stay one
 * click away.
 */
export const NATURAL_DIR: Record<PeopleSortColumn, PeopleSort['dir']> = {
  name: 'asc',
  username: 'asc',
  uid: 'asc',
  role: 'desc',
  seen: 'desc',
};

/** The default: alphabetical, which is how you find a name you already know. */
export const BY_NAME: PeopleSort = { column: 'name', dir: 'asc' };

/* ---------------------------------------------------------------- columns */

/**
 * Which columns the table is showing.
 *
 * Every column but the name is optional, and most of them start off. The
 * table had six of them at every width, which on a phone meant a name
 * squeezed into whatever three columns of fixed width left over — and two of
 * those columns, the UID and the last seen time, answer questions an
 * organiser asks perhaps twice an event. They are still there, one click
 * away, rather than taxing every row on every screen for the times they are
 * wanted.
 *
 * The name is not in this list because it is not a column an organiser can be
 * allowed to turn off: it is the row.
 */
export const PEOPLE_OPTIONAL_COLUMNS: { id: PeopleSortColumn; label: string; hint: string }[] = [
  { id: 'username', label: 'Username', hint: 'What they post under here.' },
  { id: 'uid', label: 'UID', hint: 'The identity holding the profile — what the audit log names.' },
  { id: 'role', label: 'Role', hint: 'What they may do, and the place to change it.' },
  { id: 'seen', label: 'Last seen', hint: 'When their device last used this event.' },
];

/** Canonical left-to-right order, so toggling a column back on returns it to
 *  where it was rather than to the end. */
const COLUMN_ORDER: PeopleSortColumn[] = ['name', 'username', 'uid', 'role', 'seen'];

/** Everything the table knows how to show. What a desktop starts with: there
 *  is room for all five, and the two rare ones cost nothing there. */
export const ALL_PEOPLE_COLUMNS: PeopleSortColumn[] = [...COLUMN_ORDER];

/** Name, username, role, and the actions every row ends with — what a phone
 *  starts with. The two that come off are the two that are lookups rather
 *  than comparisons: a UID and a last-seen time answer a question about one
 *  person, and neither is worth a fifth of a narrow row to have standing by. */
export const COMPACT_PEOPLE_COLUMNS: PeopleSortColumn[] = ['name', 'username', 'role'];

/**
 * What the table shows before anybody says otherwise.
 *
 * The width is the whole argument: five columns on a desktop are five facts
 * side by side, and on a phone they are five things none of which can be
 * read. This is the same call the old `hidden sm:block` made, made once and
 * in a place the organiser can overrule — and overruling it sticks, at both
 * sizes.
 */
export const defaultPeopleColumns = (wide: boolean): PeopleSortColumn[] =>
  wide ? ALL_PEOPLE_COLUMNS : COMPACT_PEOPLE_COLUMNS;

const isColumn = (value: unknown): value is PeopleSortColumn =>
  typeof value === 'string' && (COLUMN_ORDER as string[]).includes(value);

/** What was stored last time, defended against a hand-edited or outdated
 *  value: anything unreadable falls back to `fallback` rather than leaving
 *  the table with no columns at all. */
export function parsePeopleColumns(
  raw: string | null,
  fallback: PeopleSortColumn[],
): PeopleSortColumn[] {
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!Array.isArray(parsed)) return fallback;
  const kept = parsed.filter(isColumn);
  return COLUMN_ORDER.filter((c) => c === 'name' || kept.includes(c));
}

/** Turning one on or off, in canonical order and with the name column pinned
 *  on however hard it is asked to go. */
export function togglePeopleColumn(
  shown: PeopleSortColumn[],
  column: PeopleSortColumn,
): PeopleSortColumn[] {
  if (column === 'name') return shown;
  const next = shown.includes(column) ? shown.filter((c) => c !== column) : [...shown, column];
  return COLUMN_ORDER.filter((c) => c === 'name' || next.includes(c));
}

/**
 * The order in force, given what is on screen.
 *
 * Hiding the column a list is sorted by leaves it in an order with nothing
 * on screen to explain it — rows in an arrangement the organiser can neither
 * see nor undo, because the control that undoes it went with the column. So
 * the sort comes home to the name when its column leaves.
 */
export function sortForColumns(sort: PeopleSort, shown: PeopleSortColumn[]): PeopleSort {
  return shown.includes(sort.column) ? sort : BY_NAME;
}

/**
 * How much of the event somebody holds, weakest first. A ladder rather than
 * the alphabet, because "admin, speaker, user, viewer" happens to be
 * alphabetical backwards and that is a coincidence, not the meaning — and an
 * event that renames `user` to "participant" would break the coincidence
 * while the ladder stays true.
 *
 * The two non-roles sit below the four: an unclaimed shell holds nothing at
 * all, and somebody signed out holds a profile but no permission.
 */
const ROLE_RANK: Record<Role, number> = { viewer: 2, user: 3, speaker: 4, admin: 5 };

const roleRank = (person: PersonDto): number => {
  const status = personStatus(person);
  if (status.kind === 'unclaimed') return 0;
  if (status.kind === 'signed-out') return 1;
  return ROLE_RANK[status.role];
};

/**
 * What a column compares, and what counts as having nothing to compare.
 *
 * `null` is not a value that sorts low — it is the absence of one, and it is
 * pinned to the bottom in both directions below. A column of em dashes at the
 * top is noise whichever way the arrow points, and reversing the order to
 * escape it would be an odd thing to have to learn.
 */
const KEY: Record<PeopleSortColumn, (person: PersonDto) => string | number | null> = {
  name: (p) => p.name,
  username: (p) => p.username,
  uid: (p) => p.holderUid ?? null,
  role: (p) => roleRank(p),
  seen: (p) => p.lastSeenAt ?? null,
};

const compare = (a: string | number, b: string | number): number =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));

/**
 * One column, one direction, with the rows that have nothing in that column
 * last either way and full name breaking every tie.
 *
 * The tie-break matters more than it looks: without it the order of two people
 * with the same role is whatever the bundle happened to send, so a role change
 * anywhere in the event could shuffle rows that did not change.
 */
export function sortPeople(people: PersonDto[], sort: PeopleSort = BY_NAME): PersonDto[] {
  const key = KEY[sort.column];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...people].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1;
    } else {
      const by = compare(left, right);
      if (by !== 0) return sign * by;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * The People list: what the segment and the search box leave, in order, with
 * **you first**.
 *
 * You are the one row an organiser can always identify without reading it,
 * and the one they most often want — checking their own role, opening their
 * own profile, or working out which of two similar names is the device they
 * are sitting at. Hunting for yourself alphabetically in a room of two
 * hundred is the kind of small friction that makes a list feel hostile.
 */
export function filterPeople(
  people: PersonDto[],
  filter: PeopleFilter,
  query: string,
  sort: PeopleSort = BY_NAME,
): PersonDto[] {
  const shown = sortPeople(
    people.filter((p) => matchesFilter(p, filter) && matchesSearch(p, query)),
    sort,
  );
  return [...shown.filter((p) => p.isMine), ...shown.filter((p) => !p.isMine)];
}

/** How many each segment would show, for the counts on the control. Ignores
 *  the search box: a count that moved as you typed would make the segments
 *  look like they were losing people. */
export function filterCounts(people: PersonDto[]): Record<PeopleFilter, number> {
  const counts = { all: 0, arrived: 0, unclaimed: 0, organisers: 0, speakers: 0, archived: 0 };
  for (const person of people) {
    for (const { id } of PEOPLE_FILTERS) {
      if (matchesFilter(person, id)) counts[id] += 1;
    }
  }
  return counts;
}

/**
 * The one badge a row wears. `signed out` is the state that has no name
 * anywhere else: somebody holds this profile, but they left the event (or an
 * organiser took their role away), so they are neither an unclaimed shell nor
 * a person with a role.
 */
export type PersonStatus =
  { kind: 'role'; role: Role } | { kind: 'signed-out' } | { kind: 'unclaimed' };

export function personStatus(person: PersonDto): PersonStatus {
  if (!person.claimed) return { kind: 'unclaimed' };
  if (person.role == null) return { kind: 'signed-out' };
  return { kind: 'role', role: person.role };
}

/* ------------------------------------------------------------------ merge */

/**
 * Merging is the one thing an organiser cannot undo, and the wrong pick moves
 * somebody's sessions — and possibly their whole history in the event — onto a
 * stranger. So the dialog does not just list names alphabetically and hope:
 * it puts the rows that look like the same human first, and says why it thinks
 * so, leaving the judgement where it belongs.
 */
export interface MergeSuggestion {
  person: PersonDto;
  score: number;
  /** Shown on the row. The organiser is agreeing with a reason, not a rank. */
  why: string;
}

/** Lowercased, punctuation dropped, runs of space collapsed: `"A. Lovelace"`
 *  and `"a  lovelace"` become the same string, which is the whole point. */
const norm = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[.,'’`_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const namesOf = (person: PersonDto): string[] =>
  [norm(person.name), person.username === null ? '' : norm(person.username)].filter(
    (n) => n !== '',
  );

/** "a" against "ada": one is the other's opening letter, which is what an
 *  initial is. Equal strings are not an initial match, they are the same word. */
const isInitialOf = (a: string, b: string): boolean =>
  a !== b && ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b)));

function scorePair(a: string, b: string): MergeSuggestion['why'] | null {
  if (a === b) return 'same name';

  const at = a.split(' ');
  const bt = b.split(' ');
  const surname = at[at.length - 1] ?? '';
  const otherSurname = bt[bt.length - 1] ?? '';
  const sameSurname = surname !== '' && surname === otherSurname;

  if (sameSurname && at.length === bt.length && at.length > 1) {
    const rest = at.slice(0, -1).every((token, i) => {
      const other = bt[i] ?? '';
      return token === other || isInitialOf(token, other);
    });
    if (rest) return 'initials match';
  }
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) {
    return 'one name contains the other';
  }
  if (sameSurname && at.length > 1 && bt.length > 1) return 'same surname';
  return null;
}

const WEIGHT: Record<string, number> = {
  'same name': 100,
  'initials match': 80,
  'one name contains the other': 60,
  'same surname': 40,
};

/**
 * The candidates that look like `survivor`, best first. Compares full names
 * and usernames on both sides, so "Ada Lovelace" finds "@ada" too.
 */
export function suggestDuplicates(
  survivor: PersonDto,
  candidates: PersonDto[],
  limit = 3,
): MergeSuggestion[] {
  const mine = namesOf(survivor);
  const scored: MergeSuggestion[] = [];
  for (const person of candidates) {
    if (person.id === survivor.id) continue;
    let best: { why: string; score: number } | null = null;
    for (const a of mine) {
      for (const b of namesOf(person)) {
        const why = scorePair(a, b);
        if (why === null) continue;
        const score = WEIGHT[why] ?? 0;
        if (best === null || score > best.score) best = { why, score };
      }
    }
    if (best !== null) scored.push({ person, score: best.score, why: best.why });
  }
  return scored
    .sort((x, y) => y.score - x.score || x.person.name.localeCompare(y.person.name))
    .slice(0, limit);
}

export type MergeConsequenceKind = 'sessions-only' | 'claim-moves' | 'work-moves';

export interface MergeConsequence {
  kind: MergeConsequenceKind;
  text: string;
}

/** `@ada (UID: A1B2C)`, or the full name when nobody holds the profile. */
export function personLabel(person: PersonDto): string {
  if (person.username === null) return person.name;
  const holder = person.holderUid == null ? '' : ` (${person.holderUid.toUpperCase()})`;
  return `@${person.username}${holder}`;
}

/**
 * What this particular merge will do, in one sentence. Three cases, and the
 * organiser should be told which one they are in *before* they press the
 * button: the third moves a real person's whole history in the event and puts
 * their device out of it, which is not what "fold a duplicate in" sounds like.
 */
export function mergeConsequence(survivor: PersonDto, loser: PersonDto): MergeConsequence {
  if (!loser.claimed) {
    return {
      kind: 'sessions-only',
      text: 'Their sessions and pitches move here. Nothing else changes.',
    };
  }
  if (!survivor.claimed) {
    return {
      kind: 'claim-moves',
      text: `${personLabel(loser)} becomes the holder of this profile.`,
    };
  }
  return {
    kind: 'work-moves',
    text: `Everything ${personLabel(loser)} did in this event — their stars, notes, and everything they wrote — moves to ${personLabel(survivor)}, and their device is signed out of the event.`,
  };
}
