# Dependency bumps: what is safe, what is not, and the order

**Written 2026-09-05** against `dev` at `52fc390`. Suite 1146, lint clean.

**Phases 0–2 are done (2026-09-06).** Audit went **10 → 2**: the critical, the
high and everything that reached production are gone. The two left are the
react-router pair, which needs Phase 4. Baselines in `_planning/deps/`.

## The numbers

27 packages behind; `npm audit` reports **10 vulnerabilities — 1 critical,
1 high, 8 moderate**. Four of them are direct dependencies. That headline is
misleading, and the first job of this plan is to say why.

## What actually ships

The production image (`deploy/Dockerfile`) runs `node server/dist/index.js` and
serves `web/dist`. So the blast radius splits three ways, and the split is what
decides the order:

| | Reaches production | Reaches a browser | Dev/build only |
|---|---|---|---|
| express, better-sqlite3, bcryptjs, cookie-parser, marked, zod | ✅ | | |
| react, react-dom, react-router-dom, @base-ui/react, @floating-ui/react, lucide, clsx, tailwind-merge, cva, qrcode-generator | | ✅ (bundled) | |
| vite, vitest, esbuild, eslint, tsx, typescript, postcss, concurrently, @types/* | | | ✅ |

**Every advisory but one is in the third column.**

- **critical — vitest**: *"When Vitest UI server is listening, arbitrary file
  can be read and executed."* This repo runs `vitest run`. There is no UI, no
  listening server, and vitest is not in the image. Real risk here: **none**.
- **high — vite**: `server.fs.deny` bypass on **Windows** alternate paths. Dev
  server only, and development happens in a Linux container. Real risk: **none**
  as things stand. Worth noting the dev server binds `0.0.0.0` (it must, to be
  reachable from the host), so on a shared network this is not zero for a
  Windows contributor.
- **moderate — esbuild**: any website can send requests to the dev server and
  read the response. Dev only; same reasoning.

That leaves two that are not free:

- **moderate — qs, via express → body-parser.** This *is* in production. Two
  advisories (array-limit bypass; DoS via attacker-controlled `isBuffer`), both
  fixed in **qs 6.16.0**. We resolve 6.15.3 today.
- **moderate — react-router.** Two: an SSR `deserializeErrors` injection, which
  cannot apply (no SSR), and an **open redirect via backslash in `<Link>` and
  `useNavigate`**, which is shipped to browsers. Exploitability here is low:
  the only non-literal `navigate()` in the app is the slug canonicalisation at
  `web/src/lib/useEventData.ts:413`, built from `encodeURIComponent(slug)` and a
  `pathname.slice()`, with the server's own canonical slug as the input. Low is
  not zero, and it is the one browser-facing advisory.

## Risks that are ours, not the packages'

- **The suite cannot catch a React or router break.** 1146 tests, and almost
  none of them touch a DOM: `vitest.config.ts` is `environment: node`, and the
  component tests assert on *source text*. That is a deliberate and mostly good
  trade, but it means React 18→19 and react-router 6→7 would go green while
  being visibly broken in a browser. **Any bump in the browser column needs a
  manual pass, and the suite's approval means nothing for it.**
- **`marked` 14→18 is four majors across the markdown renderer**, next door to
  `shared/links.ts`, which is a sanitisation boundary. `links.test.ts` pins our
  sanitiser, not marked's output shape. A behaviour change here is an XSS
  surface, not a cosmetic one.
- **`zod` 3→4 touches every request.** `validation.ts` is the whole validation
  layer and its error shape feeds `errorText` and `FieldError`. Wide blast
  radius — but this is the one major the suite *does* cover well, through the
  supertest integration tests.
- **`bcryptjs` 2→3 must still verify existing hashes.** Event passwords and
  speaker codes are stored as bcrypt hashes; a library that cannot read them
  locks every organiser out of every event. Verify against a hash written by
  the old version before this goes anywhere near production.
- **`better-sqlite3` 11→13 is a native module** and the database is the
  product. `.npmrc` sets `ignore-scripts=true`, so it needs an explicit
  `npm run rebuild:native`, and a version mismatch shows up as a load failure
  at boot rather than a test failure.
- **Bundling bumps makes a regression unbisectable.** One package per commit,
  which is the repo's atomic-commit policy anyway.

## The blocker to clear first

**`npm install` and `npm audit fix` both fail in this dev container:**

```
npm error code EALLOWREMOTE
npm error Refusing to fetch ".../@tailwindcss/oxide-wasm32-wasi-4.3.3.tgz"
```

npm's `allow-remote` is `"none"` here and it classifies that optional
platform package as a remote fetch. The lockfile entry is well-formed
(`resolved` + `integrity` both present; 0 of 532 packages lack integrity), so
this is npm's classification, not a corrupt lock.

**Verified workaround:** `--allow-remote=all` on the command.
`npm install postcss@8.5.28 --dry-run --allow-remote=all` succeeds. Nothing
else needs relaxing — the firewall already allows `registry.npmjs.org`.

## Order

Each phase is its own commit, and each ends green on `npm run lint && npm test`.

### Phase 0 — unblock and baseline ✅ done 2026-09-06
- Record the baseline: `npm audit --json` and `npm outdated` saved to
  `_planning/` so the next phase can be compared against it, not remembered.
- Decide where `--allow-remote=all` lives: a documented flag in the bump
  procedure, not a change to `.npmrc` — the setting is doing real work and
  should not be switched off wholesale for every future install.

### Phase 1 — the one fix that reaches production, plus the free ones ✅ done 2026-09-06
- **`overrides: { "qs": "^6.16.0" }`** in package.json. Do **not** run
  `npm audit fix`: its plan is to *downgrade* express 4.22.2 → 4.22.1 and
  body-parser 1.20.6 → 1.20.4 while adding a second copy of qs 6.14.2, which is
  worse than the problem. An override pins the one package at fault and leaves
  express alone.
- Patch bumps where `Wanted` already equals `Latest` and no major is involved:
  `postcss` 8.5.26→8.5.28, `autoprefixer` 10.5.4→10.5.5, `tsx` →4.23.13,
  `@typescript-eslint/*` 8.68→8.69.
- **Result: 10 → 7.** qs resolves at 6.16.0 with express still on 4.22.2 and
  body-parser on 1.20.6 — the override moved the one package at fault and
  nothing else. The three left are `vitest` (critical), `vite` (high) and
  `react-router-dom` (moderate); none of the first two reaches production.
- **The patch bumps were `npm update`, not `npm install <pkg>@<ver>`.** The
  existing caret ranges already allowed every one of them, so the lockfile
  moved and `package.json` did not. `save-exact=true` in `.npmrc` would
  otherwise have rewritten four caret ranges into pins as a side effect of a
  patch bump, which is a policy change nobody asked for.
- **Learned the hard way: any `npm install` here breaks `better-sqlite3`.**
  npm re-extracts the package and `ignore-scripts=true` means the native
  binding is not rebuilt, so 553 tests failed with *"Could not locate the
  bindings file"*. `npm run rebuild:native` fixes it in about a minute. This
  is not specific to Phase 5 — **it applies to every phase that installs
  anything**, and it should be the step immediately after any install.

### Phase 2 — dev-only majors (clears critical + high + esbuild) ✅ done 2026-09-06

**Corrected before execution: went to vite 6.4.3 and vitest 3.2.7, not 8 and 5.**
Checking `engines` before installing changed the answer, and the original
target would have quietly broken the production build:

- **`vitest` 5 requires `^22.12 || ^24 || >=26` — it drops Node 20 entirely.**
  `deploy/Dockerfile` builds *and* runs on `node:20-slim`, and `engines` says
  `>=20`. Taking vitest 5 makes the repo untestable on the Node the product is
  built with, while package.json still claims otherwise.
- **`vite` 8 needs `^20.19 || >=22.12`** — survivable on node:20-slim, but only
  just, and pointless on its own.
- **The advisories never needed those majors.** The fix ranges are
  `vite <=6.4.2` and `vitest <3.2.6`. So **vite 6.4.3 + vitest 3.2.7** clears
  all four dev advisories — and both keep `^18 || ^20 || >=22`, so Node 20 is
  still supported and nothing about the build image has to change.
- `@vitejs/plugin-react` **stays at 4.7.0**: its peer range is already
  `^4.2 || ^5 || ^6 || ^7`, so it takes vite 6 unchanged. v5 and v6 would have
  forced Node 20.19+ for no gain.
- Result: **7 → 2**, esbuild pulled forward to 0.28.2 as a transitive. Lint,
  build and 1146 tests green.
- **vite 7/8 and vitest 4/5 are deferred to after Phase 6.** They are a Node
  decision wearing a dependency's clothes, and should be taken with it.
- Risk is real but contained: it can break the build or the test runner, and
  both fail loudly and immediately. Nothing reaches production.
- Watch: vite 6 changed the default `build.target`; check `web/dist` still
  loads in the oldest browser we care about.

### Phase 3 — lint tooling ✅ done 2026-09-07

`eslint` 8.57.1 → **10.10.0**, `eslint-plugin-react-hooks` 4.6.2 → **7.1.1**,
`@typescript-eslint/*` 8.14 → **8.69** (that is where eslint 10 entered its peer
range), plus `@eslint/js` as a new devDependency. `.eslintrc.cjs` deleted,
`eslint.config.js` written.

**Checked before installing, again.** eslint 10 needs
`^20.19.0 || ^22.13.0 || >=24`. `node:20-slim` resolves above 20.19 today, so
the Dockerfile is fine — but `engines: >=20` now overstates what installs, and
that goes in the Phase 6 pot rather than being quietly widened here.
`typescript-eslint` v9 does not exist; v8.69 already lists `eslint ^10`.

**Decisions:**

- **Kept `@typescript-eslint/eslint-plugin` + `parser` as direct deps** rather
  than swapping to the `typescript-eslint` meta-package. The meta-package is the
  docs' path, but it is a dependency change dressed as a migration; `flat/recommended`
  off the plugin gets the same config with no churn.
- **No `globals` package.** The old config's `env: { browser, node }` was already
  doing nothing: `@typescript-eslint`'s `eslint-recommended` turns `no-undef` off
  for TS, and after the migration every linted file is TS.
- **`files: ['**/*.{ts,tsx}']` is load-bearing.** Flat config only walks
  `.js/.mjs/.cjs` unless a pattern says otherwise. Without that entry the whole
  codebase silently stops being linted, and lint still exits 0 — the one
  migration failure that looks like success. Guarded by counting: **256 files
  before, 257 after** (the new `eslint.config.js` is the extra one).
