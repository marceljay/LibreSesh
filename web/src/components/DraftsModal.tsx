import type { RoomDto, SessionDto } from '@shared/types';
import { dayFullLabel, fmtMin, place } from '../lib/format';
import { Modal } from './Modal';

/**
 * Every draft this reader can see, in one list.
 *
 * A draft keeps its slot, so it is on the grid — greyed and dashed, on
 * whichever day it was parked. That is enough for the one in front of you and
 * no help at all for finding the rest: an organiser who took three talks off a
 * fourteen-day programme would otherwise page through a fortnight to get them
 * back. Which drafts a reader may see the server has already decided — the
 * bundle holds only theirs — so this lists what it holds, in running order.
 *
 * It stays open over edits and publishes on the stream, and says so when the
 * last one has gone rather than closing under the reader's hand.
 */
export function DraftsModal({
  sessions,
  rooms,
  timezone,
  onOpen,
  onClose,
}: {
  sessions: SessionDto[];
  rooms: RoomDto[];
  timezone: string;
  onOpen: (id: number) => void;
  onClose: () => void;
}) {
  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const drafts = sessions
    .filter((s) => s.draft)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : a.id - b.id));

  return (
    <Modal
      title="Drafts"
      description="Off the schedule, where only you, the organisers and anyone credited can see them. Open one to edit or publish it."
      onClose={onClose}
    >
      {drafts.length === 0 ? (
        <p className="text-xs text-stone-500 dark:text-stone-400">No drafts left.</p>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {drafts.map((s) => {
            const at = place(s, timezone);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpen(s.id)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-2 text-start hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  <span className="text-sm font-semibold">{s.title}</span>
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    {dayFullLabel(at.date)} · {fmtMin(at.startMin)}–{fmtMin(at.endMin)} ·{' '}
                    {roomName.get(s.roomId) ?? '—'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
