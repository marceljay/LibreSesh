import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { Role } from '@shared/types';
import {
  maxDigits,
  parseNumberField,
  sanitizeNumberInput,
  type NumberFieldSpec,
} from '../lib/numberField';
import { CloseIcon } from './icons';

/**
 * Inline controls all stand 38px tall — a `text-sm` input with `py-2` and a
 * border, a `text-xs` button with `py-2.5` and a border (transparent on the
 * primary). `FormRow` bottom-aligns them; matching the height lines up their
 * tops too, which is what "New track" and "Add track" were missing. Bare
 * controls that can't be padded into it (a colour swatch) take this class.
 */
export const controlHeightClass = 'h-[2.375rem]';

export const inputClass =
  'w-full rounded-lg border border-stone-300 bg-white dark:bg-stone-900 px-3 py-2 text-sm outline-none ' +
  'focus:border-stone-500 dark:border-stone-600 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-400';

/**
 * A labelled control. Deliberately carries **no** outer margin: spacing is the
 * parent's job via `FormStack`/`FormRow`/`FormGrid`. An earlier version owned a
 * `mb-3`, which forced every adjacent button to hardcode a matching `mb-3` to
 * line up — and that broke the moment a field grew a `hint` and got taller.
 */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-300"
      >
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{hint}</p>}
    </div>
  );
}

/** Vertically stacked form controls, evenly spaced. */
export function FormStack({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-3 ${className}`}>{children}</div>;
}

/**
 * Controls on one line, bottom-aligned so inputs and buttons share a baseline
 * regardless of label or hint height. This is what replaces the `mb-3` hack.
 */
export function FormRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-end gap-2 ${className}`}>{children}</div>;
}

/**
 * Responsive grid of fields. `items-start`, not `items-end`: every child is a
 * `Field`, whose label is one line, so aligning the tops aligns the inputs and
 * lets a hint hang below its own field. Bottom-aligning instead lifted the
 * input of any field *without* a hint by the height of its neighbour's — which
 * is what knocked the room editor's Name and Capacity out of line.
 */
export function FormGrid({
  children,
  cols = 2,
  className = '',
}: {
  children: ReactNode;
  cols?: 2 | 3;
  className?: string;
}) {
  const at = cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return <div className={`grid items-start gap-3 ${at} ${className}`}>{children}</div>;
}

/**
 * A field that holds a number. The only one — see `lib/numberField.ts` for why
 * `type="number"` is not it.
 *
 * Digits are all that can be typed or pasted, and the range is checked here
 * rather than by the server, so a value out of bounds says so under the field
 * while you are still looking at it. The parsed value is the caller's to read
 * back with `parseNumberField`; this renders the same verdict it would get.
 */
export function NumberField({
  label,
  hint,
  spec,
  value,
  onChange,
  onKeyDown,
  suffix,
  className = 'w-24',
  autoFocus,
}: {
  label: string;
  hint?: string;
  spec: NumberFieldSpec;
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  /** Reads on from the field: "days · the rail is on for this event". */
  suffix?: ReactNode;
  className?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const { error } = parseNumberField(value, spec);
  // A field you have not filled in yet is not a field you got wrong, so the
  // message waits until there is something in it to be wrong about.
  const shown = value.trim() === '' ? null : error;

  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(sanitizeNumberInput(e.target.value, spec))}
          onKeyDown={onKeyDown}
          maxLength={maxDigits(spec)}
          aria-invalid={shown ? true : undefined}
          aria-describedby={shown ? `${id}-error` : undefined}
          autoFocus={autoFocus}
          className={`${inputClass} ${className} ${
            shown ? 'border-red-400 focus:border-red-500 dark:border-red-700' : ''
          }`}
        />
        {suffix && (
          <span className="text-xs text-stone-500 dark:text-stone-400">{suffix}</span>
        )}
      </div>
      {shown && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {shown}
        </p>
      )}
    </Field>
  );
}

/** `userLabel` is the event's own word for the middle role, e.g. "attendee". */
export function RoleBadge({ role, userLabel }: { role: Role; userLabel?: string }) {
  const style = {
    admin: 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900',
    speaker: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
    user: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    viewer: 'bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300',
  }[role];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${style}`}>
      {role === 'user' ? (userLabel ?? 'attendee') : role}
    </span>
  );
}

export function Chip({
  active,
  onClick,
  children,
  dot,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  dot?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
        active
          ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
          : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500'
      }`}
    >
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      {children}
    </button>
  );
}

