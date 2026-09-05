# Forms overhaul — review of the whole undertaking

Written 2026-09-04 against `dev` (`362c126`). Companion to
`forms-overview.md` (the briefing), `forms_overhaul_strategy.md` (the plan),
`forms-phase0-findings.md` (the audit) and
`plans/2026-09-04-shadcn-baseui-migration.md` (the pivot). This file is the
retrospective: what was set out to do, what route it took, and what is in the
tree now. Every count below was re-measured, not copied.

## Verdict

**Complete as an undertaking.** The four visible symptoms the plan opened
with are fixed, the structural one (labels unassociated at 95 of 96 sites) is
fixed in a way that cannot regress, the guardrails are in ESLint, and the
contrast claims are tested as numbers rather than class names. Phases 5 and 6
landed in the reduced form Phase 0 re-scoped them to. What did not land is a
short list of Phase 4 items that the pivot overtook, plus two Phase 0 findings
nobody picked up; they are listed under *What did not land* and are in no
queue today.

## Goals

The plan's own framing, 2026-09-03: forms were "individually well-reasoned and
collectively inconsistent". Four symptoms — buttons misaligned with adjacent
inputs, selected chips rendering outside the field they belong to, text
controls that each looked slightly different, weak contrast — and one
structural fault underneath: `Field` rendered its `<label>` as a sibling and
95 of 96 call sites never passed `htmlFor`.

The method was to strengthen `ui.tsx`'s primitives "so that the correct thing
is the only available thing", governed by **one owner per concern**: `ui.tsx`
owns label, error, border, height, focus ring, spacing and `Modal`; a headless
library may own the interaction machinery of a composite widget and nothing
else. Explicit non-goals: no form library, no design system (shadcn named, and
"blocked by Tailwind 3"), no client-side Zod, no Tailwind 4, no
`@testing-library`.

## The plan, phase by phase, and what happened to each

| Phase | Planned | Outcome |
|---|---|---|
| 0 · Audit | Verify ten claims; classify every multi-value control | **Done** (`forms-phase0-findings.md`). All ten confirmed; two corrections to later phases: no free-text tag input exists so Zag was dropped, and the `<button>` ban was wrong by ~50× and dropped. |
| 1 · Primitives | `ControlShell`, `TextInput`, `FieldContext`, `FieldError`; prove via `NumberField` | **Done** — `671c668`, PR #28, 2026-09-03. |
| 2 · Convert | Every `inputClass` site → shell + input; ESLint bans | **Done** — `b13ca1a`, `f863275`, `eee9b3c`. `inputClass` has 0 references. |
| 3 · Tokens | Borders ≥3:1, text ≥4.5:1, real focus ring | **Done, in four attempts** — `a7c6ed7`, then `1c064ec`, `9a25839`, and after the pivot `54c08bb` re-measured against Tailwind v4's OKLCH palette. |
| 4 · Semantics | `InlineForm`, delete Enter handlers, `noValidate`, Gate password in a form, `inert` on Modal | **Half** — the Modal half arrived via Base UI Dialog. `InlineForm` was never built; see below. |
| 5 · Composite | Chips inside the shell; APG combobox once in `ui.tsx`; inline create affordance | **Done as re-scoped** — `d88e822` (chips), `bad5268` (`InlineCreate`). Keyboard stayed hand-rolled; see below. |
| 6 · One failure path | Document toast-vs-`FormError`; wire `expectedUpdatedAt` and handle `stale` | **Done in substance** — `f629630` (`errorText.ts`), stale wired on both session write paths. The policy is practised, not written down. |
| i18n readiness | Logical properties + rule; never render server text; no assembled sentences | **Done** — `fc4bd27`, `f629630`, `0cb5cdf`. |

## Timeline

- **2026-09-03** — briefing, strategy and Phase 0 findings written; Phase 1
  merged as PR #28. Three session-form layout fixes ride alongside.
- **2026-09-04, first half** — Phases 2 and 3 land directly on `dev` (the
  "one phase per PR" rule lapses here). The focus ring needs two follow-up
  commits; the second (`9a25839`) finds the real cause in the global
  `:focus-visible` rule ringing the inner input.
- **2026-09-04, pivot** — `b762010` cuts `feat/shadcn-baseui`. Twenty commits:
  Tailwind v4 by hand (`00743ee`; the codemod cannot run on arm64), shadcn
  foundation, a Select pilot on the room picker, then every select, route
  code-splitting, chips inside the field, Modal on Base UI Dialog, logical
  properties, field tokens, error codes → sentences, plural forms, cleanup.
  Merged `--no-ff` as `bfcbca1`, suite 921.
