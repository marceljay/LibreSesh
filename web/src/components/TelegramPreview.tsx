import type { EventDto, RoomDto, SessionDto } from '@shared/types';
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
interface Slot {
  time: string;
  rows: { room: string; title: string; speakers: string }[];
  day: string;
}

const FALLBACK: Slot = {
  time: '10:00',
  day: 'Tuesday 16 September',
  rows: [
    { room: 'Main Hall', title: 'Scaling an unconference', speakers: 'Ada Lovelace' },
    { room: 'Room 2', title: 'Hallway track, formalised', speakers: 'Grace Hopper' },
  ],
};

function pickSlot(event: EventDto, sessions: SessionDto[], rooms: RoomDto[]): Slot {
  const live = sessions
    .filter((s) => !s.draft)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const now = new Date().toISOString();
  const anchor = live.find((s) => s.startsAt > now) ?? live[0];
  if (!anchor) return FALLBACK;

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const at = new Date(anchor.startsAt);
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: event.timezone, ...opts }).format(at);

  return {
    time: fmt({ hour: '2-digit', minute: '2-digit', hour12: false }),
    day: fmt({ weekday: 'long', day: 'numeric', month: 'long' }),
    rows: live
      .filter((s) => s.startsAt === anchor.startsAt)
      .slice(0, 4)
      .map((s) => ({
        room: roomName.get(s.roomId) ?? '',
        title: s.title,
        speakers: s.speakers.map((p) => p.name).join(', '),
      })),
  };
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
  event,
  sessions,
  rooms,
  onClose,
}: {
  mode: string;
  leadMin: number;
  event: EventDto;
  sessions: SessionDto[];
  rooms: RoomDto[];
  onClose: () => void;
}) {
  const slot = pickSlot(event, sessions, rooms);
  const usingRealData = sessions.some((s) => !s.draft);

  const sends = {
    digest: mode === 'light' || mode === 'medium' || mode === 'heavy',
    upNext: mode === 'medium' || mode === 'heavy',
    added: mode === 'heavy',
  };
  const nothing = !sends.digest && !sends.upNext && !sends.added;

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
        {nothing && (
          <p className="text-sm text-stone-600 dark:text-stone-300">
            Nothing. The group stays connected and the bot says no more until you pick another
            setting.
          </p>
        )}

        {sends.digest && (
          <Bubble when="Each morning at 08:00">
            <p className="font-semibold">📋 {slot.day}</p>
            <div className="mt-2 space-y-0.5 font-mono text-xs">
              {slot.rows.map((row, i) => (
                <p key={i}>
                  {slot.time} {row.room} — {row.title}
                </p>
              ))}
            </div>
          </Bubble>
        )}

        {sends.upNext && (
          <Bubble when={`${leadMin} minutes before each start time`}>
            <p className="font-semibold">🕐 {slot.time} — up next</p>
            {slot.rows.map((row, i) => (
              <div key={i} className="mt-2">
                <p>{row.room}</p>
                <p>
                  <Title>{row.title}</Title>
                </p>
                {row.speakers && (
                  <p className="text-stone-600 dark:text-stone-300">{row.speakers}</p>
                )}
              </div>
            ))}
          </Bubble>
        )}

        {sends.added && (
          <Bubble when="The moment a session is placed">
            <p>
              ✨ Just added — {slot.time}, {slot.rows[0]?.room}
            </p>
            <p>
              <Title>{slot.rows[0]?.title}</Title>
            </p>
          </Bubble>
        )}

        {sends.upNext && (
          <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
            Everything starting at the same time goes out in one message, however many rooms that is
            — so a busy slot is one notification, not five.
          </p>
        )}
      </div>
    </Modal>
  );
}
