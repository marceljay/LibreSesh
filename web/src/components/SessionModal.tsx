import { plural } from '../lib/plural';
import { Modal } from './Modal';
import { useMemo, useState } from 'react';
import type {
  FormatDto,
  LabelledLink,
  PersonDto,
  RoomDto,
  Role,
  SessionDto,
  TagDto,
  TrackDto,
} from '@shared/types';
import { LINK_RULE, safeLink } from '@shared/links';
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
import {
  DURATION_CHOICES,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  SNAP_MINUTES,
  durationLabel,
} from '@shared/sessionLimits';
import { RemoveIcon } from './icons';
import { SpeakerCombobox, type SpeakerChoice } from './SpeakerCombobox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  Chip,
  DangerButton,
  Field,
  ControlShell,
  FieldGroup,
  FormError,
  FormGrid,
  HelpButton,
  HelpNote,
  hintClass,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  TextArea,
  TextInput,
  Toggle,
} from './ui';



/**
 * The two ways a session gets onto the schedule. The second used to be
 * labelled "open", which read as *open to join* — the opposite of a useful
 * distinction on a schedule where everything is open to join. It is stated as
 * the negative of the first now, with the consequence that actually matters
 * spelled out beside it: only an official session can hold the floor, so
 * anything non-official can always have something running alongside it.
 *
 * The stored value is unchanged (`official | open`); this is what a person
 * reads.
 */
const PLACEMENTS: readonly { value: 'official' | 'open'; label: string; note?: string }[] = [
  { value: 'official', label: 'Official' },
  { value: 'open', label: 'Non-official', note: 'allow parallel sessions' },
];

export interface SessionModalProps {
  session?: SessionDto;
  rooms: RoomDto[];
  tags: TagDto[];
  /** What kinds of session this event runs. Empty when the organiser has
   *  defined none, and the Format row is then absent entirely. */
  formats: FormatDto[];
  /** Empty when the event defines none; the Track field is then absent. */
  tracks: TrackDto[];
  people: PersonDto[];
  role: Role;
  /** `session.credit_others` for this role — off means the speaker field is
   *  a toggle between you and nobody. */
  canCreditOthers: boolean;
  timezone: string;
  days: string[];
  dayLabels: Record<string, string>;
  defaultDay: string;
  dayStartMin: number;
  dayEndMin: number;
  saving: boolean;
  /** False when this editor may change the session's words but not its slot —
   *  a speaker on an official session. The fields are disabled rather than
   *  left to be refused on save. */
  canMove?: boolean;
  onCancel: () => void;
  /** `repeat` asks for the same session on every day of a run; `link` keeps
   *  that run as a series. `applyTo` reaches the rest of an existing series on
   *  an edit — see `shared/repeat.ts` and the linked-sessions spec. */
  onSave: (body: SessionWrite, opts?: SaveOpts) => void;
  onDelete?: () => void;
  /** Drop this session out of its series. Present only when it is linked. */
  onUnlink?: () => void;
  /** Open the picker to link this session with others of the same name. Present
   *  only on a saved session the user may link. */
  onLinkExisting?: () => void;
}

export interface SaveOpts {
  repeat?: Repeat;
  link?: boolean;
  applyTo?: 'later' | 'all';
}

