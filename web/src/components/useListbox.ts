import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { stepActive } from '../lib/listbox';

/**
 * The keyboard and ARIA of a combobox's listbox, once.
 *
 * Three fields in the app are a text box with a list of rows under it — the
 * speaker picker, the schedule search and the settings search — and each had
 * grown its own Arrow/Enter/Escape handler and its own `role`/`aria-*` wiring.
 * They agreed on the roles and disagreed on the rest, and none of them told a
 * screen reader *which* row the arrow keys had landed on: `aria-selected` on
 * the row is not enough, the input has to name that row in
 * `aria-activedescendant` (the WAI-ARIA combobox pattern), and none did.
 *
 * This owns the highlight (`active`), the key handling and the ids that tie
 * input, list and rows together. The caller owns everything else: what is in
 * the list, what picking a row does, what Escape means when the list is
 * already closed. The hook is deliberately not a component — the three lists
 * render nothing alike, and forcing one markup on them is what the Base UI
 * combobox was rejected for.
 *
 * `onKeyDown` answers whether it handled the key, so a caller can add its own
 * keys after it (the speaker picker's Backspace-removes-a-chip) without
 * re-checking the ones this took.
 */
export function useListbox({
  open,
  count,
  allowNone = false,
  resetOn,
  onPick,
  onEscape,
}: {
  /** Whether the list is actually rendered. Drives `aria-expanded`, and the
   *  two references that must not point at a node that is not there. */
  open: boolean;
  count: number;
  /** The highlight may rest on no row (`-1`) — see `stepActive`. */
  allowNone?: boolean;
  /** When this changes the highlight goes back to rest: a new query is a new list. */
  resetOn: unknown;
  /** Enter. Receives `-1` only with `allowNone`. */
  onPick: (index: number) => void;
  onEscape: () => void;
}) {
  const id = useId();
  const rest = allowNone ? -1 : 0;
  const [active, setActive] = useState(rest);
  useEffect(() => setActive(rest), [resetOn, rest]);

  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const highlighted = open && active >= 0 && active < count;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (count === 0) return false;
      e.preventDefault();
      setActive((a) => stepActive(a, e.key === 'ArrowDown' ? 1 : -1, count, allowNone));
      return true;
    }
    if (e.key === 'Enter') {
      // Never the form's: Enter in a combobox picks, it does not save the
      // dialog around it. The caller decides what an out-of-range index means.
      e.preventDefault();
      onPick(active);
      return true;
    }
    if (e.key === 'Escape') {
      // Stopped here: a dialog listening for Escape must not close along with
      // the list — the field's own Escape has a meaning of its own.
      e.stopPropagation();
      onEscape();
      return true;
    }
    return false;
  };

  return {
    active,
    onKeyDown,
    /** Spread onto the `<input>`. */
    comboboxProps: {
      role: 'combobox' as const,
      'aria-expanded': open,
      'aria-autocomplete': 'list' as const,
      'aria-controls': open ? listboxId : undefined,
      'aria-activedescendant': highlighted ? optionId(active) : undefined,
    },
    /** Spread onto the list. */
    listboxProps: { id: listboxId, role: 'listbox' as const },
    /** Spread onto the element that *is* the row — whichever one carries
     *  `role="option"`, since the id has to sit with the role. */
    optionProps: (index: number) => ({
      id: optionId(index),
      role: 'option' as const,
      'aria-selected': index === active,
    }),
  };
}
