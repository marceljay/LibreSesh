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

## Branch strategy

- [ ] Cut `feat/shadcn-baseui` off `dev`. All work here; `dev` keeps the working
      primitive route.
- [ ] Merge back only after the decision gate (P4) passes; else abandon the branch.

## Prerequisites / version bumps

- [ ] **Tailwind v3 → v4** (the big one, app-wide, not just forms):
  - `@import "tailwindcss"` replaces `@tailwind base/components/utilities`.
  - Move `tailwind.config.js` theme (colours incl. `accent`, fonts) to CSS `@theme`.
  - Drop `postcss.config.js` + `autoprefixer`; add `@tailwindcss/vite`.
  - Sweep renamed utils: `shadow-sm→shadow-xs`, `outline-none→outline-hidden`,
    `ring` default width change, `rounded-sm` etc. Grep + fix across `web/src`.
- [ ] **React 18 → 19** (Base UI supports 18+, but 19 is the forward target;
      confirm the floor at `shadcn init`). Check `react-router-dom` 6→7 interplay.
- [ ] Confirm Vite/TS floors shadcn CLI wants at init.

## Adopt (shadcn components, added selectively via `npx shadcn add`)

- [ ] **Select** — room / track / day / duration / break-kind (highest value).
- [ ] **Dialog** — replaces `Modal` (focus trap, `inert`, scroll-lock); re-apply
      the app's dvh cap + mobile bottom-sheet styling.
- [ ] **Combobox / Command** — the speaker/host picker (retires `SpeakerCombobox`).
- [ ] **Input, Textarea, Label, Switch** — the plain fields (lower value; see scope).

## Persist as app-owned `ui.tsx` exceptions

- [ ] **`Field` wrapper** — label association + hint + `role="alert"` error +
      `FieldContext`. Do **not** adopt shadcn `Form`/`FormField` — those are
      react-hook-form; this app is controlled `useState`. Keep the Phase-1 a11y fix.
- [ ] **`NumberField`** — digits-only, range, "empty isn't yet wrong"; rebuild its
      shell on shadcn Input.
- [ ] Any bespoke chips/toggle-group (tags, weekday chips, format/placement).

## Load-bearing rules

- [ ] **Delete the global `:focus-visible` ring** (`index.css`). shadcn components
      ring themselves; the global catch-all would double with them and recreate the
      inner-border bug. Add per-element rings only to the few bespoke controls that
      lose it (search boxes).
- [ ] **Theme shadcn to the app** — stone palette, existing radii, 16px-on-mobile
      input font (verify shadcn's Input already does `text-base md:text-sm`).
- [ ] **ESLint** — allowlist `components/ui/*` (shadcn files use raw
      `<input>`/`<select>`); keep the `inputClass` ban.
- [ ] **Bundle** — measure gzipped JS before/after at the pilot; it's the one cost
      against the "one process, one file, minimal deps" value. Reconsider floating-ui
      (may be removable once Base UI handles positioning).

## Steps

- [ ] **P0 — spike:** branch; `npx shadcn init` (Base UI) into `web`; theme to stone.
- [ ] **P1 — Tailwind v4 upgrade** landed and green (lint/build/tests) *before* any
      component swap, so failures are attributable.
- [ ] **P2 — pilot Add Session modal**, smallest-first: Select (room/track) →
      Dialog → Combobox. Screenshot both themes; record bundle delta.
- [ ] **P3 — decision gate:** looks right + bundle acceptable? → continue; else stop.
- [ ] **P4 — rollout:** convert remaining selects, then (optional) Input/Textarea
      across the ~17 files; delete the global focus rule; update ESLint; port/adjust
      the `controlShell`/`starTally`/`laneLayout`-adjacent tests.
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