- **`.claude/` had to be ignored explicitly.** Three git worktrees live there.
  eslintrc skipped them for free by ignoring dot-directories; flat config
  dropped that default and would have linted three other branches.
- **The custom rules were verified by probe, not by assumption.** Two throwaway
  files, one in `web/src` and one in `web/src/components/ui/`, confirmed the
  logical-property ban, the `<input>`/`<textarea>`/`<select>` bans, and that the
  `ui/` exemption still narrows to the class-level rules only. Deleted after.

**react-hooks 7 brings fourteen new React Compiler rules.** Eleven pass on this
codebase and stay on, so they guard what gets written next. Three flag existing
code — `refs` (13 sites), `set-state-in-effect` (13), and
`preserve-manual-memoization` (1) — and are switched **off in the config, by
name, with a pointer to STATUS.md**. Fixing 27 call sites is a code change, and
this phase was scoped to say "no runtime surface at all"; hiding them behind a
plugin default would have been the other way to get there, and worse.

Lint clean, build clean, **1146 tests**. `npm audit` unchanged at 2 moderates —
this phase was never about the audit.

### Phase 4 — browser-facing, one at a time, browser pass each
- `react-router-dom` 6→7 first, alone: it clears the last two advisories that
  reach a browser, and v7's migration is well-trodden. Check every `<Link>`,
  the slug canonicalisation redirect, and the invite-link hash handling —
  `takeInvite` uses a raw `history.replaceState` the router never sees, which
  is exactly the kind of thing a router major breaks quietly.
