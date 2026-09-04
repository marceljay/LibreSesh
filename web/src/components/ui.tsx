import {
  createContext,
  forwardRef,
  lazy,
  Suspense,
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
import type { Role } from '@shared/types';
import {
  maxDigits,
  parseNumberField,
  sanitizeNumberInput,
  type NumberFieldSpec,
} from '../lib/numberField';

/**
 * Inline controls all stand 38px tall — a `text-sm` input with `py-2` and a
 * border, a `text-xs` button with `py-2.5` and a border (transparent on the
 * primary). `FormRow` bottom-aligns them; matching the height lines up their
 * tops too, which is what "New track" and "Add track" were missing. Bare
 * controls that can't be padded into it (a colour swatch) take this class.
 */
export const controlHeightClass = 'h-[2.375rem]';

/**
 * Field focus. There is already a global focus ring in `index.css`
 * (`:focus-visible` → an offset ring on *everything* a keyboard reaches), and
 * that is the ring buttons, links and bare controls use — nothing here re-adds
 * one. A field needs its own handling for two reasons the global rule cannot
 * cover on its own:
 *
 * 1. A `ControlShell` wraps its `<input>`. The global ring lands on the inner
 *    input, drawing a ring *inside* the shell — the "ugly inner border". So the
 *    input opts out of the global ring (see `TextInput`) and the **shell** takes
 *    a ring instead, via `focus-within`, so it wraps the whole control.
 * 2. A field already has a 1px border, and an *offset* ring a gap away from that
 *    border reads as a second concentric line. So a focused field hides its own
 *    border and shows one flush ring in its place — a single, thicker line.
 *
 * `TextArea` and `select` are not wrapped, so the global ring lands on them
 * correctly; they only override it to flush (no offset) and hide their border,
 * matching the shell. Keep all three in step.
 */
const fieldFocusRing =
  'focus-within:border-transparent focus-within:ring-2 focus-within:ring-stone-500 dark:focus-within:ring-stone-400';

/**
 * What a `Field` tells the control inside it: the id its label points at, the
 * ids its hint and error carry (so the control can name them in
 * `aria-describedby`), and whether it is in an invalid state.
 *
 * This is the fix for the app's oldest, quietest bug: at 95 of 96 call sites a
 * `<label>` was not associated with its control at all — `Field` rendered the
 * label as a *sibling* of `children` and passed `htmlFor` on to nobody. So
 * clicking a label did nothing and a screen reader read the placeholder or
 * silence. Now `Field` owns the id and hands it down; a control that consumes
 * this context is wired up without the call site remembering to.
 */
interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

/** For a control that lives inside a `Field` and wants its wiring. Null when a
 *  control is used bare, which is allowed — the control just gets no free id. */
export const useFieldContext = (): FieldContextValue | null => useContext(FieldContext);

/**
 * A labelled control. Deliberately carries **no** outer margin: spacing is the
 * parent's job via `FormStack`/`FormRow`/`FormGrid`. An earlier version owned a
 * `mb-3`, which forced every adjacent button to hardcode a matching `mb-3` to
 * line up — and that broke the moment a field grew a `hint` and got taller.
 *
 * It generates its own id when `htmlFor` is not given, associates the label
 * with it, and provides `FieldContext` so `TextInput` (and any future control)
 * picks up `id`, `aria-invalid` and `aria-describedby` on its own. Pass `error`
 * and the field goes invalid and renders the message under the control with
 * `role="alert"`, the id wired into `aria-describedby` automatically.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  /** A sentence, present only when the field is wrong. Sets the invalid state
   *  and is announced; absent is a field that is simply not-yet-filled. */
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-300"
        >
          {label}
        </label>
        {children}
        {hint && (
          <p id={hintId} className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            {hint}
          </p>
        )}
        {error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    </FieldContext.Provider>
  );
}

