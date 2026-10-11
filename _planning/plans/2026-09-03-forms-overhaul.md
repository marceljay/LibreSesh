# LibreSesh — form layer refactor plan

Brief for an agent working in this repo. Read this whole file before editing.
Written against `dev` (`ee4f6dd`), React 18.3.1, Tailwind 3.4.15, Vite 5, Zod 3.23.8.

## Goal

Forms in this app are individually well-reasoned and collectively inconsistent.
The visible symptoms are: buttons that don't line up with adjacent inputs, selected
items and tags that render outside the field they belong to, text controls that look
slightly different from each other, and weak contrast. Underneath, labels are not
associated with their controls at 95 of 96 call sites.

Fix these by strengthening the existing primitives in `web/src/components/ui.tsx`
so that the correct thing is the only available thing. Do not fix them by adopting a
component or form library.

## Non-goals — do not do these

- **No form library.** Not react-hook-form, TanStack Form, Formik. The house pattern
  (one `useState` per field + a hand-written sequential `save()`) stays. Forms here are
  short modals and single-field edits; centralised form state buys nothing yet.
- **No wholesale design system.** Not shadcn/ui (also blocked by Tailwind 3), and not a
  general migration of `ui.tsx` onto anyone else's Field / Form / Dialog primitives.
  `ui.tsx` already solved this app's layout, portal and alignment bugs.
  The governing rule is **one owner per concern**: `ui.tsx` owns label, error, border,
  height, focus ring, spacing, alignment and `Modal`. A headless library may own the
  *interaction machinery* of a composite widget and nothing else — see "Interaction
  layer" below. Base UI, Radix, Ark and Zag are all unstyled; the objection to them is
  never visual, it is about which layer owns which decision.
- **No client-side Zod.** Zod stays server-only (`server/src/validation.ts`) and stays on
  v3. Do not upgrade Zod. Do not add it to the web bundle. Client checks stay hand-rolled
  pure functions in `web/src/lib/`.
- **No Tailwind 4 upgrade** as part of this work. Everything below works on Tailwind 3.
- **No new *styling* or *layout* dependencies.** Visual decisions stay in `ui.tsx`.
- **No `@testing-library`, no jsdom.** Testing stays pure-logic units plus source-text
  assertions. Enforcement comes from ESLint, not from DOM tests.

## Interaction layer — who owns keyboard and ARIA

Keyboard navigation and ARIA wiring for composite widgets are worth standardising. They
are also the one part of this work where a dependency is justified, because typeahead,
indexed navigation and focus management are hard to hand-roll correctly.

**Decide this first, in Phase 0:** for every multi-value control in the app, is the value
free text the user types, or an item picked from a known collection? Tags, tracks and
formats look like entities, which means these are almost certainly *entity pickers*, not
tag inputs. The answer picks the tool:

- **Entity picker (pick from a collection, possibly with "create new")** — this is a
  combobox with chips. Two viable routes:
  - `@base-ui/react/combobox`. `Combobox.Root` takes `multiple`, and selections render as
    `Combobox.Chip` / `Combobox.ChipRemove` *inside* `Combobox.InputGroup`, alongside
    `Combobox.Input`. That is the same inversion as `ControlShell`, shipped as a
    component, with listbox state, keyboard navigation and WAI-ARIA roles included.
    Unstyled; peer range `^18 || ^19`. Import **only** the combobox entry point — Base
    UI's `Field` and `Form` are a second validation owner and must not be used.
    Before committing, run `npm ls @floating-ui/react` to see whether it duplicates the
    positioning engine already installed, and report the result.
  - Hand-roll on `@floating-ui/react`, **already a dependency at 0.27.20**. The React
    package ships interaction primitives as well as positioning: `useListNavigation`,
    `useTypeahead`, `useRole`, `useDismiss`, `useClick`, `useInteractions`,
    `FloatingFocusManager`, `FloatingList`. `components/Popover.tsx` currently uses only
    the positioning half. Zero new dependencies, more code to own.
- **Free-text tag entry (anything typed becomes a tag)** — only if such a control
  actually exists. Base UI cannot do this today; its chips are combobox-only. Use
  `@zag-js/tags-input`, a headless state machine that ships no CSS and, needing no
  positioning, does not pull in `@zag-js/popper`. `@ark-ui/react/tags-input` is the same
  machine with a component wrapper instead of prop-getters — less boilerplate, more API
  surface. Either is acceptable; pick one and note why.
