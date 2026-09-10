import { FloatingFocusManager } from '@floating-ui/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ChevronDownIcon, PitchIcon } from './icons';
import { popoverPanelClass, usePopover } from './Popover';

/**
 * Both ways of putting a session into the world, behind one button.
 *
 *     + Session ▾   →   Add a session   ·   Pitch a session
 *
 * They were two controls a row apart, then two controls side by side, and
 * they are the same question asked twice: *do you have a room and a time, or
 * only an idea?* That is a choice to make after deciding to contribute, not
 * before, and a person who has never seen an unconference cannot make it from
 * two button labels anyway. Behind one button the two sit next to each other
 * with room for a sentence each, which is where the difference can actually
 * be explained.
 *
 * **One option is not a menu.** An event with the board switched off, or a
 * viewer who may pitch but not book, gets a plain button that does the one
 * thing — never a dropdown that opens onto a single row.
 */
export function NewSessionMenu({
  canAdd,
  pitchHref,
  pitchCount,
  onAdd,
  className = '',
}: {
  canAdd: boolean;
  /** `null` when the board is off, or this viewer has no business on it. */
  pitchHref: string | null;
  /** Pitches still waiting to be placed; silent at zero. */
  pitchCount: number;
  onAdd: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    role: 'menu',
  });

  const solid =
    'flex h-[34px] items-center gap-1.5 rounded-lg border border-transparent bg-stone-900 px-3 text-xs font-semibold text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300';
  const outline =
    'flex h-[34px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-xs font-medium text-stone-600 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500';

  if (!canAdd && pitchHref === null) return null;

  // Only the board. The outline button it always was, words and all.
  if (!canAdd) {
    return (
      <Link
        data-tour="pitches"
        to={pitchHref as string}
        aria-label="Pitch a session"
        title="Pitch a session"
        className={`${outline} ${className}`}
      >
        <PitchIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Pitch a session</span>
        {pitchCount > 0 && <span className="text-stone-400 dark:text-stone-500">{pitchCount}</span>}
      </Link>
    );
  }

  // Only adding. No chevron: an arrow promising a choice that is not there is
  // worse than no arrow.
  if (pitchHref === null) {
    return (
      <button
        type="button"
        data-tour="add"
        onClick={onAdd}
        aria-label="Add session"
        title="Add session"
        className={`${solid} ${className}`}
      >
        <span aria-hidden="true">+</span>
        <span className="hidden sm:inline">Session</span>
      </button>
    );
  }

  return (
    <div className={`shrink-0 ${className}`}>
      <button
        ref={refs.setReference}
        type="button"
        data-tour="add"
        aria-label="Add or pitch a session"
        title="Add or pitch a session"
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
        className={solid}
      >
        <span aria-hidden="true">+</span>
        <span className="hidden sm:inline">Session</span>
        <ChevronDownIcon className="h-3 w-3" />
        {/* The count the board link used to carry. It is the one thing on this
            button that is news rather than an instruction, so it survives the
            merge even though its label did not. */}
        {pitchCount > 0 && <span className="opacity-60">{pitchCount}</span>}
      </button>

      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            aria-label="Add or pitch a session"
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-[17rem] p-1`}
          >
            <button
              type="button"
              onClick={() => {
                onAdd();
                setOpen(false);
              }}
              className="flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-start hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <span className="text-xs font-semibold">Add a session</span>
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                In a room, at a time, on the grid.
              </span>
            </button>
            <Link
              data-tour="pitches"
              to={pitchHref}
              onClick={() => setOpen(false)}
              className="flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-start hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <PitchIcon className="h-3.5 w-3.5" />
                Pitch a session
                {pitchCount > 0 && (
                  <span className="font-normal text-stone-400 dark:text-stone-500">
                    {pitchCount}
                  </span>
                )}
              </span>
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                Just an idea — no room, no time. Organisers place the popular ones.
              </span>
            </Link>
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );
}
