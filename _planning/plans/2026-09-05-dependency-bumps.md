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

**`react-router-dom` 6.30.6 → 7.18.3 ✅ done 2026-09-07.** `npm audit` is now
**0 vulnerabilities**, from 10 at the start of this plan. The open redirect via
a backslash in `<Link>`/`useNavigate` was the last advisory that reached a
browser.

The migration surface turned out to be nil, and that was checked rather than
hoped:

- **No data router.** Hooks in use are `useLocation`, `useMatch`,
  `useNavigate`, `useParams`, `useSearchParams` — no `useLoaderData`,
  `useFetcher`, `useNavigation`, no loaders or actions. So
  `v7_fetcherPersist`, `v7_normalizeFormMethod`, `v7_partialHydration` and
  `v7_skipActionErrorRevalidation` have nothing to act on.
- **Every path is absolute.** All 21 `navigate()` calls and all 25 `<Link to>`
  targets start with `/`, including the indirect ones (`expandTo`, `sheetUrl`,
  and the `back.to` carried in location state). The one splat route,
  `path="*"`, holds an absolute `<Navigate to="/">`. So `v7_relativeSplatPath`,
  the flag most likely to break a v6 app quietly, cannot bite.
- **`takeInvite` was the named risk and is fine.** It reads
  `window.location.hash` and calls `window.history.replaceState` directly, never
  touching the router, and guards itself with `hasTaken`. v7 changes neither
  `window.history` nor when a component first runs.
- **Slug canonicalisation** builds an absolute path from `encodeURIComponent`
  and calls `navigate(to, { replace: true })` — unchanged semantics.

`v7_startTransition` is the one real behavioural change (router state updates
wrap in `React.startTransition`). Nothing here reads router state synchronously
after navigating, so it should be invisible; it is the item to watch in a
browser pass.

Peers are `react >=18`, so **React 19 is not required by this** — the two stay
separate commits as planned.

**Still open: `react` + `react-dom` 18 → 19** with `@types/react`/`-dom` 19.
Peers are already clear (`@base-ui/react` takes `^17 || ^18 || ^19`,
`lucide-react` `^19`, `@floating-ui/react` `>=17`). The risk is not the peers —
it is that **the suite cannot see this**: no DOM, no component tests, behaviour
pinned by source-text assertions. Wants a full manual pass over the R-items in
STATUS.md.

### Phase 5 — server majors, best-covered first
One per commit, in this order, because that is descending test coverage and
ascending consequence:
1. `zod` 3→4 ✅ **done 2026-09-07.** Type-checked and 1154 tests passed with no
   source change; the two deprecated APIs (`z.ZodIssueCode.custom`,
   `z.ZodTypeAny`) were replaced anyway with the string form the rest of the
   file already used, and `z.ZodType`. `z.record` was already on the two-argument
   form v4 requires, and `result.error.issues` was already the v4 spelling.

   **What the suite could not see: every built-in message was reworded.**
   `Required` → `Invalid input: expected string, received undefined`;
   `String must contain at least 3 character(s)` → `Too small: expected string
   to have >=3 characters`; `Invalid enum value. Expected 'a' | 'b', received
   'c'` → `Invalid option: expected one of "a"|"b"`. Captured by running the
   same probe against both versions rather than trusting the changelog.

   That is safe **here specifically**, and worth writing down as the reason:
   `parse()` throws `badRequest(…)`, whose `code` is `validation`, and the
   client renders by code — `errorText` never touches `err.message` (i18n
   readiness rule 2, enforced by `errorText.test.ts`). So zod's English reaches
   logs and anyone reading the API directly, never a person using the app. A
   codebase that rendered the server's string would have had a user-visible
   copy change here with a green suite.
2. `express` 4→5 ✅ **done 2026-09-07** (branch `chore/express-5`). The suite
   drove every route and caught nothing, because the break was in the one
   branch of `createApp` no test entered.

   **`app.get('*')` throws at registration under path-to-regexp 8.** It sits
   behind `if (config.serveStatic && existsSync(WEB_DIST))`; the harness sets
   `serveStatic: false` and dev leaves it unset, so it is registered only when
   `SERVE_STATIC=1` or `NODE_ENV=production` — the image people actually run.
   Green suite, server that will not boot.

   The naive migration to `'/*splat'` is also wrong: it requires at least one
   segment, so `/` 404s and the home page is gone. `'/{*splat}'` is the form
   that matches the root as well. Both failures were watched happening before
   being fixed, and `tests/serveStatic.test.ts` now enters that branch.

   Everything else was quiet, for reasons worth recording: no async route
   handlers anywhere (better-sqlite3 is synchronous), so Express 5's promise
   forwarding changes nothing; all 40 `req.body` reads go through
   `parse(schema, …)`, so v5 handing `undefined` instead of `{}` for a bodyless
   request is still a 400 rather than a crash; the five `req.query` reads are
   scalars or already handle `Array.isArray`, so the query-parser default
   change is invisible.

   `@types/express` 5 types `req.params.x` as `string | string[]`, because
   path-to-regexp 8 can repeat a parameter. Two sites failed to compile; the
   rest are `Number(...)`, which accepts either and hid the widening. A
   `pathParam` helper narrows it in one place with the reasoning attached.

   Also smoke-tested for real: booted with `SERVE_STATIC=1`, and `/`, a deep
   link, and an unknown `/api` path answered 200 html, 200 html, 404 json.
