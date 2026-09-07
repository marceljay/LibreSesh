/**
 * Where the now line goes in a list of rows sorted by start time.
 *
 * The grid draws its line at a minute on an axis; the list has no axis, so
 * its line sits between rows. Before the first row that has not started yet:
 * a row that is running keeps the line below it — its cards already say
 * "now", and a line above them would read as "now is before this". After
 * every row once the last one has started (`rows.length`: the programme is
 * behind you). Nowhere (`-1`) when there is no now, which is any day but
 * today.
 */
export function nowLineIndex(rows: readonly { start: number }[], nowMin: number | null): number {
  if (nowMin === null) return -1;
  const next = rows.findIndex((row) => row.start > nowMin);
  return next === -1 ? rows.length : next;
}