- **2026-09-04, after the merge** — `bad5268` `InlineCreate` for the four
  add-rows, `54c08bb` contrast re-measured in OKLCH, `7532a39` a fill so a
  field is a box and not a border, `0317b80` button-to-field alignment.
  Suite 997, lint and build clean.

## The pivot — direction, and what it reversed

The primitive route kept meeting three things a hand-rolled layer does not
own well: a native `<select>` whose open menu cannot be styled at all, a
`Modal` with no focus trap and no `inert` (a Phase 0 finding), and a focus
ring that took three commits to get right. The decision on 2026-09-04 was to
replace the *remaining* phases with shadcn/ui on the Base UI engine, on a
fork so `dev` stayed shippable.

Three of the original non-goals were reversed, each explicitly: Tailwind 4
(done first, so shadcn would not be themed twice), a component library, and a
new runtime dependency (+44 kB gz, measured). Four were kept: no form library
(shadcn `Form` is react-hook-form, this app is `useState`), no client Zod, no
`@testing-library`, no React 19. The decision gate was a measured bundle cost
paid for by code-splitting: entry 224 kB gz → 61 kB gz, Base UI riding the
Modal and Select chunks and never on first paint, with `modalPortal.test.ts`
guarding the split.

What is worth noticing is that the migration ended where the original plan's
*Interaction layer* rule pointed. The plan's scope said "full replace", but
Input, Textarea, Label, the combobox and `NumberField` were all judged and
kept app-owned, because shadcn's `Input` carries none of the `FieldContext`
wiring and the speaker field's id-or-new-name value maps badly onto an
item/value model. So `ui.tsx` still owns label, error, border, height and
focus, and Base UI owns the dialog trap and the listbox — one owner per
concern, arrived at from the other side.

## Results, re-measured today

| Measure | Before (Phase 0) | Now |
|---|---|---|
| `<Field>` sites without label association | 95 of 96 | 0 — `Field` generates the id and passes it by context |
| `inputClass` / `selectClass` / `controlHeightClass` references | ~90 | 0, and an ESLint rule |
| Raw `<textarea>` outside `ui.tsx` | 7 | 0 |
| Native `<select>` | 13 | 0, and an ESLint rule |
| Raw `<input>` outside `ui.tsx` | 85 | 13, all checkbox / color / time / file / search with an inline disable |
| Field border contrast, light | stone-300, 1.49:1 | stone-500, 4.61:1 |
| Placeholder contrast, light / dark | 2.59:1 / 3.64:1 | 4.81:1 / 6.76:1 |
| Hint text, light | 4.81:1 | 7.64:1 |
| Focus indication | border shift under `outline-none` | one `focus-within` ring on the shell; inner input opts out |
| iOS focus zoom | every field | none — `text-base sm:text-sm` |
| Modal | no trap, no `inert`, backdrop is a Close button | Base UI Dialog: trap, `inert`, focus return, scroll lock |
| Entry bundle | 224 kB gz monolith | 61 kB gz + per-route chunks |
| Server text rendered on the client | `err.message` in `AdminPage` and elsewhere | only `lib/errorText.ts` turns a code into a sentence |
| Stale writes | mechanism built, never sent | `expectedUpdatedAt` on drag-move and edit-save; `stale` reads as a sentence and reloads |
| Suite | 909 at the pivot | 997, lint and build clean |

Tests that pin this: `controlShell`, `formContrast` (computes ratios from the
palette, so a shade swap fails on the number), `mobileZoom`, `modalPortal`,
`errorText`, `plural`, `numberField`.

## Phase 5, looked at closely

Phase 0 reduced it to: move the speaker chips inside a `ControlShell`, adopt
floating-ui's interaction hooks only if the hand-rolled keyboard handling
proved wanting, and build the inline create affordance.

- **Chips inside the shell** — `d88e822`. The box renders even when the
  field is full, with the reason in the comment.
- **Keyboard** — hand-rolled and kept: Arrow keys wrap through the list, Enter
  picks, Backspace on an empty box removes the last chip, Escape closes without
  closing the dialog around it. `role="combobox"`, `aria-expanded`,
  `aria-autocomplete`, `role="listbox"`/`option`, `aria-selected` are all
  present. Not present: `aria-controls` and `aria-activedescendant`, which the
  plan named from the APG pattern — so a screen reader hears the box open but
  not which row the arrow keys are on. And the plan's "implement it once, in
  `ui.tsx`" did not happen: `SpeakerCombobox`, `SearchBox` and `AdminSearch`
  each carry their own Arrow/Enter/Escape handler.
- **Inline create** — `bad5268`, and better than specified: a primitive
  (`InlineCreate`) rather than one fix, now used by tracks, tags, formats and
  expected people. Opening focuses the box, Escape returns focus to the button,
  Enter saves and stays open with the box cleared, a failed save keeps the text,
  and the open row is the button's own 38 px so nothing moves under the
  pointer. Two plan details skipped: no `aria-live` "*name* added" region, and a
  labelled *Add track* button beside the box instead of a ↵ submit inside the
  shell — a reasonable trade on a phone, where a named button beats a glyph.

