import { plural } from '../lib/plural';
import { errorText } from '../lib/errorText';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { BreakDto, FormatDto, RoomDto, TagDto, TrackDto, ViewMode } from '@shared/types';
import { TAG_COLORS, nextTagColor, readableInk } from '@shared/tagColors';
import { SUGGESTED_FORMATS } from '@shared/formats';

import { ColorPicker } from '../components/ColorPicker';
import { windowLabel } from '@shared/trackHours';
import { ApiError, api, type BreakWrite, type TrackWrite, type TrashDto } from '../lib/api';
import { fmtMin, relativeTime } from '../lib/format';
import { useEventData } from '../lib/useEventData';
import { useMe } from '../lib/useMe';
import { EventBar } from '../components/EventBar';
import { TimeField } from '../components/TimeField';

import { PasswordNote } from '../components/PasswordNote';
import { TIER_NOTE } from '../../../server/src/shared/passwordAdvice';
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
import { AdminBreaks } from './AdminBreaks';
import { AdminRooms, type RoomDraft } from './AdminRooms';
import { AdminTelegram } from './AdminTelegram';
import { AdminNostr } from './AdminNostr';
import { AdminPermissions } from './AdminPermissions';
import { AdminSearch } from './AdminSearch';
import { ADMIN_TABS, type AdminSetting, type AdminTabId } from '../lib/adminSearch';
import { settingsChanged } from '../lib/settingsDraft';
import { AdminBackup } from './AdminBackup';
import { AdminAudit } from './AdminAudit';
import { AdminInvite } from './AdminInvite';
import { AdminPeople, usePeopleView } from './AdminPeople';
import { FormatEditor, TagEditor, TrackEditor } from './AdminEditors';
import { DAYS, SESSIONS } from './adminNouns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  ControlShell,
  EmptyState,
  Field,
  FormError,
  FormGrid,
  FormStack,
  IconButton,
  InlineCreate,
  NumberField,
  PrimaryButton,
  SecondaryButton,
  Section,
  Spinner,
  TextInput,
  Toggle,
  linkClass,
  useConfirm,
  useToast,
} from '../components/ui';

/** The tabs and everything findable inside them live together in one index, so
 *  the search box and the tab bar cannot disagree about what this page holds. */
const TABS = ADMIN_TABS;

type TabId = AdminTabId;

/** How long a jumped-to setting keeps its ring. Long enough to catch the eye
 *  after the scroll settles, short enough not to look like an error state. */
const FLASH_MS = 1800;

/**
 * Marks a setting so the search box can scroll to it and ring it.
 *
 * Declared here rather than inside `AdminPage` on purpose: a component defined
 * during render is a new type on every render, so React would unmount and
 * remount everything inside it — which in a form means losing focus and the
 * caret mid-word. `scroll-mt-24` keeps the scrolled-to field clear of the
 * sticky heading above it.
 */
