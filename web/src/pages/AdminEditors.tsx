import { useState } from 'react';
import type { FormatDto, TagDto, TrackDto, TrackWindowDto } from '@shared/types';
import { ROOM_COLORS } from '@shared/roomColors';
import { TAG_COLORS } from '@shared/tagColors';
import type { TrackWrite } from '../lib/api';
import { fmtMin, minutesOf, snapMinute } from '../lib/format';
import { plural } from '../lib/plural';
import { ColorPicker } from '../components/ColorPicker';
import { Modal } from '../components/Modal';
import { TimeField } from '../components/TimeField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  ControlShell,
  DangerButton,
  Field,
  FormRow,
  FormStack,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  TextArea,
  TextInput,
  Toggle,
} from '../components/ui';
import { dayName } from './AdminBreaks';
import { PITCHES, SESSIONS } from './adminNouns';

/**
 * Rename, recolour or delete one format. Exactly the tag editor's shape,
 * because a format is exactly a tag's data — a name and a colour. It carries
 * no length: see migration 015.
 */
export function FormatEditor({
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
        <ColorPicker value={color} onChange={setColor} palette={TAG_COLORS} label="Format colour" />
      </FormStack>

      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
        {sessions === 0
          ? 'No session calls itself this yet. Deleting it affects nothing.'
          : `${plural(sessions, SESSIONS)} call themselves this. Deleting the format leaves them where they are, without a kind.`}
      </p>
    </Modal>
  );
}

/**
 * Rename and recolour one tag. A modal rather than a borderless input in the
 * pill, for the reason `RoomRow` gives: an input that saves on blur advertises
 * nothing and offers no way back out. It also gives the name clash somewhere
 * to be reported — tag names are unique per event.
 */
export function TagEditor({
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
        <ColorPicker value={color} onChange={setColor} palette={TAG_COLORS} label="Tag colour" />
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
 *
 * The row for adding one is a button until pressed. Most tracks never need it,
 * and its three fields sat open under every track's hours as if they did.
 */
function TrackHoursFields({
  start,
  end,
  windows,
  days,
  dayStartMin,
  dayEndMin,
  onStart,
  onEnd,
  onWindows,
}: {
  start: string;
  end: string;
  windows: TrackWindowDto[];
  days: string[];
  /** The event's day: a track's hours cannot reach outside it. */
  dayStartMin: number;
  dayEndMin: number;
  onStart: (next: string) => void;
  onEnd: (next: string) => void;
  onWindows: (next: TrackWindowDto[]) => void;
}) {
  const taken = new Set(windows.map((w) => w.date));
  const free = days.filter((d) => !taken.has(d));
  const [adding, setAdding] = useState(false);
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
    // Back to the button: the row just added is now in the list above it.
    setAdding(false);
  };

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
      <FormRow>
        <Field label="From">
          <TimeField
            aria-label="From"
            value={start}
            onChange={onStart}
            min={dayStartMin}
            max={dayEndMin}
          />
        </Field>
        <Field label="To" hint={minutesOf(end) > minutesOf(start) ? undefined : 'Must be later.'}>
          <TimeField
            aria-label="To"
            value={end}
            onChange={onEnd}
            min={dayStartMin}
            max={dayEndMin}
          />
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

      {/* A button until it is wanted. Most tracks keep one window every day,
          and three empty fields and an Add day under every track's hours said
          otherwise — the row is a question, and it is asked when pressed. */}
      {free.length > 0 && !adding && (
        <SecondaryButton
          className="px-3 py-1.5"
          onClick={() => setAdding(true)}
          aria-expanded={false}
        >
          + A day that differs
        </SecondaryButton>
      )}
      {free.length > 0 && adding && (
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
            <TimeField
              aria-label="From"
              value={from}
              onChange={setFrom}
              min={dayStartMin}
              max={dayEndMin}
            />
          </Field>
          <Field label="To">
            <TimeField
              aria-label="To"
              value={to}
              onChange={setTo}
              min={dayStartMin}
              max={dayEndMin}
            />
          </Field>
          <SecondaryButton onClick={addDay} disabled={!day || minutesOf(to) <= minutesOf(from)}>
            Add day
          </SecondaryButton>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-xs font-medium text-stone-500 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
          >
            Cancel
          </button>
        </FormRow>
      )}
    </div>
  );
}

export function TrackEditor({
  track,
  sessions,
  days,
  dayStartMin,
  dayEndMin,
  onPatch,
  onDelete,
  onClose,
}: {
  track: TrackDto;
  /** How many sessions sit on it. */
  sessions: number;
  /** Every date the event runs, for the per-day rows. */
  days: string[];
  dayStartMin: number;
  dayEndMin: number;
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
            dayStartMin={dayStartMin}
            dayEndMin={dayEndMin}
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
