import { FloatingFocusManager } from '@floating-ui/react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ChevronDownIcon, PitchIcon } from './icons';
import { popoverPanelClass, usePopover } from './Popover';

/**
 * Both ways of putting a session into the world, behind one button.
 *
 *     + Session ▾   →   Add a session   ·   Pitch a session   ·   Drafts 3
 *
 * They were two controls a row apart, then two controls side by side, and
 * they are the same question asked twice: *do you have a room and a time, or
 * only an idea?* That is a choice to make after deciding to contribute, not
 * before, and a person who has never seen an unconference cannot make it from
 * two button labels anyway. Behind one button the two sit next to each other
 * with room for a sentence each, which is where the difference can actually
 * be explained.
 *
 * **Drafts join in only while there are some.** They are the third way a
 * session is on its way into the world — written, not yet on — and this is
 * where somebody who parked one comes back for it. At zero there is nothing to
 * come back for, so the row is not there, and nor is the word.
 *
 * **One option is not a menu.** An event with the board switched off, or a
 * viewer who may pitch but not book, gets a plain button that does the one
 * thing — never a dropdown that opens onto a single row.
 *
 * **Arrange rides along for the organiser.** It is not a way of putting a
 * session into the world — it moves the ones already there — so it sits
 * under a rule at the bottom, but it is the other thing an organiser does to
 * the grid from this corner of the header, and the button for it sits a row
 * further down where, on a phone, it is a bare `↕`. Here it gets its words
 * and its sentence. Offered only alongside *Add a session*: the page passes
 * `onArrange` only for an admin on the grid, who may always add, so the row
 * never has to stand as a menu of one.
 */
export function NewSessionMenu({
  canAdd,
  pitchHref,
  pitchCount,
  draftCount = 0,
  onAdd,
  onDrafts,
  arranging = false,
  onArrange,
  className = '',
}: {
  canAdd: boolean;
  /** `null` when the board is off, or this viewer has no business on it. */
  pitchHref: string | null;
  /** Pitches still waiting to be placed; silent at zero. */
  pitchCount: number;
  /** Drafts this viewer can see. At zero the menu does not mention them. */
  draftCount?: number;
  onAdd: () => void;
  /** Open the list of drafts. */
  onDrafts?: () => void;
  /** Whether the grid's drag mode is on right now; the row reads accordingly. */
  arranging?: boolean;
  /**
   * Toggle the grid's drag mode. Absent wherever arranging is not on offer —
   * the list view, the full-page session, anyone but an admin — and the menu
   * then has no row for it. Only read while `canAdd` is true.
   */
  onArrange?: () => void;
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
  const item =
    'flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-start hover:bg-stone-100 dark:hover:bg-stone-800';

  const hasDrafts = draftCount > 0 && onDrafts !== undefined;
  const hasArrange = canAdd && onArrange !== undefined;

  if (!hasDrafts && !hasArrange) {
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
          {pitchCount > 0 && (
            <span className="text-stone-400 dark:text-stone-500">{pitchCount}</span>
          )}
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
  }

  // Only drafts: someone credited on one who may neither book nor pitch. The
  // same rule — one thing to do is a button, not a menu. (`hasArrange` needs
  // `canAdd`, so it cannot be what brought us past the block above.)
  if (!canAdd && pitchHref === null) {
    return (
      <button
        type="button"
        onClick={onDrafts}
        aria-label="Your drafts"
        title="Your drafts"
        className={`${outline} ${className}`}
      >
        <span>Drafts</span>
        <span className="text-stone-400 dark:text-stone-500">{draftCount}</span>
      </button>
    );
  }

  const doing =
    canAdd && pitchHref !== null
      ? 'Add or pitch a session'
      : canAdd
        ? 'Add a session'
        : 'Pitch a session';
  const label = [doing, hasDrafts && 'open a draft', hasArrange && 'arrange the grid']
    .filter((part): part is string => typeof part === 'string')
    .join(', or ');

  return (
    <div className={`shrink-0 ${className}`}>
      <button
        ref={refs.setReference}
        type="button"
        data-tour={canAdd ? 'add' : 'pitches'}
        aria-label={label}
        title={label}
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
        className={canAdd ? solid : outline}
      >
        {canAdd ? (
          <>
            <span aria-hidden="true">+</span>
            <span className="hidden sm:inline">Session</span>
          </>
        ) : (
          <>
            <PitchIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Pitch a session</span>
          </>
        )}
        {/* No counts out here. The open-pitch count rode along for a while,
            and every digit made the button wider on a phone where it is
            already fighting the view switch for the row. The counts live on
            their rows inside, next to the thing they count. */}
        <ChevronDownIcon className="h-3 w-3" />
      </button>

      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            aria-label={label}
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-[17rem] p-1`}
          >
            {canAdd && (
              <button
                type="button"
                onClick={() => {
                  onAdd();
                  setOpen(false);
                }}
                className={item}
              >
                <span className="text-xs font-semibold">Add a session</span>
                <span className="text-[11px] text-stone-500 dark:text-stone-400">
                  In a room, at a time, on the grid.
                </span>
              </button>
            )}
            {pitchHref !== null && (
              <Link
                data-tour="pitches"
                to={pitchHref}
                onClick={() => setOpen(false)}
                className={item}
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
            )}
            {/* Below a rule: the rows above start something, these go back
                to what was started — a draft to finish, or the grid itself to
                move around. */}
            {(hasDrafts || hasArrange) && (
              <div className="mt-1 border-t border-stone-200 pt-1 dark:border-stone-700">
                {hasDrafts && (
                  <button
                    type="button"
                    onClick={() => {
                      onDrafts?.();
                      setOpen(false);
                    }}
                    className={item}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      View drafts
                      <span className="font-normal text-stone-400 dark:text-stone-500">
                        {draftCount}
                      </span>
                    </span>
                    <span className="text-[11px] text-stone-500 dark:text-stone-400">
                      Kept off the schedule until someone publishes them.
                    </span>
                  </button>
                )}
                {hasArrange && (
                  <button
                    type="button"
                    aria-pressed={arranging}
                    onClick={() => {
                      onArrange?.();
                      setOpen(false);
                    }}
                    className={item}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <span aria-hidden="true">{arranging ? '✓' : '↕'}</span>
                      {arranging ? 'Done arranging' : 'Arrange sessions'}
                    </span>
                    <span className="text-[11px] text-stone-500 dark:text-stone-400">
                      {arranging
                        ? 'Drag mode is on. Turn it off when the grid is how you want it.'
                        : 'Drag a block to another time or room, or its bottom edge to change its length.'}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );
}