function SettingAnchor({
  id,
  flashed,
  children,
}: {
  id: string;
  flashed: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      id={`setting-${id}`}
      className={`scroll-mt-24 rounded-xl transition-shadow duration-300 ${
        flashed === id ? 'ring-2 ring-highlight' : ''
      }`}
    >
      {children}
    </div>
  );
}

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
  const { me } = useMe();

  const [reordering, setReordering] = useState(false);
  const [editingTag, setEditingTag] = useState<TagDto | null>(null);
  const [editingFormat, setEditingFormat] = useState<FormatDto | null>(null);
  const [editingTrack, setEditingTrack] = useState<TrackDto | null>(null);
  const [movingTracks, setMovingTracks] = useState(false);
  /** `null` means "whatever the palette offers next" — the field follows the
   *  tags that exist until someone picks a colour on purpose, and goes back to
   *  following them once the tag is added. */
  const [tagColor, setTagColor] = useState<string | null>(null);
  const peopleView = usePeopleView();

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
  const [pitchesEnabled, setPitchesEnabled] = useState(true);
  const [userRoleLabel, setUserRoleLabel] = useState('');
  const [viewerPassword, setViewerPassword] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  // Holds the slug the settings form was filled from. Navigating from one
  // event's admin page to another's re-renders this same component instance,
  // so a plain boolean latch would leave the previous event's values in the
  // form.
  const [loadedForSlug, setLoadedForSlug] = useState<string | null>(null);

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

  /** The Settings form as the saved event has it — on first load, and again
   *  when an organiser leaves the tab choosing to drop their edits. */
  const loadSettingsFrom = useCallback((saved: NonNullable<typeof event>) => {
    setName(saved.name);
    setSlugField(saved.slug);
    setStartDate(saved.startDate);
    setEndDate(saved.endDate);
    setDayStart(fmtMin(saved.dayStartMin));
    setDayEnd(fmtMin(saved.dayEndMin));
    setWeekRailFrom(String(saved.weekRailFrom));
    setAuditKeep(String(saved.auditKeep));
    setDefaultView(saved.defaultView);
    setShowOfficialBadge(saved.showOfficialBadge);
    setPitchesEnabled(saved.pitchesEnabled);
    setUserRoleLabel(saved.userRoleLabel);
    setViewerPassword('');
    setUserPassword('');
    setAdminPassword('');
  }, []);

  /**
   * Edits on the Settings tab that no Save has sent. Everything else on this
   * page saves as you go — a room, a break, a permission switch — and this is
   * the one form with a Save button, so it is the one place leaving can lose
   * something. Meaningful only once the form has been loaded for this event.
   */
  const settingsDirty =
    event !== undefined &&
    loadedForSlug === event.slug &&
    settingsChanged(
      {
        name,
        slug: slugField,
        startDate,
        endDate,
        dayStart,
        dayEnd,
        weekRailFrom,
        auditKeep,
        defaultView,
        showOfficialBadge,
        pitchesEnabled,
        userRoleLabel,
        viewerPassword,
        userPassword,
        adminPassword,
      },
      event,
    );

  // A reload or a closed tab: the browser's own "leave site?" is the only
  // thing that can still stop it, and it shows only while asked to.
  useEffect(() => {
    if (!settingsDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [settingsDirty]);

  /**
   * Every way off the Settings tab goes through here: another tab, a search
   * result on another tab, the way back to the schedule. With unsaved edits it
   * asks, and leaving means dropping them — the form is put back to what is
   * saved, so the question is not asked again over a form nobody is editing.
   * The browser's own Back button is not covered: this app's router cannot
   * intercept it.
   */
  const confirmLeaveSettings = useCallback(async (): Promise<boolean> => {
    if (tab !== 'settings' || !settingsDirty || !event) return true;
    const ok = await confirm({
      title: 'Leave without saving?',
      body: 'The settings you changed have not been saved. Leave, and they go back to what is saved; stay, and press Save settings first.',
      confirmLabel: 'Leave without saving',
    });
    if (ok) loadSettingsFrom(event);
    return ok;
  }, [tab, settingsDirty, event, confirm, loadSettingsFrom]);

  const switchTab = useCallback(
    (next: TabId) => {
      if (next === tab) return;
      void confirmLeaveSettings().then((ok) => {
        if (ok) setTab(next);
      });
    },
    [tab, confirmLeaveSettings, setTab],
  );

  /**
   * Open a setting the search box found: switch to its tab, scroll to it, and
   * ring it for a moment.
   *
   * The ring is the point. Landing on the right tab still leaves an organiser
   * scanning a screenful of fields for the one they asked for, which is the
   * problem the search was meant to solve rather than move.
   */
  const [flashed, setFlashed] = useState<string | null>(null);
  useEffect(() => {
    if (flashed === null) return;
    const timer = setTimeout(() => setFlashed(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashed]);

  const openSetting = useCallback(
    (setting: AdminSetting) => {
      void confirmLeaveSettings().then((ok) => {
        if (!ok) return;
        setTab(setting.tab);
        const anchor = setting.anchor;
        if (anchor === undefined) return;
        // After paint: the tab it lives on has to be rendered before it can be
        // scrolled to.
        requestAnimationFrame(() => {
          document
            .getElementById(`setting-${anchor}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setFlashed(anchor);
        });
      });
    },
    [setTab, confirmLeaveSettings],
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
    loadSettingsFrom(event);
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

  /** Pitches nobody has placed yet — what turning the board off would hide. */
  const openPitches = bundle.proposals.filter((p) => p.placedSessionId === null).length;
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
      data.apply({
        type: 'format.updated',
        entity: await api.updateFormat(slug, format.id, patch),
      });
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
            (Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000,
          ) + 1,
        )
      : 1;

  /** Proves the organiser password before the permission matrix will move. */
  const confirmAdmin = async (password: string): Promise<boolean> => {
    try {
      await api.confirmAdmin(slug, password);
      return true;
    } catch (err) {
      toast.show(errorText(err, 'Could not check that password'));
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
  const settingsProblem = !name.trim()
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
        pitchesEnabled,
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
    <>
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-stone-50/95 backdrop-blur dark:border-stone-700 dark:bg-stone-900/95">
        {/* Every way off this page through the bar — the logo, the way back,
            the menu — asks the Settings tab's question first, the same one
            its own tabs ask. */}
        <EventBar
          slug={slug}
          bundle={bundle}
          me={me}
          ping={data.notificationPing}
          width="max-w-3xl"
          beforeLeave={confirmLeaveSettings}
          onSignOut={() => void api.logout(slug).then(() => navigate(`/e/${slug}`))}
        />
      </header>
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Manage {event.name}</h1>
          {/* Above the tabs, because it is the way past them: eight tabs is eight
            places a setting could be, and knowing what you want to change says
            nothing about which. */}
          <AdminSearch onPick={openSetting} />
        </div>

        {/* Manage is eight unrelated jobs on one page. Tabs keep each of them a
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
              onClick={() => switchTab(t.id)}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (step === 0) return;
                e.preventDefault();
                const next = TABS[(i + step + TABS.length) % TABS.length]!;
                switchTab(next.id);
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
                            {windowLabel({
                              startMin: track.startMin,
                              endMin: track.endMin ?? 1440,
                            })}
                            {track.windows.length > 0 && ` +${plural(track.windows.length, DAYS)}`}
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
                dayStartMin={event.dayStartMin}
                dayEndMin={event.dayEndMin}
                onPatch={patchTrack}
                onDelete={removeTrack}
                onClose={() => setEditingTrack(null)}
              />
            )}

            <AdminBreaks
              breaks={bundle.breaks}
              days={dayList}
              dayStartMin={event.dayStartMin}
              dayEndMin={event.dayEndMin}
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
                {bundle.tags.length === 0 && (
                  <li className="text-sm text-stone-400 dark:text-stone-500">No tags yet.</li>
                )}
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
            <AdminPeople slug={slug} bundle={bundle} data={data} view={peopleView} />
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
                <SettingAnchor id="name" flashed={flashed}>
                  <Field label="Name">
                    <ControlShell>
                      <TextInput value={name} onChange={(e) => setName(e.target.value)} />
                    </ControlShell>
                  </Field>
                </SettingAnchor>
                {/* Renaming an event is renaming its address, which sounds more
                dangerous than it is: roles are held against the event itself,
                not its slug, so nobody is signed out or demoted — and the old
                address goes on working rather than 404ing. The hint says both,
                because an organiser who does not know that will not touch
                this field. */}
                <SettingAnchor id="slug" flashed={flashed}>
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
                </SettingAnchor>
                <SettingAnchor id="when" flashed={flashed}>
                  <FormGrid>
                    <Field label="Start date">
                      <ControlShell>
                        <TextInput
                          type="date"
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                        />
                      </ControlShell>
                    </Field>
                    <Field label="End date">
                      <ControlShell>
                        <TextInput
                          type="date"
                          value={endDate}
                          min={startDate}
                          onChange={(e) => setEndDate(e.target.value)}
                        />
                      </ControlShell>
                    </Field>
                    <Field label="Day starts">
                      <TimeField
                        aria-label="Day starts"
                        className="w-full"
                        value={dayStart}
                        onChange={setDayStart}
                      />
                    </Field>
                    <Field label="Day ends">
                      <TimeField
                        aria-label="Day ends"
                        className="w-full"
                        value={dayEnd}
                        onChange={setDayEnd}
                      />
                    </Field>
                  </FormGrid>
                </SettingAnchor>
                <SettingAnchor id="week-rail" flashed={flashed}>
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
                </SettingAnchor>
                <SettingAnchor id="default-view" flashed={flashed}>
                  <Field
                    label="Default view"
                    hint="What someone sees before they pick a view. Everybody can still switch, and a chosen view travels in the link they share."
                  >
                    <Select
                      value={defaultView}
                      onValueChange={(v) => setDefaultView(v === 'cal' ? 'cal' : 'list')}
                    >
                      {/* Wide enough for the longest option in full: at w-48 both
                      ran under the chevron. */}
                      <SelectTrigger aria-label="Default view" className="w-72">
                        <SelectValue>
                          {(v: string | null) =>
                            v === 'cal'
                              ? 'Calendar — a grid of rooms'
                              : 'List — one column, in time order'
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="list">List — one column, in time order</SelectItem>
                        <SelectItem value="cal">Calendar — a grid of rooms</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </SettingAnchor>
                <SettingAnchor id="official-badge" flashed={flashed}>
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
                </SettingAnchor>
                <SettingAnchor id="pitches" flashed={flashed}>
                  <Field
                    label="Pitch board"
                    hint="The unconference half: anyone proposes a session with no room or time, the room registers interest, and you place the popular ones on the grid. An event with a fixed programme turns it off and the button, the page and the pitch form all go. Turning it off hides the board, it never deletes it — the pitches, their interest and anything already placed from them keep, and come back untouched if you turn it on again."
                  >
                    <Toggle
                      checked={pitchesEnabled}
                      onChange={setPitchesEnabled}
                      label="Let people pitch sessions"
                    />
                    {!pitchesEnabled && openPitches > 0 && (
                      <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                        {plural(openPitches, { one: 'pitch is', other: 'pitches are' })} on the
                        board and will be hidden, not deleted.
                      </p>
                    )}
                  </Field>
                </SettingAnchor>
                <SettingAnchor id="audit-keep" flashed={flashed}>
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
                </SettingAnchor>
                <SettingAnchor id="role-label" flashed={flashed}>
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
                </SettingAnchor>

                <SettingAnchor id="passwords" flashed={flashed}>
                  <div className="mt-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                      Change passwords
                    </p>
                    <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                      Leave blank to keep the current one.
                    </p>
                  </div>
                  <FormGrid cols={3}>
                    <Field label="Viewer" hint={TIER_NOTE.viewer}>
                      <ControlShell>
                        <TextInput
                          value={viewerPassword}
                          onChange={(e) => setViewerPassword(e.target.value)}
                        />
                      </ControlShell>
                      <PasswordNote password={viewerPassword} name={name} slug={slug} />
                    </Field>
                    <Field label={userRoleLabel.trim() || 'User'} hint={TIER_NOTE.user}>
                      <ControlShell>
                        <TextInput
                          value={userPassword}
                          onChange={(e) => setUserPassword(e.target.value)}
                        />
                      </ControlShell>
                      <PasswordNote password={userPassword} name={name} slug={slug} />
                    </Field>
                    <Field label="Admin" hint={TIER_NOTE.admin}>
                      <ControlShell>
                        <TextInput
                          value={adminPassword}
                          onChange={(e) => setAdminPassword(e.target.value)}
                        />
                      </ControlShell>
                      <PasswordNote password={adminPassword} name={name} slug={slug} />
                    </Field>
                  </FormGrid>
                </SettingAnchor>
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

            <SettingAnchor id="invite" flashed={flashed}>
              <AdminInvite slug={slug} userRoleLabel={userRoleLabel.trim() || undefined} />
            </SettingAnchor>

            <SettingAnchor id="archive" flashed={flashed}>
              <Section
                title="Archive"
                description="An archived event stays readable with the viewer password, but nobody can change anything."
              >
                {event.archived ? (
                  <SecondaryButton onClick={() => void setArchived(false)}>
                    Un-archive event
                  </SecondaryButton>
                ) : (
                  <SecondaryButton onClick={() => void setArchived(true)}>
                    Archive event
                  </SecondaryButton>
                )}
              </Section>
            </SettingAnchor>
          </div>
        )}

        {/* Everywhere the schedule goes that is not this app. One connection
          today; the next one lands beside it rather than growing Settings. */}
        {tab === 'publish' && (
          <div role="tabpanel" id="admin-panel-publish" aria-labelledby="admin-tab-publish">
            <SettingAnchor id="telegram" flashed={flashed}>
              <AdminTelegram
                slug={slug}
                event={event}
                sessions={bundle.sessions}
                rooms={bundle.rooms}
                tracks={bundle.tracks}
                formats={bundle.formats}
                tags={bundle.tags}
              />
            </SettingAnchor>
            <SettingAnchor id="nostr" flashed={flashed}>
              <AdminNostr slug={slug} />
            </SettingAnchor>
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
                <p className="text-sm text-stone-400 dark:text-stone-500">
                  Nothing has been deleted.
                </p>
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
                            <SecondaryButton
                              className="py-1"
                              onClick={() => void restoreSession(s.id)}
                            >
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
    </>
  );
}
