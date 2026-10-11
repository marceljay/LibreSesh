# Forms overhaul — Phase 0 findings

Audit confirmation for `../plans/2026-09-03-forms-overhaul.md`. Read-only; nothing changed.
Verified against `dev` (`ee4f6dd`). Contrast ratios computed with the WCAG 2.x
relative-luminance formula, not eyeballed.

## Audit checklist — verdicts

| # | Claim in plan | Verdict | Actual |
|---|---|---|---|
| 1 | Multi-value controls are entity pickers, not tag inputs | **Confirmed + decides a Phase** | See §Interaction below |
| 2 | `inputClass` is `text-sm` (14px) → iOS focus-zoom | **Confirmed** | `ui.tsx:33`, `text-sm` on every field |
| 3 | Border/hint/text contrast figures | **Confirmed, refined** | See §Contrast — light matches, dark asymmetric |
| 4 | Focus is a border shift under `outline-none` | **Confirmed** | shift = 3.22:1; no ring |
| 5 | `HelpButton` is 20px (< 24px SC 2.5.8) | **Confirmed** | `ui.tsx:304`, `h-5 w-5` |
| 6 | 96 `<Field>` sites, 1 passes `htmlFor` | **Confirmed exactly** | 96 / 1 (the 1 is `ui.tsx:138`, inside `NumberField`) |
| 7 | 14 hand-rolled Enter handlers across 10 files | **Confirmed exactly** | 14 / 10 |
| 8 | Gate password not in a `<form>`, no `autoComplete` | **Confirmed** | `Gate.tsx:355`, no `<form>` anywhere in file |
| 9 | `Modal` backdrop is a full-viewport Close button, no trap/inert | **Confirmed** | `ui.tsx:542`; two "Close" buttons, no focus trap, no `inert` |
| 10 | Focus can hide behind sticky footer (SC 2.4.11, AA) | **Plausible, not proven** | Footer is `shrink-0` after a scroll region; needs a live keyboard test |

## Interaction layer — the Phase 0 decision, resolved

The plan says decide this first. **Answer: there is no free-text tag input in the
app. Drop Zag/Ark from the plan.**

- **Chip toggles over a fixed collection** — tags, format, placement `type`,
  tracks. `SessionModal.tsx` renders these as `<Chip active … onClick>` over the
  event's existing entities (`:335, :362, :482, :654`). Nothing is typed; nothing
  is created inline. These are not controls that need a combobox at all — they are
  toggle groups. Their only real bug is contrast and the chip/border layout, both
  of which `ControlShell` + the Phase 3 tokens fix.
- **One entity-picker-with-create** — `SpeakerCombobox.tsx`. It searches existing
  people and also offers *"+ Add "X" as someone new"* (`:237`), returning
  `number | string` to match the API. This is the single control that wants the
  combobox-with-chips treatment. It already hand-rolls its listbox on
  `@floating-ui/react`.
- **Native `<select>`** — 13 across 6 files (day pickers, merge target, break
  kind). Not in scope until Phase 5, and arguably never: a native select is the
  accessible default.

So Phase 5 reduces to: (a) move `SpeakerCombobox`'s chosen chips inside a
`ControlShell` (pure layout), and (b) *if* its hand-rolled keyboard handling is
found wanting, adopt `@floating-ui/react`'s interaction hooks — which are already
installed, so **zero new dependencies**. Base UI's combobox is not needed for one
control. Recommend the floating-ui route and no new dep.

## Contrast — real figures, both themes

Computed vs the actual adjacent surface, not just white. This refines the plan,
which computed light mode only and missed a **cross-theme asymmetry**.

**Field borders** (need 3:1, SC 1.4.11):

| Token | Light vs white | Dark vs input bg `stone-900` |
|---|---|---|
| `stone-300` (light border now) | **1.49:1 ✗** | — |
| `stone-600` (dark border now) | — | **2.29:1 ✗** |
| `stone-400` | 2.52:1 ✗ | 6.93:1 ✓ |
| `stone-500` | 4.80:1 ✓ | 3.65:1 ✓ |

→ **Both themes fail today.** `stone-500` is the only step that clears 3:1 in
*both* (there is no stone step between 2.52 and 4.80, so the light border will get
visibly darker — that is forced by the requirement, not a style choice). The
error-border hack `border-red-400` is **2.77:1 ✗** in light too; error states need
`red-500`+.

**Hint / secondary text** (need 4.5:1, SC 1.4.3):

| Token | Light vs white | Dark vs page `stone-950` |
|---|---|---|
| `text-stone-400` (hint now) | **2.52:1 ✗** | 7.83:1 ✓ |
| `text-stone-500` | 4.80:1 ✓ | **4.12:1 ✗** |

→ **No single token works.** Light needs ≥`stone-500`; dark needs ≤`stone-400`.
The fix is a paired token `text-stone-500 dark:text-stone-400`, which much of the
app already uses — the failures are the places that wrote a bare `text-stone-400`.
`Field`'s hint (`ui.tsx:62`) is one: `text-stone-400 dark:text-stone-500` — i.e.
**backwards**, failing in *both* themes.

**Focus:** the `stone-300 → stone-500` border shift is 3.22:1 (clears 3:1 as a
delta), but `outline-none` leaves no ring, so keyboard focus on a field is barely
visible. Not an AA failure (Focus Appearance is AAA) but the reason the ring is
hard to see. A real `:focus-within` ring on `ControlShell` fixes it.

## One correction to the plan's scope — the `<button>` ESLint rule

Phase 2 proposes banning raw `<button>` JSX outside `ui.tsx` with one in-file
exception. **That exception count is wrong by ~50×.** Raw elements in `web/src`:

- `<input>` — 85 across 23 files. Banning outside `ui.tsx`: **sound**, this is the goal.
- `<textarea>` — 7 across 7 files. Sound; needs a `TextArea` primitive first (none exists).
- `<select>` — 13 across 6 files. Native and accessible; **do not ban** — allowlist it.
- `<button>` — 82 across 24 files, **23 files outside `ui.tsx`**. AdminPage alone
  has 13, SchedulePage 12. These are menu items, sort headers, chips, icon
  buttons, grid session blocks — legitimately raw `<button>`s that are not
  `PrimaryButton`/`SecondaryButton` and never should be.

→ Banning `<button>` outside `ui.tsx` is not a lint rule, it is a rewrite of two
dozen files into wrappers that would each need a bespoke variant. **Recommend
dropping the `<button>` ban.** Keep the `<input>`/`<textarea>` bans (that is where
the real inconsistency lives) and allowlist `<select>`. This is exactly the
"stop and say so if a phase's reasoning is wrong when you see the code" case the
plan's working rules call for.

## Recommended next step

Phase 0 is done; this file is its deliverable. The two decisions it was meant to
unblock are now made: **no Zag (no free-text tag input); one entity picker, fix it
on the already-installed floating-ui.** Two adjustments to later phases fall out:
**paired contrast tokens, not single ones** (Phase 3), and **narrow the ESLint ban
to inputs/textareas** (Phase 2).

Proceed to **Phase 1** (`ControlShell` + `TextInput` + `FieldContext`, prove via
`NumberField`) as its own branch/PR. Nothing before Phase 1 changes behaviour, so
Phase 1 is the first thing that needs the browser pass already sitting under
STATUS Blockers.
