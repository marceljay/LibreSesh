import type { RoomDto } from '@shared/types';

/** Only what a room's header reads, so tests and callers need no full DTO. */
export type RoomFactsInput = Pick<RoomDto, 'capacity' | 'description' | 'openBooking'>;

/** "40 seats", "1 seat", or nothing at all. Capacity is optional by design —
 *  most unconference rooms never get one — so an unset capacity has nothing to
 *  say to a reader. "no capacity set" told them about an empty database column,
 *  not about the room. */
export const seatsLabel = (capacity: number | null): string | null =>
  capacity === null ? null : `${capacity} seat${capacity === 1 ? '' : 's'}`;

/**
 * The organiser's directions — which floor, which door, what to bring — or ''
 * when there are none.
 *
 * The first thing in the room's info panel, above the seats and the booking
 * permission. Those used to sit on the column card instead, on a second line
 * that truncated; the card is now the room's name alone, so everything a
 * reader might want about a room is in one place behind the ⓘ rather than
 * split across two.
 */
export const roomNote = (room: RoomFactsInput): string => room.description.trim();

/**
 * Whether the column header has anything to offer behind its ⓘ.
 *
 * The button's presence is the signal that there is more to read, so it has to
 * track every line the panel can draw — directions, seats, the booking
 * permission. A room with none of them is a name and nothing else, and gets no
 * button to disappoint anyone with.
 */
export const roomHasInfo = (room: RoomFactsInput): boolean =>
  roomNote(room) !== '' || room.capacity !== null || room.openBooking;
