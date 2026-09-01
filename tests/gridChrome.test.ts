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
    expect(schedule).toMatch(/if \(was\) return top > 0;/);
    expect(schedule).toMatch(/return top > FOLD_AT &&/);
  });

  it('refuses to fold when folding would move the day under you', () => {
    // Folding hands the grid the height those rows were using. On a day not
    // much longer than the screen that height is more scroll than is left, so
    // the browser clamps back — a lurch, and at the top an instant unfold that
    // leaves the header flickering one notch either side of the threshold.
    // The rule measures the rows rather than assuming a height.
    expect(schedule).toMatch(/const slack = el\.scrollHeight - el\.clientHeight;/);
    expect(schedule).toMatch(/slack - top > gain \+ FOLD_AT/);
    expect(schedule).toMatch(/foldedBar\.current\?\.offsetHeight \?\? 0/);
    expect(schedule).toMatch(/foldedRows\.current\?\.offsetHeight \?\? 0/);
  });

  it('ignores the scroll events the fold itself causes', () => {
    // Every height the animation passes through moves the scroll position, and
    // none of those movements are the reader scrolling.
    expect(schedule).toMatch(/if \(foldInFlight\.current\) return;/);
    expect(schedule).toMatch(/foldInFlight\.current = false;\n\s*setFoldMoving\(false\);\n\s*readFold\(\);/);
  });

  it('keeps a way back that does not cost you your place in the day', () => {
    expect(schedule).toMatch(/aria-label=\{\n\s*folded\n\s*\? "Show the event bar and the day picker"/);
    expect(schedule).toMatch(/onClick=\{toggleChrome\}/);
    // The toggle is in the row that never folds, and is rendered in both
    // states: a control that disappears the moment you press it reads as a
    // control that did not work.
    expect(schedule).toMatch(/aria-expanded=\{!folded\}/);
    expect(schedule).toMatch(/\{folded \? "⌄" : "⌃"\}/);
  });

  it('does not let a nudge undo a header opened by hand', () => {
    // The momentum still arriving when the button is pressed is not an
    // instruction to fold the header again.
    expect(schedule).toMatch(/top > overrideFrom\.current \+ OVERRIDE_PX/);
    expect(schedule).toMatch(/const OVERRIDE_PX = 120;/);
  });

  it('folds over time rather than switching', () => {
    // A fold that happens in one frame reads as the header being cut off, and
    // as a jump in the grid that grows into the space. Long enough to follow,
    // short enough not to be waited on.
    expect(schedule).toMatch(/const FOLD_MS = 700;/);
    expect(schedule).toContain('duration-700');
  });

  it('animates a height that nothing had to guess', () => {
    // `0fr` → `1fr` keeps the row measuring itself the whole way down. A
    // max-height fold needs a number larger than the content, which then eases
    // through empty space and arrives late — and is wrong the day the row
    // wraps onto a third line.
    expect(schedule).toContain('grid-rows-[0fr]');
    expect(schedule).toContain('grid-rows-[1fr]');
    expect(schedule).not.toMatch(/max-h-\[\d/);
  });

  it('clips the folding rows only while they are folding', () => {
    // The profile menu drops out of the event bar, so `overflow-hidden` can
    // only be on while the row is moving or away — permanently, it would cut
    // the menu off at the bar's bottom edge.
    expect(schedule).toMatch(/folded \|\| foldMoving \? "overflow-hidden"/);
    // And a row that has finished leaving is not a tab stop.
    expect(schedule).toMatch(/folded && !foldMoving \? " invisible"/);
  });

  it('holds still for anyone who asked for less motion', () => {
    const moving = schedule.match(/transition-\[[^\]]+\]/g) ?? [];
    const spared = schedule.match(/motion-reduce:transition-none/g) ?? [];
    expect(moving.length).toBeGreaterThan(0);
    expect(spared.length).toBeGreaterThanOrEqual(moving.length);
  });

  it('offers one press back to the top of the day', () => {
    expect(schedule).toMatch(/aria-label="Back to the top of the day"/);
    // Scrolled, not jumped: the same scroll the fold listens to, so the header
    // comes back on the way up rather than blinking into place at the top.
    expect(schedule).toMatch(/scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
    // Its own rule, so it still shows on a day too short to fold.
    expect(schedule).toMatch(/setPastTop\(top > TOP_BUTTON_AT\)/);
    // Out of the way means out of reach, not merely invisible.
    expect(schedule).toMatch(/tabIndex=\{pastTop \? 0 : -1\}/);
  });

  it('keeps the week rail to one line', () => {
    // A rail that wraps costs a whole header line per extra row, on exactly
    // the screens with the least of them to spare. It scrolls sideways like
    // the day strip instead, so its chips cannot shrink or be cut in half.
    const rail = schedule.match(/className="no-scrollbar[^"]*"/);
    expect(rail).not.toBeNull();
    const classes = (rail as RegExpMatchArray)[0] as string;
    expect(classes).toContain('overflow-x-auto');
    expect(classes).not.toContain('flex-wrap');
    expect(schedule).toMatch(/shrink-0 whitespace-nowrap rounded-full border/);
  });

  it('pins the folding rows to the width that is there', () => {
    // The fold wraps each row in a grid, and a grid's default column is `auto`
    // — a track that grows to its content instead of constraining it. A row
    // wider than the phone therefore made the row itself wider than the
    // header: the week rail stopped scrolling and simply ran off the right
    // edge, taking the profile menu at the end of the event bar with it, under
    // an `overflow-x: clip` that hid the evidence.
    expect(schedule).toContain('grid-cols-[minmax(0,1fr)]');
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
