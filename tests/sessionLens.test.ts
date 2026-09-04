import { describe, expect, it } from 'vitest';
import type { SessionDto } from '../server/src/shared/types.js';
import {
  lensActive,
  matchesLens,
  type SessionLens,
} from '../web/src/lib/sessionLens.js';
import { UNTRACKED } from '../web/src/lib/tracks.js';

/**
 * The lens is what narrows a set of sessions — room, tag, track, ★, now/next
 * and free text. It used to be a closure inside the schedule page, which meant
 * the search page could only grow a near-copy of it; it is one function now
 * precisely so "the same filters, over the whole event" is true rather than
 * approximately true. See `_planning/specs/search.md`.
 */
const session = (over: Partial<SessionDto> = {}): SessionDto =>
  ({
    id: 1,
    roomId: 10,
    trackId: null,
    title: 'Open space',
    description: '',
    speakers: [],
    tagIds: [],
    ...over,
  }) as SessionDto;

const lens = (over: Partial<SessionLens> = {}): SessionLens => ({
  rooms: [],
  tags: [],
  tracks: [],
  q: '',
  soon: false,
  mine: false,
  ...over,
});

/** Neither of the two surface-dependent answers, unless a test says otherwise. */
const context = (over: Partial<Parameters<typeof matchesLens>[2]> = {}) => ({
  starred: () => false,
  upcoming: () => false,
  ...over,
});

describe('matchesLens', () => {
  it('keeps everything when nothing is set', () => {
    expect(matchesLens(session(), lens(), context())).toBe(true);
  });

  it('narrows by room, tag and track', () => {
    const s = session({ roomId: 10, tagIds: [3], trackId: 7 });
    expect(matchesLens(s, lens({ rooms: [10] }), context())).toBe(true);
    expect(matchesLens(s, lens({ rooms: [11] }), context())).toBe(false);
    expect(matchesLens(s, lens({ tags: [3] }), context())).toBe(true);
    expect(matchesLens(s, lens({ tags: [4] }), context())).toBe(false);
    expect(matchesLens(s, lens({ tracks: [7] }), context())).toBe(true);
    expect(matchesLens(s, lens({ tracks: [UNTRACKED] }), context())).toBe(false);
  });

  it('ORs within one kind of chip and ANDs across kinds', () => {
    // Two rooms means either room; a room *and* a tag means both.
    const s = session({ roomId: 10, tagIds: [3] });
    expect(matchesLens(s, lens({ rooms: [10, 11] }), context())).toBe(true);
    expect(matchesLens(s, lens({ rooms: [10], tags: [4] }), context())).toBe(false);
  });

  it('matches free text the way the search box does — every word, any order', () => {
    const s = session({ title: 'Open space', speakers: [{ id: 2, name: 'Ada Lovelace' }] });
    expect(matchesLens(s, lens({ q: 'space open' }), context())).toBe(true);
    expect(matchesLens(s, lens({ q: 'ada' }), context())).toBe(true);
    expect(matchesLens(s, lens({ q: 'open closed' }), context())).toBe(false);
    // Whitespace is not a query: a box someone tapped and left is not a filter.
    expect(matchesLens(s, lens({ q: '   ' }), context())).toBe(true);
  });

  it('leaves ★ and now/next to the surface asking', () => {
    // Neither can be answered here: "mine" needs the identity's stars, and what
    // "now" means depends on whether the surface draws one day or the event.
    const s = session();
    expect(matchesLens(s, lens({ mine: true }), context())).toBe(false);
    expect(matchesLens(s, lens({ mine: true }), context({ starred: () => true }))).toBe(true);
    expect(matchesLens(s, lens({ soon: true }), context())).toBe(false);
    expect(matchesLens(s, lens({ soon: true }), context({ upcoming: () => true }))).toBe(true);
  });
});

describe('lensActive', () => {
  it('is false for an untouched lens and true for any one chip', () => {
    expect(lensActive(lens())).toBe(false);
    expect(lensActive(lens({ tags: [1] }))).toBe(true);
    expect(lensActive(lens({ mine: true }))).toBe(true);
    expect(lensActive(lens({ soon: true }))).toBe(true);
    expect(lensActive(lens({ q: 'ada' }))).toBe(true);
  });

  it('does not count a box holding only whitespace', () => {
    expect(lensActive(lens({ q: '  ' }))).toBe(false);
  });
});
