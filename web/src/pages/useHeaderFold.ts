import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Matches `duration-700` on the folding rows; see `foldRow` in `SchedulePage`. */
const FOLD_MS = 700;
/** Scroll this far into the day before the header folds itself away. */
const FOLD_AT = 24;
/** And this far down again before a header opened by hand gives way. */
const OVERRIDE_PX = 120;
/** Past this, the way back to the top of the day is worth a button. */
const TOP_BUTTON_AT = 160;

/**
 * The schedule header's fold: the day rows put themselves away once the reader
 * is into the day, and come back at the top or when the button is pressed.
 * `SchedulePage` owns the two scroll boxes and says whether folding applies at
 * all; everything that decides when to fold lives here.
 */
export function useHeaderFold({
  foldable,
  calRef,
  mainRef,
  roomCount,
  day,
  view,
}: {
  /** False on the full-page session view, where there is nothing to fold. */
  foldable: boolean;
  /** The grid's own scroller. */
  calRef: RefObject<HTMLDivElement | null>;
  /** `<main>`, which scrolls when the grid does not. */
  mainRef: RefObject<HTMLElement | null>;
  /** The three things that change which box scrolls and how far: the scroll
   *  listeners are attached again when any of them moves. */
  roomCount: number | undefined;
  day: string;
  view: string;
}) {
  /**
   * Whichever box is actually doing the scrolling.
   *
   * There are two candidates and no reliable way to name the winner in
   * advance: the grid owns a scroller of its own so its room cards can stick
   * to it, the list has none and scrolls `<main>`, and which of them ends up
   * with the overflow depends on the day's length, the header's height and
   * whether a banner is up. Naming one — first the grid's, then the grid's in
   * one view and `<main>` in the other — is what kept leaving the fold
   * listening to a box that never moved, in one view or the other. So ask the
   * boxes instead of predicting them: the one with somewhere to scroll is the
   * one the reader is scrolling. Both are listened to; this picks which one to
   * read.
   */
  const scroller = useCallback((): HTMLElement | null => {
    const boxes = [calRef.current, mainRef.current];
    return boxes.find((el) => el && el.scrollHeight > el.clientHeight + 1) ?? mainRef.current;
  }, [calRef, mainRef]);

  /**
   * The day rows — weeks, the day strip, the action row — fold themselves away
   * once you are into the day, and the ⌄/⌃ button beside the filters overrides
   * whichever way it went. The event bar above them stays: it is the way
   * home, the bell and the menu, and it is on every other page of the event,
   * so a schedule that put it away was the one page where you could lose it. The two used to fight,
   * which is what made the button look broken — you pressed it, the header came
   * back, and the next flick of the wheel put it away again. Three rules keep
   * them apart:
   *
   *  - It only folds when folding will not move the day under you. Folding
   *    hands the grid the ~150px those rows were using; if the day is not that
   *    much longer than the screen, the browser clamps the scroll back up to
   *    fit, which reads as a lurch — and when it clamps all the way to the top
   *    it unfolds the header again, one notch from folding it. A day that
   *    short simply does not fold.
   *  - Nothing auto-folds while the fold is moving: every height the animation
   *    passes through fires scroll events of its own, and they are not the
   *    reader scrolling.
   *  - A header opened by hand stays open until you deliberately scroll another
   *    `OVERRIDE_PX` down. The trackpad momentum still arriving when you press
   *    the button is not an instruction to fold it again.
   */
  /** `?debug=fold` puts the fold's own arithmetic on screen. The fold depends
   *  entirely on numbers no test in this project can see — a box's
   *  `scrollHeight` against its `clientHeight` — so when it misbehaves on a
   *  real device this is the difference between a guess and an answer. Off
   *  unless asked for, and it reads state rather than changing any. */
  const debugFold = new URLSearchParams(window.location.search).get('debug') === 'fold';
  const [foldStats, setFoldStats] = useState('');

  const [chromeMode, setChromeMode] = useState<'auto' | 'open' | 'shut'>('auto');
  const [autoFolded, setAutoFolded] = useState(false);
  const [foldMoving, setFoldMoving] = useState(false);
  /** Far enough down the day that scrolling back is work worth a button. */
  const [pastTop, setPastTop] = useState(false);
  /** Where the grid was when the button last overrode the scroll rule. */
  const overrideFrom = useRef(0);
  /** Whether the reader has been down into the day since that override. */
  const beenDown = useRef(false);
  /** The fold is mid-animation. A ref because the scroll listener reads it. */
  const foldInFlight = useRef(false);
  const foldedRows = useRef<HTMLDivElement>(null);

  const folded = foldable && (chromeMode === 'shut' || (chromeMode === 'auto' && autoFolded));

  const readFold = useCallback(() => {
    const el = scroller();
    if (!el) return;
    const top = el.scrollTop;
    setPastTop(top > TOP_BUTTON_AT);
    if (debugFold) {
      const gain = foldedRows.current?.offsetHeight ?? 0;
      setFoldStats(
        `${el === calRef.current ? 'grid' : 'main'} top=${Math.round(top)} ` +
          `scrollH=${el.scrollHeight} clientH=${el.clientHeight} ` +
          `slack=${el.scrollHeight - el.clientHeight} gain=${gain}`,
      );
    }
    if (foldInFlight.current) return;
    if (top > FOLD_AT) beenDown.current = true;
    const slack = el.scrollHeight - el.clientHeight;
    setAutoFolded((was) => {
      // Unfolds at the very top, folds at FOLD_AT: one threshold in both
      // directions would flicker, because folding resizes the grid it reads.
      if (was) return top > 0;
      const gain = foldedRows.current?.offsetHeight ?? 0;
      // `slack`, not `slack - top`: what folding costs is the same wherever you
      // are in the day — the box keeps its content and gains `gain` of
      // viewport, so what is left to scroll afterwards is `slack - gain`. Ask
      // whether *that* is still worth scrolling. The old form asked whether
      // there was a screenful left below you as well, which is a different and
      // much stricter question: it refused to fold in the bottom third of every
      // day, and in a list — which is as long as its sessions rather than as
      // long as the day — it refused almost everywhere.
      return top > FOLD_AT && slack > gain + FOLD_AT;
    });
    setChromeMode((mode) => {
      if (mode === 'auto') return mode;
      // Coming back to the top of the day spends the override either way: it
      // is where the header is open anyway, and where the scroll rule and the
      // button agree again. "Coming back" is the point — folding by hand while
      // already at the top would otherwise undo itself on the spot.
      if (top <= 0 && beenDown.current) return 'auto';
      if (mode === 'open' && top > overrideFrom.current + OVERRIDE_PX) {
        return 'auto';
      }
      return mode;
    });
  }, [calRef, debugFold, scroller]);

  const toggleChrome = useCallback(() => {
    const top = scroller()?.scrollTop ?? 0;
    overrideFrom.current = top;
    beenDown.current = top > FOLD_AT;
    setChromeMode(folded ? 'open' : 'shut');
  }, [folded, scroller]);

  const jumpToTop = useCallback(() => {
    setChromeMode('auto');
    scroller()?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scroller]);

  /**
   * The fold takes time, so "folded" and "gone" are two different moments and
   * the rows need to know which one they are in: mid-move they have to be
   * clipped, and only once they have finished leaving can they drop out of the
   * tab order. Nothing measures the transition — this is the same 700ms the
   * classes below spend, kept beside them. The scroll position is read again
   * at the end, because the resize may have moved it while we were not
   * listening.
   */
  const wasFolded = useRef(folded);
  useEffect(() => {
    if (wasFolded.current === folded) return;
    wasFolded.current = folded;
    foldInFlight.current = true;
    setFoldMoving(true);
    const timer = setTimeout(() => {
      foldInFlight.current = false;
      setFoldMoving(false);
      readFold();
    }, FOLD_MS);
    return () => clearTimeout(timer);
  }, [folded, readFold]);

  useEffect(() => {
    const boxes = [calRef.current, mainRef.current].filter((el): el is HTMLElement => el !== null);
    if (!foldable || boxes.length === 0) {
      setAutoFolded(false);
      setChromeMode('auto');
      setPastTop(false);
      return;
    }
    readFold();
    // Both, not the one we think will scroll: a listener on the wrong box
    // hears nothing, and which box scrolls is the grid's business, not ours.
    for (const el of boxes) el.addEventListener('scroll', readFold, { passive: true });
    return () => {
      for (const el of boxes) el.removeEventListener('scroll', readFold);
    };
  }, [calRef, mainRef, foldable, readFold, roomCount, day, view]);

  return {
    folded,
    foldMoving,
    pastTop,
    foldedRows,
    toggleChrome,
    jumpToTop,
    /** What `?debug=fold` prints: the measurements and the two inputs to `folded`. */
    debug: { on: debugFold, stats: foldStats, autoFolded, chromeMode },
  };
}