- `react` + `react-dom` 18→19 with `@types/react`/`@types/react-dom` 19.
  Peers are already clear: `@base-ui/react` accepts `^17 || ^18 || ^19`,
  `lucide-react` accepts `^19`, `@floating-ui/react` wants `>=17`. The risk is
  not the peers, it is that **the suite cannot see this** — full manual pass
  over the R-items in STATUS.md.

### Phase 5 — server majors, best-covered first
One per commit, in this order, because that is descending test coverage and
ascending consequence:
1. `zod` 3→4 — heavy supertest coverage; a break shows up as a failing test.
2. `express` 4→5 — router and middleware changes; the suite drives every route.
3. `marked` 14→18 — re-read `shared/links.ts` against the new output before
   trusting `links.test.ts`.
4. `bcryptjs` 2→3 — add a test that verifies a hash generated by v2 *before*
   bumping, so the compatibility claim is pinned rather than assumed.
5. `better-sqlite3` 11→13 — `npm run rebuild:native`, then boot the server for
   real, not just the suite.

### Phase 6 — align Node
`deploy/Dockerfile` builds and runs on **node:20-slim**; the dev container is
**node:22-bookworm**; `engines` says `>=20`; `@types/node` is on 20.x. So dev
and production are a major apart and the types describe production, not the
machine the code is written on. Decide one: move production to 22, or hold the
dev container at 20. Then bump `@types/node` to match — and only then, since
`@types/node` 26 would describe neither.

## Not doing, and why
- **`@types/express` 5 / `@types/react` 19 ahead of their runtimes.** Types
  that describe a version we do not run produce errors about code that is
  correct. They move with their package, in the same commit.
- **`qrcode-generator` 1.5→2, `concurrently` 9→10, `node-gyp` 12→13.** No
  advisory, no feature we want, and each is a chance to break something that
  works. Bump when there is a reason.
- **`typescript` 5→7.** Not in this pass. It is a language-level move that will
  surface errors across every file at once, and it should be its own piece of
  work with nothing else in flight.

## The one-line summary for a hurry
Nothing here is on fire. **One advisory reaches production and it is a
one-line `overrides` entry**; one reaches a browser and needs a router major.
The critical and the high are both dev-only and cannot touch a deployed
instance. The real risk in this work is not the CVEs — it is that a React or
router major would pass 1146 tests and still be broken, because almost nothing
in the suite renders a component.
