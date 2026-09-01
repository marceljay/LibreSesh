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
const rail = readFileSync(join(WEB_SRC, 'components', 'Rail.tsx'), 'utf8');

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
    // The same two icons in both states, so the button is the same width
    // whichever way it is pointing — and on a Tuesday as on a Wednesday. It
    // used to carry the day as text, which moved it under the thumb reaching
    // for it.
    expect(schedule).toMatch(/<CalendarIcon className="h-3\.5 w-3\.5" \/>/);
    expect(schedule).toMatch(/folded \? \(\n\s*<ChevronDownIcon/);
    expect(schedule).not.toContain('foldedDay');
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
    expect(schedule).toMatch(/<Rail label="Weeks"/);
    expect(rail).toContain('overflow-x-auto');
    expect(rail).toContain('no-scrollbar');
    expect(rail).not.toContain('flex-wrap');
    expect(schedule).toMatch(/shrink-0 whitespace-nowrap rounded-full border/);
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

  it('folds in the list as well as the grid', () => {
    // The fold was pinned to the grid's own scroller, so in the list — which
    // has none of its own and scrolls <main> — the listener had nothing to
    // listen to and the header never folded. Now that the list is where an
    // event opens by default, that was most of the readers.
    expect(schedule).toMatch(/const foldable = !fullPage;/);
    expect(schedule).toMatch(/<main\n\s*ref=\{mainRef\}/);
  });

  it('asks which box is scrolling rather than predicting it', () => {
    // Naming the scroller in advance — the grid's, or the grid's in one view
    // and <main> in the other — left the fold listening to a box that never
    // moved, in one view or the other. Which one has the overflow depends on
    // the day's length, the header's height and whether a banner is up.
    expect(schedule).toMatch(/el\.scrollHeight > el\.clientHeight \+ 1/);
    expect(schedule).toMatch(
      /const boxes = \[calRef\.current, mainRef\.current\]/,
    );
    // And both are listened to: a listener on the wrong box hears nothing.
    expect(schedule).toMatch(
      /for \(const el of boxes\) el\.addEventListener\("scroll", readFold/,
    );
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
});

describe('a rail says when the line goes on', () => {
  it('shows an arrow at an end only while there is more that way', () => {
    // The scrollbar is hidden, so without these a week past the right edge is
    // a week nobody finds — there is no horizontal wheel on a desktop.
    expect(rail).toMatch(/setMore\(\{ back: el\.scrollLeft > 1, on: el\.scrollLeft < max - 1 \}\)/);
    expect(rail).toMatch(/more\[side\] \? 'opacity-100' : 'pointer-events-none opacity-0'/);
  });

  it('keeps measuring rather than measuring once', () => {
    // The line changes width without the window resizing: a chip drops off as
    // the event runs, and the fold hands the row a different width.
    expect(rail).toContain('new ResizeObserver(read)');
    expect(rail).toMatch(/el\.addEventListener\('scroll', read, \{ passive: true \}\)/);
  });

  it('moves the line rather than replacing it', () => {
    // Less than a full screenful, so the chip you were reading is still there
    // after the press.
    expect(rail).toMatch(/el\.clientWidth \* 0\.8/);
  });

  it('centres its arrows on the line itself', () => {
    // The arrows are absolute over the rail's own box, so any vertical padding
    // inside that box sits them below the chips they belong to. The space
    // under the rail is the caller's, outside it.
    expect(rail).toContain('absolute inset-y-0');
    expect(schedule).toMatch(/<div className="mx-auto max-w-6xl pb-2">\n\s*<Rail label="Weeks" className="gap-1.5 px-4">/);
  });

  it('draws its arrows rather than setting them as text', () => {
    // ‹ and › sit on the text baseline at the font's own optical size: small,
    // and low against the chips. Drawn, they are centred by the same flexbox
    // that centres everything else in the row.
    expect(rail).toContain('<Chevron className="h-4 w-4" />');
    // The note explaining the change quotes the glyphs it replaced, so read
    // the code rather than the prose.
    const code = rail.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toContain('‹');
    expect(code).not.toContain('›');
  });

  it('does not put two dead stops in the tab order', () => {
    // Every chip the arrows scroll to is a button, and tabbing to one brings
    // it into view by itself.
    expect(rail).toContain('tabIndex={-1}');
    expect(rail).toContain('aria-hidden="true"');
  });

});
