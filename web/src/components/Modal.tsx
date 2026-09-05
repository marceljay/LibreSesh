import type { ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { CloseIcon } from './icons';

/**
 * Bottom sheet on mobile, centred dialog from `sm` up. Closes on backdrop
 * click, on Escape, and on the × in its header; focus moves in on open.
 *
 * Three regions, and the middle one is the only one that scrolls:
 *
 *   header  title, an optional line saying what the dialog is for, close
 *   body    the form
 *   footer  the actions
 *
 * That structure is the fix for two habits every caller had grown. The intro
 * line under the title was a `-mt-2` paragraph hand-placed at the top of each
 * body, cancelling the heading's own margin — and once the header became
 * sticky, it slid underneath and was clipped. The actions were a `mt-4 flex
 * justify-end gap-2` row re-typed in every modal, at the very bottom of a form
 * tall enough that Save scrolled off the screen. Neither is the caller's
 * problem to solve, and each solved it slightly differently.
 *
 * **This lives outside `ui.tsx` on purpose.** `ui.tsx` is imported by the app
 * shell for its providers, so anything it pulls in lands in the first-paint
 * chunk — and Base UI's Dialog is ~20 kB gzipped. Keeping the dialog in its own
 * module lets it ride the lazy chunks of the modals that actually use it, so a
 * viewer reading the schedule never downloads it.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  wide,
  footer,
  onSubmit,
}: {
  title: string;
  /** One line under the title: what this dialog is for, or what it will do. */
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** The action bar. It does not scroll, so Save stays reachable from anywhere
   *  in a long form. Right-aligned; give an item `me-auto` to send it left, or
   *  `basis-full` to put it on its own line above the buttons. */
  footer?: ReactNode;
  /** Given, the dialog is a real `<form>`: Enter in a field submits it, and the
   *  primary action should be a `type="submit"` button. */
  onSubmit?: () => void;
}) {
  const Body = onSubmit ? 'form' : 'div';

  /*
   * Base UI's Dialog owns what this hand-rolled and got quietly wrong: a real
   * focus trap, `inert` on the rest of the page, focus handed back to whatever
   * opened it, scroll lock, and Escape. Phase 0 flagged the missing trap; this
   * is the fix, and every caller gets it without changing a line.
   *
   * The portal is Base UI's now, but it is still load-bearing for the reason it
   * always was: `position: fixed` is only fixed to the viewport while no
   * ancestor has a filter, transform or `backdrop-filter`. The schedule header
   * has `backdrop-blur`, so a dialog opened from a menu up there (About, device
   * linking) used to be laid out inside the header's own box — backdrop over a
   * strip at the top, panel pushed off the screen on a phone.
   */
  return (
    <Dialog.Root
      open
      // The caller mounts and unmounts this, so closing only ever means "tell
      // them"; they stop rendering it and it goes.
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-stone-900/40 dark:bg-black/60" />
        {/* Bottom sheet on mobile, centred dialog from `sm` up. */}
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <Dialog.Popup
            // dvh, not vh: on mobile browsers vh counts the area behind the
            // address bar, so 90vh can be taller than what you can actually see.
            // The panel is capped and its body scrolls, so nothing can end up
            // above the top of the screen where no scrolling reaches it.
            className={`relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white outline-hidden dark:bg-stone-900 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl ${
              wide ? 'max-w-2xl' : 'max-w-md'
            }`}
          >
            <Body
              className="flex min-h-0 flex-1 flex-col"
              {...(onSubmit
                ? {
                    // No native bubbles: a `required` on a field would raise the
                    // browser's own message a beat before the app's sentence in
                    // the footer. The handler validates; see `InlineForm`.
                    noValidate: true,
                    onSubmit: (e: React.FormEvent) => {
                      e.preventDefault();
                      onSubmit();
                    },
                  }
                : {})}
            >
              <div className="flex shrink-0 items-start gap-3 border-b border-stone-200 px-5 py-4 dark:border-stone-700">
                <div className="min-w-0 flex-1">
                  {/* Title and Description are Base UI's so the dialog is actually
                      labelled and described to a screen reader, rather than
                      carrying a hand-written `aria-label` that could drift. */}
                  <Dialog.Title className="text-base font-semibold tracking-tight">
                    {title}
                  </Dialog.Title>
                  {description && (
                    <Dialog.Description className="mt-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                      {description}
                    </Dialog.Description>
                  )}
                </div>
                {/* `type="button"` is load-bearing: inside the `<form>` body a bare
                    button submits it, so the × would save instead of close. */}
                <Dialog.Close
                  type="button"
                  aria-label="Close"
                  title="Close"
                  className="-me-1.5 -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-stone-500 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                >
                  <CloseIcon />
                </Dialog.Close>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                {children}
              </div>

              {footer && (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3 dark:border-stone-700 dark:bg-stone-950/40">
                  {footer}
                </div>
              )}
            </Body>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
