import type { EventDto, RoomDto, SessionDto } from '@shared/types';
import { templateParts } from '@shared/telegramTemplate';
import { Modal } from './Modal';
import { SecondaryButton } from './ui';

/**
 * What the group will actually see.
 *
 * Every other setting in Manage Event changes something the organiser can look
 * at — the grid redraws, the login page changes. These change what a message
 * in somebody else's Telegram group will say tomorrow morning, which is
 * invisible from here and expensive to get wrong: the way to find out used to
 * be to turn it on and wait. So each option shows its own output, drawn from
 * this event's real schedule wherever there is one.
 */

/** A sample drawn from the event, or an honest stand-in when it is empty. */
export interface Row {
  time: string;
  room: string;
  track: string;
  title: string;
  speakers: string;
  format: string;
  tags: string[];
  streams: string[];
}

interface Slot {
  time: string;
  rows: Row[];
  /** Every non-draft session of the anchor's day, for the digest. */
  day: { time: string; room: string; title: string }[];
  dayLabel: string;
}

const FALLBACK: Slot = {
  time: '10:00',
  dayLabel: 'Tuesday 16 September',
  day: [
    { time: '10:00', room: 'Main Hall', title: 'Scaling an unconference' },
    { time: '10:00', room: 'Room 2', title: 'Hallway track, formalised' },
    { time: '11:30', room: 'Main Hall', title: 'What we got wrong last year' },
  ],
  rows: [
    {
      time: '10:00',
      room: 'Main Hall',
      track: 'Practice',
      title: 'Scaling an unconference',
      speakers: 'Ada Lovelace',
      format: 'Workshop',
      tags: ['facilitation'],
      streams: ['Main camera'],
    },
    {
      time: '10:00',
      room: 'Room 2',
      track: '',
      title: 'Hallway track, formalised',
      speakers: 'Grace Hopper',
      format: '',
      tags: [],
      streams: [],
    },
  ],
};

function pickSlot(
  event: EventDto,
  sessions: SessionDto[],
  rooms: RoomDto[],
  tracks: NamedRef[],
  formats: NamedRef[],
  tags: NamedRef[],
): Slot {
  const live = sessions
    .filter((s) => !s.draft)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const now = new Date().toISOString();
  const anchor = live.find((s) => s.startsAt > now) ?? live[0];
  if (!anchor) return FALLBACK;

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  const formatName = new Map(formats.map((f) => [f.id, f.name]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const at = new Date(anchor.startsAt);
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: event.timezone, ...opts }).format(at);

  const fmtOf = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: event.timezone, ...opts }).format(new Date(iso));
  const anchorDay = fmtOf(anchor.startsAt, { year: 'numeric', month: 'short', day: 'numeric' });

  return {
    time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }),
    dayLabel: fmt({ weekday: 'long', day: 'numeric', month: 'long' }),
    // The digest is the whole day, so it is drawn from the whole day and not
    // from the anchor's slot — showing one slot three times was a lie about
    // what the morning message contains.
    day: live
      .filter(
        (x) => fmtOf(x.startsAt, { year: 'numeric', month: 'short', day: 'numeric' }) === anchorDay,
      )
      .slice(0, 6)
      .map((x) => ({
        time: fmtOf(x.startsAt, { hour: '2-digit', minute: '2-digit', hour12: false }),
        room: roomName.get(x.roomId) ?? '',
        title: x.title,
      })),
    rows: live
      .filter((s) => s.startsAt === anchor.startsAt)
      .slice(0, 4)
      .map((s) => ({
        time: fmtOf(s.startsAt, { hour: '2-digit', minute: '2-digit', hour12: false }),
        room: roomName.get(s.roomId) ?? '',
        track: trackName.get(s.trackId ?? -1) ?? '',
        title: s.title,
        speakers: s.speakers.map((p) => p.name).join(', '),
        format: formatName.get(s.formatId ?? -1) ?? '',
        tags: s.tagIds.map((id) => tagName.get(id) ?? '').filter((t) => t !== ''),
        streams: s.livestreams.map((l) => l.label),
      })),
  };
}

/** Everything the preview needs of a track, a format or a tag: its name. */
export interface NamedRef {
  id: number;
  name: string;
}

/**
 * One session's line, drawn from the same parts the bot sends.
 *
 * `templateParts` in `@shared/telegramTemplate` decides what survives; this
 * decides what a surviving part looks like on screen. The bot does the same
 * with Telegram's HTML, so an organiser reading this is reading what the group
 * will get rather than an impression of it.
 */
