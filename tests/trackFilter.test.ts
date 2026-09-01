import { describe, expect, it } from 'vitest';
import { UNTRACKED, matchesTracks, trackBucket } from '../web/src/lib/tracks.js';

const on = (trackId: number | null) => ({ trackId });

describe('trackBucket', () => {
  it('is the session’s own track when it has one', () => {
    expect(trackBucket(on(7))).toBe(7);
  });

  it('is the unassigned bucket when it has none', () => {
    expect(trackBucket(on(null))).toBe(UNTRACKED);
  });

  it('cannot collide with a real track id', () => {
    // Track ids come from an autoincrement column, so they are always ≥ 1.
    expect(UNTRACKED).toBeLessThan(1);
  });
});

describe('matchesTracks', () => {
  it('narrows nothing when nothing is selected', () => {
    expect(matchesTracks([], on(3))).toBe(true);
    expect(matchesTracks([], on(null))).toBe(true);
  });

  it('keeps only the selected tracks', () => {
    expect(matchesTracks([3], on(3))).toBe(true);
    expect(matchesTracks([3], on(4))).toBe(false);
    expect(matchesTracks([3, 4], on(4))).toBe(true);
  });

  it('drops untracked sessions unless the unassigned bucket is selected', () => {
    expect(matchesTracks([3], on(null))).toBe(false);
    expect(matchesTracks([UNTRACKED], on(null))).toBe(true);
  });

  it('selects the unassigned bucket alongside real tracks', () => {
    const selected = [3, UNTRACKED];
    expect(matchesTracks(selected, on(3))).toBe(true);
    expect(matchesTracks(selected, on(null))).toBe(true);
    expect(matchesTracks(selected, on(4))).toBe(false);
  });

  it('does not let the unassigned bucket catch a tracked session', () => {
    expect(matchesTracks([UNTRACKED], on(3))).toBe(false);
  });
});
