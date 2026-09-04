# Migration: forms → shadcn/ui on Base UI

**Decision (2026-09-04):** replace the hand-rolled form primitives with
shadcn/ui components on the **Base UI** engine (shadcn's default since Jul 2026).
Keep a few app-owned exceptions in `ui.tsx`. Do it on a **fork of the current
route**, not on `dev` — the primitive layer stays shippable until this proves out.

## Why (one line each)

- Native `<select>` can't style its open menu → shadcn Select fixes the
  inconsistency.
- App `Modal` has no focus trap / `inert` (Phase 0) → shadcn Dialog gives it.
- Hand-rolled combobox + focus-ring edge cases keep biting → library owns them.

## Progress (updated 2026-09-04, evening)

Commits on `feat/shadcn-baseui`, all green (build/lint/909 tests):

- **Tailwind v4 done** (`00743ee`) — by hand (codemod dead on arm64). Vite plugin,
  `@theme`/`@custom-variant`/`@source`, gray-200 border + button-cursor shims,
  class-value renames.
- **shadcn foundation** (`9c200ec`) — cn(), stone-mapped tokens (light+dark),
  tw-animate-css, components.json. App `accent` (yellow) renamed → `highlight` to
  free `accent` for shadcn.
- **Select** (`05edfde`, `995ebc3`) — `ui/select.tsx` on Base UI, themed to the
  fields; every Add/Edit Session dropdown (room/track/day/duration/until) converted.
- **Code-split** (`ec6863f`) — routes + SessionModal are `React.lazy`. Monolith
  (224 kB gz) → shell ~62 kB gz + per-route; **Base UI (~50 kB gz) rides the
  SessionModal chunk, off first paint.** This is the answer to load speed.
- **Date/time glyph** (`175e8de`) — native picker indicator visible in dark mode.
- **All remaining selects** (`b66aaa6`) — PlaceProposalModal, breaks, admin. No
  native `<select>` element left anywhere.
- **Speaker chips inside the field** (`d88e822`) — layout fix on the working
  combobox rather than a Base UI rebuild; see the Combobox note below.

**Decision gate passed:** user accepts the +44 kB gz Base UI entry fee (measured);
deploy is unaffected (build-time only); load speed protected by code-splitting.

**Next:** Dialog (replaces `Modal`, gains the focus trap it lacks) → Input/Textarea
across the ~17 files → P5 cleanup (retire `ControlShell`/`selectClass`, drop
floating-ui, sync STATUS/CHANGELOG/ARCHITECTURE, merge back to `dev`).

**Deferred by the user:** the **datepicker** — likely event-length-dependent (time
picker for a day, calendar for weeks); needs `react-day-picker` if a real calendar.

## Branch strategy

- [x] Cut `feat/shadcn-baseui` off `dev`. All work here; `dev` keeps the working
      primitive route.
- [ ] Merge back only after the decision gate (P4) passes; else abandon the branch.

## Prerequisites / version bumps

**Revised 2026-09-04:** shadcn/ui supports Tailwind **v3 + React 18** (CLI detects
the version and generates v3-compatible components) — v4 is **not** required to
adopt shadcn. And the `@tailwindcss/upgrade` codemod **cannot run in this arm64
sandbox** (`tree-sitter-typescript` native binary fails to load). So:

- [x] **Tailwind v3 → v4 — DONE** (`00743ee`), by hand since the codemod can't run
      here. The user asked for it first rather than deferred: it's the target anyway,
      and doing shadcn on v3 then v4 would re-theme twice.
- [ ] **React 18 → 19 + router 6 → 7 — still deferred.** Base UI supports React 18,
      so not blocking.

## Adopt (shadcn components, added selectively via `npx shadcn add`)

- [x] **Select** — `ui/select.tsx` on Base UI. **All of them:** session modal
      (room/track/day/duration/until), PlaceProposalModal, breaks day picker,
      admin "Opens in" + track-hours day. No native `<select>` left in the app.
- [x] **Combobox — decided against a Base UI rebuild (2026-09-04).** The speaker
      field's value is *either* a person id *or* a newly typed name, with
      `onlySelf`/`isAdmin`/archived rules and a deliberate create-a-person row —
      a bespoke model that maps badly onto Base UI's item/value model, on a core
      interaction, with the Base UI docs unreachable from this sandbox. Instead the
      chips moved *inside* the field box (`d88e822`) — pure layout on the working
      component, which is what Phase 0 planned for this control all along. It is
      the one legitimate app-owned exception to "shadcn everywhere". Revisit only
      if the library genuinely buys something later.
- [ ] **Dialog** — replaces `Modal` (focus trap, `inert`, scroll-lock); re-apply
      the app's dvh cap + mobile bottom-sheet styling.
- [ ] **Input, Textarea, Label, Switch** — the plain fields (lower value; last).

## Persist as app-owned `ui.tsx` exceptions

- [ ] **`Field` wrapper** — label association + hint + `role="alert"` error +
      `FieldContext`. Do **not** adopt shadcn `Form`/`FormField` — those are
      react-hook-form; this app is controlled `useState`. Keep the Phase-1 a11y fix.
- [ ] **`NumberField`** — digits-only, range, "empty isn't yet wrong"; rebuild its
      shell on shadcn Input.
- [ ] Any bespoke chips/toggle-group (tags, weekday chips, format/placement).

## Load-bearing rules

- [~] **Global `:focus-visible` ring** (`index.css`) — *not* deleted yet, and so
      far it doesn't need to be: shadcn components are single focusable elements, so
      the global ring merges with their own on the same element (one ring), unlike
      `ControlShell` (wrapper + inner input) which doubled. Revisit if a wrapped
      shadcn control reintroduces the double.
- [x] **Theme shadcn to the app** — stone-mapped tokens, Tailwind radii, 16px-on-
      mobile carried on the trigger (`text-base sm:text-sm`).
- [ ] **ESLint** — allowlist `components/ui/*` when the raw-element ban bites (Base
      UI wrappers don't trip it yet); keep the `inputClass` ban.
- [x] **Bundle — measured:** +44 kB gz for Base UI's runtime (not lucide). Accepted;
      isolated off first paint by code-splitting. Still to reclaim: drop
      `@floating-ui/react` (~18 kB) once popovers move to Base UI.

## Steps

- [x] **P0 — foundation:** branch; shadcn set up **manually** (CLI hangs on the
      custom Vite layout); themed to stone.
- [x] **P1 — Tailwind v4** landed and green.
- [~] **P2 — Add Session modal:** Select ✓ (room verified good by the user). Combobox
      + Dialog still to do here.
- [x] **P3 — decision gate:** passed (bundle accepted, load protected).
- [~] **P4 — rollout (in progress):** selects → combobox → dialog → Input/Textarea
      across the ~17 files; then update ESLint; port the `controlShell`/`starTally`
      source-text tests as primitives are retired.
- [ ] **P5 — cleanup:** remove dead primitives (`ControlShell`, `selectClass`,
      `SpeakerCombobox`, old `Modal`); drop floating-ui if unused; update
      ARCHITECTURE + STATUS + CHANGELOG.

## Scope (resolved 2026-09-04)

- **Full replace** — shadcn for every component; keep an app-owned exception only
  where something is "truly special" (the `Field` a11y wrapper, `NumberField`, the
  chip/toggle groups, calendar-specific chrome). Plain Input/Textarea go last.

## Risks

- Tailwind v4 sweep is app-wide (grids, cards, calendar), not forms-only — most of
  the regression surface lives here, not in shadcn.
- Base UI 1.x API churn; shadcn Base-UI path younger than its Radix path.
- react-router 6→7 if React 19 forces it (open-redirect advisory already noted in
  STATUS dep-bumps).

## Rollback

- Everything is on `feat/shadcn-baseui`. `git checkout dev` restores the working
  primitive route with zero cleanup.
