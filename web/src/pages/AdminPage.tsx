import { plural } from '../lib/plural';
import { errorText } from '../lib/errorText';
import { Modal } from '../components/Modal';
import { useCallback, useEffect, useState } from 'react';
import { FloatingFocusManager } from '@floating-ui/react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  BreakDto,
  FormatDto,
  PersonDto,
  Role,
  RoomDto,
  TagDto,
  TrackDto,
  TrackWindowDto,
  ViewMode,
} from '@shared/types';
import { ROOM_COLORS } from '@shared/roomColors';
import { TAG_COLORS, nextTagColor, readableInk } from '@shared/tagColors';
import { SUGGESTED_FORMATS } from '@shared/formats';

import { ColorPicker } from '../components/ColorPicker';
import { windowLabel } from '@shared/trackHours';
import { ApiError, api, type BreakWrite, type TrackWrite, type TrashDto } from '../lib/api';
import { fmtMin, minutesOf, relativeTime, snapMinute } from '../lib/format';
import { useEventData } from '../lib/useEventData';
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
import { usePeopleColumns, type PeopleColumnsControl } from '../lib/usePeopleColumns';
import { ColumnsIcon, MoreIcon, SearchIcon } from '../components/icons';
import { PersonStatusBadge } from '../components/PersonLine';
import { popoverPanelClass, usePopover } from '../components/Popover';
import { RoleControl } from '../components/RoleControl';

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

            <button type="button" role="menuitem" onClick={() => run(onMerge)} className={itemClass}>
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

import { MergeModal } from '../components/MergeModal';
import {
  auditKeepField,
  numberFieldMessage,
  parseNumberField,
  weekRailFromField,
  type NumberFieldError,
} from '../lib/numberField';

/** "<field>: <problem>" as one template with two named parts, rather than the
 *  message lowercased and glued onto a label — casing is language-specific
 *  (German capitalises nouns), so it is not ours to change. */
const fieldProblem = (field: string, error: NumberFieldError): string =>
  `${field}: ${numberFieldMessage(error)}`;
import { AdminBreaks, dayName } from './AdminBreaks';
import { AdminRooms, type RoomDraft } from './AdminRooms';
import { AdminPermissions } from './AdminPermissions';
import { AdminBackup } from './AdminBackup';
import { AdminAudit } from './AdminAudit';
import { AdminInvite } from './AdminInvite';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  ControlShell,
  DangerButton,
  EmptyState,
  Field,
  FormError,
  FormGrid,
  FormRow,
  FormStack,
  IconButton,
  InlineCreate,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  Section,
  Spinner,
  TextArea,
  TextInput,
  Toggle,
  bareFieldFocusRing,
  linkClass,
  useConfirm,
  useToast,
} from '../components/ui';


