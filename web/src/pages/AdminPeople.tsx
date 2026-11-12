import { useState } from 'react';
import { FloatingFocusManager } from '@floating-ui/react';
import { Link } from 'react-router-dom';
import type { BundleDto, PersonDto, Role } from '@shared/types';
import { api } from '../lib/api';
import { errorText } from '../lib/errorText';
import { relativeTime } from '../lib/format';
import {
  BY_NAME,
  NATURAL_DIR,
  PEOPLE_FILTERS,
  PEOPLE_OPTIONAL_COLUMNS,
  filterCounts,
  filterPeople,
  sortForColumns,
  type PeopleFilter,
  type PeopleSort,
  type PeopleSortColumn,
} from '../lib/people';
import { plural } from '../lib/plural';
import type { EventData } from '../lib/useEventData';
import { usePeopleColumns, type PeopleColumnsControl } from '../lib/usePeopleColumns';
import { ColumnsIcon, MoreIcon, SearchIcon } from '../components/icons';
import { MergeModal } from '../components/MergeModal';
import { PersonStatusBadge } from '../components/PersonLine';
import { popoverPanelClass, usePopover } from '../components/Popover';
import { RoleControl } from '../components/RoleControl';
import {
  InlineCreate,
  PrimaryButton,
  Section,
  bareFieldFocusRing,
  useToast,
} from '../components/ui';
import { SESSIONS } from './adminNouns';

/**
 * The People table's columns, shared by the header and every row so the two
 * cannot drift apart. The point of a column is reading *down* it: two people
 * called Ada Lovelace are told apart by the username and UID beside them, and
 * those have to line up to be compared.
 *
 * None of them is `hidden sm:block` any more. Two columns that vanished at a
 * breakpoint were a rule an organiser could not see or argue with; now the
 * same two are off by default on a phone and in the Columns menu. The actions
 * column is one icon wide because Open left it for the menu.
 *
 * Name and username share the room that is left, equally — they are the two
 * things a person is looked up by, and a username squeezed to `@margarethami…`
 * is not a lookup. `min` is the width below which a column stops being worth
 * reading; the table scrolls sideways rather than go under it, which is the
 * bargain the grid already makes on a phone.
 */
const PEOPLE_COL = {
  name: { className: 'min-w-0 flex-1', min: 140 },
  username: { className: 'min-w-0 flex-1', min: 140 },
  uid: { className: 'w-16 shrink-0', min: 64 },
  role: { className: 'w-24 shrink-0', min: 96 },
  seen: { className: 'w-16 shrink-0', min: 64 },
  actions: { className: 'w-9 shrink-0', min: 36 },
};

/** The gap between two columns, as `gap-2` is worth in pixels. */
const PEOPLE_GAP = 8;

/**
 * How narrow the table may get before it scrolls instead.
 *
 * Computed from the columns actually on, so a phone showing the four it
 * starts with scrolls a little and one showing all six scrolls more, and a
 * desktop — where the sum is under the page's `max-w-3xl` — never scrolls at
 * all and hands the slack to the name and the username.
 */
const peopleTableWidth = (shown: PeopleSortColumn[]): number => {
  const cols = [...shown.map((c) => PEOPLE_COL[c].min), PEOPLE_COL.actions.min];
  return cols.reduce((a, b) => a + b, 0) + PEOPLE_GAP * (cols.length - 1);
};

/**
 * One column heading, which is also the control that orders by it.
 *
 * The arrow is drawn only on the column in force. A row of five arrows all
 * pointing somewhere would say every column is sorted, and only one ever is;
 * a hover arrow on the rest would be invisible to a finger. So the affordance
 * is the heading being a button at all — it underlines on hover — and the
 * arrow is the state, not the invitation.
 *
 * The accessible name carries the whole thing, because "Name ▲" read aloud is
 * "Name" and nothing else: `aria-sort` belongs on a real `columnheader`, and
 * this table is a flex list rather than a `<table>`.
 */
