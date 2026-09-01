import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type {
  BreakDto,
  PersonDto,
  RoomDto,
  TagDto,
  TrackDto,
  TrackWindowDto,
  ViewMode,
} from '@shared/types';
import { ROOM_COLORS } from '@shared/roomColors';
import { TAG_COLORS, nextTagColor, readableInk } from '@shared/tagColors';

import { ColorPicker } from '../components/ColorPicker';
import { windowLabel } from '@shared/trackHours';
import { ApiError, api, type BreakWrite, type TrackWrite, type TrashDto } from '../lib/api';
import { fmtMin, minutesOf, relativeTime, rowId, snapMinute, uid } from '../lib/format';
import { useEventData } from '../lib/useEventData';
import { AdminBreaks, dayName } from './AdminBreaks';
import { AdminRooms, type RoomDraft } from './AdminRooms';
import { AdminPermissions } from './AdminPermissions';
import { AdminBackup } from './AdminBackup';
import { AdminAudit } from './AdminAudit';
import { AdminAttendees } from './AdminAttendees';
import { AdminInvite } from './AdminInvite';
import {
  DangerButton,
  Modal,
  EmptyState,
  Field,
  FormGrid,
  FormRow,
  FormStack,
  IconButton,
  PrimaryButton,
  RoleBadge,
  SecondaryButton,
  Section,
  Spinner,
  Toggle,
  inputClass,
  linkClass,
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

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

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
  const [searchParams, setSearchParams] = useSearchParams();
  const data = useEventData(slug);

  const [reordering, setReordering] = useState(false);
  const [tagName, setTagName] = useState('');
  const [editingTag, setEditingTag] = useState<TagDto | null>(null);
  const [trackName, setTrackName] = useState('');
  const [editingTrack, setEditingTrack] = useState<TrackDto | null>(null);
  const [movingTracks, setMovingTracks] = useState(false);
  /** `null` means "whatever the palette offers next" — the field follows the
   *  tags that exist until someone picks a colour on purpose, and goes back to
   *  following them once the tag is added. */
  const [tagColor, setTagColor] = useState<string | null>(null);
  const [personName, setPersonName] = useState('');

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
      toast.show((err as Error).message);
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

  const fail = (err: unknown) => toast.show((err as Error).message);

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
    if (!window.confirm(`Delete “${room.name}”?`)) return;
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
  const newTagColor = tagColor ?? suggestedTagColor;

  const addTag = async () => {
    if (!tagName.trim()) return;
    try {
      const created = await api.createTag(slug, { name: tagName.trim(), color: newTagColor });
      data.apply({ type: 'tag.created', entity: created });
      setTagName('');
      setTagColor(null);
    } catch (err) {
      fail(err);
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

  const addTrack = async () => {
    if (!trackName.trim()) return;
    try {
      const created = await api.createTrack(slug, { name: trackName.trim() });
      data.apply({ type: 'track.created', entity: created });
      setTrackName('');
    } catch (err) {
      fail(err);
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
    if (
      !window.confirm(
        `Delete the “${track.name}” track? Its sessions keep their room and lose the track.`,
      )
    ) {
      return false;
    }
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
    if (!window.confirm(`Delete the “${tag.name}” tag? It will be removed from every session.`)) {
      return false;
    }
    try {
      await api.deleteTag(slug, tag.id);
      data.apply({ type: 'tag.deleted', entity: { id: tag.id } });
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  const addPerson = async () => {
    if (!personName.trim()) return;
    try {
      const created = await api.createPerson(slug, { name: personName.trim() });
      data.apply({ type: 'person.created', entity: created });
      setPersonName('');
    } catch (err) {
      fail(err);
    }
  };

  const removePerson = async (person: PersonDto) => {
    if (
      !window.confirm(
        `Delete ${person.name}? Their sessions keep their slot but lose the speaker.`,
      )
    ) {
      return;
    }
    try {
      await api.deletePerson(slug, person.id);
      data.apply({ type: 'person.deleted', entity: { id: person.id } });
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
        err instanceof ApiError ? err.message : 'Could not check that password',
      );
      return false;
    }
  };

  const saveSettings = async () => {
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
        weekRailFrom: Number(weekRailFrom) || 8,
        auditKeep: Number(auditKeep),
        defaultView,
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
    if (archived && !window.confirm('Archive this event? It becomes read-only for everyone.')) {
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
                            ` +${plural(track.windows.length, 'day')}`}
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-stone-500 dark:text-stone-400">
                        {plural(
                          bundle.sessions.filter((x) => x.trackId === track.id).length,
                          'session',
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

              <FormRow>
                <div className="min-w-40 flex-1">
                  <Field label="New track">
                    <input
                      value={trackName}
                      onChange={(e) => setTrackName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void addTrack()}
                      maxLength={60}
                      className={inputClass}
                    />
                  </Field>
                </div>
                <PrimaryButton onClick={() => void addTrack()} disabled={!trackName.trim()}>
                  Add track
                </PrimaryButton>
              </FormRow>
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
            <FormRow>
              <div className="min-w-40 flex-1">
                <Field label="New tag">
                  <input
                    value={tagName}
                    onChange={(e) => setTagName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void addTag()}
                    className={inputClass}
                  />
                </Field>
              </div>
              <PrimaryButton onClick={() => void addTag()} disabled={!tagName.trim()}>
                Add tag
              </PrimaryButton>
            </FormRow>
            <div className="mt-3">
              <ColorPicker
                value={newTagColor}
                onChange={setTagColor}
                palette={TAG_COLORS}
                label="New tag colour"
                hint="Picked for you from the colours no tag is using yet. Change it here if you would rather choose."
              />
            </div>
          </Section>

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
          <Section
            title="People"
            description="Speaker and host profiles, with the role each holder has at this event. Anyone can claim their own from the schedule; organisers hand out a speaker code for the rest."
          >
            <ul className="mb-4 space-y-2">
              {bundle.people.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 dark:bg-stone-800 px-3 py-2"
                >
                  <span className="min-w-32 flex-1 text-sm font-medium">
                    {person.name}
                    <span className="ml-1.5 font-mono text-xs font-normal text-stone-400 dark:text-stone-500">
                      ({rowId(person.id)})
                    </span>
                  </span>
                  {/* Three things an organiser acts on differently: nobody
                      has this profile; somebody has it, at some role; or the
                      code minted for it has never been redeemed — which
                      `claimed` cannot say, since minting claims the profile
                      the moment the phrase is printed. */}
                  {person.role != null && (
                    <RoleBadge role={person.role} userLabel={event.userRoleLabel} />
                  )}
                  {!person.claimed && (
                    <span className="rounded-full border border-dashed border-stone-300 px-2 py-0.5 text-xs text-stone-500 dark:border-stone-600 dark:text-stone-400">
                      unclaimed
                    </span>
                  )}
                  {person.holderUid != null && (
                    <span
                      title="Identity holding this profile — the same at every event on this instance"
                      className="font-mono text-xs text-stone-400 dark:text-stone-500"
                    >
                      ({uid(person.holderUid)})
                    </span>
                  )}
                  {person.codePending === true && (
                    <span
                      title="A speaker code was minted for them and has never been redeemed."
                      className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    >
                      code unused
                    </span>
                  )}
                  <Link
                    to={`/e/${slug}/p/${person.id}`}
                    className="shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:border-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-400"
                  >
                    Edit
                  </Link>
                  <DangerButton className="shrink-0 px-3 py-1.5" onClick={() => void removePerson(person)}>
                    Delete
                  </DangerButton>
                </li>
              ))}
              {bundle.people.length === 0 && (
                <li className="text-sm text-stone-400 dark:text-stone-500">No people yet.</li>
              )}
            </ul>
            <FormRow>
              <div className="min-w-40 flex-1">
                <Field label="New person">
                  <input
                    value={personName}
                    onChange={(e) => setPersonName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void addPerson()}
                    maxLength={120}
                    className={inputClass}
                  />
                </Field>
              </div>
              <PrimaryButton onClick={() => void addPerson()} disabled={!personName.trim()}>
                Add person
              </PrimaryButton>
            </FormRow>
          </Section>
          <AdminAttendees slug={slug} userLabel={event.userRoleLabel} />
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
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
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
              <input
                value={slugField}
                onChange={(e) => setSlugField(slugify(e.target.value))}
                className={inputClass}
              />
            </Field>
            <FormGrid>
              <Field label="Start date">
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
              </Field>
              <Field label="End date">
                <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Day starts">
                <input type="time" step={300} value={dayStart} onChange={(e) => setDayStart(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Day ends">
                <input type="time" step={300} value={dayEnd} onChange={(e) => setDayEnd(e.target.value)} className={inputClass} />
              </Field>
            </FormGrid>
            <Field
              label="Group days into weeks past"
              hint={`Up to this many days the schedule shows one row of day tabs. Longer than this and they split into a rail of weeks. This event runs ${eventDays} day${eventDays === 1 ? '' : 's'}.`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={weekRailFrom}
                  onChange={(e) => setWeekRailFrom(e.target.value)}
                  className={`${inputClass} w-24`}
                />
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  days
                  {eventDays > (Number(weekRailFrom) || 8)
                    ? ' · the rail is on for this event'
                    : ' · one row of tabs for this event'}
                </span>
              </div>
            </Field>
            <Field
              label="Opens in"
              hint="Which view someone gets who has not chosen one. The switch above the grid still works for everybody, and a view somebody picks travels in the link they share. The list reads well at any size; the grid earns its place once there are several rooms to compare."
            >
              <select
                value={defaultView}
                onChange={(e) => setDefaultView(e.target.value === 'cal' ? 'cal' : 'list')}
                className={`${inputClass} w-48`}
              >
                <option value="list">List — one column, in time order</option>
                <option value="cal">Calendar — a grid of rooms</option>
              </select>
            </Field>
            <Field
              label="Audit entries to keep"
              hint="The log in the Audit tab is append-only and nothing else prunes it. Past this many entries the oldest are dropped as new ones arrive. 0 keeps every entry forever."
            >
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={1000000}
                  step={100}
                  value={auditKeep}
                  onChange={(e) => setAuditKeep(e.target.value)}
                  className={`${inputClass} w-32`}
                />
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {Number(auditKeep) === 0
                    ? 'entries · keeping everything'
                    : 'entries · older ones are dropped'}
                </span>
              </div>
            </Field>
            <Field
              label="What you call your participants"
              hint="Shown on role badges and in prompts. “attendee”, “participant”, “member”…"
            >
              <input
                value={userRoleLabel}
                onChange={(e) => setUserRoleLabel(e.target.value)}
                maxLength={24}
                className={inputClass}
              />
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
                <input value={viewerPassword} onChange={(e) => setViewerPassword(e.target.value)} className={inputClass} />
              </Field>
              <Field label={userRoleLabel.trim() || 'User'}>
                <input value={userPassword} onChange={(e) => setUserPassword(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Admin">
                <input value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className={inputClass} />
              </Field>
            </FormGrid>
            <div>
              <PrimaryButton onClick={() => void saveSettings()}>Save settings</PrimaryButton>
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
                <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} className={inputClass} />
              </Field>
              <Field
                label="New slug"
                hint={`Used in the URL: /e/${cloneSlugValue || 'your-event'}`}
              >
                <input
                  value={cloneSlug}
                  onChange={(e) => setCloneSlug(slugify(e.target.value))}
                  placeholder={slugify(cloneName) || 'your-event'}
                  className={inputClass}
                />
              </Field>
              <FormGrid>
                <Field label="Start date">
                  <input
                    type="date"
                    value={cloneStart}
                    onChange={(e) => {
                      setCloneStart(e.target.value);
                      if (cloneEnd < e.target.value) setCloneEnd(e.target.value);
                    }}
                    className={inputClass}
                  />
                </Field>
                <Field label="End date">
                  <input
                    type="date"
                    value={cloneEnd}
                    min={cloneStart}
                    onChange={(e) => setCloneEnd(e.target.value)}
                    className={inputClass}
                  />
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
                  <input value={cloneViewer} onChange={(e) => setCloneViewer(e.target.value)} className={inputClass} />
                </Field>
                <Field label="User">
                  <input value={cloneUser} onChange={(e) => setCloneUser(e.target.value)} className={inputClass} />
                </Field>
                <Field label="Admin">
                  <input value={cloneAdmin} onChange={(e) => setCloneAdmin(e.target.value)} className={inputClass} />
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
          <DangerButton className="mr-auto" onClick={() => void remove()} disabled={busy}>
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
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className={inputClass}
            autoFocus
          />
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
          : `Carried by ${plural(sessions, 'session')} and ${plural(pitches, 'pitch', 'pitches')}. Deleting the tag removes it from all of them.`}
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
          <input
            type="time"
            step={300}
            value={start}
            onChange={(e) => onStart(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="To" hint={minutesOf(end) > minutesOf(start) ? undefined : 'Must be later.'}>
          <input
            type="time"
            step={300}
            value={end}
            onChange={(e) => onEnd(e.target.value)}
            className={inputClass}
          />
        </Field>
      </FormRow>

      {windows.length > 0 && (
        <ul className="space-y-1.5">
          {windows.map((w) => (
            <li
              key={w.date}
              className="flex items-center gap-2 rounded bg-stone-50 px-2 py-1.5 text-sm dark:bg-stone-800"
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
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className={inputClass}
              aria-label="Day"
            >
              {free.map((d) => (
                <option key={d} value={d}>
                  {dayName(d)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input
              type="time"
              step={300}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="To">
            <input
              type="time"
              step={300}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
            />
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
          <DangerButton className="mr-auto" onClick={() => void remove()} disabled={busy}>
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
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field
          label="Description"
          hint="Shown to attendees behind the column's info button. What the strand is for, who it is aimed at."
        >
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
            className={`${inputClass} resize-none`}
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
          : `${plural(sessions, 'session')} on this track. Deleting it keeps them — they lose the track, not their room.`}
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
