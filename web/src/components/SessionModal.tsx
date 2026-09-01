import { useMemo, useState } from 'react';
import type { PersonDto, RoomDto, Role, SessionDto, TagDto, TrackDto } from '@shared/types';
import { windowLabel, windowOn } from '@shared/trackHours';
import type { SessionWrite } from '../lib/api';
import { fmtMin, place } from '../lib/format';
import {
  checkRepeat,
  MAX_REPEAT_DAYS,
  repeatDates,
  weekdayOf,
  WEEKDAY_LABELS,
  WEEKDAYS_MONDAY_FIRST,
  type Repeat,
  type Weekday,
} from '@shared/repeat';
import { zonedTimeToUtc } from '@shared/time';
import { RemoveIcon } from './icons';
import { SpeakerCombobox, type SpeakerChoice } from './SpeakerCombobox';
import {
  Chip,
  DangerButton,
  Field,
  FieldGroup,
  FormError,
  FormGrid,
  HelpButton,
  HelpNote,
  Modal,
  PrimaryButton,
  SecondaryButton,
  Toggle,
  inputClass,
} from './ui';

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

export interface SessionModalProps {
  session?: SessionDto;
  rooms: RoomDto[];
  tags: TagDto[];
  /** Empty when the event defines none; the Track field is then absent. */
  tracks: TrackDto[];
  people: PersonDto[];
  role: Role;
  timezone: string;
  days: string[];
  dayLabels: Record<string, string>;
  defaultDay: string;
  dayStartMin: number;
  dayEndMin: number;
  saving: boolean;
  onCancel: () => void;
  /** `repeat` asks for the same session on every day of a run. What comes back
   *  is that many independent sessions — see `shared/repeat.ts`. */
  onSave: (body: SessionWrite, repeat?: Repeat) => void;
  onDelete?: () => void;
}

