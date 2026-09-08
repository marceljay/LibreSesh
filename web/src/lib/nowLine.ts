/**
 * Where the now line goes in a list of rows sorted by start time.
 *
 * The grid draws its line at a minute on an axis; the list has no axis, so
 * its line goes where the sessions are: across every card that is running
 * (the list draws that itself), and only when none is, in a gap between rows.
 * `nowLineIndex` says which gap: before the first row that has not started
 * yet, after every row once the last one has started (`rows.length`: the
 * programme is behind you), nowhere (`-1`) when there is no now, which is any
 * day but today. A line under a running row read as "now is after this", so
 * a running row never gets the gap line — it gets the line across its cards.
 */
export function nowLineIndex(rows: readonly { start: number }[], nowMin: number | null): number {
  if (nowMin === null) return -1;
  const next = rows.findIndex((row) => row.start > nowMin);
  return next === -1 ? rows.length : next;
}
