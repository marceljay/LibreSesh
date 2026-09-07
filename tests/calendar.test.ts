import { describe, expect, it } from 'vitest';
import type { SessionDto } from '../server/src/shared/types.js';
import {
  competingIds,
  drawnAt,
  overlappingIds,
  type DragTarget,
} from '../web/src/components/Calendar.js';

/** Only the fields overlappingIds actually reads. */
const placed = (id: number, roomId: number, startMin: number, endMin: number) => ({
  session: { id, roomId } as SessionDto,
  startMin,
  endMin,
});

describe('overlappingIds', () => {
  it('finds nothing in an empty or single-session day', () => {
    expect(overlappingIds([])).toEqual(new Set());
    expect(overlappingIds([placed(1, 1, 600, 660)])).toEqual(new Set());
  });

  it('flags both sides of a clash', () => {
    const ids = overlappingIds([placed(1, 1, 600, 660), placed(2, 1, 630, 690)]);
    expect(ids).toEqual(new Set([1, 2]));
  });

  it('does not flag back-to-back sessions', () => {
    expect(overlappingIds([placed(1, 1, 600, 660), placed(2, 1, 660, 720)])).toEqual(new Set());
  });

  it('ignores an identical time span in a different room', () => {
    expect(overlappingIds([placed(1, 1, 600, 660), placed(2, 2, 600, 660)])).toEqual(new Set());
  });

  it('flags a session fully contained in another', () => {
    expect(overlappingIds([placed(1, 1, 600, 720), placed(2, 1, 620, 640)])).toEqual(
      new Set([1, 2]),
    );
  });

  it('flags every member of a three-way pile-up', () => {
    const ids = overlappingIds([
      placed(1, 1, 600, 700),
      placed(2, 1, 620, 720),
      placed(3, 1, 640, 660),
    ]);
    expect(ids).toEqual(new Set([1, 2, 3]));
  });

  it('leaves a clean session out of a room that also has a clash', () => {
    const ids = overlappingIds([
      placed(1, 1, 600, 660),
      placed(2, 1, 630, 690),
      placed(3, 1, 800, 860),
    ]);
    expect(ids).toEqual(new Set([1, 2]));
  });
});

describe('drawnAt', () => {
  const row = { startMin: 600, durMin: 60, columnIndex: 1 };
  const target = (over: Partial<DragTarget> = {}): DragTarget => ({
    id: 1,
    mode: 'move',
    startMin: 660,
    durMin: 60,
    columnIndex: 2,
    ...over,
  });

  it('draws a block on its own row when nothing is being dragged', () => {
    expect(drawnAt(row, null, 4)).toEqual(row);
  });

  it('draws a dragged block at the drag target', () => {
    expect(drawnAt(row, target(), 4)).toEqual({ startMin: 660, durMin: 60, columnIndex: 2 });
  });

  /**
   * The regression this exists for. The server echoes our own move back over
   * SSE before it answers the PATCH, so the row reaches the client already
   * moved while the block is still held at the drop. The target must win
   * outright — combined with the row it would double the move, and the block
   * would visibly leap and then snap back when the hold cleared.
   */
  it('does not move again when the row has already caught up mid-hold', () => {
    const held = target({ pending: true });
    const echoed = { startMin: 660, durMin: 60, columnIndex: 2 };
    expect(drawnAt(echoed, held, 4)).toEqual(echoed);
    // And releasing the hold onto that row is a no-op, so nothing snaps.
    expect(drawnAt(echoed, null, 4)).toEqual(drawnAt(echoed, held, 4));
  });

  it('holds a resize at its dropped length while the row still has the old one', () => {
    const held = target({ mode: 'resize', startMin: 600, durMin: 90, columnIndex: 1 });
    expect(drawnAt(row, held, 4)).toEqual({ startMin: 600, durMin: 90, columnIndex: 1 });
  });

  it('clamps a column the grid is not showing', () => {
    expect(drawnAt({ ...row, columnIndex: -1 }, null, 4).columnIndex).toBe(0);
    expect(drawnAt(row, target({ columnIndex: 9 }), 4).columnIndex).toBe(3);
    expect(drawnAt(row, null, 0).columnIndex).toBe(0);
  });
});

/** A session that holds the floor, and one that does not. */
const hold = (id: number, roomId: number, startMin: number, endMin: number) => ({
  session: { id, roomId, blocksOpenBooking: true } as SessionDto,
  startMin,
  endMin,
});

describe('competingIds', () => {
  it('finds nothing when no session holds the floor', () => {
    expect(competingIds([])).toEqual(new Set());
    expect(competingIds([placed(1, 1, 600, 660), placed(2, 2, 600, 660)])).toEqual(new Set());
  });

  it('flags a session running against a hold, in any room', () => {
    const ids = competingIds([hold(1, 1, 600, 660), placed(2, 2, 600, 660)]);
    expect(ids).toEqual(new Set([2]));
  });

  it('flags a partial overlap on either side', () => {
    expect(competingIds([hold(1, 1, 600, 660), placed(2, 2, 570, 610)])).toEqual(new Set([2]));
    expect(competingIds([hold(1, 1, 600, 660), placed(2, 2, 650, 690)])).toEqual(new Set([2]));
  });

  it('leaves back-to-back sessions alone', () => {
    expect(competingIds([hold(1, 1, 600, 660), placed(2, 2, 660, 720)])).toEqual(new Set());
    expect(competingIds([hold(1, 1, 600, 660), placed(2, 2, 540, 600)])).toEqual(new Set());
  });

  it('never flags the hold itself, or a second hold', () => {
    expect(competingIds([hold(1, 1, 600, 660), hold(2, 2, 600, 660)])).toEqual(new Set());
  });

  it('flags a session once even when it runs against two holds', () => {
    const ids = competingIds([hold(1, 1, 600, 660), hold(2, 2, 650, 700), placed(3, 3, 610, 690)]);
    expect(ids).toEqual(new Set([3]));
  });
});