const TABS = [
  { id: 'programme', label: 'Programme' },
  { id: 'people', label: 'People' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'settings', label: 'Settings' },
  { id: 'backup', label: 'Backup' },
  { id: 'trash', label: 'Trash' },
  { id: 'audit', label: 'Audit' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** The counted nouns this page says. Kept together so a translation has one
 *  place to extend them, rather than an `+ 's'` at each call site. */
const SESSIONS = { one: 'session', other: 'sessions' };
const PITCHES = { one: 'pitch', other: 'pitches' };
const DAYS = { one: 'day', other: 'days' };

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Rooms, tags, passwords and event settings — admin only (SPEC §7.1). */
export function AdminPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const data = useEventData(slug);

  const [reordering, setReordering] = useState(false);
  const [editingTag, setEditingTag] = useState<TagDto | null>(null);
  const [editingFormat, setEditingFormat] = useState<FormatDto | null>(null);
  const [editingTrack, setEditingTrack] = useState<TrackDto | null>(null);
  const [movingTracks, setMovingTracks] = useState(false);
  /** `null` means "whatever the palette offers next" — the field follows the
   *  tags that exist until someone picks a colour on purpose, and goes back to
   *  following them once the tag is added. */
  const [tagColor, setTagColor] = useState<string | null>(null);
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>('all');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleSort, setPeopleSort] = useState<PeopleSort>(BY_NAME);
  const peopleColumns = usePeopleColumns();
  const [merging, setMerging] = useState<PersonDto | null>(null);

  const bundle = data.bundle;
  const event = bundle?.event;

  const [name, setName] = useState('');
  const [slugField, setSlugField] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dayStart, setDayStart] = useState('');
  const [dayEnd, setDayEnd] = useState('');
  const [weekRailFrom, setWeekRailFrom] = useState('8');
  const [auditKeep, setAuditKeep] = useState('1000');
  const [defaultView, setDefaultView] = useState<ViewMode>('list');
  const [showOfficialBadge, setShowOfficialBadge] = useState(false);
  const [userRoleLabel, setUserRoleLabel] = useState('');
  const [viewerPassword, setViewerPassword] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  // Holds the slug the settings form was filled from. Duplicating an event
  // navigates straight to the new event's admin page, which re-renders this
  // same component instance — so a plain boolean latch would leave the previous
  // event's values in the form.
  const [loadedForSlug, setLoadedForSlug] = useState<string | null>(null);

  const [cloneName, setCloneName] = useState('');
  const [cloneSlug, setCloneSlug] = useState('');
  const [cloneStart, setCloneStart] = useState('');
  const [cloneEnd, setCloneEnd] = useState('');
  const [cloneViewer, setCloneViewer] = useState('');
  const [cloneUser, setCloneUser] = useState('');
  const [cloneAdmin, setCloneAdmin] = useState('');
  const [cloning, setCloning] = useState(false);
  // Duplicating happens once in an event's life, if ever; seven fields should
  // not sit open above Trash for the whole of the rest of it.
  const [cloneOpen, setCloneOpen] = useState(false);

  const [trash, setTrash] = useState<TrashDto | null>(null);
  const isAdmin = bundle?.role === 'admin';

  const tabParam = searchParams.get('tab');
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'programme';
  const setTab = useCallback(
    (next: TabId) => {
      // replace, not push: flicking through tabs shouldn't fill the back button.
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'programme') params.delete('tab');
          else params.set('tab', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const loadTrash = useCallback(async () => {
    try {
      setTrash(await api.trash(slug));
    } catch (err) {
      toast.show(errorText(err));
    }
  }, [slug, toast]);

  // Only when its tab is open — the bin is the one section most visits never
  // look at, and it is a request of its own.
  useEffect(() => {
    if (isAdmin && tab === 'trash') void loadTrash();
  }, [isAdmin, tab, loadTrash]);

  if (event && loadedForSlug !== event.slug) {
    setLoadedForSlug(event.slug);
    setName(event.name);
    setSlugField(event.slug);
    setStartDate(event.startDate);
    setEndDate(event.endDate);
    setDayStart(fmtMin(event.dayStartMin));
    setDayEnd(fmtMin(event.dayEndMin));
    setWeekRailFrom(String(event.weekRailFrom));
    setAuditKeep(String(event.auditKeep));
    setDefaultView(event.defaultView);
    setShowOfficialBadge(event.showOfficialBadge);
    setUserRoleLabel(event.userRoleLabel);
    // Clear the duplicate form too, so it isn't pre-filled after a clone.
    setCloneName('');
    setCloneSlug('');
    setCloneStart('');
    setCloneEnd('');
    setCloneViewer('');
    setCloneUser('');
    setCloneAdmin('');
    setCloning(false);
    setCloneOpen(false);
  }

  const fail = (err: unknown) => toast.show(errorText(err));

  if (data.status === 'loading') return <Spinner label="Loading…" />;
  if (!bundle || !event) {
    return (
      <EmptyState>
        You need the admin password for this event.{' '}
        <Link to={`/e/${slug}`} className={linkClass}>
          Go to the schedule
        </Link>
      </EmptyState>
    );
  }
  if (bundle.role !== 'admin') {
    return (
      <EmptyState>
        Only organisers can manage this event.{' '}
        <Link to={`/e/${slug}`} className={linkClass}>
          Back to the schedule
        </Link>
      </EmptyState>
    );
  }

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

  const addRoom = async (draft: RoomDraft) => {
    try {
      const created = await api.createRoom(slug, {
        ...draft,
        sortOrder: bundle.rooms.length,
      });
      data.apply({ type: 'room.created', entity: created });
    } catch (err) {
      fail(err);
    }
  };

  const patchRoom = async (room: RoomDto, patch: Partial<RoomDto>) => {
    try {
      data.apply({ type: 'room.updated', entity: await api.updateRoom(slug, room.id, patch) });
    } catch (err) {
      fail(err);
    }
  };

  // Rooms arrive already sorted, so reordering is a matter of array position.
  // Historic rows can share a sort_order (everything seeded before this feature
  // is 0), so swapping the two numbers would be a no-op — instead renumber the
  // whole list and PATCH only the rooms whose number actually moved, which
  // makes the first reorder self-healing.
  const moveRoom = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (reordering || target < 0 || target >= bundle.rooms.length) return;
    const ordered = bundle.rooms.slice();
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setReordering(true);
    try {
      for (let i = 0; i < ordered.length; i += 1) {
        const room = ordered[i];
        if (room.sortOrder === i) continue;
        data.apply({
          type: 'room.updated',
          entity: await api.updateRoom(slug, room.id, { sortOrder: i }),
        });
      }
    } catch (err) {
      fail(err);
    } finally {
      setReordering(false);
    }
  };

  const removeRoom = async (room: RoomDto) => {
    const ok = await confirm({
      title: `Delete the room “${room.name}”?`,
      body: 'A room with sessions still in it cannot be deleted — move those first. The bin does not hold rooms, so this cannot be undone.',
    });
    if (!ok) return;
    try {
      await api.deleteRoom(slug, room.id);
      data.apply({ type: 'room.deleted', entity: { id: room.id } });
    } catch (err) {
      fail(err);
    }
  };

  /** The first palette colour no live tag is wearing. The server picks the
   *  same one for a tag created without a colour; doing it here as well means
   *  the swatch shows what you are about to get rather than a surprise. */
  const suggestedTagColor = nextTagColor((bundle?.tags ?? []).map((t) => t.color));

  /** The shipped suggestions this event has not defined yet, matched the way
   *  the server matches names — case-insensitively, since "Workshop" and
   *  "workshop" are the same format and the second would be refused. */
  const definedFormats = new Set((bundle?.formats ?? []).map((f) => f.name.toLowerCase()));
  const suggestedFormats = SUGGESTED_FORMATS.filter(
    (s) => !definedFormats.has(s.name.toLowerCase()),
  );
  const newTagColor = tagColor ?? suggestedTagColor;

  const addTag = async (name: string): Promise<boolean> => {
    try {
      const created = await api.createTag(slug, { name, color: newTagColor });
      data.apply({ type: 'tag.created', entity: created });
      setTagColor(null);
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const patchTag = async (tag: TagDto, patch: Partial<TagDto>): Promise<boolean> => {
    try {
      data.apply({ type: 'tag.updated', entity: await api.updateTag(slug, tag.id, patch) });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const addTrack = async (name: string): Promise<boolean> => {
    try {
      const created = await api.createTrack(slug, { name });
      data.apply({ type: 'track.created', entity: created });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const patchTrack = async (track: TrackDto, patch: TrackWrite): Promise<boolean> => {
    try {
      data.apply({ type: 'track.updated', entity: await api.updateTrack(slug, track.id, patch) });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const moveTrack = async (index: number, direction: -1 | 1) => {
    const list = bundle?.tracks ?? [];
    const to = index + direction;
    if (movingTracks || to < 0 || to >= list.length) return;
    const ids = list.map((t) => t.id);
    [ids[index], ids[to]] = [ids[to] as number, ids[index] as number];
    setMovingTracks(true);
    try {
      for (const track of await api.reorderTracks(slug, ids)) {
        data.apply({ type: 'track.updated', entity: track });
      }
    } catch (err) {
      fail(err);
    } finally {
      setMovingTracks(false);
    }
  };

  const removeTrack = async (track: TrackDto): Promise<boolean> => {
    const ok = await confirm({
      title: `Delete the “${track.name}” track?`,
      body: 'Its sessions keep their room and their time, and lose the track. The bin does not hold tracks, so this cannot be undone.',
    });
    if (!ok) return false;
    try {
      await api.deleteTrack(slug, track.id);
      data.apply({ type: 'track.deleted', entity: { id: track.id } });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const addBreak = async (draft: BreakWrite): Promise<boolean> => {
    try {
      data.apply({ type: 'break.created', entity: await api.createBreak(slug, draft) });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const patchBreak = async (item: BreakDto, draft: BreakWrite): Promise<boolean> => {
    try {
      data.apply({ type: 'break.updated', entity: await api.updateBreak(slug, item.id, draft) });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  // No confirmation: a break is four fields an organiser can type again in
  // seconds, and it takes nothing else with it when it goes.
  const removeBreak = async (item: BreakDto): Promise<boolean> => {
    try {
      await api.deleteBreak(slug, item.id);
      data.apply({ type: 'break.deleted', entity: { id: item.id } });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const removeTag = async (tag: TagDto): Promise<boolean> => {
    const ok = await confirm({
      title: `Delete the “${tag.name}” tag?`,
      body: 'It comes off every session and pitch that wears it. The bin does not hold tags, so this cannot be undone.',
    });
    if (!ok) return false;
    try {
      await api.deleteTag(slug, tag.id);
      data.apply({ type: 'tag.deleted', entity: { id: tag.id } });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const addFormat = async (name: string): Promise<boolean> => {
    if (!name.trim()) return false;
    try {
      // No colour sent: the server picks the first the event is not using,
      // the same rule tags follow, so a list of formats is legible without
      // anyone choosing colours by hand.
      const created = await api.createFormat(slug, { name: name.trim() });
      data.apply({ type: 'format.created', entity: created });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const patchFormat = async (format: FormatDto, patch: Partial<FormatDto>): Promise<boolean> => {
    try {
      data.apply({ type: 'format.updated', entity: await api.updateFormat(slug, format.id, patch) });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const removeFormat = async (format: FormatDto): Promise<boolean> => {
    const ok = await confirm({
      title: `Delete the “${format.name}” format?`,
      body: 'The sessions that use it keep their slot and simply stop saying what kind of session they are. The bin does not hold formats, so this cannot be undone.',
    });
    if (!ok) return false;
    try {
      await api.deleteFormat(slug, format.id);
      data.apply({ type: 'format.deleted', entity: { id: format.id } });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

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

  const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  /** Every date this event covers, for the break day picker. Read from the
   *  saved event rather than the settings form: a break can only be pinned to
   *  a day the event actually has. */
  const dayList = ((): string[] => {
    const out: string[] = [];
    const cursor = new Date(`${bundle.event.startDate}T12:00:00Z`);
    const last = Date.parse(`${bundle.event.endDate}T12:00:00Z`);
    while (cursor.getTime() <= last && out.length < 400) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  })();

  // Inclusive, matching dateRange on the schedule.
  const eventDays =
    startDate && endDate
      ? Math.max(
          1,
          Math.round(
            (Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) /
              86400000,
          ) + 1,
        )
      : 1;

  /** Proves the organiser password before the permission matrix will move. */
  const confirmAdmin = async (password: string): Promise<boolean> => {
    try {
      await api.confirmAdmin(slug, password);
      return true;
    } catch (err) {
      toast.show(
        errorText(err, 'Could not check that password'),
      );
      return false;
    }
  };

  const parsedWeekRail = parseNumberField(weekRailFrom, weekRailFromField);
  const parsedAuditKeep = parseNumberField(auditKeep, auditKeepField);

  /**
   * The first thing wrong with the settings form, or `null` when nothing is.
   *
   * These four rules were the server's alone, which meant the way to discover
   * you had mistyped a slug or a password was to press Save and read a toast.
   * They are cheap to check here and the server still checks them all — this
   * is the form telling you before you ask, not the validation itself moving.
   */
  const settingsProblem =
    !name.trim()
      ? 'The event needs a name'
      : slugField !== event?.slug && !/^[a-z0-9-]{3,40}$/.test(slugField)
        ? 'Slug must be 3–40 characters of a–z, 0–9 or -'
        : parsedWeekRail.error
          ? fieldProblem('Group days into weeks past', parsedWeekRail.error)
          : parsedAuditKeep.error
            ? fieldProblem('Audit entries to keep', parsedAuditKeep.error)
            : [viewerPassword, userPassword, adminPassword].some((pw) => pw && pw.length < 6)
              ? 'Passwords must be at least 6 characters'
              : null;

  const saveSettings = async () => {
    // The second and third clauses are the narrowing the first already
    // implies: `settingsProblem` is null only once both numbers parsed.
    if (settingsProblem || parsedWeekRail.value === null || parsedAuditKeep.value === null) return;
    try {
      const updated = await api.updateSettings(slug, {
        name: name.trim(),
        // Only when it actually changed: sending the current slug back is a
        // no-op the server would still log as a rename.
        ...(slugField && slugField !== event?.slug ? { slug: slugField } : {}),
        startDate,
        endDate,
        dayStartMin: toMinutes(dayStart),
        dayEndMin: toMinutes(dayEnd),
        // Guarded above rather than coerced here: `Number('')` is 0, which
        // is how clearing the audit box used to save "keep everything for
        // ever", and `Number(x) || 8` is how a typo used to save 8.
        weekRailFrom: parsedWeekRail.value,
        auditKeep: parsedAuditKeep.value,
        defaultView,
        showOfficialBadge,
        ...(userRoleLabel.trim() ? { userRoleLabel: userRoleLabel.trim() } : {}),
        ...(viewerPassword ? { viewerPassword } : {}),
        ...(userPassword ? { userPassword } : {}),
        ...(adminPassword ? { adminPassword } : {}),
      });
      data.apply({ type: 'event.updated', entity: updated });
      setViewerPassword('');
      setUserPassword('');
      setAdminPassword('');
      toast.show('Settings saved');
    } catch (err) {
      fail(err);
    }
  };

  // The organiser on this page is already the event admin, so no instance key
  // is needed — the endpoint accepts either.
  const cloneSlugValue = cloneSlug || slugify(cloneName);
  const cloneReady =
    cloneName.trim().length > 0 &&
    /^[a-z0-9-]{3,40}$/.test(cloneSlugValue) &&
    cloneStart.length > 0 &&
    cloneEnd.length > 0 &&
    cloneViewer.length >= 6 &&
    cloneUser.length >= 6 &&
    cloneAdmin.length >= 6;

  const cloneEvent = async () => {
    setCloning(true);
    try {
      const created = await api.cloneEvent(slug, {
        newName: cloneName.trim(),
        newSlug: cloneSlugValue,
        startDate: cloneStart,
        endDate: cloneEnd,
        viewerPassword: cloneViewer,
        userPassword: cloneUser,
        adminPassword: cloneAdmin,
      });
      toast.show('Event duplicated — you are its organiser');
      navigate(`/e/${created.slug}/admin`);
    } catch (err) {
      fail(err);
      setCloning(false);
    }
  };

  const savePermissions = async (next: Record<string, string[]>) => {
    try {
      const updated = await api.updatePermissions(slug, next as never);
      data.apply({ type: 'permissions.updated', entity: updated });
      toast.show('Permissions saved');
    } catch (err) {
      fail(err);
      // Rethrown, not swallowed: the matrix flips its switch the moment it is
      // clicked and needs to know to put it back.
      throw err;
    }
  };

  const setArchived = async (archived: boolean) => {
    if (
      archived &&
      !(await confirm({
        title: 'Archive this event?',
        body: 'It becomes read-only for everyone: nobody can add, edit or delete anything until it is un-archived here. Nothing is deleted, and it can be turned off again.',
        confirmLabel: 'Archive',
        danger: false,
      }))
    ) {
      return;
    }
    try {
      const updated = await api.updateSettings(slug, { archived });
      data.apply({ type: 'event.updated', entity: updated });
      toast.show(archived ? 'Event archived' : 'Event un-archived');
    } catch (err) {
      fail(err);
    }
  };

  const restoreSession = async (id: number) => {
    try {
      data.apply({ type: 'session.created', entity: await api.restoreSession(slug, id) });
      toast.show('Session restored');
      await loadTrash();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'room_missing') {
        toast.show('That session’s room was deleted — recreate the room first, then restore.');
      } else {
        fail(err);
      }
    }
  };

  const restoreContribution = async (id: number) => {
    try {
      data.apply({ type: 'contribution.created', entity: await api.restoreContribution(slug, id) });
      toast.show('Contribution restored');
      await loadTrash();
    } catch (err) {
      fail(err);
    }
  };

  const trashEmpty =
    trash !== null && trash.sessions.length === 0 && trash.contributions.length === 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(`/e/${slug}`)}
          className={`text-xs ${linkClass}`}
        >
          ← Schedule
        </button>
        <h1 className="text-lg font-semibold tracking-tight">Manage {event.name}</h1>
      </div>

      {/* Manage is seven unrelated jobs on one page. Tabs keep each of them a
          screenful, and the choice lives in the URL so a reload — or a link
          sent to a co-organiser — lands on the same one. */}
      <div
        role="tablist"
        aria-label="Manage sections"
        className="mb-6 flex flex-wrap gap-0.5 rounded-lg border border-stone-300 bg-white p-0.5 dark:border-stone-600 dark:bg-stone-900"
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`admin-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`admin-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (step === 0) return;
              e.preventDefault();
              const next = TABS[(i + step + TABS.length) % TABS.length]!;
              setTab(next.id);
              document.getElementById(`admin-tab-${next.id}`)?.focus();
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === t.id
                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'programme' && (
        <div role="tabpanel" id="admin-panel-programme" aria-labelledby="admin-tab-programme">
          <AdminRooms
            rooms={bundle.rooms}
            reordering={reordering}
            onCreate={addRoom}
            onPatch={patchRoom}
            onMove={moveRoom}
            onDelete={removeRoom}
          />

          <Section
            title="Tracks"
            description="Thematic strands running across rooms and days. Optional — with none, the schedule lays its columns out by room and never mentions them. Their order is the order of the columns."
            className="mb-6"
          >
            <FormStack>
              {bundle.tracks.length > 0 && (
                <ul className="space-y-2">
                  {bundle.tracks.map((track, index) => (
                    <li
                      key={track.id}
                      className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800"
                    >
                      <div className="flex shrink-0">
                        <IconButton
                          onClick={() => void moveTrack(index, -1)}
                          disabled={index === 0 || movingTracks}
                          aria-label={`Move ${track.name} up`}
                        >
                          ↑
                        </IconButton>
                        <IconButton
                          onClick={() => void moveTrack(index, 1)}
                          disabled={index === bundle.tracks.length - 1 || movingTracks}
                          aria-label={`Move ${track.name} down`}
                        >
                          ↓
                        </IconButton>
                      </div>
                      <span
                        aria-hidden
                        className="h-5 w-5 shrink-0 rounded-full border border-stone-300 dark:border-stone-600"
                        style={{ background: track.color }}
                      />
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">
                        {track.name}
                        {track.description && (
                          <span className="font-normal text-stone-500 dark:text-stone-400">
                            {' · '}
                            {track.description}
                          </span>
                        )}
                      </p>
                      {track.startMin !== null && (
                        <span className="shrink-0 tabular-nums text-xs text-stone-500 dark:text-stone-400">
                          {windowLabel({ startMin: track.startMin, endMin: track.endMin ?? 1440 })}
                          {track.windows.length > 0 &&
                            ` +${plural(track.windows.length, DAYS)}`}
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
                        {plural(
                          bundle.sessions.filter((x) => x.trackId === track.id).length,
                          SESSIONS,
                        )}
                      </span>
                      <SecondaryButton
                        className="shrink-0 px-3 py-1.5"
                        onClick={() => setEditingTrack(track)}
                      >
                        Edit
                      </SecondaryButton>
                    </li>
                  ))}
                </ul>
              )}
              {bundle.tracks.length === 0 && (
                <p className="text-sm text-stone-400 dark:text-stone-500">
                  No tracks. Add one and the schedule gains a Room / Track switch.
                </p>
              )}

              <InlineCreate
                action="Add a track"
                fieldLabel="New track"
                submitLabel="Add track"
                maxLength={60}
                onSubmit={addTrack}
              />
            </FormStack>
          </Section>

          {editingTrack && (
            <TrackEditor
              track={editingTrack}
              sessions={bundle.sessions.filter((x) => x.trackId === editingTrack.id).length}
              days={dayList}
              onPatch={patchTrack}
              onDelete={removeTrack}
              onClose={() => setEditingTrack(null)}
            />
          )}

          <AdminBreaks
            breaks={bundle.breaks}
            days={dayList}
            onCreate={addBreak}
            onPatch={patchBreak}
            onDelete={removeBreak}
          />

          <Section
            title="Tags"
            description="Labels for sessions and pitches. Attendees filter the schedule by them."
            className="mb-6"
          >
            <ul className="mb-4 flex flex-wrap gap-2">
              {bundle.tags.map((tag) => (
                <li key={tag.id}>
                  {/* The tag as it is actually drawn on the schedule, and
                      pressing it is how you change it. A neutral pill with a
                      colour dot beside it showed the colour at a size nobody
                      could judge it at, and gave no hint that the row was a
                      way in to the editor. */}
                  <button
                    type="button"
                    onClick={() => setEditingTag(tag)}
                    title={`Edit ${tag.name}`}
                    style={{ background: tag.color, color: readableInk(tag.color) }}
                    className="rounded-full px-2.5 py-1 text-xs font-medium ring-offset-2 ring-offset-white hover:ring-2 hover:ring-stone-400 dark:ring-offset-stone-900"
                  >
                    {tag.name}
                    <span className="sr-only">— edit this tag</span>
                  </button>
                </li>
              ))}
              {bundle.tags.length === 0 && <li className="text-sm text-stone-400 dark:text-stone-500">No tags yet.</li>}
            </ul>
            <InlineCreate
              action="Add a tag"
              fieldLabel="New tag"
              submitLabel="Add tag"
              onSubmit={addTag}
            >
              {/* Inside, so the colour picker collapses with the tag it is for.
                  Left outside it would sit under a closed button, offering a
                  colour for nothing. */}
              <div className="mt-3">
                <ColorPicker
                  value={newTagColor}
                  onChange={setTagColor}
                  palette={TAG_COLORS}
                  label="New tag colour"
                  hint="Picked for you from the colours no tag is using yet. Change it here if you would rather choose."
                />
              </div>
            </InlineCreate>
          </Section>

          <Section
            title="Formats"
            description="What kind of thing a session is — a talk, a workshop, a panel. Picked at the top of the session form. It says what a session is, never how long it runs."
            className="mb-6"
          >
            <ul className="mb-4 flex flex-wrap gap-2">
              {bundle.formats.map((format) => (
                <li key={format.id}>
                  <button
                    type="button"
                    onClick={() => setEditingFormat(format)}
                    title={`Edit ${format.name}`}
                    style={{ background: format.color, color: readableInk(format.color) }}
                    className="rounded-full px-2.5 py-1 text-xs font-medium ring-offset-2 ring-offset-white hover:ring-2 hover:ring-stone-400 dark:ring-offset-stone-900"
                  >
                    {format.name}
                    <span className="sr-only">— edit this format</span>
                  </button>
                </li>
              ))}
              {bundle.formats.length === 0 && (
                <li className="text-sm text-stone-400 dark:text-stone-500">No formats yet.</li>
              )}
            </ul>

            {/* Suggestions rather than defaults: nothing is created until it is
                clicked, so an event that runs none of these — or invents its
                own — is not left deleting a dozen rows it never asked for.
                Each drops off the list once it exists. */}
            {suggestedFormats.length > 0 && (
              <div className="mb-4">
                <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
                  {bundle.formats.length === 0
                    ? 'Common ones, if any of them fit. Click to add.'
                    : 'More to add:'}
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {suggestedFormats.map((s) => (
                    <li key={s.name}>
                      <button
                        type="button"
                        title={s.hint}
                        onClick={() => void addFormat(s.name)}
                        className="rounded-full border border-dashed border-stone-300 px-2.5 py-1 text-xs text-stone-600 hover:border-stone-500 hover:text-stone-900 dark:border-stone-600 dark:text-stone-300 dark:hover:border-stone-400 dark:hover:text-stone-100"
                      >
                        + {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <InlineCreate
              action="Add a format"
              fieldLabel="New format"
              submitLabel="Add format"
              maxLength={40}
              onSubmit={addFormat}
            />
          </Section>

          {editingFormat && (
            <FormatEditor
              format={editingFormat}
              sessions={bundle.sessions.filter((x) => x.formatId === editingFormat.id).length}
              onPatch={patchFormat}
              onDelete={removeFormat}
              onClose={() => setEditingFormat(null)}
            />
          )}

          {editingTag && (
            <TagEditor
              tag={editingTag}
              sessions={bundle.sessions.filter((x) => x.tagIds.includes(editingTag.id)).length}
              pitches={bundle.proposals.filter((x) => x.tagIds.includes(editingTag.id)).length}
              onPatch={patchTag}
              onDelete={removeTag}
              onClose={() => setEditingTag(null)}
            />
          )}
        </div>
      )}

      {tab === 'people' && (
        <div role="tabpanel" id="admin-panel-people" aria-labelledby="admin-tab-people">
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
              hint="Creates a profile nobody holds yet — for a speaker you are putting on the programme before they arrive. They claim it at the gate, or with a speaker code."
              maxLength={120}
              onSubmit={addPerson}
            />
          </Section>
        </div>
      )}

      {tab === 'permissions' && (
        <div role="tabpanel" id="admin-panel-permissions" aria-labelledby="admin-tab-permissions">
          <AdminPermissions
            permissions={bundle.permissions as never}
            userRoleLabel={event.userRoleLabel}
            onChange={savePermissions}
            onUnlock={confirmAdmin}
          />
        </div>
      )}

      {tab === 'settings' && (
        <div role="tabpanel" id="admin-panel-settings" aria-labelledby="admin-tab-settings">
          <Section title="Event settings" className="mb-6">
            <FormStack>
            <Field label="Name">
              <ControlShell>
                <TextInput value={name} onChange={(e) => setName(e.target.value)} />
              </ControlShell>
            </Field>
            {/* Renaming an event is renaming its address, which sounds more
                dangerous than it is: roles are held against the event itself,
                not its slug, so nobody is signed out or demoted — and the old
                address goes on working rather than 404ing. The hint says both,
                because an organiser who does not know that will not touch
                this field. */}
            <Field
              label="Slug"
              hint={
                slugField && slugField !== event?.slug
                  ? `The event moves to /e/${slugField}. Everyone stays signed in with the role they have, and /e/${event?.slug} keeps working for links already shared.`
                  : `Used in the URL: /e/${slugField || event?.slug}`
              }
            >
              <ControlShell>
                <TextInput
                  value={slugField}
                  onChange={(e) => setSlugField(slugify(e.target.value))}
                />
              </ControlShell>
            </Field>
            <FormGrid>
              <Field label="Start date">
                <ControlShell>
                  <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </ControlShell>
              </Field>
              <Field label="End date">
                <ControlShell>
                  <TextInput type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
                </ControlShell>
              </Field>
              <Field label="Day starts">
                <ControlShell>
                  <TextInput type="time" step={300} value={dayStart} onChange={(e) => setDayStart(e.target.value)} />
                </ControlShell>
              </Field>
              <Field label="Day ends">
                <ControlShell>
                  <TextInput type="time" step={300} value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} />
                </ControlShell>
              </Field>
            </FormGrid>
            <NumberField
              label="Group days into weeks past"
              hint={`Up to this many days the schedule shows one row of day tabs. Longer than this and they split into a rail of weeks. This event runs ${plural(eventDays, DAYS)}.`}
              spec={weekRailFromField}
              value={weekRailFrom}
              onChange={setWeekRailFrom}
              suffix={
                parsedWeekRail.value === null
                  ? 'days'
                  : eventDays > parsedWeekRail.value
                    ? 'days · the rail is on for this event'
                    : 'days · one row of tabs for this event'
              }
            />
            <Field
              label="Opens in"
              hint="Which view someone gets who has not chosen one. The switch above the grid still works for everybody, and a view somebody picks travels in the link they share. The list reads well at any size; the grid earns its place once there are several rooms to compare."
            >
              <Select
                value={defaultView}
                onValueChange={(v) => setDefaultView(v === 'cal' ? 'cal' : 'list')}
              >
                <SelectTrigger aria-label="Opens in" className="w-48">
                  <SelectValue>
                    {(v: string | null) =>
                      v === 'cal' ? 'Calendar — a grid of rooms' : 'List — one column, in time order'
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list">List — one column, in time order</SelectItem>
                  <SelectItem value="cal">Calendar — a grid of rooms</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label="Mark the official programme"
              hint="Off by default. Turn it on where the schedule mixes an organiser's programme with sessions attendees put up themselves, and the difference is worth seeing at a glance. On an event where everything is official the badge says nothing, and on an open floor it is noise. A session's own panel always says which it is, either way."
            >
              <Toggle
                checked={showOfficialBadge}
                onChange={setShowOfficialBadge}
                label="Show an “Official” tag on grid blocks and list cards"
              />
            </Field>
            <NumberField
              label="Audit entries to keep"
              hint="The log in the Audit tab is append-only and nothing else prunes it. Past this many entries the oldest are dropped as new ones arrive. 0 keeps every entry forever."
              spec={auditKeepField}
              value={auditKeep}
              onChange={setAuditKeep}
              className="w-32"
              suffix={
                parsedAuditKeep.value === 0
                  ? 'entries · keeping everything'
                  : 'entries · older ones are dropped'
              }
            />
            <Field
              label="What you call your participants"
              hint="Shown on role badges and in prompts. “attendee”, “participant”, “member”…"
            >
              <ControlShell>
                <TextInput
                  value={userRoleLabel}
                  onChange={(e) => setUserRoleLabel(e.target.value)}
                  maxLength={24}
                />
              </ControlShell>
            </Field>

            <div className="mt-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                Change passwords
              </p>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Leave blank to keep the current one.
              </p>
            </div>
            <FormGrid cols={3}>
              <Field label="Viewer">
                <ControlShell>
                  <TextInput value={viewerPassword} onChange={(e) => setViewerPassword(e.target.value)} />
                </ControlShell>
              </Field>
              <Field label={userRoleLabel.trim() || 'User'}>
                <ControlShell>
                  <TextInput value={userPassword} onChange={(e) => setUserPassword(e.target.value)} />
                </ControlShell>
              </Field>
              <Field label="Admin">
                <ControlShell>
                  <TextInput value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                </ControlShell>
              </Field>
            </FormGrid>
            <div>
              {settingsProblem && <FormError className="mb-2">{settingsProblem}</FormError>}
              <PrimaryButton
                onClick={() => void saveSettings()}
                disabled={settingsProblem !== null}
              >
                Save settings
              </PrimaryButton>
            </div>
            </FormStack>
          </Section>

          <AdminInvite slug={slug} userRoleLabel={userRoleLabel.trim() || undefined} />

          <Section
            title="Duplicate Event/Conf"
            description="Rooms and tags carry over to the new event; sessions and contributions do not."
            className="mb-6"
            actions={
              <SecondaryButton
                className="shrink-0 py-1.5"
                onClick={() => setCloneOpen(!cloneOpen)}
                aria-expanded={cloneOpen}
              >
                {cloneOpen ? 'Close' : 'Duplicate…'}
              </SecondaryButton>
            }
          >
            {cloneOpen && (
              <FormStack>
              <Field label="New name">
                <ControlShell>
                  <TextInput value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
                </ControlShell>
              </Field>
              <Field
                label="New slug"
                hint={`Used in the URL: /e/${cloneSlugValue || 'your-event'}`}
              >
                <ControlShell>
                  <TextInput
                    value={cloneSlug}
                    onChange={(e) => setCloneSlug(slugify(e.target.value))}
                    placeholder={slugify(cloneName) || 'your-event'}
                  />
                </ControlShell>
              </Field>
              <FormGrid>
                <Field label="Start date">
                  <ControlShell>
                    <TextInput
                      type="date"
                      value={cloneStart}
                      onChange={(e) => {
                        setCloneStart(e.target.value);
                        if (cloneEnd < e.target.value) setCloneEnd(e.target.value);
                      }}
                    />
                  </ControlShell>
                </Field>
                <Field label="End date">
                  <ControlShell>
                    <TextInput
                      type="date"
                      value={cloneEnd}
                      min={cloneStart}
                      onChange={(e) => setCloneEnd(e.target.value)}
                    />
                  </ControlShell>
                </Field>
              </FormGrid>
              <div className="mt-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                  New passwords
                </p>
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">At least 6 characters each.</p>
              </div>
              <FormGrid cols={3}>
                <Field label="Viewer">
                  <ControlShell>
                    <TextInput value={cloneViewer} onChange={(e) => setCloneViewer(e.target.value)} />
                  </ControlShell>
                </Field>
                <Field label="User">
                  <ControlShell>
                    <TextInput value={cloneUser} onChange={(e) => setCloneUser(e.target.value)} />
                  </ControlShell>
                </Field>
                <Field label="Admin">
                  <ControlShell>
                    <TextInput value={cloneAdmin} onChange={(e) => setCloneAdmin(e.target.value)} />
                  </ControlShell>
                </Field>
              </FormGrid>
              <div>
                <PrimaryButton onClick={() => void cloneEvent()} disabled={!cloneReady || cloning}>
                  {cloning ? 'Duplicating…' : 'Duplicate Event/Conf'}
                </PrimaryButton>
              </div>
              </FormStack>
            )}
          </Section>

          <Section
            title="Archive"
            description="An archived event stays readable with the viewer password, but nobody can change anything."
          >
            {event.archived ? (
              <SecondaryButton onClick={() => void setArchived(false)}>Un-archive event</SecondaryButton>
            ) : (
              <SecondaryButton onClick={() => void setArchived(true)}>Archive event</SecondaryButton>
            )}
          </Section>
        </div>
      )}

      {tab === 'backup' && (
        <div role="tabpanel" id="admin-panel-backup" aria-labelledby="admin-tab-backup">
          <AdminBackup slug={slug} eventName={event.name} />
        </div>
      )}

      {tab === 'trash' && (
        <div role="tabpanel" id="admin-panel-trash" aria-labelledby="admin-tab-trash">
          <Section
            title="Trash"
            description="Deleted sessions and contributions. Restoring puts them back for everyone."
          >
            {trash === null ? (
              <p className="text-sm text-stone-400 dark:text-stone-500">Loading…</p>
            ) : trashEmpty ? (
              <p className="text-sm text-stone-400 dark:text-stone-500">Nothing has been deleted.</p>
            ) : (
              <div className="space-y-4">
                {trash.sessions.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                      Sessions
                    </h3>
                    <ul className="space-y-2">
                      {trash.sessions.map((s) => (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 dark:bg-stone-800 px-3 py-2"
                        >
                          <span className="min-w-32 flex-1 text-sm font-medium">{s.title}</span>
                          <span className="text-xs text-stone-400 dark:text-stone-500">
                            deleted {relativeTime(s.deletedAt)} · {s.deletedByName}
                          </span>
                          <SecondaryButton className="py-1" onClick={() => void restoreSession(s.id)}>
                            Restore
                          </SecondaryButton>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {trash.contributions.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                      Contributions
                    </h3>
                    <ul className="space-y-2">
                      {trash.contributions.map((c) => (
                        <li
                          key={c.id}
                          className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 dark:bg-stone-800 px-3 py-2"
                        >
                          <span className="min-w-32 flex-1 truncate text-sm">
                            <span className="text-stone-400 dark:text-stone-500">{c.kind}: </span>
                            {c.body}
                          </span>
                          <span className="text-xs text-stone-400 dark:text-stone-500">
                            deleted {relativeTime(c.deletedAt)} · {c.createdByName}
                          </span>
                          <SecondaryButton
                            className="py-1"
                            onClick={() => void restoreContribution(c.id)}
                          >
                            Restore
                          </SecondaryButton>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>
      )}

      {tab === 'audit' && (
        <div role="tabpanel" id="admin-panel-audit" aria-labelledby="admin-tab-audit">
          <AdminAudit slug={slug} auditKeep={event.auditKeep} />
        </div>
      )}
    </div>
  );
}

/**
 * Rename and recolour one tag. A modal rather than a borderless input in the
 * pill, for the reason `RoomRow` gives: an input that saves on blur advertises
 * nothing and offers no way back out. It also gives the name clash somewhere
 * to be reported — tag names are unique per event.
 */
/**
 * Rename, recolour or delete one format. Exactly the tag editor's shape,
 * because a format is exactly a tag's data — a name and a colour. It carries
 * no length: see migration 015.
 */
function FormatEditor({
  format,
  sessions,
  onPatch,
  onDelete,
  onClose,
}: {
  format: FormatDto;
  /** How many sessions call themselves this, so deleting is informed. */
  sessions: number;
  onPatch: (format: FormatDto, patch: Partial<FormatDto>) => Promise<boolean>;
  onDelete: (format: FormatDto) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(format.name);
  const [color, setColor] = useState(format.color);
  const [busy, setBusy] = useState(false);

  const dirty = name.trim() !== format.name || color !== format.color;

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (await onPatch(format, { name: name.trim(), color })) onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onDelete(format)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit format"
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <DangerButton className="me-auto" onClick={() => void remove()} disabled={busy}>
            Delete
          </DangerButton>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={!name.trim() || !dirty || busy}>
            Save
          </PrimaryButton>
        </>
      }
    >
      <FormStack>
        <Field label="Name">
          <ControlShell>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoFocus
            />
          </ControlShell>
        </Field>
        <ColorPicker
          value={color}
          onChange={setColor}
          palette={TAG_COLORS}
          label="Format colour"
        />
      </FormStack>

      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
        {sessions === 0
          ? 'No session calls itself this yet. Deleting it affects nothing.'
          : `${plural(sessions, SESSIONS)} call themselves this. Deleting the format leaves them where they are, without a kind.`}
      </p>
    </Modal>
  );
}

function TagEditor({
  tag,
  sessions,
  pitches,
  onPatch,
  onDelete,
  onClose,
}: {
  tag: TagDto;
  /** What carries this tag, so deleting it is an informed choice. */
  sessions: number;
  pitches: number;
  onPatch: (tag: TagDto, patch: Partial<TagDto>) => Promise<boolean>;
  onDelete: (tag: TagDto) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [busy, setBusy] = useState(false);

  const dirty = name.trim() !== tag.name || color !== tag.color;

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (await onPatch(tag, { name: name.trim(), color })) onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onDelete(tag)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit tag"
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <DangerButton className="me-auto" onClick={() => void remove()} disabled={busy}>
            Delete
          </DangerButton>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={!name.trim() || !dirty || busy}>
            Save
          </PrimaryButton>
        </>
      }
    >
      <FormStack>
        <Field label="Name">
          <ControlShell>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoFocus
            />
          </ControlShell>
        </Field>
        <ColorPicker
          value={color}
          onChange={setColor}
          palette={TAG_COLORS}
          label="Tag colour"
        />
      </FormStack>

      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
        {sessions + pitches === 0
          ? 'Nothing carries this tag yet. Deleting it affects nothing.'
          : `Carried by ${plural(sessions, SESSIONS)} and ${plural(pitches, PITCHES)}. Deleting the tag removes it from all of them.`}
      </p>
    </Modal>
  );
}

/**
 * Rename, recolour or delete one track. Same shape as the tag editor — a modal
 * rather than an input in the row, so there is something to cancel — but it
 * says what deleting costs, because a track's sessions survive it.
 */
/**
 * The hours half of the track editor: the window the track keeps on an ordinary
 * day, and the days that keep a different one.
 *
 * A per-day row *replaces* the default rather than trimming it, so "workshops
 * run mornings, except Saturday, when they have the afternoon" is one row and
 * not a special case. Only days without a row are offered, because two windows
 * on one date would have no defined winner.
 */
function TrackHoursFields({
  start,
  end,
  windows,
  days,
  onStart,
  onEnd,
  onWindows,
}: {
  start: string;
  end: string;
  windows: TrackWindowDto[];
  days: string[];
  onStart: (next: string) => void;
  onEnd: (next: string) => void;
  onWindows: (next: TrackWindowDto[]) => void;
}) {
  const taken = new Set(windows.map((w) => w.date));
  const free = days.filter((d) => !taken.has(d));
  const [day, setDay] = useState(free[0] ?? '');
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(end);

  const addDay = () => {
    if (!day || minutesOf(to) <= minutesOf(from)) return;
    const next = [
      ...windows,
      { date: day, startMin: snapMinute(minutesOf(from)), endMin: snapMinute(minutesOf(to)) },
    ].sort((a, b) => a.date.localeCompare(b.date));
    onWindows(next);
    setDay(free.filter((d) => d !== day)[0] ?? '');
  };

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
      <FormRow>
        <Field label="From">
          <ControlShell>
            <TextInput
              type="time"
              step={300}
              value={start}
              onChange={(e) => onStart(e.target.value)}
            />
          </ControlShell>
        </Field>
        <Field label="To" hint={minutesOf(end) > minutesOf(start) ? undefined : 'Must be later.'}>
          <ControlShell>
            <TextInput
              type="time"
              step={300}
              value={end}
              onChange={(e) => onEnd(e.target.value)}
            />
          </ControlShell>
        </Field>
      </FormRow>

      {windows.length > 0 && (
        <ul className="space-y-1.5">
          {windows.map((w) => (
            <li
              key={w.date}
              className="flex items-center gap-2 rounded-sm bg-stone-50 px-2 py-1.5 text-sm dark:bg-stone-800"
            >
              <span className="min-w-0 flex-1 truncate">{dayName(w.date)}</span>
              <span className="shrink-0 tabular-nums text-xs text-stone-500 dark:text-stone-400">
                {fmtMin(w.startMin)}–{fmtMin(w.endMin)}
              </span>
              <IconButton
                onClick={() => onWindows(windows.filter((x) => x.date !== w.date))}
                aria-label={`Drop the ${dayName(w.date)} hours`}
              >
                ×
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {free.length > 0 && (
        <FormRow>
          <Field label="A day that differs">
            <Select value={day} onValueChange={(v) => v != null && setDay(v)}>
              <SelectTrigger aria-label="Day">
                <SelectValue>{(v: string | null) => (v == null ? '' : dayName(v))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {free.map((d) => (
                  <SelectItem key={d} value={d}>
                    {dayName(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="From">
            <ControlShell>
              <TextInput
                type="time"
                step={300}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </ControlShell>
          </Field>
          <Field label="To">
            <ControlShell>
              <TextInput
                type="time"
                step={300}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </ControlShell>
          </Field>
          <SecondaryButton onClick={addDay} disabled={!day || minutesOf(to) <= minutesOf(from)}>
            Add day
          </SecondaryButton>
        </FormRow>
      )}
    </div>
  );
}

function TrackEditor({
  track,
  sessions,
  days,
  onPatch,
  onDelete,
  onClose,
}: {
  track: TrackDto;
  /** How many sessions sit on it. */
  sessions: number;
  /** Every date the event runs, for the per-day rows. */
  days: string[];
  onPatch: (track: TrackDto, patch: TrackWrite) => Promise<boolean>;
  onDelete: (track: TrackDto) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(track.name);
  const [description, setDescription] = useState(track.description);
  const [color, setColor] = useState(track.color);
  const [limited, setLimited] = useState(track.startMin !== null);
  const [start, setStart] = useState(fmtMin(track.startMin ?? 9 * 60));
  const [end, setEnd] = useState(fmtMin(track.endMin ?? 13 * 60));
  const [windows, setWindows] = useState<TrackWindowDto[]>(track.windows);
  const [busy, setBusy] = useState(false);

  const hours = limited
    ? { startMin: snapMinute(minutesOf(start)), endMin: snapMinute(minutesOf(end)) }
    : { startMin: null, endMin: null };
  const hoursValid = !limited || minutesOf(end) > minutesOf(start);

  const dirty =
    name.trim() !== track.name ||
    description.trim() !== track.description ||
    color !== track.color ||
    hours.startMin !== track.startMin ||
    hours.endMin !== track.endMin ||
    JSON.stringify(windows) !== JSON.stringify(track.windows);

  const save = async () => {
    if (!name.trim() || !hoursValid || busy) return;
    setBusy(true);
    try {
      if (
        await onPatch(track, {
          name: name.trim(),
          description: description.trim(),
          color,
          ...hours,
          windows,
        })
      ) {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onDelete(track)) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit track"
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <DangerButton className="me-auto" onClick={() => void remove()} disabled={busy}>
            Delete
          </DangerButton>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={!name.trim() || !dirty || !hoursValid || busy}>
            Save
          </PrimaryButton>
        </>
      }
    >
      <FormStack>
        <Field label="Name">
          <ControlShell>
            <TextInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              autoFocus
            />
          </ControlShell>
        </Field>
        <Field
          label="Description"
          hint="Shown to attendees behind the column's info button. What the strand is for, who it is aimed at."
        >
          <TextArea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
            className="resize-none"
          />
        </Field>
        <ColorPicker
          value={color}
          onChange={setColor}
          palette={ROOM_COLORS}
          label="Track colour"
          hint="Used for this track's column on the schedule. The washed-out palette is deliberate: a column is something text sits on."
        />

        <Toggle
          checked={limited}
          onChange={setLimited}
          label="Only takes sessions at certain hours"
        />
        {limited && (
          <TrackHoursFields
            start={start}
            end={end}
            windows={windows}
            days={days}
            onStart={setStart}
            onEnd={setEnd}
            onWindows={setWindows}
          />
        )}
      </FormStack>

      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
        {sessions === 0
          ? 'No sessions are on this track yet.'
          : `${plural(sessions, SESSIONS)} on this track. Deleting it keeps them — they lose the track, not their room.`}
      </p>
      {limited && sessions > 0 && (
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
          Sessions already on the track stay where they are, whatever these hours say — the window
          is a rule about what may be booked next. Organisers are never held to it.
        </p>
      )}
    </Modal>
  );
}