export function SessionModal({
  session,
  rooms,
  tags,
  formats,
  tracks,
  people,
  role,
  canCreditOthers,
  timezone,
  days,
  dayLabels,
  defaultDay,
  dayStartMin,
  dayEndMin,
  saving,
  canMove = true,
  onCancel,
  onSave,
  onDelete,
  onUnlink,
  onLinkExisting,
}: SessionModalProps) {
  const isAdmin = role === 'admin';
  // Users may only place sessions in rooms that allow booking (SPEC §5.1).
  const allowedRooms = useMemo(
    () => (isAdmin ? rooms : rooms.filter((r) => r.openBooking)),
    [isAdmin, rooms],
  );

  const existing = session ? place(session, timezone) : null;
  const [title, setTitle] = useState(session?.title ?? '');
  // A new session by anyone but an organiser starts credited to them: at an
  // unconference you mostly host what you book, and it is one click to
  // remove. An organiser's starts empty — they are usually placing someone
  // else's talk.
  const [speakers, setSpeakers] = useState<SpeakerChoice[]>(() => {
    if (session) return session.speakers.map((p) => p.id);
    const mine = people.find((p) => p.isMine);
    return !isAdmin && mine ? [mine.id] : [];
  });
  const [description, setDescription] = useState(session?.description ?? '');
  // A session can be streamed more than once. Kept as a draft list with a
  // blank row at the end, the way the profile's links are edited: adding the
  // second one should not need a button pressed before there is a field.
  const [livestreams, setLivestreams] = useState<LabelledLink[]>(
    () => session?.livestreams ?? [],
  );
  const [roomId, setRoomId] = useState<number>(session?.roomId ?? allowedRooms[0]?.id ?? 0);
  const [day, setDay] = useState(existing?.date ?? defaultDay);
  const [start, setStart] = useState(fmtMin(existing?.startMin ?? Math.max(dayStartMin, 14 * 60)));
  const [durMin, setDurMin] = useState(existing?.durMin ?? 30);
  // A session already 40 minutes long has no chip in the list, and a select
  // whose value matches no option silently shows the first one — so the form
  // would have offered to shorten it to 15 the moment anything else was saved.
  // Opening straight into the typed field is what stops that.
  const [customDur, setCustomDur] = useState(
    () => existing !== null && !(DURATION_CHOICES as readonly number[]).includes(existing.durMin),
  );
  const [tagIds, setTagIds] = useState<number[]>(session?.tagIds ?? []);
  const [formatId, setFormatId] = useState<number | null>(session?.formatId ?? null);
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

  /** Clicking the active chip clears the format: "unspecified" is a real
   *  answer, and it is the one every session starts with. A format never
   *  touches the times — how long a session runs is the session's business. */
  const pickFormat = (next: FormatDto) => setFormatId(formatId === next.id ? null : next.id);

  // Repeating puts a session on more than one day at once — the attendee
  // offering morning yoga as much as an organiser building a programme, so it
  // is for anyone who may place a session, not organisers alone. It is only for
  // sessions that do not exist yet: editing one day of a run edits that day.
  const lastDay = days[days.length - 1] ?? day;
  const canRepeat = role !== 'viewer' && !session && day < lastDay;
  const [repeating, setRepeating] = useState(false);
  // An organiser's run defaults to loose rows (programme-building); everyone
  // else's defaults to a linked series, since a recurring session someone runs
  // themselves is the thing they will want to edit in one place.
  const [repeatLink, setRepeatLink] = useState(!isAdmin);
  const [untilChoice, setUntilChoice] = useState(lastDay);
  const [weekdays, setWeekdays] = useState<Weekday[]>(WEEKDAYS_MONDAY_FIRST);

  // How far an edit to a linked session reaches. Only shown when the session is
  // already part of a series; the default keeps the old per-row behaviour.
  const isLinked = !!session?.seriesId;
  const [applyScope, setApplyScope] = useState<'one' | 'later' | 'all'>('one');

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
    if (
      !Number.isInteger(durMin) ||
      durMin < MIN_DURATION_MINUTES ||
      durMin > MAX_DURATION_MINUTES ||
      durMin % SNAP_MINUTES !== 0
    ) {
      setError(
        `A session runs between ${MIN_DURATION_MINUTES} minutes and ${durationLabel(MAX_DURATION_MINUTES)}, in ${SNAP_MINUTES}-minute steps`,
      );
      return;
    }
    const [h, m] = start.split(':').map(Number);
    const startMin = Math.round(((h ?? 0) * 60 + (m ?? 0)) / 5) * 5;
    if (!isAdmin && (startMin < dayStartMin || startMin + durMin > dayEndMin)) {
      setError(`A session you place must sit between ${fmtMin(dayStartMin)} and ${fmtMin(dayEndMin)}`);
      return;
    }
    const streams = livestreams
      .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
      .filter((l) => l.url !== '' || l.label !== '');
    if (streams.some((l) => safeLink(l.url) === null)) {
      setError(LINK_RULE);
      return;
    }
    if (streams.some((l) => l.label === '')) {
      setError('Give each stream a name, so a reader knows which is which');
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
      livestreams: streams,
      startsAt: zonedTimeToUtc(day, startMin, timezone).toISOString(),
      endsAt: zonedTimeToUtc(day, startMin + durMin, timezone).toISOString(),
      tagIds,
      trackId,
      formatId,
    }, {
      repeat,
      ...(repeat && repeatLink ? { link: true } : {}),
      ...(isLinked && applyScope !== 'one' ? { applyTo: applyScope } : {}),
    });
  };

  const heading = session ? 'Edit session' : isAdmin ? 'Add session' : 'Propose a session';

  return (
    // `wide`: the form is mostly two- and three-column FormGrids (day, start,
    // duration; room and track), and at the default `max-w-md` every one of
    // them collapsed to a single column on a desktop that had room for three.
    <Modal
      title={heading}
      description={
        isAdmin
          ? undefined
          : 'What you propose lives in a room anyone may book, and stays editable by you.'
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
            <DangerButton className="me-auto inline-flex items-center gap-1.5" onClick={onDelete}>
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
        <FieldGroup>
          {/* An organiser who defines none would otherwise see the row simply
              missing, which reads as "this app has no formats" rather than
              "this event has none yet" — the two are indistinguishable from
              inside the form, and the second is where every event starts.
              Attendees are spared it: they cannot add one. */}
          {formats.length === 0 && isAdmin && (
            <Field label="Format">
              <p className={hintClass}>
                This event defines none yet. Add them under Manage Event →
                Programme and they appear here, at the top of this form.
              </p>
            </Field>
          )}

          {/* First in the form, because it is what the thing is. It sets
              nothing else: the times below are the session's own. */}
          {formats.length > 0 && (
            <Field label="Format">
              <div className="flex flex-wrap gap-1.5">
                {formats.map((f) => (
                  <Chip
                    key={f.id}
                    dot={f.color}
                    active={formatId === f.id}
                    onClick={() => pickFormat(f)}
                  >
                    {f.name}
                  </Chip>
                ))}
              </div>
            </Field>
          )}

          {/* Second, directly under Format and above the title, not down in
              Extras where it used to sit. An organiser who never scrolls to it
              places everything as official — the default — and official is the
              one choice that locks a session against the person who put it up.
              A decision with that consequence has to be visible before the
              form is filled in, not after.

              Called "Placement" and not "Type": it says who put the session up
              and whether it is the published programme, while the field above
              says what kind of session it is. */}
          {isAdmin && (
            <Field label="Placement">
              {/* Wraps, like the Attendance row below it. Without it the two
                  chips and the "?" were one non-wrapping line, and on a phone
                  the tail of "Non-official: allow parallel sessions" ran off
                  the edge and clipped — 22 characters gone with room to spare
                  a line down. */}
              <div className="flex flex-wrap items-center gap-1.5">
                {PLACEMENTS.map((p) => (
                  <Chip key={p.value} active={type === p.value} onClick={() => setType(p.value)}>
                    {p.label}
                    {p.note && <span className="ms-1 font-normal opacity-70">: {p.note}</span>}
                  </Chip>
                ))}
                <HelpButton
                  open={typeHelp}
                  onClick={() => setTypeHelp(!typeHelp)}
                  label="how a session is placed"
                />
              </div>
              {typeHelp && (
                <HelpNote>
                  <p>
                    <strong className="font-semibold text-stone-800 dark:text-stone-100">
                      Official
                    </strong>{' '}
                    means the organisers put it on. Only they can add one, move it or delete
                    it — though anyone named as a speaker can still edit what it says.
                  </p>
                  <p>
                    <strong className="font-semibold text-stone-800 dark:text-stone-100">
                      Non-official
                    </strong>{' '}
                    means an attendee put it on. Whoever created it keeps editing it, and it
                    can only go in a room that anyone may book.
                  </p>
                  <p>
                    Why “allow parallel sessions”: an official session can be marked{' '}
                    <em>Everyone should be at this</em>, which stops attendees adding anything
                    while it runs. A non-official one can never be marked that way, so
                    something else can always run at the same time.
                  </p>
                  <p>
                    Worth knowing before you switch one: making somebody&rsquo;s non-official
                    session official takes it out of their hands, unless they are named as a
                    speaker on it.
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

          <Field label="Title">
            <ControlShell>
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </ControlShell>
          </Field>
          <Field label="Speaker or host">
            <SpeakerCombobox
              people={people}
              value={speakers}
              onChange={setSpeakers}
              isAdmin={isAdmin}
              onlySelf={!isAdmin && !canCreditOthers}
            />
          </Field>
          <Field label="Description" hint="Markdown is supported.">
            <TextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
              className="resize-y"
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
          {/* Said once, above the fields it applies to, rather than as a
              refusal after Save. A speaker owns their talk's words; where and
              when it runs is the programme, and the programme is the
              organiser's. */}
          {!canMove && (
            <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300">
              You are credited on this session, so you can edit what it says.
              Moving it is the organisers&rsquo; — ask them if the slot is wrong.
            </p>
          )}
          <FormGrid>
            <Field label="Room">
              <Select
                value={roomId}
                onValueChange={(v) => v != null && setRoomId(v)}
                disabled={!canMove}
              >
                <SelectTrigger aria-label="Room">
                  <SelectValue>
                    {(v: number | null) => allowedRooms.find((r) => r.id === v)?.name ?? ''}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {allowedRooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                      {r.openBooking ? ' (open)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {tracks.length > 0 && (
              <Field label="Track" hint="Optional. The schedule can lay its columns out by track.">
                <Select value={trackId} onValueChange={(v) => setTrackId(v)}>
                  <SelectTrigger aria-label="Track">
                    <SelectValue>
                      {(v: number | null) =>
                        v == null ? 'No track' : (tracks.find((t) => t.id === v)?.name ?? '')
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>No track</SelectItem>
                    {/* A track that keeps hours says so here, for the day being
                        placed — cheaper than a refusal after Save, and it is the
                        only place the choice and the day are on screen together. */}
                    {tracks.map((t) => {
                      const hours = windowOn(t, day);
                      return (
                        <SelectItem key={t.id} value={t.id}>
                          {hours ? `${t.name} (${windowLabel(hours)})` : t.name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </FormGrid>

          {/* Day, start and duration are one thought and read as one row. They
              used to share a two-column grid with room and track, which put
              "duration" under "day" and left a hole beside it. */}
          <FormGrid cols={3}>
            <Field label="Day">
              <Select value={day} onValueChange={(v) => v != null && setDay(v)} disabled={!canMove}>
                <SelectTrigger aria-label="Day">
                  <SelectValue>{(v: string | null) => (v == null ? '' : (dayLabels[v] ?? v))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {days.map((d) => (
                    <SelectItem key={d} value={d}>
                      {dayLabels[d] ?? d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Start" hint="In 5-minute steps.">
              <ControlShell disabled={!canMove}>
                <TextInput
                  type="time"
                  step={300}
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  disabled={!canMove}
                />
              </ControlShell>
            </Field>
            {/* A list plus a way past it. The list used to stop at three
                hours, which quietly said no session runs longer — and a
                full-day excursion, an all-afternoon poster hall and a
                hackathon all do. "Other" takes any multiple of five up to a
                day, which is what the server accepts. */}
            <Field label="Duration">
              <Select
                value={customDur ? 'other' : String(durMin)}
                onValueChange={(v) => {
                  if (v === 'other') {
                    setCustomDur(true);
                    return;
                  }
                  if (v != null) {
                    setCustomDur(false);
                    setDurMin(Number(v));
                  }
                }}
                disabled={!canMove}
              >
                <SelectTrigger aria-label="Duration">
                  <SelectValue>
                    {(v: string | null) =>
                      v === 'other' ? 'Other…' : v == null ? '' : durationLabel(Number(v))
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DURATION_CHOICES.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {durationLabel(d)}
                    </SelectItem>
                  ))}
                  <SelectItem value="other">Other…</SelectItem>
                </SelectContent>
              </Select>
              {customDur && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <ControlShell disabled={!canMove} className="w-24">
                    <TextInput
                      type="number"
                      value={durMin}
                      onChange={(e) => setDurMin(Number(e.target.value))}
                      min={MIN_DURATION_MINUTES}
                      max={MAX_DURATION_MINUTES}
                      step={SNAP_MINUTES}
                      aria-label="Duration in minutes"
                      autoFocus
                      disabled={!canMove}
                    />
                  </ControlShell>
                  <span className={hintClass}>
                    minutes{durMin >= 60 ? ` · ${durationLabel(durMin)}` : ''}
                  </span>
                </div>
              )}
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
                  {/* One line on desktop, wrapping on a narrow screen: "Until"
                      sizes to its content and the seven day chips take the
                      rest, so neither is stretched and both fit across. */}
                  <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                    <Field label="Until">
                      <Select value={until} onValueChange={(v) => v != null && setUntilChoice(v)}>
                        <SelectTrigger aria-label="Until" className="w-auto">
                          <SelectValue>
                            {(v: string | null) => (v == null ? '' : (dayLabels[v] ?? v))}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {days
                            .filter((d) => d > day)
                            .map((d) => (
                              <SelectItem key={d} value={d}>
                                {dayLabels[d] ?? d}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
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
                  </div>
                  <Toggle
                    checked={repeatLink}
                    onChange={setRepeatLink}
                    label="Keep these linked, so an edit can apply to the whole run"
                  />
                  <p className={`${hintClass} leading-relaxed`}>
                    {repeatProblem ??
                      `Creates ${plural(runCount, { one: 'session', other: 'sessions' })}, the first on ${dayLabels[day] ?? day}.`}{' '}
                    {repeatLink
                      ? 'Editing one later offers to apply to the rest — but each keeps its own time, so moving one never moves the others.'
                      : 'They are not linked: moving or deleting one afterwards leaves the rest where they are, so a day that runs late is a day you fix on its own.'}
                  </p>
                </div>
              )}
            </Field>
          )}

          {(isLinked || (session && onLinkExisting)) && (
            <Field label="Series">
              {isLinked ? (
                <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-stone-700 dark:text-stone-200">
                      Linked session
                    </span>
                    {onUnlink && (
                      <button
                        type="button"
                        onClick={onUnlink}
                        className="text-xs text-stone-500 underline underline-offset-2 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                      >
                        Unlink this one
                      </button>
                    )}
                  </div>
                  <p className={`mt-1 ${hintClass}`}>
                    Apply your changes to
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Chip active={applyScope === 'one'} onClick={() => setApplyScope('one')}>
                      This session only
                    </Chip>
                    <Chip active={applyScope === 'later'} onClick={() => setApplyScope('later')}>
                      This and later
                    </Chip>
                    <Chip active={applyScope === 'all'} onClick={() => setApplyScope('all')}>
                      All in the series
                    </Chip>
                  </div>
                  {applyScope !== 'one' && (
                    <p className={`mt-2 ${hintClass} leading-relaxed`}>
                      The others keep their own time — only the words, room and details change.
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onLinkExisting}
                  className="text-xs text-stone-500 underline underline-offset-2 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                >
                  Link matching sessions…
                </button>
              )}
            </Field>
          )}
        </FieldGroup>

        <FieldGroup title="Extras">
          <Field
            label="Livestream links"
            hint="Optional, and as many as the session has — a main camera, a room feed, an interpreted channel. Attendees only see what you add."
          >
            <div className="flex flex-col gap-1.5">
              {livestreams.map((stream, i) => (
                <div key={i} className="flex gap-1.5">
                  <ControlShell className="w-32 shrink-0">
                    <TextInput
                      value={stream.label}
                      onChange={(e) =>
                        setLivestreams((ls) =>
                          ls.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)),
                        )
                      }
                      aria-label={`Name of stream ${i + 1}`}
                      placeholder="YouTube"
                      maxLength={60}
                    />
                  </ControlShell>
                  <ControlShell className="flex-1">
                    <TextInput
                      value={stream.url}
                      onChange={(e) =>
                        setLivestreams((ls) =>
                          ls.map((l, j) => (j === i ? { ...l, url: e.target.value } : l)),
                        )
                      }
                      aria-label={`Link for stream ${i + 1}`}
                      placeholder="https:// or ipfs://…"
                      maxLength={2000}
                    />
                  </ControlShell>
                  <IconButton
                    aria-label={`Remove stream ${i + 1}`}
                    onClick={() => setLivestreams((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <RemoveIcon className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              ))}
              {livestreams.length < 6 && (
                <SecondaryButton
                  className="self-start py-1 text-xs"
                  onClick={() => setLivestreams((ls) => [...ls, { label: '', url: '' }])}
                >
                  {livestreams.length === 0 ? 'Add a stream' : 'Add another'}
                </SecondaryButton>
              )}
            </div>
          </Field>

        </FieldGroup>
      </div>
    </Modal>
  );
}
