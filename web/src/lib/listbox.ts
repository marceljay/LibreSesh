/**
 * Where the highlight in a listbox goes after an arrow press.
 *
 * Pure, so the three comboboxes (speaker picker, schedule search, settings
 * search) share one answer to "what happens at the ends" instead of three
 * hand-rolled modulo expressions that had already drifted: two wrapped through
 * every row, one wrapped through a "nothing picked" position as well.
 *
 * `allowNone` is that position. `-1` means no row is highlighted, which is
 * what lets Enter in the schedule search mean "show me everything" rather than
 * "open the first hit": the highlight starts there, Down enters the list at
 * the top, Up from the top returns there.
 */
export function stepActive(
  active: number,
  delta: 1 | -1,
  count: number,
  allowNone = false,
): number {
  const rest = allowNone ? -1 : 0;
  if (count === 0) return rest;
  const next = active + delta;
  if (next < rest) return count - 1;
  if (next >= count) return rest;
  return next;
}
