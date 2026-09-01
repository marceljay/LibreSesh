/**
 * Tag colours. Bright and saturated, which is the opposite of `ROOM_COLORS`
 * and deliberately so: a room colour is a column that text sits on all day, so
 * it has to stay out of the way, while a tag is a chip a few characters wide
 * that has to be picked out at a glance from across a session block.
 *
 * Every one of these carries white text at 4.5:1 or better, because that is
 * how a tag is drawn everywhere it appears — a filled pill with the tag's name
 * in white on it. A brighter yellow or a mid-green would read well as a dot
 * and be unreadable as a chip, which is why the list stops where it does.
 *
 * Shared so the client renders swatches from the same list the server assigns
 * defaults from.
 */
export const TAG_COLORS = [
  '#2563EB', // blue
  '#E11D48', // rose
  '#047857', // emerald
  '#7C3AED', // violet
  '#B45309', // amber
  '#0E7490', // cyan
  '#C026D3', // fuchsia
  '#4D7C0F', // lime
] as const;

/**
 * Grey. Not in the palette and not assigned to anything any more — it is what
 * the tags created before there was a palette still carry, and what a caller
 * gets if they ask for no colour at all in a way the assignment cannot serve.
 */
export const LEGACY_TAG_COLOR = '#6B7280';

/**
 * The first colour no live tag is using, so a new tag looks different from its
 * neighbours without anyone choosing. Cycles once every colour is spoken for —
 * a repeat is better than the alternative, which was every tag being the same
 * grey.
 */
export function nextTagColor(taken: readonly string[]): string {
  const used = new Set(taken.map((c) => c.toLowerCase()));
  const free = TAG_COLORS.find((c) => !used.has(c.toLowerCase()));
  return free ?? TAG_COLORS[taken.length % TAG_COLORS.length];
}
