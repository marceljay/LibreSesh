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

## Progress (updated 2026-09-04, late)

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

- **Dialog** (`8852058`) — `Modal` rebuilt on Base UI Dialog, gaining the focus
  trap and `inert` it never had. Kept in its own file and lazy-loaded from
  `ConfirmProvider`, or Base UI would ride the first-paint chunk (62 → 83 kB gz
  when it briefly did).
- **Logical properties** (`fc4bd27`) — `ps-`/`pe-`/`start-`/`end-` everywhere, with
  an ESLint rule holding the line. RTL (right-to-left languages such as Arabic or
  Hebrew) costs a `dir` attribute now rather than a sweep.
- **Combobox close-on-pick** (`6b967be`) — the list stayed open after adding a
  speaker; most sessions have exactly one.
- **Field tokens** (`fac9349`) — shadcn's `--input`/`--ring` aligned to the app's
  stone, so a Select and a text field draw the same border and ring.
- **Error codes → sentences** (`f629630`, i18n readiness rule 2) — the client was
  rendering `err.message`, i.e. whatever English the server wrote. Now the server
  sends a code + details and `lib/errorText.ts` is the one place a failure becomes
  a sentence.
- **Plural forms** (`0cb5cdf`, rule 3) — `${n} session${n === 1 ? '' : 's'}` gone
  from a dozen sites, along with three divergent local `plural()` helpers.
- **P5 dead code** (`763d7e2`) — `selectClass` and `controlHeightClass` retired;
  ESLint now bans raw `<select>` and both old skins.

**Next:** sync STATUS/CHANGELOG/ARCHITECTURE, then merge to `dev`.

**Backlogged (not part of this migration):** the **datepicker** — likely
event-length-dependent (time picker for a day, calendar for weeks); needs
`react-day-picker` if a real calendar. Moved to STATUS.md's backlog on 2026-09-04
so this plan can close.

## Branch strategy

- [x] Cut `feat/shadcn-baseui` off `dev`. All work here; `dev` keeps the working
      primitive route.
- [~] Merge back once P5 lands. The decision gate (P3) passed on 2026-09-04.

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
- [x] **Dialog** — `Modal` rebuilt on Base UI Dialog (`8852058`), public API
      unchanged, dvh cap + bottom-sheet styling re-applied. Lives in its own
      `Modal.tsx` rather than `ui.tsx` so Base UI stays off the first-paint chunk.
- [x] **Input, Textarea, Label, Switch — decided against (2026-09-04).** shadcn's
      `Input` is a bare styled `<input>` with none of the `FieldContext` wiring
      ours carries (id, `aria-describedby`, `aria-invalid` from the `Field`), so
      adopting it would trade working label association for visual sameness the
      app already has. The second app-owned exception, on the same grounds as the
      combobox.

## Persist as app-owned `ui.tsx` exceptions

- [x] **`Field` wrapper** — kept. Label association + hint + `role="alert"` error
      + `FieldContext`. shadcn `Form`/`FormField` deliberately not adopted: those
      are react-hook-form, this app is controlled `useState`.
- [x] **`NumberField`** — kept on `ControlShell` + `TextInput` (see the Input
      decision above). Its refusal is now a code + params rendered at the
      boundary (`0cb5cdf`), not a pre-built English sentence.
- [x] **`SpeakerCombobox`** — kept; see the Combobox note above.
- [x] Bespoke chips/toggle-group (tags, weekday chips, format/placement) — kept.

## Load-bearing rules

- [x] **Global `:focus-visible` ring** (`index.css`) — kept, deliberately: shadcn components are single focusable elements, so
      the global ring merges with their own on the same element (one ring), unlike
      `ControlShell` (wrapper + inner input) which doubled. Revisit if a wrapped
      shadcn control reintroduces the double.
- [x] **Theme shadcn to the app** — stone-mapped tokens, Tailwind radii, 16px-on-
      mobile carried on the trigger (`text-base sm:text-sm`).
- [x] **ESLint** (`763d7e2`) — `components/ui/*` allowlisted alongside `ui.tsx`;
      the old-skin ban now covers `selectClass` as well as `inputClass`, and raw
      `<select>` is banned outright now that no native one is left.
- [x] **Bundle — measured:** +44 kB gz for Base UI's runtime (not lucide). Accepted;
      isolated off first paint by code-splitting. Entry is **60.6 kB gz**; Base UI
      rides the Modal (21.7) and select (28.5) chunks.
- [x] **`@floating-ui/react` stays** — checked at P5: still used by `Popover`,
      `FilterMenu`, `RoleControl`, `HelpMenu` and `AdminPage`. Moving those to Base
      UI Popover is a separate job with its own bundle question, not cleanup.

## Steps

- [x] **P0 — foundation:** branch; shadcn set up **manually** (CLI hangs on the
      custom Vite layout); themed to stone.
- [x] **P1 — Tailwind v4** landed and green.
- [x] **P2 — Add Session modal:** Select ✓ (room verified good by the user);
      Dialog ✓; combobox resolved as an app-owned exception.
- [x] **P3 — decision gate:** passed (bundle accepted, load protected).
- [x] **P4 — rollout:** every select, the dialog, and the ESLint update. Combobox
      and Input/Textarea resolved as app-owned exceptions rather than swaps, so
      the `controlShell`/`starTally` source-text tests stay and were extended.
- [~] **P5 — cleanup:** `selectClass`/`controlHeightClass` removed (`763d7e2`);
      floating-ui checked and kept; `ControlShell`/`SpeakerCombobox` kept by
      decision, not dead. Remaining: ARCHITECTURE + STATUS + CHANGELOG, merge.

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
