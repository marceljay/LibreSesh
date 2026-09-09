import { FloatingFocusManager } from '@floating-ui/react';
import { useState } from 'react';

import { dayRangeLabel } from '../lib/format';
import { ChevronDownIcon } from './icons';
import { popoverPanelClass, usePopover } from './Popover';

/**
 * The week rail, folded into one button.
 *
 * A long event navigates in two rows: a rail of week chips, and that week's
 * days below it. On a desktop the rail earns its line — you see the whole
 * shape of the event at once, and which part of it you are in. On a phone
 * those two rows are most of what stands between the event bar and the first
 * session of the day, and the rail is the one that can be said in a single
 * chip: you are in week 2, there are 3, here are the others.
 *
 * So below `sm` the rail is gone and this stands at the head of the day
 * strip. It costs the strip about one day of width and gives the grid a whole
 * row back.
 *
 * Everything the chips carried comes with it — the date range, the session
 * count, and the dot on the week holding today — because the point of the
 * rail was never the chips, it was knowing where you are without leaving the
 * day you are reading.
 */
export function WeekMenu({
  weeks,
  weekIndex,
  today,
  day,
  countFor,
  onPick,
  className = '',
}: {
  weeks: string[][];
  /** Which week the chosen day falls in. */
  weekIndex: number;
  today: string;
  /** The day on screen, so the week holding today can say whether you are
   *  already looking at it. */
  day: string;
  countFor: (week: string[]) => number;
  /** Given the day to land on — today when the week holds it, else its first. */
  onPick: (day: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    role: 'menu',
  });

  const current = weeks[weekIndex];
  if (!current) return null;
  const range = dayRangeLabel(current[0] as string, current[current.length - 1] as string);

  return (
    <div className={`shrink-0 ${className}`}>
      <button
        ref={refs.setReference}
        type="button"
        // The button says "W2"; the accessible name says all of it. A screen
        // reader has no width to save, and "W2" alone is not a week.
        aria-label={`Week ${weekIndex + 1} of ${weeks.length}, ${range}. Choose a week`}
        title={`Week ${weekIndex + 1} · ${range}`}
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
        className={`flex items-center gap-0.5 rounded-md px-2 py-1.5 text-xs font-semibold ${
          open
            ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
            : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
        }`}
      >
        {/* "Wk2", not "W2". A lone W beside a number reads as an initial or a
            column header, and on a row that already holds Mon/Tue/Wed it is
            the one label with no word in it. Two letters is still a third of
            "Week" and unambiguous at a glance. */}
        Wk{weekIndex + 1}
        {/* The chevron stays, unlike the one Filter dropped: that button opens
            a panel of its own controls, this one replaces a rail that used to
            be visible, and the arrow is what says the other weeks still
            exist. */}
        <ChevronDownIcon className="h-3 w-3" />
      </button>

      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            aria-label="Weeks"
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-[15rem] p-1`}
          >
            {weeks.map((week, i) => {
              const first = week[0] as string;
              const last = week[week.length - 1] as string;
              const holdsToday = week.includes(today);
              return (
                <button
                  key={first}
                  type="button"
                  aria-current={i === weekIndex ? 'true' : undefined}
                  onClick={() => {
                    onPick(holdsToday ? today : first);
                    setOpen(false);
                  }}
                  className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs ${
                    i === weekIndex
                      ? 'bg-stone-100 font-semibold dark:bg-stone-800'
                      : 'hover:bg-stone-100 dark:hover:bg-stone-800'
                  }`}
                >
                  <span className="w-12 shrink-0 font-medium">Week {i + 1}</span>
                  <span className="grow text-stone-500 dark:text-stone-400">
                    {dayRangeLabel(first, last)}
                  </span>
                  {/* The dot the chips carried: today is in this week and you
                      are not looking at it. Silent once you are. */}
                  {holdsToday && !week.includes(day) && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-highlight" />
                  )}
                  <span className="w-6 shrink-0 text-end text-stone-400 dark:text-stone-500">
                    {countFor(week)}
                  </span>
                </button>
              );
            })}
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );
}