- **Click-to-edit** — `@zag-js/editable`, same conditions, or hand-rolled.
- **Everything visual** — border, height, focus ring, contrast, spacing, alignment —
  stays in `ui.tsx` regardless of which machine drives the behaviour. Render the
  library's prop-getters or slot components onto our own `ControlShell`.

Adopt at most one of these routes. If the Phase 0 audit finds no free-text tag input,
drop Zag from the plan entirely.

If a Zag or Ark machine is added, wire its `translations` and `dir` props from the i18n
layer (see below) rather than accepting the English defaults.

## Load-bearing — treat as constraints, not preferences

Changing any of these needs an explicit decision, not a refactor:

1. **Margin ownership.** `Field` carries no outer margin. Spacing belongs to
   `FormStack` / `FormRow` / `FormGrid`. `FormRow` bottom-aligns, `FormGrid` top-aligns.
   Both are documented in-file with the bug that motivated them.
2. **`PrimaryButton` is not `inline-flex`.** Making it flex left-aligns eight full-width
   buttons. Leave it.
3. **Errors go where the action was** — modal footer beside the button pressed, or under
   the control with the user's text intact. Never at the top of a scrolled form.
4. **Messages are sentences, not codes.**
5. **"Empty is not yet wrong."** `NumberField` withholds its error until there is
   something to be wrong about. Every new validating control copies this.
6. **`Modal`'s portal + `dvh` handling.** The portal exists because `backdrop-blur` on the
   schedule header made `position: fixed` resolve against the header's box. The `dvh` cap
   exists because `vh` counts the area behind the mobile address bar. Do not "simplify".
7. **`type="number"` is banned.** See `lib/numberField.ts`.
8. **The comments carry the rejected alternative.** Preserve them when moving code, and
   add one whenever this plan's reasoning is non-obvious from the result.

## Phase 0 — Confirm the audit (no behaviour change)

Verify each of these in the tree, and report actual numbers. Do not fix anything yet.

- **Classify every multi-value control.** For each one, record whether its value is free
  text the user types or an item chosen from a known collection, and whether "create new"
  is possible. This decides the Interaction layer question above. List the call sites.
- `inputClass` uses `text-sm` (14px). **iOS Safari zooms the viewport on focus for any
  input below 16px and does not zoom back out.** Every text field in the app has this bug.
