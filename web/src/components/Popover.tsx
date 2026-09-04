import {
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  size,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  type Placement,
} from '@floating-ui/react';

/**
 * One anchored panel, positioned so it can never leave the screen.
 *
 * Every popdown here used to be `absolute start-0` inside a `relative` wrapper,
 * sized `w-[min(28rem,calc(100vw-2rem))]`. That is only safe when the wrapper
 * starts at the left edge of the viewport. In the schedule's filter bar it does
 * not — the button sits a couple of hundred pixels in — so the panel's right
 * edge landed at `wrapper.left + 100vw` and hung that far off the page. Nothing
 * clipped it, so the *document* grew wider than the viewport and mobile
 * browsers shrank the whole page to fit. That is the "zoomed out, layout
 * destroyed" bug, and it was arithmetic, not flakiness.
 *
 * Three things here make it unrepeatable:
 *
 * - `strategy: 'fixed'` takes the panel out of the document's scroll width
 *   altogether, so an overhang can no longer widen the page even in principle.
 * - `shift` slides the panel back inside the viewport; `flip` puts it above the
 *   anchor when there is no room below.
 * - `size` caps width *and* height to the space actually left, which also
 *   retires the old `max-h-[70vh]` — `vh` counts the strip behind the mobile
 *   address bar, so 70vh was taller than 70% of what you can see.
 *
 * `GAP` is the breathing room kept from every viewport edge.
 */
const GAP = 8;

export function usePopover({
  open,
  onOpenChange,
  placement = 'bottom-start',
  role = 'dialog',
  escapeKey = true,
  hover = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placement?: Placement;
  /** `listbox` for a combobox's results, `dialog` for a panel of controls,
   *  `tooltip` for one that only describes its anchor — which is what wires
   *  `aria-describedby` up rather than announcing a dialog nobody opened. */
  role?: 'dialog' | 'listbox' | 'menu' | 'tooltip';
  /** Off when the anchor already gives Escape a meaning of its own — a search
   *  box closes its results on the first press and clears itself on the
   *  second, and this listener would swallow the distinction. */
  escapeKey?: boolean;
  /** Also open on hover and on keyboard focus, for a panel that explains its
   *  anchor rather than acting on it — the ⓘ on a column card.
   *
   *  `mouseOnly` is the whole point of routing this through Floating UI. A
   *  touch browser synthesises the mouse sequence on a tap — `mouseenter`,
   *  `focus`, `click`, as separate DOM events — so a hand-rolled
   *  `onMouseEnter={open}` beside an `onClick={toggle}` opens on the enter and
   *  closes on the click, and the panel can never be pinned by a finger. This
   *  listens to a real mouse only, and leaves the tap to the caller's click.
   *  `visibleOnly` focus is the same rule for the keyboard: tab to it and it
   *  opens, but the focus a tap or a click leaves behind does not. */
  hover?: boolean;
}) {
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange,
    placement,
    // Fixed, not absolute: an absolutely positioned panel is part of the
    // document's scroll width, and that is what let the old one widen the page.
    strategy: 'fixed',
    // Reposition while it is open — the schedule scrolls under a sticky header,
    // and a phone rotating or its address bar collapsing resizes the viewport.
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: GAP }),
      shift({ padding: GAP }),
      // After shifting, cap to what is actually left. Inline `max-width` beats
      // the caller's Tailwind `w-…`, so a panel asks for its ideal width and
      // silently gets less on a narrow screen.
      size({
        padding: GAP,
        apply({ availableWidth, availableHeight, elements }) {
          elements.floating.style.maxWidth = `${Math.max(0, availableWidth)}px`;
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      }),
    ],
  });

  const interactions = useInteractions([
    // Outside pointerdown and Escape, which every one of these hand-rolled
    // separately and none of them quite identically.
    useDismiss(context, { outsidePressEvent: 'pointerdown', escapeKey }),
    // `safePolygon` so the pointer can cross the 4px `offset` into the panel
    // without the panel closing on the way. Enabled either way — the hook is
    // inert when `hover` is off, and hooks cannot be called conditionally.
    useHover(context, { enabled: hover, mouseOnly: true, handleClose: safePolygon() }),
    useFocus(context, { enabled: hover, visibleOnly: true }),
    useRole(context, { role }),
  ]);

  return { refs, floatingStyles, context, ...interactions };
}

/**
 * The surface itself: the card everything shares, plus the scrolling that has
 * to be on the same element `size` measured, or a capped panel clips its own
 * overflow instead of scrolling it.
 */
export const popoverPanelClass =
  'z-40 flex flex-col overflow-y-auto overscroll-contain rounded-xl border border-stone-200 ' +
  'bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900';
