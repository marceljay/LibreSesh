import { FloatingFocusManager } from '@floating-ui/react';
import { useState } from 'react';

import { dayLabel, dayRangeLabel } from '../lib/format';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';
import { popoverPanelClass, usePopover } from './Popover';

/**
 * The whole day picker, on a phone, in one row:
 *
 *     ‹  Wed 18 Sep ▾  ›
 *
 * A long event used to navigate in two rows — a rail of week chips, and that
 * week's days scrolling sideways under it. Both were most of the gap between
 * the event bar and the first session, and the second was a hidden-scrollbar
 * scroller with days off each edge: arrows could say the line went on, but not
 * make a day on the far side of it reachable in fewer than several flicks.
 *
 * The dropdown holds every day in the event, grouped under its week, so any
 * one of them is a scan and a tap rather than a hunt.
 *
 * **The chevrons are not decoration.** What the strip was genuinely good at is
 * that tomorrow was visible and one tap away, and at an unconference people
 * move between neighbouring days constantly. A bare dropdown turns that into
 * tap-open-scan-tap, which is worse than what it replaced. With them this
 * beats the strip on reaching a far day and ties it on reaching the next one,
 * for one row instead of two.
 *
 * Only above `weekRailFrom` days — below it the strip shows the whole event at
 * once, and there is nothing to fix. See SchedulePage.
 */
export function DayPicker({
  days,
  weeks,
  day,
  today,
  countFor,
  onPick,
  className = '',
}: {
  /** Every day of the event, in order; the chevrons step through this. */
  days: readonly string[];
  /** The same days grouped, so the panel can head each run with its week. */
  weeks: readonly string[][];
  day: string;
  today: string;
  countFor: (day: string) => number;
  onPick: (day: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    role: 'menu',
  });

  const at = days.indexOf(day);
  const previous = at > 0 ? (days[at - 1] as string) : null;
  const next = at > -1 && at < days.length - 1 ? (days[at + 1] as string) : null;
  const label = dayLabel(day, today);

  /** Both ends of the event are a real edge, so the button goes flat rather
   *  than disappearing — a control that vanishes moves everything beside it,
   *  and on a row this narrow that is the button under the thumb. */
  const step = (to: string | null, side: 'back' | 'on'): React.ReactElement => {
    const Chevron = side === 'back' ? ChevronLeftIcon : ChevronRightIcon;
    return (
      <button
        type="button"
        disabled={to === null}
        onClick={() => to && onPick(to)}
        aria-label={side === 'back' ? 'Previous day' : 'Next day'}
        title={side === 'back' ? 'Previous day' : 'Next day'}
        className="flex shrink-0 items-center rounded-md px-1.5 py-1.5 text-stone-600 hover:bg-stone-100 disabled:pointer-events-none disabled:opacity-30 dark:text-stone-300 dark:hover:bg-stone-800"
      >
        <Chevron className="h-4 w-4" />
      </button>
    );
  };

  return (
    <div
      className={`flex min-w-0 items-center rounded-lg border border-stone-300 bg-white p-0.5 dark:border-stone-600 dark:bg-stone-900 ${className}`}
    >
      {step(previous, 'back')}
      <button
        ref={refs.setReference}
        type="button"
        aria-label={`${label.top} ${label.sub}. Choose a day`}
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
        className={`flex min-w-0 grow items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium ${
          open
            ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
            : 'text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800'
        }`}
      >
        <span className="truncate">
          {label.top} <span className="font-normal opacity-70">{label.sub}</span>
        </span>
        <ChevronDownIcon className="h-3 w-3 shrink-0" />
      </button>
      {step(next, 'on')}

      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            aria-label="Days"
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-[16rem] p-1`}
          >
            {weeks.map((week, i) => (
              <div key={week[0]}>
                {/* The week is a heading, not a target: picking a week meant
                    picking its first day anyway, and the days are right here.
                    It survives as the thing that tells you where you are in a
                    fortnight — which is all the rail was ever for. */}
                {weeks.length > 1 && (
                  <div className="flex items-baseline gap-2 px-2.5 pb-1 pt-2 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                    <span>Week {i + 1}</span>
                    <span className="font-normal">
                      {dayRangeLabel(week[0] as string, week[week.length - 1] as string)}
                    </span>
                  </div>
                )}
                {week.map((d) => {
                  const each = dayLabel(d, today);
                  const count = countFor(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-current={d === day ? 'true' : undefined}
                      onClick={() => {
                        onPick(d);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs ${
                        d === day
                          ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                          : 'hover:bg-stone-100 dark:hover:bg-stone-800'
                      } ${d !== day && count === 0 ? 'opacity-40' : ''}`}
                    >
                      <span className="w-16 shrink-0 font-medium">{each.top}</span>
                      <span
                        className={`grow ${d === day ? 'opacity-70' : 'text-stone-500 dark:text-stone-400'}`}
                      >
                        {each.sub}
                      </span>
                      {/* Today, when you are somewhere else — the dot the week
                          chips carried, now on the day that earns it. */}
                      {d === today && d !== day && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-highlight" />
                      )}
                      <span
                        className={`w-5 shrink-0 text-end ${d === day ? 'opacity-70' : 'text-stone-400 dark:text-stone-500'}`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );
}