/** Exported for the same reason `secondaryButtonClass` is: the landing page's
 *  call to action is a router `<Link>`, which owns its own element.
 *
 *  Deliberately *not* `inline-flex`, which `secondaryButtonClass` does carry.
 *  A `<button>` centres its label by the UA's `text-align: center`; make it a
 *  flex container and the label becomes a flex item at `flex-start` instead,
 *  which silently left-aligns all eight full-width PrimaryButtons — the gate's
 *  "Enter schedule" among them. An `<a>` that wants the button's box adds
 *  `inline-flex items-center` itself, the way `SessionDetail` already adds
 *  `justify-center` to the one wide SecondaryButton. */
export const primaryButtonClass =
  'rounded-lg border border-transparent bg-stone-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-stone-700 disabled:opacity-40 ' +
  'dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300';

export function PrimaryButton({
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`${primaryButtonClass} ${className}`}>
      {children}
    </button>
  );
}

/** Exported so a download `<a>` can look like the button it stands in for. */
export const secondaryButtonClass =
  'inline-flex items-center rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-xs font-semibold text-stone-700 hover:border-stone-500 disabled:opacity-40 ' +
  'dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-400';

export function SecondaryButton({
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={`${secondaryButtonClass} ${className}`}>
      {children}
    </button>
  );
}

/**
 * Destructive action. Previously these were red *underlined text links*, which
 * read as navigation rather than as a button and gave no hit target.
 */
