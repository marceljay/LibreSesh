import { describe, expect, it } from 'vitest';
import type { BundleDto } from '../server/src/shared/types.js';
import { applyStar } from '../web/src/lib/useEventData.js';

/**
 * A star is two facts drawn as one object: whether it is yours (the star's
 * colour) and how many people put it on their agenda (the number beside it).
 *
 * The optimistic toggle only ever moved the first. So a click turned the star
 * amber under a number that did not budge — which reads as the click not
 * having worked, and is the one thing an optimistic update exists to prevent.
 * Stars carry no server change event either, so nothing came along to correct
 * it: the tally stayed wrong until the next reload.
 */
const bundle = (over: Partial<BundleDto> = {}): BundleDto =>
  ({ starredSessionIds: [], starCounts: {}, ...over }) as BundleDto;

describe('starring moves the tally with it', () => {
  it('counts your star the moment you make it', () => {
    const next = applyStar(bundle({ starCounts: { 7: 3 } }), 7, true);
    expect(next.starredSessionIds).toContain(7);
    expect(next.starCounts[7]).toBe(4);
  });

  it('counts it back down when you take it off', () => {
    const next = applyStar(bundle({ starredSessionIds: [7], starCounts: { 7: 4 } }), 7, false);
    expect(next.starredSessionIds).not.toContain(7);
    expect(next.starCounts[7]).toBe(3);
  });

  it('starts a session nobody had starred at one', () => {
    // No entry at all, rather than a zero — the server only sends the ones
    // with a count.
    expect(applyStar(bundle(), 7, true).starCounts[7]).toBe(1);
  });

  it('never renders a negative tally', () => {
    // A count that arrived stale would otherwise go below zero and be drawn.
    expect(applyStar(bundle({ starredSessionIds: [7] }), 7, false).starCounts[7]).toBe(0);
  });

  it('leaves other sessions alone', () => {
    const next = applyStar(bundle({ starCounts: { 7: 3, 8: 9 } }), 7, true);
    expect(next.starCounts[8]).toBe(9);
  });

  it('is idempotent, so a repeated flip cannot inflate the count', () => {
    // The reducer leans on this: same object back means no render, and it is
    // also what stops a double-fire counting twice.
    const already = bundle({ starredSessionIds: [7], starCounts: { 7: 4 } });
    expect(applyStar(already, 7, true)).toBe(already);
    const none = bundle({ starCounts: { 7: 4 } });
    expect(applyStar(none, 7, false)).toBe(none);
  });

  it('does not mutate what it was given', () => {
    // The revert path re-applies the old value on failure, and would have
    // nothing to go back to.
    const before = bundle({ starCounts: { 7: 3 } });
    applyStar(before, 7, true);
    expect(before.starCounts[7]).toBe(3);
    expect(before.starredSessionIds).toEqual([]);
  });
});