3. `marked` 14→18 ✅ **done 2026-09-07.** The plan said to re-read the output
   before trusting the tests, and that was the right instinct for the wrong
   reason: there were no tests. `renderMarkdown` feeds three
   `dangerouslySetInnerHTML` sites — a session description, a pitch
   description, a profile bio, all written by whoever is in the room — and had
   no coverage at all.

   **The bump introduces a stored XSS, and nothing would have said so.**
   `escapeHtml` escapes `&`, `<` and `>`, not `"`, and `renderer.link` puts a
   title straight into `title="…"`. marked 14 escaped a title's quotes itself,
   so the gap was covered by the parser; marked 18 does not. Confirmed by
   running the same payload against both:

   - marked 14: `title="a&amp;quot; onmouseover=&amp;quot;alert(1)"` — ugly,
     double-escaped, inert.
   - marked 18: `title="a" onmouseover="alert(1)"` — a live handler.

   `[x](https://ok 'a" onmouseover="alert(1)')` in a bio was enough. Fixed with
   an `escapeAttr` for the two places author text lands inside an attribute
   (href and title) rather than by relying on the parser, so it cannot come
   back on the next bump either way.

   `tests/markdown.test.ts` pins the SPEC §7.4 contract — 17 cases: script,
   iframe, style, svg, event handlers, a comment hiding a tag, `javascript:`
   and `data:` links, relative resolution, the allowed schemes, images as alt
   text. It asserts against *tags*, with quoted attribute values blanked first,
   because `onmouseover=` inside a `title` is text and outside one is a
   handler, and a blunter regex cannot tell those apart. Verified by
   reintroducing the bug and watching it fail.
4. `bcryptjs` 2→3 ✅ **done 2026-09-07.** Done in that order, and it was the
   right order: the four hashes in `tests/passwordHashes.test.ts` were
   generated by bcryptjs **2.4.3** and pasted in as literals, so they keep
   meaning "a hash from before" whichever version is installed. The suite was
   green on 2.4.3 first, then green on 3.0.3 — which is what makes "old hashes
   still work" a measurement rather than a hope.

   Worth stating why this needed pinning at all: every event password on every
   instance is a stored hash that nothing re-hashes, so a library that changed
   how it reads one would not throw, would not fail a build, and would not fail
   any other test — it would start refusing correct passwords, at an event, in
   front of a room.

   Writing the test needed a seam, and the seam was worth having: bcrypt was
   named at four call sites, so `verifyPassword` now sits beside `hashPassword`
   and the library appears in one module. The next bump is a one-line question.

   Two properties pinned besides compatibility: the `$2a$` prefix those hashes
   carry is still accepted, and **72-byte truncation still truncates** rather
   than throwing — a rewrite deciding to reject a longer input would turn a long
   stored password into a 500 instead of a sign-in. (My first negative case was
   wrong for exactly this reason: appending a character to a 72-byte password
   changes nothing, so it must be changed in place.)
5. `better-sqlite3` 11→13 — `npm run rebuild:native`, then boot the server for
   real, not just the suite.

### Phase 6 — align Node ✅ done 2026-09-07 (the alignment; vite/vitest still open)

Production moved to **Node 22**. `deploy/Dockerfile` was on `node:20-slim` in
both stages while `.devcontainer/Dockerfile` had been on `node:22-bookworm`
since it was written — with a comment on the very line saying *"Node 20 is
end-of-life — do not stay on it."* The decision had been made and only ever
applied to the machine the code is written on.

That made this a security fix, not housekeeping: **Node 20 reached end-of-life
in April 2026**, so the production runtime had been unpatched for five months —
a larger exposure than any advisory left in `npm audit`.

Changed together, because a partial move is the state we were already in:

- `deploy/Dockerfile`, both stages → `node:22-bookworm-slim`. Distro pinned,
  not just the major, for the same reason the dev container pins it: a floating
  `node:22-slim` can move to a newer Debian and change what the `apt-get` line
  can install.
- `engines` `>=20` → **`>=22.13`**. Not `>=22.12`: eslint 10 requires
  `^20.19.0 || ^22.13.0 || >=24`, so 22.13 is the real floor on the 22 line, and
  it also satisfies vitest 5's `^22.12`.
- `@types/node` 20.17.6 → **22.20.1**, so the types describe the runtime again.
- `docs/hosting.md`: the base-image line operators match their
  distro against, and the systemd section's "install Node 20".

**better-sqlite3 on Node 22 was verified, not assumed.** 11.10.0 compiles and
runs on ABI 127 — that is what `npm run rebuild:native` has been producing in
this container all along, and what the 1146 tests run against. Prebuild
availability only affects build speed; the build stage already installs
`python3 make g++` for the compile path.

Correction to the Phase 2 note: taking vitest 5 would *not* have made the
product untestable. vitest is a devDependency that never runs in production,
and the dev container was already on 22.23. What would have happened is an
`EBADENGINE` warning from `npm ci` in the Docker build (`engine-strict` is not
set, so it warns rather than fails). The conclusion — decide Node first — held;
the reason was thinner than it was written.

**Still open:** vite 6 → 7/8 and vitest 3 → 4/5, now unblocked. They are a
straight bump with no advisory behind them, so they wait their turn behind
Phase 4.

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
