import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A grid block's badges — draft, clash, competing, now — used to sit in the
 * same flex row as the tag dashes. That row is 4px tall, the height of the
 * dashes; a badge is a 16px chip, so whenever one appeared the row grew and
 * carried the title, the time and everything under them 12px down the block
 * (measured in Chromium at 1440×1000: strip 4→16, title top 11→23).
 *
 * `now` is the one that made it a bug rather than an inconsistency. The other
 * three are fixed properties of a session, so a block wearing one simply
 * looked different from its neighbours. `now` arrives on the clock: the minute
 * a session went live its own title and time jumped down a line, out of step
 * with every block beside it, and on a short block the push sent the time
 * under the bottom edge, which is `overflow-hidden`.
 *
 * So the badges come out of the flow, the way `StarTally` already does at the
 * other corner, and the tag strip keeps the 4px it always had. There is no
 * layout in jsdom to measure, so what is pinned here is the structure that
 * gets that result.
 */
const calendar = readFileSync(
  join(__dirname, '..', 'web', 'src', 'components', 'Calendar.tsx'),
  'utf8',
);

/** The block's badge cluster, from its opening tag to the closing brace. */
const cluster = calendar.match(
  /\{\(session\.draft \|\| clash \|\| competes \|\| live\) && \([\s\S]*?\n {16}\)\}/,
);

describe('a grid block puts its badges over the block, not in it', () => {
  it('draws the badges out of the flow, in the block’s top corner', () => {
    expect(cluster).not.toBeNull();
    const markup = (cluster as RegExpMatchArray)[0];
    expect(markup).toMatch(/<div className="absolute end-2 top-1 [^"]*flex items-center/);
  });

  it('takes the block’s own background so a long title truncates under a chip', () => {
    // `bg-inherit`, not a literal colour: the block underneath is white, or
    // stone-900 in dark, or a draft's stone-100/stone-800, and the strip has
    // to be whichever of those it is sitting on. Verified in Chromium — the
    // computed background matches the block's in all four combinations.
    const markup = (cluster as RegExpMatchArray)[0];
    expect(markup).toContain('bg-inherit');
    expect(markup).not.toMatch(/\bbg-white\b|\bbg-stone-100\b/);
  });

  it('leaves the tag strip alone at the height of the dashes', () => {
    // The strip that remains in the flow holds the tags and nothing else: one
    // chip back in it is the whole bug.
    const strip = calendar.match(
      /<div className="flex items-center gap-1">\s*\{session\.tagIds\.map\(([\s\S]*?)\n {16}<\/div>/,
    );
    expect(strip).not.toBeNull();
    const markup = (strip as RegExpMatchArray)[0];
    expect(markup).toContain('h-1 w-4 rounded-full');
    expect(markup).not.toMatch(/draft|clash|competes|live/);
  });

  it('no longer needs a badge to know which badges came before it', () => {
    // In the flow each chip pushed itself right with `ms-auto`, and only the
    // first one could: every later chip carried a condition naming the ones
    // before it. The cluster is right-aligned as a whole now, so the chips
    // are plain and independent.
    const markup = (cluster as RegExpMatchArray)[0];
    expect(markup).not.toContain('ms-auto');
    expect(markup).not.toMatch(/\$\{clash \? '' : /);
    expect(markup).not.toMatch(/\$\{clash \|\| competes \|\| session\.draft \? '' : /);
  });

  it('still says all four things, with the reasons a reader hovers for', () => {
    const markup = (cluster as RegExpMatchArray)[0];
    for (const word of ['draft', 'clash', 'competing', 'now']) {
      expect(markup).toContain(`>\n                        ${word}\n`);
    }
    expect(markup).toContain('Overlaps another session in this room');
    expect(markup).toContain('Runs against a session everyone should be at');
    expect(markup).toContain('bg-highlight');
  });
});