export function DangerButton({
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-lg border border-red-300 bg-white px-4 py-2.5 text-xs font-semibold text-red-600 hover:border-red-500 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:bg-stone-900 dark:text-red-400 dark:hover:border-red-700 dark:hover:bg-red-950/40 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A round "?" that reveals a note beside the control it explains. For the
 * handful of fields whose meaning is not in their name — where a hint under
 * the field would be permanent clutter for something you read once.
 */
export function HelpButton({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  /** Names what is being explained, e.g. "session types". */
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-label={`Explain ${label}`}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold leading-none ${
        open
          ? 'border-stone-500 bg-stone-500 text-white dark:border-stone-400 dark:bg-stone-400 dark:text-stone-900'
          : 'border-stone-300 text-stone-500 hover:border-stone-500 hover:text-stone-700 dark:border-stone-600 dark:text-stone-400 dark:hover:border-stone-400 dark:hover:text-stone-200'
      }`}
    >
      ?
    </button>
  );
}

/**
 * The note a {@link HelpButton} reveals, which scrolls itself into view as it
 * opens. The field being explained is usually the last one in a tall dialog, so
 * the text arrived entirely below the fold: you pressed "?" and, from where you
 * were sitting, nothing happened. `block: 'nearest'` scrolls the least it can
 * get away with, so a note that is already visible does not move the form.
 */
export function HelpNote({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  return (
    <div
      ref={box}
      className="mt-2 space-y-1.5 rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs leading-relaxed text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
    >
      {children}
    </div>
  );
}

/** Square button for a single glyph — reorder arrows, close, etc. Always needs
 *  an `aria-label`, since the glyph is not a name. */
export function IconButton({
  children,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border border-transparent text-sm text-stone-500 hover:border-stone-300 hover:bg-stone-100 disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-800 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Inline navigation. Underline appears on hover/focus rather than at rest —
 * permanently underlined links made dense admin screens look noisy, and were
 * being used for actions (delete) that are not navigation at all.
 */
export function TextLink({
  children,
  className = '',
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...rest}
      className={`rounded text-stone-600 underline-offset-2 hover:text-stone-900 hover:underline focus-visible:underline dark:text-stone-400 dark:hover:text-stone-100 ${className}`}
    >
      {children}
    </a>
  );
}

/** The class `TextLink` applies, for react-router `<Link>`, which needs to own
 *  its own element. Keeps one definition of what a link looks like. */
export const linkClass =
  'rounded text-stone-600 underline-offset-2 hover:text-stone-900 hover:underline ' +
  'focus-visible:underline dark:text-stone-400 dark:hover:text-stone-100';

/** A titled card. Replaces the `rounded-2xl border … p-5 shadow-sm` string that
 *  was repeated at every section on the admin page. */
export function Section({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-stone-200 bg-white p-5 shadow-sm dark:border-stone-700 dark:bg-stone-900 ${className}`}
    >
      <div
        className={`flex flex-wrap items-start gap-3 ${children ? 'mb-3' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{description}</p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Checkbox with its label as one hit target, aligned to the same baseline as
 *  the inputs beside it. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={`flex items-center gap-1.5 text-xs ${
        disabled
          ? 'cursor-not-allowed text-stone-400 dark:text-stone-600'
          : 'cursor-pointer text-stone-600 dark:text-stone-300'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-stone-900 disabled:opacity-50 dark:accent-stone-100"
      />
      {label}
    </label>
  );
}

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
   *  in a long form. Right-aligned; give an item `mr-auto` to send it left, or
   *  `basis-full` to put it on its own line above the buttons. */
  footer?: ReactNode;
  /** Given, the dialog is a real `<form>`: Enter in a field submits it, and the
   *  primary action should be a `type="submit"` button. */
  onSubmit?: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Only if nothing inside has claimed it already — a field with `autoFocus`
    // has focus by now, and taking it back would undo the point of asking.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const Body = onSubmit ? 'form' : 'div';

  /* Rendered into `body`, not where it was written.
   *
   * `position: fixed` is only fixed to the viewport while no ancestor has a
   * filter, transform or `backdrop-filter` — any of those become the
   * containing block for fixed descendants instead. The schedule header has
   * `backdrop-blur`, so a dialog opened from a menu up there (About, device
   * linking) was laid out inside the header's own box: the backdrop covered a
   * strip at the top of the page, and the panel, which sits at the bottom of
   * its container on a phone, was pushed off the screen entirely. A portal
   * takes it out of that box without moving it in the React tree, so the
   * handlers and state stay exactly where they were written. */
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      {/* Fixed, not absolute: the backdrop must cover the viewport whatever the
          panel does. */}
      <button
        type="button"
        aria-label="Close"
        className="fixed inset-0 cursor-default bg-stone-900/40 dark:bg-black/60"
        onClick={onClose}
      />
      <div className="flex h-full items-end justify-center sm:items-center sm:p-4">
        <div
          ref={panel}
          tabIndex={-1}
          // dvh, not vh: on mobile browsers vh counts the area behind the
          // address bar, so 90vh can be taller than what you can actually see.
          // The panel is capped and its body scrolls, so nothing can end up
          // above the top of the screen where no scrolling reaches it.
          className={`relative flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white outline-none dark:bg-stone-900 sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl ${
            wide ? 'max-w-2xl' : 'max-w-md'
          }`}
        >
          <Body
            className="flex min-h-0 flex-1 flex-col"
            {...(onSubmit
              ? {
                  onSubmit: (e: React.FormEvent) => {
                    e.preventDefault();
                    onSubmit();
                  },
                }
              : {})}
          >
            <div className="flex shrink-0 items-start gap-3 border-b border-stone-200 px-5 py-4 dark:border-stone-700">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold tracking-tight">{title}</h2>
                {description && (
                  <p className="mt-1 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                    {description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                title="Close"
                className="-mr-1.5 -mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              >
                <CloseIcon />
              </button>
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
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Why the last attempt did not go through. Sits in the modal footer beside the
 *  button you just pressed, rather than at the top of a form you have scrolled
 *  away from. */
export function FormError({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      role="alert"
      className={`rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 ${className}`}
    >
      {children}
    </p>
  );
}

/** A run of related fields under a quiet heading. A form of a dozen controls
 *  reads as three or four things you are being asked, not as a wall. */
export function FieldGroup({
  title,
  children,
  className = '',
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
        {title}
      </h3>
      <FormStack>{children}</FormStack>
    </section>
  );
}

/* ------------------------------- Toasts ------------------------------- */

interface ToastApi {
  show: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

export const useToast = (): ToastApi => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);

  const show = useCallback((text: string) => setMessage(text), []);
  const value = useMemo(() => ({ show }), [show]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 2800);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {message && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-center text-xs font-medium text-white shadow-lg dark:bg-stone-100 dark:text-stone-900"
        >
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="py-16 text-center text-sm text-stone-500 dark:text-stone-400">{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="py-20 text-center text-sm text-stone-400 dark:text-stone-500" role="status">
      {label}
    </div>
  );
}
