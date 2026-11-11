import { describe, expect, it } from 'vitest';
import type { SessionDto } from '../server/src/shared/types';
import { clashAt, clashLabel, roomBusy } from '../web/src/lib/roomAvailability';

/**
 * The form's copy of the server's overlap rules (`assertNoOverlap`,
 * `findBlockingSession`): what a session being placed would run into. If the
 * two disagree, the lists grey a slot the server would take or offer one it
 * refuses, so the cases here are the server's own edges.
 */

const TZ = 'Europe/Berlin'; // UTC+2 on the day below
const DAY = '2026-06-01';
const session = (over: Partial<SessionDto>): SessionDto =>
  ({
    id: 1,
    roomId: 1,
    title: 'Keynote',
    blocksOpenBooking: false,
    draft: false,
    // 10:00–11:00 local
    startsAt: '2026-06-01T08:00:00.000Z',
    endsAt: '2026-06-01T09:00:00.000Z',
    ...over,
  }) as SessionDto;

describe('roomBusy', () => {
  it('keeps what is in the room and nothing else', () => {
    const busy = roomBusy([session({}), session({ id: 2, roomId: 2, title: 'Next door' })], {
      roomId: 1,
    });
    expect(busy.map((b) => b.title)).toEqual(['Keynote']);
  });

  it('skips drafts and the session being edited', () => {
    const all = [session({ id: 1, draft: true }), session({ id: 2 })];
    expect(roomBusy(all, { roomId: 1, excludeId: 2 })).toEqual([]);
  });

  it('counts a session holding the floor in any room, only when asked', () => {
    const all = [session({ id: 3, roomId: 2, blocksOpenBooking: true })];
    expect(roomBusy(all, { roomId: 1 })).toEqual([]);
    const busy = roomBusy(all, { roomId: 1, holdsCount: true });
    expect(busy).toHaveLength(1);
    expect(busy[0]?.hold).toBe(true);
  });

  it('does not ignore a hold in another room because it is a draft elsewhere', () => {
    const all = [session({ id: 3, roomId: 2, blocksOpenBooking: true, draft: true })];
    expect(roomBusy(all, { roomId: 1, holdsCount: true })).toEqual([]);
  });
});

describe('clashAt', () => {
  const busy = roomBusy([session({})], { roomId: 1 });
  const at = (startMin: number, durMin: number) => clashAt(busy, DAY, startMin, durMin, TZ);

  it('finds any overlap, however partial', () => {
    expect(at(600, 30)?.title).toBe('Keynote'); // starts with it
    expect(at(630, 60)?.title).toBe('Keynote'); // starts inside, runs past
    expect(at(570, 45)?.title).toBe('Keynote'); // runs into its start
    expect(at(540, 180)?.title).toBe('Keynote'); // swallows it
  });

  it('lets back-to-back through, either side', () => {
    expect(at(570, 30)).toBeNull(); // 09:30–10:00
    expect(at(660, 30)).toBeNull(); // 11:00–11:30
  });

  it('is free on another day', () => {
    expect(clashAt(busy, '2026-06-02', 600, 30, TZ)).toBeNull();
  });

  it('names what is in the way on the event’s clock', () => {
    expect(clashLabel(at(600, 30)!, TZ)).toBe('“Keynote” (10:00–11:00)');
  });
});