## Phase 6, looked at closely

- **Wire the concurrency mechanism** — done. Both session write paths in
  `SchedulePage` send `expectedUpdatedAt`; the drag-move path catches `stale`
  and says "Someone else moved that session — reloading"; the edit-save path
  reaches `errorText`'s `stale` case. Two organisers editing one session no
  longer silently last-write-wins.
- **Never render server text** — done. The server sends a code plus details;
  `errorText.ts` is the one place a failure becomes a sentence, unknown codes
  fall through to the HTTP status, and a source-text test bans the old
  pattern. `AdminPage`'s `fail` now goes through it.
- **Decide and document the failure path** — decided in practice, never
  written. The rule the code follows is: a modal's rejected save is a
  `FormError` in the footer beside the button; a loose admin row's failure is
  a toast, and `InlineCreate` says so in its comment. `AdminPage` still has
  eleven `toast.show` sites to two `FormError`s. Nothing in `ARCHITECTURE.md`
  or `ui.tsx` states the rule, which is what the plan asked for.

## What did not land

Phase 4 was the phase the pivot ran over. Its Modal half arrived, better than
planned, through Base UI Dialog. The rest is still in the tree exactly as
Phase 0 found it, and none of it is recorded in `STATUS.md`:

1. **The gate's password field is still not in a `<form>`** and has no
   `name="password"` or `autoComplete="current-password"`. Password managers
   still cannot reliably save or fill it. The most user-visible leftover.
2. **`InlineForm` was never built.** Seven hand-rolled Enter-to-submit
   handlers remain on real forms: Gate (two), AdminInvite, AdminBreaks,
   AdminRooms (two), AdminPermissions. The plan's count of fourteen included
   combobox and grid keyboard handling, which are not this.
3. **`noValidate`** appears nowhere. Moot for now — no field carries
   `required` or `pattern`, so no native bubble can race the app's message —
   but the first one added will.
4. **`enterKeyHint` / `inputMode`** at three sites.
5. **`HelpButton` is still 20 px** (`h-5 w-5`); WCAG 2.2 SC 2.5.8 wants 24.
6. **Focus behind the sticky modal footer** (SC 2.4.11, AA) was "plausible,
   not proven" in Phase 0 and has not been tested since.
7. **`aria-activedescendant` / `aria-controls`** on the three comboboxes, and
   one shared listbox behaviour instead of three.
8. **The failure-path rule** written down in `ARCHITECTURE.md`.

Two documentation drifts: `STATUS.md`'s *Forms* backlog still opens with
"Expect someone should be a button", which `bad5268` shipped; and the
migration plan says "Status: complete" while the eight items above sit in no
queue. R1 (the browser pass for Phases 2–3) is legitimately still awaiting
the user's eyes.

## Assessment

The undertaking did what it set out to do, and the parts that matter most are
the ones that cannot regress: label association is structural, the old skins
are lint errors, contrast is a computed test. The pivot was handled well —
forked, gated on a measured cost, merged with a body that says why, the plan
kept as a decision record, each reversed non-goal named. The best moment is
that "shadcn everywhere" quietly became "Base UI for the machinery, `ui.tsx`
for the field", which is the plan's own rule.

Two criticisms. The process rule "one phase per PR" lasted one phase; from
Phase 2 on everything went to `dev` directly, and the pivot's plan closed
itself without carrying Phase 4's residue anywhere. And Phase 3 took four
commits because contrast was first judged by class name and only later
computed — the computed test should have been the first commit, not the last.

Recommended close-out, small: one `STATUS.md` edit that drops the shipped
*Expect someone* entry and adds the list above as a single *Forms* item, with
the gate password form first.

## Postscript, 2026-09-05

The eight items under *What did not land* landed the next day on
`docs/forms-overhaul-close-out`, one commit each, in the order listed:
`InlineForm` and the admin rows, the gate as a login form, the shared
`useListbox` hook with `aria-activedescendant`, `HelpButton` at 24 px, the
live region on `InlineCreate`, `enterKeyHint` where Enter has one meaning, the
failure-path rule in ARCHITECTURE §Where a failure goes, and the sticky-footer
question. That last one was answered by inspection rather than a live Tab: the
footer is a flex sibling *below* the only scroll region, not an overlay on it,
so a focused field cannot be behind it; `tests/modalPortal.test.ts` now pins
that shape. The two documentation drifts were fixed with the same branch.
Suite at 1046, lint and build clean, entry chunk unchanged at 61 kB gz.
