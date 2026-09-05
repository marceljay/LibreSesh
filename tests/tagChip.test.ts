import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TAG_COLORS } from '../server/src/shared/tagColors.js';

/**
 * The palette is bright on purpose — Okabe–Ito, so two tags stay distinct to
 * the common forms of colour blindness — but a *filled* chip spends that
 * brightness on a surface. A session carrying four tags was four saturated
 * blocks shouting over the title they belong to.
 *
 * The fix is the render, not the data: every tag ever created goes calm at
 * once, no migration, and the eight hues are still eight distinguishable
 * things because the hue survives in the wash and the edge.
 *
 * There is no DOM in this suite, so what is pinned is where the chip is drawn
 * from and that nothing draws its own any more.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const read = (...p: string[]) => readFileSync(join(WEB_SRC, ...p), 'utf8');
const ui = read('components', 'ui.tsx');

/** Every place a stored tag or format colour reaches the page. */
const CALL_SITES = [
  ['components', 'SessionDetail.tsx'],
  ['components', 'ListView.tsx'],
  ['components', 'ProposalBoard.tsx'],
  ['pages', 'BoardPreview.tsx'],
];

describe('a tag is a wash and an edge, not a fill', () => {
  it('carries the hue without spending it on a surface', () => {
    expect(ui).toContain('color-mix(in srgb, ${color} 14%, transparent)');
    expect(ui).toContain('color-mix(in srgb, ${color} 45%, transparent)');
  });

  it('reads in neutral ink, so a typed-in colour cannot make it illegible', () => {
    // `readableInk` existed because a filled chip's text sits on the tag's own
    // colour. The wash sits on the page's background instead, so the ink is
    // the page's and there is no per-colour decision left to get wrong.
    const chip = /export function TagChip\(([\s\S]*?)\n}/.exec(ui)?.[1] ?? '';
    expect(chip).not.toBe('');
    expect(chip).toContain('text-stone-700');
    expect(chip).toContain('dark:text-stone-200');
    expect(chip).not.toContain('readableInk');
  });

  it('refuses to put anything but a hex literal into color-mix', () => {
    // A stored colour is free text an organiser may type. One invalid
    // argument invalidates the whole declaration, taking the chip's border
    // and padding with it — so the guard is what keeps a bad value looking
    // like a plain chip rather than like a bug.
    expect(ui).toContain('const isHex =');
    expect(ui).toMatch(/isHex\(color\)\s*\?/);
  });

  it('is the only tag chip in the app', () => {
    for (const site of CALL_SITES) {
      const source = read(...site);
      expect({ site, hasOwnChip: source.includes('background: tag.color') }).toEqual({
        site,
        hasOwnChip: false,
      });
      expect({ site, usesReadableInk: source.includes('readableInk') }).toEqual({
        site,
        usesReadableInk: false,
      });
    }
  });

  it('leaves the stored palette alone — this was never a data change', () => {
    // The point of "retroactively, in one go": the eight colours are still
    // the eight colours, and every tag already created is already calmer.
    expect(TAG_COLORS).toHaveLength(8);
    expect(TAG_COLORS[0]).toBe('#0072B2');
  });
});

describe('a format is not a tag', () => {
  const detail = read('components', 'SessionDetail.tsx');

  it('has no fill at all, only a rule in its own colour', () => {
    const label = /export function FormatLabel\(([\s\S]*?)\n}/.exec(ui)?.[1] ?? '';
    expect(label).not.toBe('');
    expect(label).toContain('border-s-2');
    expect(label).toContain('borderColor: color');
    expect(label).not.toContain('background');
  });

  it('sits beside the title rather than in the row of labels above it', () => {
    // A format says what the session *is*; a tag says what it is about.
    // Drawn as two coloured pills in one row they read as one list of
    // interchangeable labels, which is the confusion this moves out of.
    // Anchored on the heading itself, not on `session.title` — the star
    // button's aria-label names the title too, well above either of these.
    const headingAt = detail.indexOf('</h2>');
    const formatAt = detail.indexOf('<FormatLabel');
    const tagsAt = detail.indexOf('<TagChip');
    expect(headingAt).toBeGreaterThan(-1);
    expect(formatAt).toBeGreaterThan(headingAt);
    expect(tagsAt).toBeLessThan(headingAt);
  });
});