export function SessionModal({
  session,
  rooms,
  tags,
  tracks,
  people,
  role,
  timezone,
  days,
  dayLabels,
  defaultDay,
  dayStartMin,
  dayEndMin,
  saving,
  onCancel,
  onSave,
  onDelete,
}: SessionModalProps) {
  const isAdmin = role === 'admin';
  // Users may only place sessions in rooms that allow booking (SPEC §5.1).
  const allowedRooms = useMemo(
    () => (isAdmin ? rooms : rooms.filter((r) => r.openBooking)),
    [isAdmin, rooms],
  );

  const existing = session ? place(session, timezone) : null;
  const [title, setTitle] = useState(session?.title ?? '');
  const [speakers, setSpeakers] = useState<SpeakerChoice[]>(
    () => session?.speakers.map((p) => p.id) ?? [],
  );
  const [description, setDescription] = useState(session?.description ?? '');
  const [livestreamUrl, setLivestreamUrl] = useState(session?.livestreamUrl ?? '');
  const [roomId, setRoomId] = useState<number>(session?.roomId ?? allowedRooms[0]?.id ?? 0);
  const [day, setDay] = useState(existing?.date ?? defaultDay);
  const [start, setStart] = useState(fmtMin(existing?.startMin ?? Math.max(dayStartMin, 14 * 60)));
  const [durMin, setDurMin] = useState(existing?.durMin ?? 30);
  const [tagIds, setTagIds] = useState<number[]>(session?.tagIds ?? []);
  const [typeHelp, setTypeHelp] = useState(false);
  const [trackId, setTrackId] = useState<number | null>(session?.trackId ?? null);
  const [type, setType] = useState<'official' | 'open'>(
    session?.type ?? (isAdmin ? 'official' : 'open'),
  );
  const [blocksOpenBooking, setBlocksOpenBooking] = useState(session?.blocksOpenBooking ?? false);
  const [blockHelp, setBlockHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server refuses a hold on an open session rather than quietly dropping
  // it, so the form never offers the combination: switching the type to open
  // takes the hold with it, visibly, while the box is still on screen.
  const holdsFloor = isAdmin && type === 'official' && blocksOpenBooking;

  // Repeating is for building a programme, so it belongs to organisers and to
  // sessions that do not exist yet. Editing one day of a run edits that day:
  // the sessions a run creates are independent from the moment they land, and
  // the form does not pretend otherwise.
  const lastDay = days[days.length - 1] ?? day;
  const canRepeat = isAdmin && !session && day < lastDay;
  const [repeating, setRepeating] = useState(false);
  const [untilChoice, setUntilChoice] = useState(lastDay);
  const [weekdays, setWeekdays] = useState<Weekday[]>(WEEKDAYS_MONDAY_FIRST);

  // Both are clamped on read rather than corrected in an effect: changing the
  // day above can invalidate either, and a run that silently repaired itself
  // while you looked at it would be worse than one that just stays right.
  const until = untilChoice > day ? untilChoice : lastDay;
  const startWeekday = weekdayOf(day);
  const runDays = useMemo(() => {
    const chosen = new Set(weekdays);
    // The day picked above is the first occurrence, so its weekday is not
    // something the chips get to switch off.
    chosen.add(startWeekday);
    return WEEKDAYS_MONDAY_FIRST.filter((d) => chosen.has(d));
  }, [weekdays, startWeekday]);

  const repeat: Repeat | undefined =
    canRepeat && repeating
      ? { until, ...(runDays.length < 7 ? { days: runDays } : {}) }
      : undefined;
  const runCount = repeat ? repeatDates(day, repeat).dates.length : 1;
  const repeatProblem = repeat
    ? checkRepeat(day, repeat, { eventEndDate: lastDay, max: MAX_REPEAT_DAYS })
    : null;

  const save = () => {
    if (!title.trim()) {
      setError('A title is required');
      return;
    }
    if (!roomId) {
      setError('There is no room you can place this in');
      return;
    }
    const [h, m] = start.split(':').map(Number);
    const startMin = Math.round(((h ?? 0) * 60 + (m ?? 0)) / 5) * 5;
    if (!isAdmin && (startMin < dayStartMin || startMin + durMin > dayEndMin)) {
      setError(`Open sessions must sit between ${fmtMin(dayStartMin)} and ${fmtMin(dayEndMin)}`);
      return;
    }
    const stream = livestreamUrl.trim();
    if (stream && !/^https?:\/\//i.test(stream)) {
      setError('A livestream link must start with http:// or https://');
      return;
    }
    if (repeatProblem) {
      setError(repeatProblem);
      return;
    }
    onSave({
      roomId,
      type: isAdmin ? type : undefined,
      ...(isAdmin ? { blocksOpenBooking: holdsFloor } : {}),
      title: title.trim(),
      speakers,
      description: description.trim(),
      livestreamUrl: livestreamUrl.trim(),
      startsAt: zonedTimeToUtc(day, startMin, timezone).toISOString(),
      endsAt: zonedTimeToUtc(day, startMin + durMin, timezone).toISOString(),
      tagIds,
      trackId,
    }, repeat);
  };

  const heading = session ? 'Edit session' : isAdmin ? 'Add session' : 'Propose an open session';

  return (
    // `wide`: the form is mostly two- and three-column FormGrids (day, start,
    // duration; room and track), and at the default `max-w-md` every one of
    // them collapsed to a single column on a desktop that had room for three.
    <Modal
      title={heading}
      description={
        isAdmin
          ? undefined
          : 'Open sessions live in rooms that anyone may book, and stay editable by you.'
      }
      onClose={onCancel}
      wide
      onSubmit={save}
      footer={
        <>
          {error && <FormError className="basis-full">{error}</FormError>}
          {/* Delete sits at the far end from Save, so the two are never
              neighbours under the same thumb. */}
          {onDelete && (
            <DangerButton className="mr-auto inline-flex items-center gap-1.5" onClick={onDelete}>
              <RemoveIcon className="h-3.5 w-3.5" />
              Delete
            </DangerButton>
          )}
          <SecondaryButton onClick={onCancel}>Cancel</SecondaryButton>
          <PrimaryButton
            type="submit"
            disabled={saving || allowedRooms.length === 0 || repeatProblem !== null}
          >
            {saving ? 'Saving…' : runCount > 1 ? `Create ${runCount} sessions` : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      {allowedRooms.length === 0 && (
        <p className="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
          No room here is open for booking yet, so there is nowhere for you to add a session.
        </p>
      )}

      <div className="space-y-5">
        <FieldGroup title="What it is">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className={inputClass}
              autoFocus
            />
          </Field>
          <Field label="Speaker or host">
            <SpeakerCombobox people={people} value={speakers} onChange={setSpeakers} />
          </Field>
          <Field label="Description" hint="Markdown is supported.">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
              className={`${inputClass} resize-y`}
            />
          </Field>
          <Field label="Tags">
            <div className="flex flex-wrap gap-1.5">
              {tags.length === 0 && (
                <span className="text-xs text-stone-400 dark:text-stone-500">No tags yet.</span>
              )}
              {tags.map((t) => (
                <Chip
                  key={t.id}
                  dot={t.color}
                  active={tagIds.includes(t.id)}
                  onClick={() =>
                    setTagIds((prev) =>
                      prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                    )
                  }
                >
                  {t.name}
                </Chip>
              ))}
            </div>
          </Field>
        </FieldGroup>

        <FieldGroup title="When and where">
          <FormGrid>
            <Field label="Room">
              <select
                value={roomId}
                onChange={(e) => setRoomId(Number(e.target.value))}
                className={inputClass}
              >
                {allowedRooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.openBooking ? ' (open)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            {tracks.length > 0 && (
              <Field label="Track" hint="Optional. The schedule can lay its columns out by track.">
                <select
                  value={trackId ?? ''}
                  onChange={(e) => setTrackId(e.target.value ? Number(e.target.value) : null)}
                  className={inputClass}
                >
                  <option value="">No track</option>
                  {/* A track that keeps hours says so here, for the day being
                      placed — cheaper than a refusal after Save, and it is the
                      only place the choice and the day are on screen together. */}
                  {tracks.map((t) => {
                    const hours = windowOn(t, day);
                    return (
                      <option key={t.id} value={t.id}>
                        {hours ? `${t.name} (${windowLabel(hours)})` : t.name}
                      </option>
                    );
                  })}
                </select>
              </Field>
            )}
          </FormGrid>

          {/* Day, start and duration are one thought and read as one row. They
              used to share a two-column grid with room and track, which put
              "duration" under "day" and left a hole beside it. */}
          <FormGrid cols={3}>
            <Field label="Day">
              <select value={day} onChange={(e) => setDay(e.target.value)} className={inputClass}>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {dayLabels[d] ?? d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start" hint="In 5-minute steps.">
              <input
                type="time"
                step={300}
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Duration">
              <select
                value={durMin}
                onChange={(e) => setDurMin(Number(e.target.value))}
                className={inputClass}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </Field>
          </FormGrid>

          {canRepeat && (
            <Field label="Repeat">
              <Toggle
                checked={repeating}
                onChange={setRepeating}
                label="Put this session on more than one day"
              />
              {repeating && (
                <div className="mt-3 space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
                  <FormGrid cols={2}>
                    <Field label="Until">
                      <select
                        value={until}
                        onChange={(e) => setUntilChoice(e.target.value)}
                        className={inputClass}
                      >
                        {days
                          .filter((d) => d > day)
                          .map((d) => (
                            <option key={d} value={d}>
                              {dayLabels[d] ?? d}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="On these days">
                      <div className="flex flex-wrap gap-1.5">
                        {WEEKDAYS_MONDAY_FIRST.map((d) => (
                          <Chip
                            key={d}
                            active={runDays.includes(d)}
                            onClick={() => {
                              if (d === startWeekday) return;
                              setWeekdays((prev) =>
                                prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
                              );
                            }}
                          >
                            {WEEKDAY_LABELS[d]}
                          </Chip>
                        ))}
                      </div>
                    </Field>
                  </FormGrid>
                  <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                    {repeatProblem ??
                      `Creates ${runCount} separate ${runCount === 1 ? 'session' : 'sessions'}, ` +
                        `the first on ${dayLabels[day] ?? day}.`}{' '}
                    They are not linked: moving or deleting one afterwards leaves the rest where
                    they are, so a day that runs late is a day you fix on its own.
                  </p>
                </div>
              )}
            </Field>
          )}
        </FieldGroup>

        <FieldGroup title="Extras">
          <Field label="Livestream link" hint="Optional. Attendees only see this if you set it.">
            <input
              value={livestreamUrl}
              onChange={(e) => setLivestreamUrl(e.target.value)}
              placeholder="https://…"
              maxLength={2000}
              className={inputClass}
            />
          </Field>

          {isAdmin && (
            <Field label="Type">
              <div className="flex items-center gap-1.5">
                {(['official', 'open'] as const).map((t) => (
                  <Chip key={t} active={type === t} onClick={() => setType(t)}>
                    <span className="capitalize">{t}</span>
                  </Chip>
                ))}
                <HelpButton
                  open={typeHelp}
                  onClick={() => setTypeHelp(!typeHelp)}
                  label="session types"
                />
              </div>
              {typeHelp && (
                <HelpNote>
                  <p>
                    <strong className="font-semibold text-stone-800 dark:text-stone-100">
                      Official
                    </strong>{' '}
                    is the published programme. Only organisers can add one or change it.
                  </p>
                  <p>
                    <strong className="font-semibold text-stone-800 dark:text-stone-100">
                      Open
                    </strong>{' '}
                    is attendee-placed. Whoever created it can keep editing it, and it can only
                    go in a room that allows booking.
                  </p>
                  <p>
                    Making a session official therefore locks it against the person who put it
                    up. Neither type affects timing: organisers may double-book a room, everyone
                    else may not, whichever type it is.
                  </p>
                </HelpNote>
              )}
            </Field>
          )}

          {isAdmin && type === 'official' && (
            <Field label="Attendance">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Toggle
                  checked={blocksOpenBooking}
                  onChange={setBlocksOpenBooking}
                  label="Everyone should be at this"
                />
                <HelpButton
                  open={blockHelp}
                  onClick={() => setBlockHelp(!blockHelp)}
                  label="holding the floor"
                />
              </div>
              {blockHelp && (
                <HelpNote>
                  <p>
                    While this session runs, attendees cannot add a session anywhere — not even
                    in a room that allows booking. For a keynote or a closing plenary that is
                    the point: there is nowhere else to be.
                  </p>
                  <p>
                    It holds only its own hours, so leave it off for registration, coffee and
                    anything that runs all day. Organisers and speakers can still place sessions
                    against it, and those show on the schedule as{' '}
                    <strong className="font-semibold text-stone-800 dark:text-stone-100">
                      competing
                    </strong>
                    .
                  </p>
                  <p>
                    Sessions already booked in these hours stay where they are — ticking this
                    afterwards moves and cancels nobody.
                  </p>
                  <p>
                    Lunch, dinner and coffee are not sessions at all — they are breaks, set
                    up once in Manage Event → Programme and drawn quietly behind every day
                    they apply to.
                  </p>
                </HelpNote>
              )}
            </Field>
          )}
        </FieldGroup>
      </div>
    </Modal>
  );
}
