import { describe, expect, it } from 'vitest';
import {
  roomHasInfo,
  roomNote,
  seatsLabel,
  type RoomFactsInput,
} from '../web/src/lib/rooms.js';

const room = (over: Partial<RoomFactsInput> = {}): RoomFactsInput => ({
  capacity: null,
  description: '',
  openBooking: false,
  ...over,
});

describe('seatsLabel', () => {
  it('says nothing when capacity is unset', () => {
    expect(seatsLabel(null)).toBeNull();
  });

  it('agrees in number', () => {
    expect(seatsLabel(1)).toBe('1 seat');
    expect(seatsLabel(40)).toBe('40 seats');
  });

  it('keeps a deliberate zero', () => {
    expect(seatsLabel(0)).toBe('0 seats');
  });
});

describe('roomNote', () => {
  it('is empty for a room with nothing written about it', () => {
    expect(roomNote(room())).toBe('');
    expect(roomNote(room({ description: '   ' }))).toBe('');
  });

  it("carries the organiser's directions, trimmed", () => {
    expect(roomNote(room({ description: '  Ground floor, past the café  ' }))).toBe(
      'Ground floor, past the café',
    );
  });

  it('is the directions alone — seats are seatsLabel\'s job', () => {
    expect(roomNote(room({ capacity: 60 }))).toBe('');
  });
});

describe('roomHasInfo', () => {
  it('is false for a room with nothing to say, so the card is a bare name', () => {
    expect(roomHasInfo(room())).toBe(false);
    expect(roomHasInfo(room({ description: '  ' }))).toBe(false);
  });

  it('is true for each thing the panel can draw on its own', () => {
    // The card no longer carries seats or the booking permission, so either
    // one alone has to be enough to put the button there — otherwise the fact
    // is in the app and reachable from nowhere.
    expect(roomHasInfo(room({ description: 'Past the café' }))).toBe(true);
    expect(roomHasInfo(room({ capacity: 40 }))).toBe(true);
    expect(roomHasInfo(room({ openBooking: true }))).toBe(true);
  });

  it('counts a deliberate zero capacity, which is a real thing to say', () => {
    expect(roomHasInfo(room({ capacity: 0 }))).toBe(true);
  });
});