export function Line({ row, template }: { row: Row; template: string }) {
  const parts = templateParts(template, {
    title: row.title,
    room: row.room,
    track: row.track,
    speakers: row.speakers,
    format: row.format,
    tags: row.tags.map((t) => `#${t}`).join(' '),
    streams: row.streams.join(', '),
    time: row.time,
  });

  return (
    <>
      {parts.map((part, i) =>
        // The two that are links in a real message are links here: seeing which
        // parts are tappable is half of what the preview is for.
        part.name === 'title' || part.name === 'streams' ? (
          <Title key={i}>{part.text}</Title>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/**
 * One session to draw a line from — the event's own wherever there is one.
 *
 * Exported because the panel puts a live line under the box an organiser is
 * typing in, and it has to be the same session the Example uses or the two
 * disagree on the same screen.
 */
export function sampleRow(
  event: EventDto,
  sessions: SessionDto[],
  rooms: RoomDto[],
  tracks: NamedRef[],
  formats: NamedRef[],
  tags: NamedRef[],
): Row {
  return pickSlot(event, sessions, rooms, tracks, formats, tags).rows[0] ?? FALLBACK.rows[0]!;
}

/** One message, drawn the way Telegram draws it: a bubble, not a form field. */
function Bubble({ when, children }: { when: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {when}
      </p>
      <div className="max-w-md rounded-2xl rounded-bl-sm bg-stone-100 px-3.5 py-2.5 text-sm leading-relaxed text-stone-800 dark:bg-stone-800 dark:text-stone-100">
        {children}
      </div>
    </div>
  );
}

const Title = ({ children }: { children: React.ReactNode }) => (
  <span className="text-sky-700 underline dark:text-sky-400">{children}</span>
);

export function TelegramPreview({
  mode,
  leadMin,
  template,
  digest,
  event,
  sessions,
  rooms,
  tracks = [],
  formats = [],
  tags = [],
  onClose,
}: {
  mode: string;
  leadMin: number;
  /** The line each session renders as. Previewed from what is on screen, which
   *  is how somebody decides whether to press Save. */
  template: string;
  /** 'HH:MM' the morning message goes out, as the field currently reads. */
  digest: string;
  event: EventDto;
  sessions: SessionDto[];
  rooms: RoomDto[];
  tracks?: NamedRef[];
  formats?: NamedRef[];
  tags?: NamedRef[];
  onClose: () => void;
}) {
  const slot = pickSlot(event, sessions, rooms, tracks, formats, tags);
  const usingRealData = sessions.some((s) => !s.draft);

  // Mirrors MODES in telegram.ts. Every branch below is a trigger the announcer
  // really fires — a bubble here for something unwritten is the failure this
  // modal exists to prevent, and it shipped once.
  const sends = {
    upNext: mode === 'light' || mode === 'medium' || mode === 'heavy',
    digest: mode === 'medium' || mode === 'heavy',
    placed: mode === 'medium' || mode === 'heavy',
    added: mode === 'heavy',
    moved: mode === 'heavy',
  };
  const upNext = sends.upNext;

  return (
    <Modal
      title="What the group will see"
      description={
        usingRealData
          ? 'Drawn from this event’s own schedule. Real messages carry links to each session.'
          : 'This event has no sessions yet, so these use stand-in names.'
      }
      onClose={onClose}
      footer={<SecondaryButton onClick={onClose}>Close</SecondaryButton>}
    >
      <div className="space-y-5">
        {mode === 'off' && (
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Nothing. The group stays connected and the bot says no more until you pick another
            setting.
          </p>
        )}

        {sends.digest && (
          <Bubble when={`Each morning at ${digest}`}>
            <p className="font-semibold">📋 {slot.dayLabel}</p>
            <p className="mt-1 text-[11px] italic text-stone-500 dark:text-stone-400">
              Always one line a session, whatever your line says.
            </p>
            <div className="mt-2 space-y-0.5 font-mono text-xs">
              {slot.day.map((row, i) => (
                <p key={i}>
                  {row.time} · {row.room} — {row.title}
                </p>
              ))}
            </div>
          </Bubble>
        )}

        {upNext && (
          <Bubble when={`${leadMin} minutes before each start time`}>
            <p className="font-semibold">🕐 {slot.time} — up next</p>
            {/* A line a session, two when it is streamed — the same shape
              `itemBlock` builds, because a preview of a different shape is
              the failure this modal exists to prevent. */}
            {slot.rows.map((row, i) => (
              <div key={i} className="mt-2">
                <Line row={row} template={template} />
              </div>
            ))}
          </Bubble>
        )}

        {sends.placed && slot.rows[0] && (
          <Bubble when="The moment a pitch reaches the grid">
            <p>🙌 Just pitched — {slot.time}</p>
            <div className="mt-2">
              <Line row={slot.rows[0]} template={template} />
            </div>
          </Bubble>
        )}

        {sends.added && slot.rows[0] && (
          <Bubble when="The moment an organiser puts a session up">
            <p>✨ Just added — {slot.time}</p>
            <div className="mt-2">
              <Line row={slot.rows[0]} template={template} />
            </div>
          </Bubble>
        )}

        {sends.moved && (
          <Bubble when="Within a minute of a session being dragged">
            <p className="font-semibold">🔄 Moved on the schedule</p>
            <p className="mt-2 font-mono text-xs">
              {slot.time} · {slot.rows[0]?.room} — {slot.rows[0]?.title}
            </p>
          </Bubble>
        )}

        {upNext && (
          <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
            Everything starting at the same time goes out in one message, however many rooms that is
            — so a busy slot is one notification, not five.
          </p>
        )}
      </div>
    </Modal>
  );
}
