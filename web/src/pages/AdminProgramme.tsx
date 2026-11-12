import { useState } from 'react';
import type { BreakDto, BundleDto, FormatDto, RoomDto, TagDto, TrackDto } from '@shared/types';
import { SUGGESTED_FORMATS } from '@shared/formats';
import { TAG_COLORS, nextTagColor, readableInk } from '@shared/tagColors';
import { windowLabel } from '@shared/trackHours';
import { api, type BreakWrite, type TrackWrite } from '../lib/api';
import { errorText } from '../lib/errorText';
import { plural } from '../lib/plural';
import type { EventData } from '../lib/useEventData';
import { ColorPicker } from '../components/ColorPicker';
import {
  FormStack,
  IconButton,
  InlineCreate,
  SecondaryButton,
  Section,
  useConfirm,
  useToast,
} from '../components/ui';
import { AdminBreaks } from './AdminBreaks';
import { FormatEditor, TagEditor, TrackEditor } from './AdminEditors';
import { AdminRooms, type RoomDraft } from './AdminRooms';
import { DAYS, SESSIONS } from './adminNouns';

/** The Programme tab: rooms, tracks, breaks, formats and tags — what a
 *  session can be put in and labelled with. */
export function AdminProgramme({
  slug,
  bundle,
  data,
}: {
  slug: string;
  bundle: BundleDto;
  data: EventData;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const event = bundle.event;
  const [reordering, setReordering] = useState(false);
  const [editingTag, setEditingTag] = useState<TagDto | null>(null);
  const [editingFormat, setEditingFormat] = useState<FormatDto | null>(null);
  const [editingTrack, setEditingTrack] = useState<TrackDto | null>(null);
  const [movingTracks, setMovingTracks] = useState(false);
  /** `null` means "whatever the palette offers next" — the field follows the
   *  tags that exist until someone picks a colour on purpose, and goes back to
   *  following them once the tag is added. */
  const [tagColor, setTagColor] = useState<string | null>(null);

  const fail = (err: unknown) => toast.show(errorText(err));

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

  return (
    <>
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
                    {plural(bundle.sessions.filter((x) => x.trackId === track.id).length, SESSIONS)}
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
    </>
  );
}