/** The message under a control, announced. A sibling of the hint rather than a
 *  toast, because a field's error belongs under the field it is about. `Field`
 *  renders it from its `error` prop; exported for the field-at-a-time editors
 *  that own their own error state. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}

/**
 * The bordered, focus-ringed box that **is** the field. Owns the border, the
 * height floor, the radius, the padding, the focus ring and the invalid state
 * — nothing else in the app may draw a field border.
 *
 * The point is an inversion. Until now the `<input>` was the field, so anything
 * that belongs *in* a field — a chosen tag, a unit like "days", a submit ↵ —
 * had to render as a sibling outside the border, which is why selected items
 * turned up outside the box that owns them. Here the box is the field and the
 * input is one child of it: `flex flex-wrap` so chips and adornments sit inside
 * the border and wrap, `min-h` rather than a fixed height so a shell holding
 * two rows of tags can grow, and a `:focus-within` ring so focus shows on the
 * box however many children it holds. Clicking empty space in the box focuses
 * the input, the way a native field does.
 *
 * `controlHeightClass` is the floor here, matching the button primitives, so a
 * shell and a button on one line align by construction — see its note.
 */
export function ControlShell({
  invalid,
  disabled,
  className = '',
  children,
}: {
  /** Overrides the `Field`'s invalid state; usually left to the context. */
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useFieldContext();
  const isInvalid = invalid ?? ctx?.invalid ?? false;
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      onMouseDown={(e) => {
        // Only a click on the box's own padding, not on a child control: a tap
        // on a chip's remove button or the input itself must reach it.
        if (e.target !== ref.current) return;
        const field = ref.current?.querySelector<HTMLElement>(
          'input, textarea, select, [contenteditable="true"]',
        );
        if (field) {
          e.preventDefault();
          field.focus();
        }
      }}
      className={`flex min-h-[2.375rem] flex-wrap items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 transition-colors ${fieldFocusRing} dark:bg-stone-900 ${
        isInvalid
          ? 'border-red-500 dark:border-red-500'
          : 'border-stone-500 dark:border-stone-500'
      } ${disabled ? 'opacity-60' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The bare text input that lives inside a `ControlShell`. No border, no
 * padding, no background of its own — the shell owns all of that. Reads
 * `FieldContext` for its `id`, `aria-invalid` and `aria-describedby`, so a
 * `Field` + `ControlShell` + `TextInput` is wired up with none of it written
 * at the call site.
 *
 * `text-base sm:text-sm`: 16px on a phone, because iOS Safari zooms the whole
 * viewport when a field below 16px takes focus and does not zoom back out —
 * every text field in the app has had that bug. 14px returns above `sm`, where
 * there is no such behaviour and the denser size reads better.
 *
 * `focus-visible:ring-0`: the input opts out of the global `:focus-visible` ring
 * (`index.css`). Without this it draws that ring *inside* the shell — the "ugly
 * inner border". Focus is shown on the shell instead (`ControlShell`'s
 * `focus-within` ring), so the whole field rings, not the input within it.
 */
export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className = '', ...props }, ref) {
    const ctx = useFieldContext();
    return (
      <input
        ref={ref}
        id={props.id ?? ctx?.id}
        aria-invalid={props['aria-invalid'] ?? (ctx?.invalid || undefined)}
        aria-describedby={props['aria-describedby'] ?? ctx?.describedBy}
        {...props}
        className={`min-w-0 flex-1 bg-transparent text-base text-stone-900 outline-hidden placeholder:text-stone-400 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed sm:text-sm dark:text-stone-100 dark:placeholder:text-stone-500 ${className}`}
      />
    );
  },
);

/**
 * The multi-line sibling of `TextInput`. Unlike `TextInput` it owns its own
 * border rather than living inside a `ControlShell`: a textarea never holds
 * chips or adornments, which is the whole reason `ControlShell` exists, so
 * wrapping one buys nothing and fights the flex layout. It still reads
 * `FieldContext` for `id`/`aria-invalid`/`aria-describedby` and carries the
 * same 16px-on-mobile fix, so a `Field` + `TextArea` is wired up with none of
 * it at the call site.
 *
 * Border and focus tokens are kept in step with `ControlShell` by hand; the
 * Phase 3 contrast pass changes both together (and the `border-stone-300` ban
 * lands only after it).
 */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className = '', ...props }, ref) {
  const ctx = useFieldContext();
  const invalid = props['aria-invalid'] ?? ctx?.invalid;
  return (
    <textarea
      ref={ref}
      id={props.id ?? ctx?.id}
      aria-invalid={invalid || undefined}
      aria-describedby={props['aria-describedby'] ?? ctx?.describedBy}
      {...props}
      className={`w-full rounded-lg border bg-white px-3 py-2 text-base text-stone-900 outline-hidden transition-colors placeholder:text-stone-400 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-stone-500 focus-visible:ring-offset-0 disabled:cursor-not-allowed sm:text-sm dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus-visible:ring-stone-400 ${
        invalid ? 'border-red-500 dark:border-red-500' : 'border-stone-500 dark:border-stone-500'
      } ${className}`}
    />
  );
});

/**
 * The class for a native `<select>`. Native selects stay native — the plan
 * allowlists the element rather than wrapping it, because a native select is
 * the accessible default and holds nothing a `ControlShell` would carry. This
 * gives them the field's border, height and focus ring so they read as siblings
 * of the text fields, and is what a native select wears now that the old field
 * skin is gone. Tokens track `ControlShell`; Phase 3 changes them together.
 */
export const selectClass =
  `${controlHeightClass} w-full rounded-lg border border-stone-500 bg-white px-3 text-base outline-hidden transition-colors ` +
  'focus:border-transparent focus:ring-2 focus:ring-stone-500 focus:ring-offset-0 sm:text-sm ' +
  'dark:border-stone-500 dark:bg-stone-900 dark:text-stone-100 dark:focus:ring-stone-400';

/** Trailing (or leading) content inside a `ControlShell` — a unit like "days",
 *  a submit ↵, an icon button. Sits inside the border, which is the whole
 *  reason `ControlShell` exists. */
export function ControlAdornment({ children }: { children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
      {children}
    </span>
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
  const { error } = parseNumberField(value, spec);
  // A field you have not filled in yet is not a field you got wrong, so the
  // message waits until there is something in it to be wrong about.
  const shown = value.trim() === '' ? null : error;

  // The proof that the Phase 1 primitives carry a real field: no id, no aria
  // wiring and no bespoke error markup here any more — `Field` owns the id and
  // the message, `ControlShell` owns the border and the invalid state,
  // `TextInput` picks all of it up from context. The digits-only rule and
  // "empty is not yet wrong" are unchanged.
  //
  // The suffix stays *outside* the box, beside it, not in a `ControlAdornment`.
  // In this app the suffix is not a unit like "days" but a running sentence —
  // "days · the rail is on for this event" — and inside a `w-32` shell it would
  // wrap into a heap. `ControlAdornment` is for the short in-field kind (a ↵, a
  // real unit), which arrives with the inline-create control later.
  return (
    <Field label={label} hint={hint} error={shown ?? undefined}>
      <div className="flex items-center gap-2">
        <ControlShell className={className}>
          <TextInput
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(sanitizeNumberInput(e.target.value, spec))}
            onKeyDown={onKeyDown}
            maxLength={maxDigits(spec)}
            autoFocus={autoFocus}
          />
        </ControlShell>
        {suffix && <span className="text-xs text-stone-500 dark:text-stone-400">{suffix}</span>}
      </div>
    </Field>
  );
}

/** `userLabel` is the event's own word for the middle role, e.g. "attendee". */
/**
 * The colour each role wears, and the pill it wears it in.
 *
 * Split out from `RoleBadge` so the editable tag in the People list can be the
 * same object as the badge everywhere else. A role that is a plain select in
 * one place and a coloured pill in another reads as two different facts; an
 * organiser scanning the list should recognise "organiser" by colour before
 * they have read the word.
 */
export const roleTagColor: Record<Role, string> = {
  admin: 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900',
  speaker: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
  user: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  viewer: 'bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300',
};

/** The pill itself, without the colour — shared with the "signed out" tag,
 *  which is not a role and so has no entry above. The `capitalize` that used
 *  to live here does not: "signed out" is a sentence about somebody, not a
 *  role's name, and "Signed Out" beside a lowercase "speaker" reads as a
 *  different kind of thing. Whoever renders a role word adds it. */
export const roleTagShape = 'rounded-full px-2 py-0.5 text-xs font-semibold';

/** What this event calls the role. `user` is the one an organiser may rename,
 *  which is why nothing hard-codes "attendee" but this. */
export const roleWord = (role: Role, userLabel?: string): string =>
  role === 'user' ? (userLabel ?? 'attendee') : role;

export function RoleBadge({ role, userLabel }: { role: Role; userLabel?: string }) {
  return (
    <span className={`${roleTagShape} ${roleTagColor[role]} capitalize`}>
      {roleWord(role, userLabel)}
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
      className={`rounded-sm text-stone-600 underline-offset-2 hover:text-stone-900 hover:underline focus-visible:underline dark:text-stone-400 dark:hover:text-stone-100 ${className}`}
    >
      {children}
    </a>
  );
}

/** The class `TextLink` applies, for react-router `<Link>`, which needs to own
 *  its own element. Keeps one definition of what a link looks like. */
export const linkClass =
  'rounded-sm text-stone-600 underline-offset-2 hover:text-stone-900 hover:underline ' +
  'focus-visible:underline dark:text-stone-400 dark:hover:text-stone-100';

/** A titled card. Replaces the `rounded-2xl border … p-5 shadow-xs` string that
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
      className={`rounded-2xl border border-stone-200 bg-white p-5 shadow-xs dark:border-stone-700 dark:bg-stone-900 ${className}`}
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
  /** Optional: a group whose contents say what they are needs no heading, and
   *  an empty one would still cost the space above the first field. */
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      {title && (
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
          {title}
        </h3>
      )}
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
          className="fixed bottom-4 start-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-lg bg-stone-900 px-4 py-2 text-center text-xs font-medium text-white shadow-lg dark:bg-stone-100 dark:text-stone-900"
        >
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export interface ConfirmRequest {
  title: string;
  /** What will actually happen. Where the thing goes, and whether it can be
   *  brought back — those are the two questions, and a browser alert could
   *  answer neither because it cannot hold a sentence worth reading. */
  body: ReactNode;
  confirmLabel?: string;
  /** Red button. Default true: nearly everything that asks is a removal. */
  danger?: boolean;
}

const ConfirmContext = createContext<(request: ConfirmRequest) => Promise<boolean>>(() =>
  Promise.resolve(false),
);

/**
 * Ask before doing something that cannot be taken back, in the app's own
 * voice rather than the browser's.
 *
 * `window.confirm` was doing this job and doing it badly: it renders as an
 * alert from the *browser*, unstyled, untranslatable, one line, and it says
 * "Delete X?" without ever saying what deleting means here — that a session
 * goes to the bin and can be restored, while a room or a tag simply goes. It
 * also freezes the page's JavaScript, which on a phone at a conference is
 * indistinguishable from a hang.
 *
 * Shaped as a promise so it drops straight into the place a `confirm()` call
 * used to sit, rather than turning every caller into a state machine.
 */
/**
 * Loaded on demand, not imported. `ui.tsx` is pulled into the app shell for its
 * providers, so a static import here would drag Base UI's Dialog (~20 kB gz)
 * into the first-paint chunk for every visitor — including the ones who only
 * ever read the schedule. A confirm is rare and always a response to a click,
 * so fetching the dialog at that moment costs nothing anyone notices.
 */
const LazyModal = lazy(() => import('./Modal').then((m) => ({ default: m.Modal })));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{
    request: ConfirmRequest;
    settle: (ok: boolean) => void;
  } | null>(null);

  const ask = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((settle) => setPending({ request, settle })),
    [],
  );

  const close = (ok: boolean) => {
    pending?.settle(ok);
    setPending(null);
  };

  const danger = pending?.request.danger !== false;
  const label = pending?.request.confirmLabel ?? 'Delete';

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <Suspense fallback={null}>
        <LazyModal
          title={pending.request.title}
          onClose={() => close(false)}
          onSubmit={() => close(true)}
          footer={
            <>
              <SecondaryButton onClick={() => close(false)}>Cancel</SecondaryButton>
              {danger ? (
                <DangerButton type="submit">{label}</DangerButton>
              ) : (
                <PrimaryButton type="submit">{label}</PrimaryButton>
              )}
            </>
          }
        >
          <p className="text-sm text-stone-600 dark:text-stone-300">{pending.request.body}</p>
        </LazyModal>
        </Suspense>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = (): ((request: ConfirmRequest) => Promise<boolean>) =>
  useContext(ConfirmContext);

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="py-16 text-center text-sm text-stone-500 dark:text-stone-400">{children}</div>;
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="py-20 text-center text-sm text-stone-500 dark:text-stone-400" role="status">
      {label}
    </div>
  );
}
