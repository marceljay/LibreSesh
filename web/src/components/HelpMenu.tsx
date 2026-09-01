import { useState } from 'react';
import { FloatingFocusManager } from '@floating-ui/react';

import { popoverPanelClass, usePopover } from './Popover';
import { Modal } from './ui';

const itemClass =
  'block w-full px-3 py-2 text-left text-xs font-medium text-stone-700 ' +
  'hover:bg-stone-100 focus-visible:bg-stone-100 focus:outline-none ' +
  'dark:text-stone-200 dark:hover:bg-stone-800 dark:focus-visible:bg-stone-800';

/**
 * Which build you are looking at, stamped by vite at build time.
 *
 * Defaulted rather than asserted: a missing stamp should read "unknown", not
 * take the page down with it.
 */
function build(): { tag: string; commit: string; built: string } {
  const dirty = import.meta.env.VITE_BUILD_DIRTY === 'true';
  const at = new Date(import.meta.env.VITE_BUILD_TIME ?? '');
  return {
    tag: import.meta.env.VITE_BUILD_TAG ?? 'unknown',
    commit: (import.meta.env.VITE_BUILD_COMMIT ?? 'unknown') + (dirty ? '-dirty' : ''),
    built: Number.isNaN(at.getTime())
      ? 'unknown'
      : `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  };
}

/**
 * The "?" beside your name: the tour, and what this thing is.
 *
 * The version used to live in a pill pinned to the bottom-right of every page —
 * a permanent fixture for a question asked twice a year, sitting over the
 * corner of the grid on a phone. It is in **About LibreSesh** now, which is
 * where someone who wants it will look, and out of everyone else's way.
 */
export function HelpMenu({ onTour, demo }: { onTour: () => void; demo: boolean }) {
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState(false);
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    role: 'menu',
  });
  const { tag, commit, built } = build();

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
        aria-label="Help"
        title="Help"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-xs font-medium text-stone-500 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-500"
      >
        ?
      </button>

      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            role="menu"
            aria-label="Help"
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-48 py-1`}
          >
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                setOpen(false);
                onTour();
              }}
            >
              Take the tour
            </button>
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                setOpen(false);
                setAbout(true);
              }}
            >
              About LibreSesh
            </button>
          </div>
        </FloatingFocusManager>
      )}

      {about && (
        <Modal title="About LibreSesh" onClose={() => setAbout(false)}>
          <div className="space-y-3 text-sm">
            <p className="text-stone-600 dark:text-stone-300">
              A simple, open-source scheduling tool for conferences and
              unconferences. Everyone reads the same live schedule; anyone with
              a link can follow it, and nobody needs an account.
            </p>
            {demo && (
              <p className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                demo instance — the data here is reset
              </p>
            )}
            {/* `select-all`: the first thing anyone is asked for when they
                report something is which build they were on. */}
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-stone-500 dark:text-stone-400">Version</dt>
              <dd className="select-all font-mono">{tag}</dd>
              <dt className="text-stone-500 dark:text-stone-400">Commit</dt>
              <dd className="select-all font-mono">{commit}</dd>
              <dt className="text-stone-500 dark:text-stone-400">Built</dt>
              <dd className="select-all font-mono">{built}</dd>
            </dl>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              MIT licensed.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}