- Contrast, computed against white. `border-stone-300` (#d6d3d1) ≈ **1.5:1**;
  `text-stone-400` (#a8a29e) ≈ **2.5:1**; `text-stone-500` (#78716c) ≈ **4.8:1**.
  Required: 4.5:1 for body/label/hint text (WCAG 1.4.3), 3:1 for control borders and
  focus indicators (1.4.11). So current field borders are roughly half the required
  ratio, and `stone-400` is the first step that still fails — `stone-500` is the first
  that passes. Re-derive these with a contrast tool and report the real figures before
  changing tokens. Check dark mode separately.
- `inputClass` has `outline-none` and signals focus only by shifting the border from
  `stone-300` to `stone-500`. Report whether that shift is ≥3:1 against the unfocused
  state. (Focus Appearance is AAA, so this is a quality problem rather than an AA
  failure — but `outline-none` with no replacement ring is the reason keyboard focus is
  hard to see.)
- `HelpButton` is `h-5 w-5` (20px). WCAG 2.2 SC 2.5.8 Target Size (Minimum) is AA and
  wants 24×24 CSS px. Check whether the spacing exception applies at its call sites.
- Count `<Field>` call sites and how many pass `htmlFor`. Expected: 96 and 1.
- Count hand-rolled `e.key === 'Enter'` handlers. Expected: 14 across 10 files.
- `Gate.tsx` password field: confirm it is not inside a `<form>` and has no
  `autoComplete`. Password managers cannot reliably fill or save it.
- `Modal` has `aria-modal="true"` but no focus trap and no `inert` on the app root, and
  its backdrop is a full-viewport `<button aria-label="Close">` inside the dialog — so a
  screen reader user meets a "Close" button before the dialog's content, and a second one
  in the header.
- Check whether keyboard focus inside the scrolling modal body can end up behind the
  sticky footer. That one *is* AA (SC 2.4.11 Focus Not Obscured).

Deliverable: a short findings file. Nothing else.

## Phase 1 — `ControlShell` and `TextInput` (the core change)

This is the phase that fixes three of the four visible symptoms. Do it as one PR.

**The insight:** today the `<input>` *is* the field, so anything that belongs "in the
field" (tags, chips, a submit affordance, a unit suffix) has to render as a sibling
outside the border. That is why selected items appear outside the search box. Invert it:
the bordered box is the field, and the input is one child of it.

Add to `ui.tsx`:

```tsx
// The bordered, focus-ringed box. Owns border, height, radius, padding, focus
// state and invalid state. Nothing else may draw a field border.
export function ControlShell({ invalid, disabled, children, className }: {...})

// The bare text input that lives inside a ControlShell. No border, no padding,
// no background — the shell owns all of that. Consumes FieldContext for its id
// and aria wiring.
export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>)

// Trailing/leading content inside the shell: a submit ↵, a unit, an icon button.
export function ControlAdornment({ children }: {...})
```

Requirements:

- `ControlShell` renders `flex flex-wrap items-center gap-1.5` so tags and chips sit
  inside the border and wrap.
- Clicking anywhere in the shell focuses its input.
- Focus ring lives on the shell via `:focus-within`, replacing the current
  `outline-none` + border shift. Use a real ring so it is visible in both themes.
- Height: keep `controlHeightClass` as the *minimum*, not a fixed height — a shell
  holding two rows of tags must be able to grow.
- Font size: `text-base sm:text-sm` on the input, or better, a `@media (pointer: coarse)`
  rule setting `font-size: max(1rem, …)`. **Do not** add `maximum-scale=1` or
  `user-scalable=no` to the viewport meta — that disables pinch zoom and fails WCAG.
- `inputClass` stays exported as a deprecated alias during migration, with a comment
  pointing at `ControlShell`. Remove it in Phase 2 once call sites are converted.

**`Field` gains a context.** `Field` generates an id with `useId()` when `htmlFor` is
absent, wires its own `<label htmlFor>`, and provides `{ id, describedBy, invalid }`
through a `FieldContext`. `TextInput` consumes it and sets `id`, `aria-invalid` and
`aria-describedby` automatically. Add `FieldError` as a sibling of `FieldHint` that
renders `role="alert"` and registers its id into `describedBy`.

After this, `NumberField` should be reimplementable as `Field` + `ControlShell` +
`TextInput` + `ControlAdornment` with no bespoke aria wiring. Do that as the proof, and
keep its behaviour byte-identical — including "empty is not yet wrong".

Acceptance: `npm run lint` passes; `NumberField` renders and validates as before;
clicking a label focuses its control; no visual regression in the room editor or the
"New track" / "Add track" row.

## Phase 2 — Convert the call sites

Mechanical, one directory per commit. `git grep -n inputClass` is the worklist.

- Replace `<input className={inputClass}>` with `<TextInput>` inside a `ControlShell`.
- Delete `htmlFor` plumbing that Phase 1 made unnecessary.
- Where a control had a red-border-on-error hack, move it to `ControlShell invalid`.
- Report any call site that resists conversion rather than forcing it; those are the
  interesting ones.

Then add the guardrails to `.eslintrc` — ESLint 8 `no-restricted-syntax`:

- Ban `<input>`, `<select>`, `<textarea>` JSX in `web/src` outside `components/ui.tsx`.
- Ban `<button>` JSX outside `ui.tsx` (the button primitives exist; `Modal`'s internal
  close button is the one allowed exception, in-file).
- Ban the string `inputClass` once it is deleted.
- Ban `border-stone-300` and `text-stone-400` in `web/src` after Phase 3.

These rules are what stops the next agent — or the next session of this one — from
reintroducing the bug. They matter more than the refactor.

## Phase 3 — Tokens: contrast and focus

One commit, one place. Using the Phase 0 numbers:

- Raise field borders to the first stone step that clears 3:1 in both themes.
- Raise hint text (`Field`'s hint, `FieldGroup`'s title, `Spinner`) to the first step that
  clears 4.5:1. `text-stone-400` fails; do not keep it for anything a user must read.
- Add a real focus ring to `ControlShell` and to all four button primitives.
- Do not add per-call-site colour overrides. If a field needs different contrast, the
  token is wrong.
- Keep the stone palette. This is a contrast fix, not a restyle.

## Phase 4 — Form semantics

- Add an `InlineForm` primitive: a real `<form noValidate onSubmit>` for the
  loose-controls sections (`AdminPage`, `AdminRooms`, `AdminBreaks`, `Gate`,
  `NewEventPage`, `ImportPage`). Enter then submits natively.
- Delete the 14 hand-rolled `e.key === 'Enter'` handlers as their sections convert.
- Add `noValidate` to `Modal`'s form too, so native bubbles never race the app's messages.
- Put the Gate password field in a form with `name="password"` and
  `autoComplete="current-password"`.
- Add `inputMode` and `enterKeyHint` where they help (`enterKeyHint="done"` on
  single-field inline edits). Note `enterKeyHint` only relabels the key; it does not
  change behaviour, so the handler still has to exist.
- `Modal`: set `inert` on the app root while open (imperatively — React 18 has no `inert`
  prop) and make the backdrop a `div` with `onClick` and `aria-hidden="true"`, since
  Escape and the header × already provide keyboard and AT paths.

## Phase 5 — Composite controls

Only after Phases 1–4. The tags/combobox bugs are largely *layout* bugs that
`ControlShell` already fixes; re-check before building anything.

- Render selected chips as children of the control's `ControlShell`, with the text input
  as the last child. That alone is the "selected items not in the search field" fix, and
  it is pure layout — do it first and re-measure before adding any dependency.
- Then implement the chosen route from "Interaction layer", using the Phase 0
  classification. If the controls are entity pickers, that is either
  `@base-ui/react/combobox` (chips and ARIA included) or `@floating-ui/react`'s
  interaction hooks over our own markup. Follow the WAI-ARIA APG combobox pattern for
  `aria-expanded`, `aria-controls` and `aria-activedescendant`. Implement it once, in
  `ui.tsx`, and have every picker use it.
- Only if Phase 0 found a genuine free-text tag input: add `@zag-js/tags-input` (or
  `@ark-ui/react/tags-input`) rather than iterating on a hand-rolled version of Enter-to-
  add, delimiter splitting on paste, arrow-key selection of existing tags, and backspace
  at caret-start. Report before adding.
- Inline create affordance ("Expect someone"): keep the visible button that opens it —
  discoverability, not accessibility, is this pattern's weak point. On open, focus the
  input. Give the input an `aria-label` that matches its placeholder word for word, a real
  `<button type="submit">` rendered as ↵ inside the shell, Escape to cancel, focus
  retained after a successful add, and a `aria-live="polite"` region announcing
  "<name> added". Do not announce errors through that region — the error node has
  `role="alert"` and would be read twice.

## Phase 6 — One failure path

- Decide and document: field-attributable failures render under the control or in the
  modal footer via `FormError`; unexpected/network failures go to the toast. The same
  class of failure must not be a toast in `AdminPage` and a `FormError` in a modal.
- Wire the concurrency mechanism that already exists server-side: send
  `expectedUpdatedAt` on session writes and handle the `stale` `ApiError` code with a
  sentence that says someone else changed it. Today two organisers silently
  last-write-wins on a mechanism built to prevent exactly that.

## i18n readiness

An i18n layer is planned but not yet chosen. Do not add one as part of this work. Do the
three structural things that are expensive to retrofit, and nothing else.

1. **Logical properties from Phase 1 onward.** In `ControlShell`, `TextInput` and every
   converted call site, use Tailwind's logical utilities — `ms-`/`me-`, `ps-`/`pe-`,
   `border-s`/`border-e`, `text-start`/`text-end` (Tailwind 3.3+) — instead of `pl-`,
   `pr-`, `left-`, `right-`, `text-left`. RTL then costs a `dir` attribute rather than a
   second pass over every call site. Add an ESLint rule banning the physical variants in
   `web/src` once Phase 2 lands.
2. **Never render server message text.** `ApiError` already carries machine codes
   (`stale`, `overlap`, `name_taken`, `rate_limited`). Map code → sentence on the client,
   in one module. `AdminPage.tsx`'s `fail = (err) => toast.show(err.message)` currently
   surfaces the server's English string directly; convert it during Phase 6. The server
   stays locale-unaware.
3. **No assembled sentences.** Every user-visible string must be a single message with
   named parameters, not concatenation. This touches `lib/numberField.ts`'s range
   messages and `SessionModal.tsx`'s seven ordered checks — reshape those to return a
   code plus params rather than a finished sentence, and let the caller render it.
   Quantities go through `Intl.PluralRules`, not `n === 1 ? 'minute' : 'minutes'`.

Also in scope for translation later, so keep them centralised: every `aria-label`, the
`role="alert"` error text, live-region announcements, and any `translations` object
passed to a Zag machine.

## Working rules for the agent

- One phase per PR. Do not start the next phase in the same branch.
- `npm run lint` (eslint + both tsc projects) must pass on every commit.
- Expect to update source-text assertions in `tests/roleTag.test.ts`,
  `tests/confirmDialog.test.ts`, `tests/peopleColumns.test.ts`. Update them; do not
  delete them.
- When you change a primitive, update its comment to say what it replaced and why. That
  convention is the strongest one in this codebase.
- If a phase's reasoning turns out to be wrong when you see the code, stop and say so
  rather than improvising a different design.