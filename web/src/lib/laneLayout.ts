import type { SessionDto } from '@shared/types';

export interface Lane {
  /** Which side-by-side slot this session sits in, 0-based. */
  lane: number;
  /** How many slots its cluster is split into — the width divisor. */
  lanes: number;
}

/**
 * Greedy lane assignment so overlapping sessions in one *column* sit side by
 * side. Keyed to the column, not the room: lanes are about what visually
 * collides, and when the columns are tracks two sessions in different rooms
 * do collide on screen.
 *
 * The lane count is scoped to a **cluster** — a run of sessions each of which
 * overlaps the one before — not to the whole column. So a single clash halves
 * only the two sessions that clash; a session sitting alone an hour later keeps
 * the full width, instead of being narrowed by a collision it has no part in.
 */
export function laneLayout(
  items: { session: SessionDto; startMin: number; endMin: number }[],
  columnOf: (session: SessionDto) => number,
): Map<number, Lane> {
  const byColumn = new Map<number, typeof items>();
  for (const item of items) {
    const key = columnOf(item.session);
    const list = byColumn.get(key);
    if (list) list.push(item);
    else byColumn.set(key, [item]);
  }
  const out = new Map<number, Lane>();
  for (const list of byColumn.values()) {
    const sorted = list.slice().sort((a, b) => a.startMin - b.startMin);

    let cluster: typeof sorted = [];
    let clusterEnd = -Infinity;
    // Assign lanes within one cluster and stamp every member with the cluster's
    // own lane count — the width divisor is the local collision, not the day's.
    const flush = () => {
      const laneEnds: number[] = [];
      for (const item of cluster) {
        let index = laneEnds.findIndex((end) => end <= item.startMin);
        if (index === -1) {
          laneEnds.push(item.endMin);
          index = laneEnds.length - 1;
        } else {
          laneEnds[index] = item.endMin;
        }
        out.set(item.session.id, { lane: index, lanes: 1 });
      }
      for (const item of cluster) {
        const entry = out.get(item.session.id);
        if (entry) entry.lanes = laneEnds.length;
      }
      cluster = [];
      clusterEnd = -Infinity;
    };

    for (const item of sorted) {
      // A session that starts at or after everything so far has ended begins a
      // new cluster: back-to-back (start === previous end) does not collide.
      if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMin);
    }
    flush();
  }
  return out;
}
