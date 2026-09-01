/**
 * Tag colours: the Okabe–Ito palette, eight colours chosen to stay distinct to
 * the common forms of colour blindness. A tag is a chip a few characters wide
 * that has to be told apart at a glance from across a session block, and
 * "told apart" has to hold for the roughly one in twelve men who would read a
 * red/green pair as the same chip.
 *
 * It is the opposite of `ROOM_COLORS` and deliberately so: a room colour is a
 * column that text sits on all day, so it stays out of the way; a tag is meant
 * to be spotted.
 *
 * These are bright rather than dark, so a chip cannot assume white text the
 * way it used to — yellow and sky blue carry black, blue and vermillion carry
 * white. `readableInk` in the client picks per colour, which is also what
 * keeps a custom colour someone types in legible.
 */
export const TAG_COLORS = [
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#009E73', // bluish green
  '#CC79A7', // reddish purple
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#F0E442', // yellow
  '#000000', // black
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

/**
 * Black or white, whichever can be read on `hex`. WCAG relative luminance,
 * then the plain contrast ratio against each — white on Okabe–Ito's yellow is
 * 1.1:1, which is a chip with no text on it as far as anyone reading it is
 * concerned.
 *
 * Shared because the same question is asked of a custom colour someone typed
 * in, and there is no palette to look that one up in.
 */
export function readableInk(hex: string): '#000000' | '#FFFFFF' {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (full.length !== 6 || /[^0-9a-f]/i.test(full)) return '#FFFFFF';
  const channel = (pair: string): number => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * channel(full.slice(0, 2)) +
    0.7152 * channel(full.slice(2, 4)) +
    0.0722 * channel(full.slice(4, 6));
  // Against white the ratio is 1.05 / (L + 0.05); against black, (L + 0.05) / 0.05.
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}
