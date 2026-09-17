import { useState, type ReactNode } from 'react';
import { InfoIcon } from './icons';
import { popoverPanelClass, usePopover } from './Popover';

/**
 * The ⓘ beside a field label: a sentence or two the hint has no room for, and
 * a way out to the documentation.
 *
 * Same shape as the ⓘ on a room column in the calendar — `usePopover` with
 * `hover`, so a mouse or a tab reaches it and a tap pins it. A hint under the
 * field is for what you must know to fill it in; this is for what a stranger
 * to the feature needs before they know whether they want it at all.
 */
export function FieldInfo({
  label,
  href,
  children,
}: {
  /** Announced to a screen reader: "About the bot token". */
  label: string;
  /** Where the longer answer lives. */
  href?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    role: 'dialog',
    hover: true,
  });

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="-m-1 rounded-full p-1 text-stone-500 hover:text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-stone-500 dark:text-stone-400 dark:hover:text-stone-100"
        {...getReferenceProps({ onClick: () => setOpen((v) => !v) })}
      >
        <InfoIcon className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          className={`${popoverPanelClass} w-72 p-3 text-xs leading-relaxed text-stone-600 dark:text-stone-300`}
        >
          {children}
          {href && (
            <p className="mt-2">
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-stone-900 dark:hover:text-stone-100"
              >
                Read the docs
              </a>
            </p>
          )}
        </div>
      )}
    </>
  );
}
