import { describe, expect, it } from 'vitest';
import type { SessionDto } from '../server/src/shared/types.js';
import { laneLayout } from '../web/src/lib/laneLayout.js';

/**
 * The grid lays overlapping sessions side by side by splitting a column into
 * lanes. The bug this pins: the split must be scoped to the clash, not the
 * whole column — a session an hour away from any collision keeps the full
 * width instead of being narrowed by one it has no part in.
 */
describe('laneLayout', () => {
  const item = (id: number, startMin: number, endMin: number) => ({
    session: { id, roomId: 1 } as SessionDto,
    startMin,
    endMin,
  });
  const oneColumn = () => 0;

  it('gives a lone session the full width', () => {
    const lanes = laneLayout([item(1, 600, 660)], oneColumn);
    expect(lanes.get(1)).toEqual({ lane: 0, lanes: 1 });
  });

  it('splits two clashing sessions into two lanes', () => {
    const lanes = laneLayout([item(1, 600, 720), item(2, 660, 780)], oneColumn);
    expect(lanes.get(1)).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get(2)).toEqual({ lane: 1, lanes: 2 });
  });

  it('does not narrow sessions above or below the clash', () => {
    // A 09:00–10:00 alone, then B 10:00–12:00 and C 11:00–13:00 clash, then
    // D 14:00–15:00 alone. Only B and C are halved; A and D keep full width.
    const lanes = laneLayout(
      [item(1, 540, 600), item(2, 600, 720), item(3, 660, 780), item(4, 840, 900)],
      oneColumn,
    );
    expect(lanes.get(1)?.lanes).toBe(1); // A — the one the bug wrongly narrowed
    expect(lanes.get(2)?.lanes).toBe(2); // B
    expect(lanes.get(3)?.lanes).toBe(2); // C
    expect(lanes.get(4)?.lanes).toBe(1); // D
  });

  it('treats back-to-back sessions as separate clusters', () => {
    // 10:00–11:00 then 11:00–12:00 touch but do not overlap.
    const lanes = laneLayout([item(1, 600, 660), item(2, 660, 720)], oneColumn);
    expect(lanes.get(1)?.lanes).toBe(1);
    expect(lanes.get(2)?.lanes).toBe(1);
  });

  it('reuses a freed lane so a chain of clashes stays two wide', () => {
    // A 10–11 & B 10:30–11:30 clash (2 lanes); C 11:15–12:00 overlaps only B,
    // so it reuses A's freed lane and the cluster stays two wide, not three.
    const lanes = laneLayout(
      [item(1, 600, 660), item(2, 630, 690), item(3, 675, 720)],
      oneColumn,
    );
    expect(lanes.get(1)).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get(2)).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get(3)).toEqual({ lane: 0, lanes: 2 }); // back in lane 0
  });

  it('keeps clashes in different columns independent', () => {
    const lanes = laneLayout(
      [item(1, 600, 720), item(2, 660, 780), item(3, 600, 660)],
      (s) => (s.id === 3 ? 1 : 0), // session 3 in its own column
    );
    expect(lanes.get(1)?.lanes).toBe(2);
    expect(lanes.get(3)?.lanes).toBe(1); // alone in column 1
  });

  it('scopes the clash per column when columns are tracks, not rooms', () => {
    // The grid's track axis keys columns by trackId, so two sessions in
    // different rooms but the same track do collide on screen and must lane;
    // a session elsewhere in that track keeps full width, and a session in
    // another track is untouched. This is the track-view version of the bug —
    // laneLayout is axis-agnostic, so the same clustering has to hold here.
    const trackItem = (id: number, trackId: number, startMin: number, endMin: number) => ({
      session: { id, trackId } as unknown as SessionDto,
      startMin,
      endMin,
    });
    const byTrack = (s: SessionDto) => (s as unknown as { trackId: number }).trackId;
    const lanes = laneLayout(
      [
        trackItem(1, 7, 600, 660), // track 7, 10:00–11:00 (room A)
        trackItem(2, 7, 600, 660), // track 7, 10:00–11:00 (room B) — clashes with 1
        trackItem(3, 7, 840, 900), // track 7, 14:00–15:00 — far from the clash
        trackItem(4, 9, 600, 660), // track 9, 10:00–11:00 — different track
      ],
      byTrack,
    );
    expect(lanes.get(1)?.lanes).toBe(2); // clashing pair splits
    expect(lanes.get(2)?.lanes).toBe(2);
    expect(lanes.get(3)?.lanes).toBe(1); // the distant one keeps full width
    expect(lanes.get(4)?.lanes).toBe(1); // another track is unaffected
  });
});
