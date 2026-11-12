import type { RoomDto, TrackDto } from '@shared/types';
import { windowLabel, type DayWindow } from '@shared/trackHours';
import { roomNote, seatsLabel } from '../lib/rooms';

/**
 * Everything about a room, in one place: the organiser's directions first,
 * then the facts.
 *
 * The card used to carry the seats and the booking permission on a second
 * line, and this panel deliberately held only what the card had no room for.
 * That split asked a reader to look in two places for one room, and put a
 * standing claim — "attendees may book this room" — in the busiest 176px on
 * the schedule. The card is a name now, and everything about the room is
 * behind the ⓘ.
 */
export function RoomInfo({ room }: { room: RoomDto }) {
  const note = roomNote(room);
  const seats = seatsLabel(room.capacity);
  return (
    <div className="space-y-1.5">
      {note && <p className="whitespace-pre-line">{note}</p>}
      {seats && <p>{seats}</p>}
      {room.openBooking && <p>Attendees may schedule their own sessions here.</p>}
    </div>
  );
}

/**
 * What a track is for, how much is on it, and the hours it keeps today.
 *
 * The count and the hours used to sit on the card under the name, and the
 * panel only explained them. They are all behind the ⓘ now — the card is a
 * name, as a room's is, and the name opens the track's own page — so the
 * panel says the hours as well as what they mean: that they are a rule rather
 * than a description, who it binds, and whether this day keeps its own window.
 */
export function TrackInfo({
  track,
  day,
  note,
  count,
  hours,
}: {
  track: TrackDto;
  day: string;
  /** The organiser's context for the strand, or '' if they gave none. */
  note: string;
  /** Sessions on the track across the whole event. */
  count: number;
  /** The window the track keeps on `day`, or null when it takes any hour. */
  hours: DayWindow | null;
}) {
  const ownDay = track.windows.some((w) => w.date === day);
  return (
    <div className="space-y-1.5">
      {/* The organiser's words first: a reader who tapped the button wants to
          know what the strand is, and the facts are a footnote to that. */}
      {note && <p className="whitespace-pre-line">{note}</p>}
      <p>{count} in the programme, every day counted.</p>
      {hours && (
        <>
          <p>
            Today takes sessions <span className="tabular-nums">{windowLabel(hours)}</span>. That is
            a rule: a session outside it is refused, unless an organiser places it.
          </p>
          {ownDay && <p>Today keeps its own window — other days differ.</p>}
          {!ownDay && track.windows.length > 0 && (
            <p>
              Other days differ:{' '}
              {track.windows.map((w) => `${w.date} ${windowLabel(w)}`).join(', ')}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
