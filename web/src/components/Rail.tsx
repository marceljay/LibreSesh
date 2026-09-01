import { useCallback, useEffect, useRef, useState } from 'react';

import { ChevronLeftIcon, ChevronRightIcon } from './icons';

/**
 * One line that scrolls sideways, with an arrow at the end where there is more
 * to see.
 *
 * The scrollbar is hidden — a bar under a row of chips is thicker than the
 * chips and it is only there on some platforms anyway — which leaves nothing at
 * all to say the line continues. On a touch screen you find out by flicking; on
 * a desktop, with no horizontal wheel, a six-week conference simply looked like
 * a three-week one. The arrows are that missing sentence, and they are only up
 * while they are true.
 *
 * They are not tab stops: everything they scroll to is a button of its own, and
 * tabbing to one already brings it into view, so two more stops in the header
 * would be noise on the way to the day picker.
 */
export function Rail({
  label,
  className = '',
  children,
}: {
  /** Names the row for a screen reader — "Weeks", not "Week 1". */
  label: string;
  /** Layout for the line itself: horizontal padding and the gap between its
   *  items. Vertical spacing belongs *outside* the rail — the arrows are
   *  centred on this box, so padding under the row would sit them low. */
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ back: false, on: false });

  const read = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // A pixel of slack: scroll offsets are fractional at any zoom but 100%, and
    // an arrow that hangs on at the end of the line reads as a broken control.
    setMore({ back: el.scrollLeft > 1, on: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    read();
    el.addEventListener('scroll', read, { passive: true });
    // The line changes width without the page resizing — a week goes by and
    // the rail loses a chip, the fold hands it a different width — so the row
    // and its content are both watched rather than measured once.
    const observer = new ResizeObserver(read);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener('scroll', read);
      observer.disconnect();
    };
  }, [read, children]);

  const nudge = (direction: -1 | 1): void => {
    const el = ref.current;
    if (!el) return;
    // Not a whole screenful: an overlap keeps the chip you were looking at on
    // screen, so the press moves the line rather than replacing it.
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const arrow = (side: 'back' | 'on'): JSX.Element => {
    const Chevron = side === 'back' ? ChevronLeftIcon : ChevronRightIcon;
    return (
      <button
        type="button"
        // Pointer affordance only — see the note above.
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => nudge(side === 'back' ? -1 : 1)}
        className={`absolute inset-y-0 z-10 flex w-11 items-center transition-opacity duration-150 motion-reduce:transition-none ${
          side === 'back'
            ? 'left-0 justify-start bg-gradient-to-r pl-0.5'
            : 'right-0 justify-end bg-gradient-to-l pr-0.5'
        } from-stone-50 via-stone-50/90 to-transparent text-stone-500 hover:text-stone-900 dark:from-stone-900 dark:via-stone-900/90 dark:text-stone-400 dark:hover:text-stone-100 ${
          more[side] ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* Drawn, not set as text: ‹ and › are set on the text baseline and at
            the font's own optical size, so they came out small and sitting
            low against the chips they belong to. An icon is centred by the
            same flexbox that centres everything else in the row. */}
        <Chevron className="h-4 w-4" />
      </button>
    );
  };

  return (
    <div className="relative">
      <div
        ref={ref}
        role="group"
        aria-label={label}
        className={`no-scrollbar flex items-center overflow-x-auto ${className}`}
      >
        {children}
      </div>
      {arrow('back')}
      {arrow('on')}
    </div>
  );
}
