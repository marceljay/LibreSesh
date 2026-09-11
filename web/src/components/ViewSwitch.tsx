import { FloatingFocusManager } from '@floating-ui/react';
import { useState } from 'react';

import { ChevronDownIcon } from './icons';
import { popoverPanelClass, usePopover } from './Popover';

export type View = 'cal' | 'list';
export type Axis = 'room' | 'track';

/**
 * List or grid, and — on an event with tracks — which way the grid's columns
 * run.
 *
 *     List │ Grid ▾   →   Rooms   ·   Tracks
 *
 * The axis used to be a second segmented control that appeared beside this
 * one the moment the grid was chosen and vanished when it was left. A control
 * that comes and goes reflows the row it lives in, and on a phone the row
 * wrapped under it every time. Folding the choice into the Grid button keeps
 * the row one width in both views: the button grows by a chevron, and the
 * question it asks — rooms or tracks — is asked when the answer matters, on
 * the way into the grid, or from inside it to turn the columns the other way.
 *
 * Without tracks there is no question. The Grid button is then the plain
 * toggle it always was, and no chevron promises a choice that is not there.
 *
 * List sits on the left: it is the view a phone opens in, and the one with no
 * further question, so the button that grows is the one at the end.
 */
export function ViewSwitch({
  view,
  axis,
  hasTracks,
  onChange,
}: {
  view: View;
  axis: Axis;
  hasTracks: boolean;
  onChange: (next: { view: View; axis?: Axis }) => void;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    role: 'menu',
  });

  const segment = (on: boolean) =>
    `flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium ${
      on
        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
        : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800'
    }`;
  const item =
    'flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-start hover:bg-stone-100 dark:hover:bg-stone-800 aria-checked:bg-stone-100 dark:aria-checked:bg-stone-800';

  return (
    <div
      data-tour="view"
      className="flex rounded-lg border border-stone-300 bg-white p-0.5 dark:border-stone-600 dark:bg-stone-900"
    >
      <button
        type="button"
        onClick={() => onChange({ view: 'list' })}
        aria-pressed={view === 'list'}
        className={segment(view === 'list')}
      >
        List
      </button>
      {hasTracks ? (
        <button
          ref={refs.setReference}
          type="button"
          aria-pressed={view === 'cal'}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Grid — by rooms or by tracks"
          {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
          className={segment(view === 'cal')}
        >
          Grid
          <ChevronDownIcon className="h-3 w-3" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onChange({ view: 'cal' })}
          aria-pressed={view === 'cal'}
          className={segment(view === 'cal')}
        >
          Grid
        </button>
      )}

      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            aria-label="Lay the grid out by"
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-56 p-1`}
          >
            {(['room', 'track'] as const).map((a) => (
              <button
                key={a}
                type="button"
                role="menuitemradio"
                // Only a fact inside the grid: in the list no axis is showing,
                // and a tick there would claim one was.
                aria-checked={view === 'cal' && axis === a}
                onClick={() => {
                  onChange({ view: 'cal', axis: a });
                  setOpen(false);
                }}
                className={item}
              >
                <span className="text-xs font-semibold">{a === 'room' ? 'Rooms' : 'Tracks'}</span>
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  {a === 'room'
                    ? 'A column per room, side by side.'
                    : 'A column per track; each block says which room it is in.'}
                </span>
              </button>
            ))}
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );
}