function PeopleHeader({
  column,
  label,
  sort,
  onSort,
  className,
}: {
  column: PeopleSortColumn;
  label: string;
  sort: PeopleSort;
  onSort: (column: PeopleSortColumn) => void;
  className: string;
}) {
  const active = sort.column === column;
  const dir = active ? sort.dir : NATURAL_DIR[column];
  return (
    <span className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={
          active
            ? `${label}, sorted ${sort.dir === 'asc' ? 'ascending' : 'descending'}. Reverse it`
            : `Sort by ${label}`
        }
        className={`flex max-w-full items-center gap-0.5 uppercase tracking-wide hover:text-stone-600 hover:underline dark:hover:text-stone-300 ${
          active ? 'text-stone-700 dark:text-stone-200' : ''
        }`}
      >
        <span className="truncate">{label}</span>
        {active && (
          <span aria-hidden="true" className="shrink-0 text-[0.6rem]">
            {dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    </span>
  );
}

/** One size for every action, so a row of them is a column. */
const peopleActionClass =
  'w-[3.5rem] rounded-lg border border-stone-300 bg-white px-1 py-1 text-xs font-semibold ' +
  'text-stone-700 hover:border-stone-500 dark:border-stone-600 dark:bg-stone-900 ' +
  'dark:text-stone-200 dark:hover:border-stone-400';

/**
 * Every way into a profile from this table, so the way back out is the same
 * one wherever the organiser started: the name, the username, or the menu.
 */
function PersonLink({
  slug,
  person,
  className,
  title,
  role,
  children,
}: {
  slug: string;
  person: PersonDto;
  className?: string;
  title?: string;
  /** `menuitem` where this link is one; the row's own links are just links. */
  role?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={`/e/${slug}/p/${person.id}`}
      state={{ back: { to: `/e/${slug}/admin?tab=people`, label: 'People' } }}
      className={className}
      title={title}
      role={role}
    >
      {children}
    </Link>
  );
}

/**
 * Everything you can do to a row, behind one button the width of an icon.
 *
 * They were three buttons in the row until archiving made them four, and four
 * did not fit a column this table can spare the width for. A menu is the
 * better shape anyway: Merge, Archive and Delete are each consequential and
 * each need a sentence to be safe to press, and a sentence does not fit on a
 * 56-pixel button.
 *
 * Open went in with them, as "Edit profile" — the name it deserved, since
 * that is what an organiser goes there to do. It was the one action left in
 * the row, and it was costing every row four columns' worth of width to say
 * a word the whole row already means: the name and the username are links to
 * the same place, and they were always the thing a finger aimed at first.
 */
function PersonActions({
  slug,
  person,
  onMerge,
  onArchive,
}: {
  slug: string;
  person: PersonDto;
  onMerge: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    role: 'menu',
    placement: 'bottom-end',
  });
  const archived = person.archivedAt !== null;

  const run = (act: () => void) => {
    setOpen(false);
    act();
  };
  const itemClass =
    'flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-start hover:bg-stone-100 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-stone-800';

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={`Actions for ${person.name}`}
        title={`Actions for ${person.name}`}
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
      >
        <MoreIcon className="h-4 w-4" />
      </button>
      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            aria-label={`Actions for ${person.name}`}
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-64 p-1 text-xs`}
          >
            {/* First, because it is the one an organiser reaches for most —
                and a link rather than a button, so it still opens in a new
                tab the way the name beside it does. */}
            <PersonLink slug={slug} person={person} role="menuitem" className={itemClass}>
              <span className="font-semibold text-stone-700 dark:text-stone-200">Edit profile</span>
              <span className="text-stone-500 dark:text-stone-400">
                Their name, bio, links and role.
              </span>
            </PersonLink>

            <button
              type="button"
              role="menuitem"
              onClick={() => run(onMerge)}
              className={itemClass}
            >
              <span className="font-semibold text-stone-700 dark:text-stone-200">Merge…</span>
              <span className="text-stone-500 dark:text-stone-400">
                Fold a duplicate of {person.name} into this profile.
              </span>
            </button>

            {/* Where Delete used to be, and doing the job Delete was reached
                for. Delete refused outright for anyone holding their own
                profile — which is most of a live event — and for everyone
                else it stripped the name off every session they were credited
                on and could not be undone. Archiving is the same tidy-up with
                none of that: the row leaves this list and the speaker picker,
                the sessions keep their speaker, and it is one click back. */}
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onArchive)}
              className={itemClass}
            >
              <span className="font-semibold text-stone-700 dark:text-stone-200">
                {archived ? 'Take out of the archive' : 'Archive'}
              </span>
              <span className="text-stone-500 dark:text-stone-400">
                {archived
                  ? 'Back into the People list and the speaker picker.'
                  : 'Out of this list and the speaker picker — including “All”. Keeps their sessions, their role and their way in, and entering again brings them back by itself.'}
              </span>
            </button>
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}
/**
 * Which columns the table is showing.
 *
 * A desktop starts with all five, as it always did. A phone starts without
 * the UID and the last seen time — lookups an organiser does a handful of
 * times an event, and on a narrow row the two that leave nothing legible
 * behind. That was already the rule as `hidden sm:block`; the difference is
 * that it is now a default rather than a law, and disagreeing with it sticks
 * at both sizes.
 */
function PeopleColumnsMenu({ columns }: { columns: PeopleColumnsControl }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
  });

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label="Columns"
        title="Which columns this table shows"
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold ${
          open
            ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
            : 'border-stone-300 bg-white text-stone-600 hover:border-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-400'
        }`}
      >
        <ColumnsIcon className="h-3.5 w-3.5" />
        {/* The word goes below `sm`, where the columns it hides are the point. */}
        <span className="hidden sm:inline">Columns</span>
      </button>

      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            aria-label="Columns"
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-64 p-1 text-xs`}
          >
            {PEOPLE_OPTIONAL_COLUMNS.map(({ id, label, hint }) => (
              <label
                key={id}
                className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                {/* eslint-disable-next-line no-restricted-syntax -- checkbox, not a text field */}
                <input
                  type="checkbox"
                  checked={columns.showing(id)}
                  onChange={() => columns.toggle(id)}
                  className="mt-0.5 shrink-0 accent-stone-900 dark:accent-stone-100"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-stone-700 dark:text-stone-200">
                    {label}
                  </span>
                  <span className="block text-stone-500 dark:text-stone-400">{hint}</span>
                </span>
              </label>
            ))}
            {/* Name is not offered, because a row without it is not a row. */}
            <div className="mt-1 border-t border-stone-100 px-2 pb-1 pt-1.5 dark:border-stone-800">
              <button
                type="button"
                onClick={columns.reset}
                className="text-stone-500 hover:underline disabled:opacity-40 disabled:hover:no-underline dark:text-stone-400"
                disabled={columns.isDefault}
              >
                Back to what this screen started with
              </button>
            </div>
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}

/**
 * The People table's filter, search text and sort order.
 *
 * Called by `AdminPage` and passed down, rather than held in `AdminPeople`:
 * the tab's component unmounts when another tab opens, and an organiser who
 * looks something up under Settings and comes back should find the list as
 * they left it.
 */
export function usePeopleView() {
  const [filter, setFilter] = useState<PeopleFilter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PeopleSort>(BY_NAME);
  return { filter, setFilter, query, setQuery, sort, setSort };
}

export type PeopleView = ReturnType<typeof usePeopleView>;

/** The People tab: profile claims waiting on an organiser, the table of
 *  everyone in the event, merging, and expecting someone by name. */
export function AdminPeople({
  slug,
  bundle,
  data,
  view,
}: {
  slug: string;
  bundle: BundleDto;
  data: EventData;
  view: PeopleView;
}) {
  const toast = useToast();
  const event = bundle.event;
  const {
    filter: peopleFilter,
    setFilter: setPeopleFilter,
    query: peopleQuery,
    setQuery: setPeopleQuery,
    sort: peopleSort,
    setSort: setPeopleSort,
  } = view;
  const peopleColumns = usePeopleColumns();
  const [merging, setMerging] = useState<PersonDto | null>(null);

  const fail = (err: unknown) => toast.show(errorText(err));

  // Derived rather than stored: SSE edits land in the bundle, and a list that
  // remembered its own copy would show a role change one refresh late.
  const openClaims = bundle.claims.filter((c) => c.declinedAt === null);
  /** Approving runs a merge, so the whole bundle moves; reload rather than
   *  guess which parts. */
  const decideClaim = async (run: () => Promise<unknown>) => {
    try {
      await run();
      await data.reload();
    } catch (err) {
      fail(err);
    }
  };

  const peopleCounts = filterCounts(bundle.people);
  // Ordering by a column that is no longer on screen would leave the rows in
  // an arrangement with nothing visible to explain or undo it.
  const peopleOrder = sortForColumns(peopleSort, peopleColumns.shown);
  const shownPeople = filterPeople(bundle.people, peopleFilter, peopleQuery, peopleOrder);

  /**
   * Click a column to order by it; click the one you are already on to turn it
   * round. A fresh column starts whichever way that column is usually asked —
   * see `NATURAL_DIR` — rather than always ascending, so "who was here last"
   * and "who runs this event" are one click each rather than two.
   */
  const sortBy = (column: PeopleSortColumn) =>
    setPeopleSort((s) => {
      // Against the order actually in force, which is not the remembered one
      // when the column it names has been switched off.
      const now = sortForColumns(s, peopleColumns.shown);
      return now.column === column
        ? { column, dir: now.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: NATURAL_DIR[column] };
    });

  const addPerson = async (name: string): Promise<boolean> => {
    try {
      const created = await api.createPerson(slug, { name });
      data.apply({ type: 'person.created', entity: created });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  /**
   * Hand somebody a different role. The server refuses to demote the last
   * organiser — an event nobody can administer has no way back — so that
   * refusal arrives as a toast rather than being predicted here.
   */
  const changeRole = async (person: PersonDto, role: Role) => {
    try {
      const updated = await api.setPersonRole(slug, person.id, role);
      data.apply({ type: 'person.updated', entity: updated });
    } catch (err) {
      fail(err);
    }
  };

  /**
   * Put a profile away, or take it back out. No confirmation: nothing is lost
   * and the same menu item undoes it, which is the difference between this and
   * Delete — and asking twice about a reversible tidy-up is how an organiser
   * learns to click through dialogs without reading them.
   */
  const toggleArchive = async (person: PersonDto) => {
    try {
      const updated =
        person.archivedAt === null
          ? await api.archivePerson(slug, person.id)
          : await api.unarchivePerson(slug, person.id);
      data.apply({ type: 'person.updated', entity: updated });
      toast.show(
        updated.archivedAt === null
          ? `${updated.name} is back in the list`
          : `${updated.name} archived — find them under Archived`,
      );
    } catch (err) {
      fail(err);
    }
  };

  return (
    <>
      {/* People asking for a profile somebody left for them. Above the
              list because it is the one thing here that is waiting on you,
              and it disappears the moment the queue is empty. */}
      {openClaims.length > 0 && (
        <Section
          className="mb-4"
          title={`Waiting for you (${openClaims.length})`}
          description="Someone says one of these profiles is them. Approving hands it over and folds their own profile into it, exactly as merging the two by hand would. It cannot be undone, so check the username against who you were expecting."
        >
          <ul>
            {openClaims.map((claim) => {
              const theirs = bundle.people.find((p) => p.id === claim.requesterPersonId);
              return (
                <li
                  key={claim.id}
                  className="flex flex-wrap items-center gap-2 border-b border-stone-100 py-2 text-sm last:border-0 dark:border-stone-800"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">@{claim.username}</span>
                    {claim.requesterUid != null && (
                      <span className="ms-1.5 font-mono text-xs text-stone-400 dark:text-stone-500">
                        {claim.requesterUid.toUpperCase()}
                      </span>
                    )}
                    <span className="text-stone-500 dark:text-stone-400"> says they are </span>
                    <span className="font-medium">{claim.personName}</span>
                    {theirs && (
                      <span className="block text-xs text-stone-400 dark:text-stone-500">
                        Their profile “{theirs.name}” is folded in and removed.
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className={peopleActionClass}
                      onClick={() => void decideClaim(() => api.declineClaim(slug, claim.id))}
                    >
                      Decline
                    </button>
                    <PrimaryButton
                      className="w-[4.25rem] px-1 py-1 text-xs"
                      onClick={() => void decideClaim(() => api.approveClaim(slug, claim.id))}
                    >
                      Approve
                    </PrimaryButton>
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <Section
        title="People"
        description="Everyone who has entered this event, plus the people you are expecting. Entering claims a username and creates a profile; a profile nobody holds is one you or a session named, still waiting for them to arrive."
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter people" className="flex flex-wrap gap-1">
            {PEOPLE_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={peopleFilter === f.id}
                onClick={() => setPeopleFilter(f.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                  peopleFilter === f.id
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
                }`}
              >
                {f.label} <span className="tabular-nums opacity-60">{peopleCounts[f.id]}</span>
              </button>
            ))}
          </div>
          <div className="relative ms-auto w-32 sm:w-48">
            <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-500 dark:text-stone-400" />
            {/* eslint-disable-next-line no-restricted-syntax -- compact search box; folds into a ControlShell adornment in a later phase */}
            <input
              type="search"
              value={peopleQuery}
              onChange={(e) => setPeopleQuery(e.target.value)}
              aria-label="Search people"
              placeholder="Name, @username or UID"
              className={`w-full rounded-lg border border-stone-500 bg-stone-50 ps-8 pe-2 py-1 text-xs text-stone-700 outline-hidden dark:border-stone-500 dark:bg-stone-950 dark:text-stone-200 ${bareFieldFocusRing}`}
            />
          </div>
          <PeopleColumnsMenu columns={peopleColumns} />
        </div>

        {/* Sideways rather than squeezed, which is the bargain the grid
                already makes on a phone. A table that fits a 375-pixel screen
                by giving every column 60 pixels is not a table anybody can
                read; one that scrolls keeps each column at the width its
                content needs, and the header scrolls with the rows so a
                column is never read under the wrong heading. On a desktop the
                sum is under the page's own width, so nothing scrolls and the
                slack goes to the name and the username. */}
        <div className="overflow-x-auto">
          <div style={{ minWidth: peopleTableWidth(peopleColumns.shown) }}>
            {/* A header, because this is a table now: six facts about a
                  person, the same six on every row, and an organiser reading
                  down one column should not have to work out which is which.
                  The widths are shared with the rows below.

                  Every column that holds a fact also orders by it. It used to
                  be one button offering two of the five, which meant the
                  question "who has no username yet" or "who is still only a
                  viewer" had no answer but reading the whole list. The header
                  was `aria-hidden` while it was decoration; now that it is the
                  control, it is not. */}
            <div className="flex items-center gap-2 border-b border-stone-200 pb-1 text-[0.65rem] font-semibold uppercase tracking-wide text-stone-400 dark:border-stone-700 dark:text-stone-500">
              {(
                [
                  ['name', 'Name'],
                  ['username', 'Username'],
                  ['uid', 'UID'],
                  ['role', 'Role'],
                  ['seen', 'Last seen'],
                ] as [PeopleSortColumn, string][]
              )
                .filter(([column]) => peopleColumns.showing(column))
                .map(([column, label]) => (
                  <PeopleHeader
                    key={column}
                    column={column}
                    label={label}
                    sort={peopleOrder}
                    onSort={sortBy}
                    className={PEOPLE_COL[column].className}
                  />
                ))}
              {/* Named, like every column beside it, and not a button:
                    there is nothing here to order by, because it holds a menu
                    rather than a fact. "Edit" rather than "Actions" — it is
                    two characters cheaper in a column nine wide, and it is
                    what the menu is opened to do. */}
              <span className={`${PEOPLE_COL.actions.className} text-end`}>Edit</span>
            </div>

            <ul className="mb-4">
              {shownPeople.map((person) => (
                <li
                  key={person.id}
                  className="flex items-center gap-2 border-b border-stone-100 py-1.5 last:border-0 dark:border-stone-800"
                >
                  {/* The name is the way in, at the size a finger is aimed
                        at. It used to be text with a 56-pixel "Open" button four
                        columns away — the one link on the row that was not where
                        anyone pointed. */}
                  <span
                    className={`${PEOPLE_COL.name.className} flex items-baseline gap-1.5`}
                    title={
                      (person.sessionCount ?? 0) === 0
                        ? 'Not credited on any session'
                        : `Credited on ${plural(person.sessionCount ?? 0, SESSIONS)}`
                    }
                  >
                    <PersonLink
                      slug={slug}
                      person={person}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {person.name}
                    </PersonLink>
                    {/* Your own row, pinned to the top by `filterPeople`. */}
                    {person.isMine && (
                      <span
                        title="This device — the profile you are signed in as"
                        className="shrink-0 rounded-full bg-stone-200 px-1.5 py-0.5 text-[0.65rem] font-semibold text-stone-600 dark:bg-stone-700 dark:text-stone-300"
                      >
                        you
                      </span>
                    )}
                    {/* No "code" badge here. An outstanding speaker code is
                          a fact about one person, and it was being read down a
                          column of two hundred rows where it is noise — it
                          says nothing about who they are or what they may do,
                          which is what the rest of the row is for. The profile
                          page says it, in the place the code is minted and
                          revoked, and says which of the three states it is in
                          rather than only flagging one. */}
                  </span>

                  {peopleColumns.showing('username') && (
                    <span className={`${PEOPLE_COL.username.className} truncate text-xs`}>
                      {/* An em dash is not a profile to open, so only a real
                            username is a link. */}
                      {person.username === null ? (
                        <span
                          className="text-stone-500 dark:text-stone-400"
                          title="Nobody holds this profile, so it has no username"
                        >
                          —
                        </span>
                      ) : (
                        <PersonLink
                          slug={slug}
                          person={person}
                          title="Their username in this event — what they post under"
                          className="text-stone-500 hover:underline dark:text-stone-400"
                        >
                          @{person.username}
                        </PersonLink>
                      )}
                    </span>
                  )}

                  {peopleColumns.showing('uid') && (
                    <span
                      className={`${PEOPLE_COL.uid.className} truncate font-mono text-xs text-stone-400 dark:text-stone-500`}
                      title="The identity holding this profile — the code the audit log names, and the same one at every event on this instance"
                    >
                      {person.holderUid == null ? '—' : person.holderUid.toUpperCase()}
                    </span>
                  )}

                  {/* The role *is* the status: the badge everyone else sees,
                        with a pencil in it for anyone who holds the profile, and
                        a plain badge for a profile nobody holds. */}
                  {peopleColumns.showing('role') && (
                    <span className={PEOPLE_COL.role.className}>
                      {person.claimed ? (
                        <RoleControl
                          role={person.role ?? null}
                          userLabel={event.userRoleLabel}
                          personName={person.name}
                          onChange={(role) => void changeRole(person, role)}
                        />
                      ) : (
                        <PersonStatusBadge person={person} userLabel={event.userRoleLabel} />
                      )}
                    </span>
                  )}

                  {peopleColumns.showing('seen') && (
                    <span
                      className={`${PEOPLE_COL.seen.className} truncate text-xs text-stone-400 dark:text-stone-500`}
                      title={
                        person.lastSeenAt == null
                          ? 'Nobody holds this profile, so it has never been used'
                          : `Last seen ${new Date(person.lastSeenAt).toLocaleString()}`
                      }
                    >
                      {person.lastSeenAt == null ? '—' : relativeTime(person.lastSeenAt)}
                    </span>
                  )}

                  {/* One icon, and everything behind it. The column was four
                        times this wide to hold a button saying "Open" beside a
                        second one saying only "more", and the width it gives
                        back is width the name column now has on the screen with
                        the least of it to spare. */}
                  <span className={`${PEOPLE_COL.actions.className} flex justify-end`}>
                    <PersonActions
                      slug={slug}
                      person={person}
                      onMerge={() => setMerging(person)}
                      onArchive={() => void toggleArchive(person)}
                    />
                  </span>
                </li>
              ))}
              {shownPeople.length === 0 && (
                <li className="py-2 text-sm text-stone-400 dark:text-stone-500">
                  {bundle.people.length === 0 ? 'Nobody here yet.' : 'Nobody matches that.'}
                </li>
              )}
            </ul>
          </div>
        </div>

        {merging && (
          <MergeModal
            slug={slug}
            survivor={merging}
            people={bundle.people}
            userLabel={event.userRoleLabel}
            onClose={() => setMerging(null)}
            onMerged={(updated, loserId) => {
              data.apply({ type: 'person.deleted', entity: { id: loserId } });
              data.apply({ type: 'person.updated', entity: updated });
              // Sessions and pitches moved too, so the rest of the bundle
              // is stale in ways no single change frame describes.
              void data.reload();
              setMerging(null);
            }}
          />
        )}

        <InlineCreate
          action="Expect someone"
          fieldLabel="Name of the person to expect"
          submitLabel="Add person"
          hint="Creates a profile nobody holds yet — for a speaker you are putting on the programme before they arrive. They claim it at the login page, or with a speaker code."
          maxLength={120}
          onSubmit={addPerson}
        />
      </Section>
    </>
  );
}
