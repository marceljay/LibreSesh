import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The grid's room cards are `sticky top-0` inside the grid's own scroller, so
 * they only hold their place while the grid is the thing being scrolled. It
 * used to be sized `max-height: calc(100vh - 200px)` — a guess at the header's
 * height — and whenever the real header was taller the document scrolled too:
 * the header stayed put (it was sticky to the window), the grid slid up under
 * it, and the room labels went with it. You were left reading an unlabelled
 * column of boxes.
 *
 * The fix is structural: the page is a viewport-height shell that cannot
 * scroll, and the grid takes the height that is left. There is no DOM here, so
 * what is pinned is the shape of that shell, and the fold that gives the grid
 * more of it once you are into the day.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const schedule = readFileSync(join(WEB_SRC, 'pages', 'SchedulePage.tsx'), 'utf8');
const calendar = readFileSync(join(WEB_SRC, 'components', 'Calendar.tsx'), 'utf8');

describe('the schedule is a shell, not a document', () => {
  it('gives the page the viewport height and no scroll of its own', () => {
    const root = schedule.match(/<div className="(flex h-\[100dvh\][^"]*)">/);
    expect(root).not.toBeNull();
    const classes = (root as RegExpMatchArray)[1] as string;
    // `dvh`, not `vh`: on a phone `vh` counts the strip behind the address bar,
    // which would push the bottom of the grid off screen.
    expect(classes).toContain('h-[100dvh]');
    expect(classes).toContain('flex-col');
    expect(classes).toContain('overflow-hidden');
  });

  it('leaves the header no reason to be sticky', () => {
    // Sticky is what a header needs when the document scrolls under it. This
    // one is a flex row that cannot be scrolled away, and saying `sticky` here
    // again would hide a page that had started scrolling behind it.
    expect(schedule).not.toMatch(/<header className="sticky/);
    expect(schedule).toMatch(/<header className="[^"]*shrink-0/);
  });

  it('sizes the grid from the shell rather than guessing the header', () => {
    expect(calendar).toContain('h-full overflow-auto');
    expect(calendar).not.toContain('100vh');
    expect(calendar).not.toContain('maxHeight');
  });
});

describe('the header folds once you are into the day', () => {
  it('folds on scroll and unfolds back at the top', () => {
    // Two thresholds, not one: a header that folded and unfolded on the same
    // scroll position would flicker, because folding resizes the grid it is
    // measuring.
    expect(schedule).toMatch(/setChromeFolded\(\(was\) => top > \(was \? 0 : 24\)\)/);
  });

  it('keeps a way back that does not cost you your place in the day', () => {
    expect(schedule).toMatch(/aria-label="Show the event bar and the day picker"/);
    expect(schedule).toMatch(/onClick=\{\(\) => setChromePinned\(true\)\}/);
  });

  it('keeps Now in the row that survives the fold', () => {
    // The action row folds away; the filter row does not. Now belongs with the
    // filters, between the Filter menu and the chips it puts up.
    const filter = schedule.indexOf('<FilterMenu');
    const now = schedule.indexOf('data-tour="now"');
    const chips = schedule.indexOf('<ActiveFilters');
    expect(filter).toBeGreaterThan(-1);
    expect(now).toBeGreaterThan(filter);
    expect(chips).toBeGreaterThan(now);
  });
});
