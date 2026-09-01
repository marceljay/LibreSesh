# Project Status

The shared queue: what is in flight, what is blocked, and what is planned.
Shipped work moves to [CHANGELOG.md](CHANGELOG.md) and is not repeated here.

Last updated: 2026-09-01

## In Progress

Working on `dev`; `main` is the released line and only takes merges. The
breaks rework has landed — `feat/event-level-breaks` (`5e53811`) is an
ancestor of `dev` — so its code half is done and written up in CHANGELOG
`[Unreleased]` and ARCHITECTURE §Breaks; what is left of it is the browser
confirmation under Blockers. 0.2.0 was tagged 2026-08-30; what shipped is in
CHANGELOG.md under `[0.2.0]`, and what has landed since is under
`[Unreleased]`. What is left of the UI-overhaul plan lives in
`_planning/plans/2026-08-29-ui-overhaul-permissions-pitches.md`:

- **Tag colours — asked for 2026-09-01, nothing written yet.** Two parts: the
  colour control on the add-tag row and in the tag editor should be a circle
  rather than the browser's rectangular `<input type="color">` chrome, and a
  new tag should take a colour by itself instead of every tag starting at
  `DEFAULT_TAG_COLOR` grey (`AdminPage.tsx:42`). The auto-assignment wants its
  own palette: `ROOM_COLORS` is deliberately washed out because a room colour
  is a column that text sits on, while a tag is a small chip that has to read
  at a glance — so a second, brighter list beside it, with the `nextRoomColor`
  shape, taking the first colour no live tag is using. The server already
  defaults a colourless tag to `#6B7280`; that default should become the
  assignment, so an API caller gets what the form gets.

- **Whole-app UI sweep.** The primitives landed, the admin page is done, and
  as of 2026-08-31 every modal is on the `Modal` primitive — the last six
  hand-rolled intro paragraphs and button rows are gone (`fb5c759`).
  21 underline usages remain across ProfilePage (5), SchedulePage (4),
  ProposalBoard (4), DetailSheet (4), EventListPage (1), NewEventPage (1),
  Tour (1) and Gate (1, the "already here on another device" link added with
  device linking). The count excludes the `[&_a]:underline` in prose wrappers —
  links inside rendered markdown keep their underline deliberately — and the
  five in `ui.tsx`, which are the primitives themselves. Re-counted 2026-08-31
  after the Backup and Audit tabs and the gate's name-collision link: still 21,
  because all three use the primitives (`secondaryButtonClass`, `linkClass`)
  rather than a bare `underline`.
- **ARCHITECTURE.md concurrency paragraph.** §Realtime documents broadcast and
  heartbeats but never states the model: last-write-wins, `assertNotStale`
  409 on an `updated_at` mismatch, no CRDT by design.

## Blockers

- **The breaks band still has not been seen in a browser.** What is left of
  this: nobody has yet said whether the band is on the grid.

  **The "older app" half is solved, 2026-09-01, and the answer was a process.**
  A whole dev stack from 2026-08-31 was still running — `npm run dev` (pid
  1005743), its vite holding port 3000 since the day before. Its API half had
  stopped listening on 3001, which is what "not running anymore with the db"
  turned out to be: a front end with nothing behind it. Everything the browser
  loaded came from that Aug-31 vite. It also explains the empty commit in
  About (see Backlog): the build stamp is read once at config load, so it was
  reporting the 31st. Killed and restarted clean; API and web both answer 200,
  and `data/app.db` is on migration `008_default_view.sql`.

  **What to check first next time UI looks stale: `ss -tlnp | grep 3000` and
  the start time of what owns it.** A vite that has been up for a day serves
  current source through HMR — which is why this hid for so long — but its
  config, its env stamp and its dep graph are from whenever it started.

  The checks below are kept as the record of what was ruled out server side,
  and was verified rather than assumed:ruled out server side, and was verified rather than assumed:
  - `data/app.db` holds three breaks (democonf: Lunch 12:00–14:00, Coffee
    15:30–16:00; longconf: Lunch), all `date: null`, and the bundle returns
    them.
  - The running vite serves the new modules — `AdminPage.tsx` imports
    `AdminBreaks`, `SchedulePage.tsx` passes `breaks: bundle.breaks` to both
    `Calendar` and `ListView`.
  - `Calendar` rendered server-side with one break emits the band with the
    right geometry (`top:384px;height:192px` for 12:00–14:00 on an 08:00 grid),
    `aria-hidden` and `pointer-events-none` as designed.
  - There is no service worker and no client-side bundle cache, so nothing
    should be able to serve stale UI.
  - An identity that is not ours (`6f257`, admin on both events) was hitting
    this API live, and nothing listened on 3000 before the dev server started,
    so the tab did load from this vite.

  A stale build server on port 3221 (`node server/dist/index.js` from
  2026-08-30, pointed at a scratchpad `bug.db`) was found and killed — that one
  explains the earlier "state seems old", but not why the reloaded app still
  shows no breaks.

  What it unblocked on, kept for the next time: two checks from the browser
  that reports the problem — open
  `/src/pages/AdminBreaks.tsx` on the dev server (JS source = right server, so
  hard-reload the tab; app HTML or 404 = the forwarded port goes somewhere
  else), and read the build under **?** → **About LibreSesh**, which should
  say `v0.2.0 · 5e53811-dirty` (it was a pill in the bottom-right corner until
  2026-09-01). If it is the port, the next move is a second dev
  server on a fresh port so VS Code auto-forwards it, side-stepping the fixed
  `appPort` mapping in `.devcontainer/devcontainer.json`.

The identity design question that sat here is decided and shipped — see
`_planning/specs/identity-and-people.md` §Decisions for the reasoning and
CHANGELOG `[Unreleased]` for what landed.

---

# Backlog

_The only queue of future work, priority-ordered. Top High-Priority item = next up._

## High Priority

- **The ⓘ on a column card cannot be opened by touch.** Found 2026-09-01 by the
  cloud review of `dev` → `main`, and verified in the source: the button in
  `ColumnCard` (`web/src/components/Calendar.tsx:254-270`) carries both
  `onMouseEnter={() => setOpen(true)}` and `onClick={() => setOpen((v) => !v)}`.
  A touch browser synthesises the mouse sequence on tap — `mouseenter`, then
  `focus`, then `click` — as separate DOM events, so React commits `true` on the
  enter and the click's toggle immediately flips it back to `false`. Every tap
  flashes the panel open and closes it; the panel cannot be pinned.

  This matters more than a stray handler because of what the redesign put behind
  that button. `e265ec0` reduced a room column card to the room's name alone and
  moved seats, `Attendees may schedule` and the organiser's directions into the
  panel; the track-hours work (`e4eb832`, `5738ac6`) put the strand description
  and the rule-vs-day-window explanation there too. On a phone — how an attendee
  standing in a corridor actually reads the schedule — none of it is reachable.
  The doc comment above the component (`Calendar.tsx:226`) states the opposite,
  "a click opens it on touch, where there is no hover at all"; that sentence is
  the assumption to fix, not just the code.

  Three fixes, cheapest first:
  1. `onClick={() => setOpen(true)}`. The card's `onMouseLeave`, `onBlur` and
     Escape already close it, so the toggle earns nothing.
  2. Gate the hover openers on a hover-capable pointer —
     `window.matchMedia('(hover: hover)').matches` — and keep the toggle for
     touch. Honest about the two input models, one more branch to hold.
  3. Move it onto `usePopover`/`useDismiss` like `SearchBox`, `FilterMenu` and
     `HelpMenu`, whose `useHover` is `mouseOnly` and gets this right by
     construction. This is where the codebase is going anyway (see the
     Medium-Priority popdown item), and it deletes a hand-rolled dismiss.

  Note it is untestable the way the rest of the calendar is tested: there is no
  DOM in the container, so the tap sequence cannot be asserted, and a unit test
  over an `openOnTap`-style helper would only restate the fix. This one needs a
  real phone, or at least a browser with touch emulation — same standing gap as
  the drop-flicker item below.

- **The commit in About LibreSesh comes out empty — cause found, one line
  left.** Reported 2026-09-01 against the About dialog (`52a11fc`). It was the
  stale dev server (see the entry under Blockers): the build stamp is computed
  once, when vite loads its config, and the process serving port 3000 had
  loaded its config on 2026-08-31. Started fresh on 2026-09-01 the same page
  serves `VITE_BUILD_COMMIT: "6654fab"`, so there is nothing wrong with the
  stamping. What is still worth doing is one line of hardening: `HelpMenu`
  falls back with `??`, which only catches `undefined`, so an empty string
  would print as blank rather than `unknown` — `||`, or an explicit check.
  Same for the `dirty` flag, which read `true` against a clean tree on the
  fresh server and is worth a second look.

- **The drop still flickers, and the fix so far only made it smaller.**
  Reported 2026-08-31, after the two fixes in CHANGELOG `[Unreleased]` landed
  (`461e7ab`, `9b95de7`): a dragged block and a permission switch still show a
  visible pop, "just maybe a bit less glitchy". What is already ruled out is
  the double-application — the drop hold is absolute now, so the server's echo
  of our own write cannot move the block a second time. What is left is
  unidentified, and it needs eyes on a real browser: neither dev container nor
  the test suite has a DOM, so `drawnAt` and `overlay` are tested as pure
  functions and the actual paint is not.

  Leading suspect for the grid, not yet confirmed: **lane re-layout.**
  `drawnAt` overrides a block's `startMin`, `durMin` and `columnIndex`, but not
  its lane — `laneLayout` recomputes from `placed`, which follows the echoed
  row, so `lane.lane` and `lane.lanes` can change while the block is still
  held, moving its `left` and `width` sideways mid-hold. That would be exactly
  one horizontal pop at echo time. If confirmed, the fix is the same shape as
  the last one: lay the grid out from the drawn positions rather than the raw
  rows, so a held block lanes against where it is drawn.

  Second suspect, cheaper to test: nothing on the block transitions position —
  the class list carries `transition-shadow` only — so every correction, however
  small and however correct, arrives as an instant jump. A short transform
  transition on `top`/`left` would make a legitimate re-layout read as movement
  instead of a glitch, and would also mask the tail of whatever the real cause
  turns out to be. Worth doing on its own merits; not a substitute for finding
  the cause.

  For the permissions matrix there is no remaining suspect on file. The
  optimistic overlay does move the switch on click, so if it still flicks, the
  next thing to establish is *which* of the three states is wrong and when —
  note that `busy !== null` disables every switch in the table during a save,
  and a disabled `Toggle` restyles, which is a visible change that is not a
  revert and could easily read as one.

- **Pitch board.** Always show the creator, default the creator as host, and
  split the board into hot/new. The plan is
  `_planning/plans/2026-08-29-ui-overhaul-permissions-pitches.md`, whose
  up/down-vote assumption is **withdrawn** (decided 2026-08-31): interest stays
  one-way, so no `proposal_votes` table, no migration, and `interestCount`
  keeps its name and its meaning in `EventExport`. The button already wears an
  up-arrow rather than a star, which was only ever about the glyph colliding
  with "on my agenda".

- **Instance-level audit rows have no screen — and no pruning.** A
  whole-database backup, an event created from the landing page, or any
  device-link mint/redeem/failure carries no `event_id`, so those rows are
  invisible in Manage Event → Audit, which is per-event by design. They are the
  instance owner's business and there is no instance admin page to put them on.
  Noticed 2026-08-31: `pruneAudit` deletes by `event_id`, so these rows also
  grow without limit — slowly (they are all rare actions), but forever.

- **The importer still only creates an event, and is still curl-only.**
  Repeats landed 2026-08-31 in both front doors — a `repeat` key on a document
  row, and the **Repeat** control in the session form — so a long programme's
  daily officials and fixed track hours are a few rows or a few clicks rather
  than sixty of either. What is left of that job:
  - **Importing into an *existing* event.** The route only creates, so a whole
    transcribed programme still cannot be dropped into the event you are
    already running; the session form is the only way in, one session (or one
    run) at a time. Wants `POST /events/:slug/import`, gated on event admin
    rather than the instance key, matching rooms/tracks/tags to the existing
    ones by name instead of creating duplicates — same transaction and same
    `dryRun` as now.
  - **A UI for the importer itself.** `POST /events/import` is curl plus a JSON
    file, which is right for a transcription and wrong for everything else.
  - **Duplicate a day.** The repeat control repeats *one* session; copying a
    whole day's programme onto other days is still hand work. Same expansion,
    a different front door — an action on the day rail rather than in the
    session form.

  Two smaller things noticed alongside: `POST /events/:slug/clone` copies rooms
  and tags but **not tracks**, which post-date it and look simply forgotten;
  and a track carries no time of its own, so "Tech runs 14:00–16:00" is said by
  a repeating session rather than by the track. Track defaults in the import
  document would be cheap; `start_min`/`end_min` on the `tracks` table is the
  bigger version and changes what a track means in the session form, the grid
  and the filters — worth doing only to make the app *enforce* track hours.

- **Nothing imports an event *export*.** `POST /events/import` builds an event
  from a JSON schedule, but does not read `GET /export.json` back: an export is
  a record of ids, instants and authorship belonging to identities the target
  instance has never seen, and reading one back wants a new slug, fresh ids and
  a decision about those names. So the encrypted whole-DB backup is still the
  only restore path.

- **Compact button overrides do nothing.** `SecondaryButton className="py-1"`
  and the `py-1.5` variants in DetailSheet, ProfilePage, ProposalBoard and
  AdminPermissions are dead: Tailwind emits `.py-1` and `.py-1.5` *before* the
  primitives' `.py-2.5`, so the base always wins and those buttons are full
  height. Verified in the built CSS on 2026-08-31. Predates the button-height
  fix — that change kept the situation identical rather than creating it. Wants
  either a real `size` prop on the button primitives or `tailwind-merge`; a
  call site cannot win this with a class name.

- **The gate doesn't suggest device linking to a merged-out device.** After a
  both-claimed merge the losing device is signed out; when it next hits the
  gate, nothing says "if this is you, link this device instead of re-entering".
  A person who re-enters recreates the two-identity split the organiser just
  merged away. Wants one line on the gate (likely only when the arriving
  identity holds no role but does hold an event name here — exactly the
  signed-out shape). Scenario documented in ARCHITECTURE §Merging two people.

- **Number fields accept nonsense.** Room capacity is `type="number" min={0}`,
  which the browser enforces on the spinner but not on typing or paste; the
  client strips a minus sign and `parseCapacity` floors it, and the server
  takes whatever arrives. Same shape wherever a number is typed. Wants one
  validated numeric input primitive rather than a guard per field.

- **No write path under flaky connectivity.** Reads recover well — `EventSource`
  auto-reconnects and `useEventData` refetches the whole bundle on reopen, and
  the header shows "reconnecting…". Writes do not: every mutation is a bare
  `fetch` with no queue or retry, so a star/note/edit attempted while offline
  fails with a toast and is lost. There is also no service worker, so a cold
  load with no connectivity renders nothing. Full offline editing is an explicit
  v1 non-goal (SPEC §Non-goals — no CRDT), but a small outbox that retries
  queued writes on reconnect would cover the hallway-wifi case without one.

- **Dependency bumps — all need major upgrades, none currently exploitable here.**
  Assessed 2026-08-28:
  - `vitest` 2.x, _critical_ — only reachable when the Vitest **UI server** is
    listening. We never run `vitest --ui`. Fix is vitest@4 (breaking).
  - `vite` 5.x, _high_ — `server.fs.deny` bypass **on Windows**. Dev-only, and
    this project builds on Linux. Fix is vite@8 (breaking).
  - `esbuild` (via Vite), _moderate_ — any website can call the dev server and
    read the response. Worth knowing because our dev server binds `0.0.0.0`
    for the container; does not affect production, which serves static files.
  - `react-router-dom` 6.x, _moderate_ — the one advisory that ships. Open
    redirect via a backslash in `<Link>`/`useNavigate`; the companion SSR
    `deserializeErrors` issue does not apply (no SSR). Every navigation we
    build is prefixed with a literal `/e/`, so a path cannot start `//` or
    `\\`. Fix is react-router-dom@7 (breaking).
- **Cloning still demands all three passwords.** Creating an event lets you
  leave any of them blank — a four-word phrase is generated and shown once on
  a confirmation screen — but `POST /events/:slug/clone` kept the old
  all-required schema. Deliberate for now: the clone UI has nowhere to reveal
  a generated secret, and an organiser who never sees one cannot hand it out.
  Wants the same reveal screen, then `resolveEventPasswords` wired into the
  clone route so the two creation paths stop disagreeing.

- **Manual browser pass — now with a specific backlog.** Automated coverage is
  server-side, so everything below shipped on a read-through alone (no browser
  in this dev container, no component tests). Each wants a real look, ideally
  on a phone. From 2026-08-31:
  - the **Repeat** control in the session form — the only part of it with no
    automated coverage, since the server route is tested and the modal is not.
    Worth watching: the weekday chips wrapping under `sm` inside a `FormGrid`
    that is already two columns; that the start day's chip reads as *fixed*
    rather than broken when clicking it does nothing; and that the live count
    and the **Create N sessions** button track the *Until* select as it moves.
    Then create a real run of ten and confirm the grid fills without a reload —
    the client applies each created session itself and the server also
    broadcasts them, so a double-apply would show up here first;
  - **Manage Event is seven tabs now** (Programme / People / Permissions /
    Settings / Trash / Backup / Audit) with the choice in `?tab=`. Check the
    tab strip wraps sanely on a narrow screen, and that arrow-key navigation
    moves focus as a `tablist` should;
  - the **Audit** list: long names and long titles on one line, the filter box,
    "Load older entries" at the page boundary;
  - the **Backup** tab: the passphrase mismatch warning, and that the encrypted
    download actually saves with its `.lsbk` name from a real browser rather
    than supertest;
  - the gate's **"Enter as Ada 2"** link, which is only reachable by taking a
    name that is already held;
  - buttons are 38px tall now, matching the inputs beside them — worth one
    sweep for anything that looked balanced at 32px.

  From 2026-08-31 (`ad00f1e`, `fb5c759`), none of it seen in a browser yet:
  - the **search popdown**: arrow keys through the five hits and Enter to open
    one, Enter on an empty selection going to `/e/:slug/search`, `/` focusing
    the box from anywhere, Escape closing then clearing, and that a tap on a
    result lands before the blur does;
  - the **results page** on a multi-day event: day grouping, the highlight
    marks in both themes, and back/forward moving the box with the URL;
  - the **Filter panel**: that it wraps on a narrow header, the count badge,
    and taking one active chip off at a time;
  - the modals that changed footers — **Link another device**, **Edit
    profile**, **Merge a duplicate**, the two proposal modals — submitting on
    Enter and not double-submitting.

  From 2026-09-01, none of it seen in a browser:
  - the **info button on a column card**: that the ⓘ appears only on rooms with
    a description and tracks with hours, that hover, focus and tap all open the
    panel, and — the bug fixed in `c7ae002` — that the panel opens flush under
    *its own* card in a row where the cards are different heights, including
    the right-aligned one on the last column;
  - the **track editor**: the hours toggle, the per-day rows and their day
    picker offering only dates without a window, and that the list row reads
    `09:00–13:00 +1 day`;
  - the **session form's track picker**, which labels each option with the
    hours for the day being placed, and the refusal that arrives from the
    server when an attendee books outside them;
  - the **invite QR**, which has had no camera anywhere near it. The encoder is
    verified — the symbol renders with correct finder patterns and the URL
    round-trips through the fragment, both under test — but *scanning* is the
    part no test in this repo can reach. Wanted: a real phone camera on the
    rendered code; that the gate then shows **Invited as …** with no password
    box; that the address bar reads a bare `/e/:slug` immediately after, and
    that Back does not restore the fragment; that copying the URL at that point
    yields a link which asks a second device for the password. Also worth a
    look on paper — print it and scan the print, which is the only test of the
    module size at the default 176px. The sharing warning beside it is
    role-dependent — amber for the attendee and organiser codes, a plain line
    for the viewer one — so all three want a look.

  From 2026-08-30:
  - the `Modal` rewrite — overlay scrolls, `dvh` cap — against the tallest
    modal there is, and the one it was reported on ("Link another device");
  - the schedule header on a narrow screen: theme now lives in the profile
    menu, Manage/Arrange/Add sit together and go icon-only below `sm`. Watch
    where the action row chooses to wrap;
  - the tour no longer auto-starting for an organiser, while "?" still opens
    it;
  - the drag, now-line and 360px checks that were already outstanding.
- **Deploy paths, and what is actually proven.** Railway builds from
  `deploy/Dockerfile` (`railway.json` pins the builder — Railway's Node
  autodetection runs a plain `npm ci`, which honours our `ignore-scripts=true`
  and so never builds better-sqlite3). Two failures found the hard way on
  2026-08-30, both now startup errors instead of silent damage:
  no volume attached, so a rebuild destroyed the event on it; then a
  root-owned volume the unprivileged app could not write, surfacing only as
  `SQLITE_CANTOPEN`. `server/src/preflight.ts` reports every misconfiguration
  at once, and `deploy/entrypoint.sh` chowns the volume before dropping to
  `node`.
  **Still unproven:** there is no `docker` in this dev container, so the
  entrypoint's _root_ branch and the `gosu` install have never executed — the
  next deploy is their first real run. `deploy/docker-compose.yml`, the Caddy
  front end and `deploy/backup.sh` have never been run at all; treat the first
  VPS deploy as their test. Railway notes: `_planning/deployment-guide.md` §10.
- **No component test coverage, and no error boundary.** 384 tests, and the
  only web-side ones (`format.test.ts`, `calendar.test.ts`) cover pure
  functions — there is no jsdom/testing-library stack, so nothing renders a
  component. The drag maths, the SSE reducer and the clash detection are the
  parts most likely to regress silently, and the Calendar column refactor on
  2026-08-30 went in on a read-through alone. The build-stamp crash the same
  day — a component that threw on every render, blanking the page, while the
  whole suite stayed green — is what the gap costs. A React error boundary
  would have contained it; there is still none.

## Medium Priority

- **Put the last two popdowns on `usePopover`.** `ProfileMenu` and
  `SpeakerCombobox` still position themselves and still carry their own
  outside-click/Escape effects. Neither can overhang today — one is `right-0
  w-48`, the other `w-full` — so they are exempted by name in
  `tests/popoverOverflow.test.ts`, which also asserts the reason still holds.
  Moving them over would delete the last two copies of the dismiss effect and
  let that allowlist go away.

- **Revisit what Floating UI costs the first paint.** Adopting
  `@floating-ui/react` for the popover fix (`3c3030c`) took the bundle from
  134.3 to 152.5 kB gzipped — **+18.2 kB, about 13%** — on a single JS chunk
  that is already 489 kB raw. Worth asking whether that is the right trade on a
  phone at a conference venue, which is the network this app is actually used
  on.

  The argument *for* reducing: `@floating-ui/react-dom` is roughly a third of
  the weight and does the whole job the bug needed — `strategy: 'fixed'`,
  `shift`, `flip`, `size`. Everything above that line is convenience.

  The argument *against*, which is why the fuller package was chosen: the extra
  weight buys `useDismiss`, `useRole` and `FloatingFocusManager`. Dropping to
  `react-dom` means hand-rolling the outside-click/Escape effect again in every
  popdown — the four near-identical copies this change set out to delete — and
  losing focus return on close, which is a real accessibility regression, not
  just tidiness. `FloatingFocusManager` pulls in `tabbable` and is likely the
  bulk of the 18 kB, so the cheap middle option is to keep `useDismiss`/
  `useRole` and do focus return by hand.

  Measure before deciding: most of the win may be elsewhere. Nothing is
  code-split — one chunk carries the admin pages, the calendar and the gate
  alike, and a route-level `React.lazy` on the admin section would likely dwarf
  18 kB. Check that first; the popover dep may not be the thing worth cutting.

- **A track window cannot close a day.** Noted 2026-09-01 when track hours
  landed. An override row is a window and a window must end after it starts, so
  "the workshops track does not run on the last day" cannot be said — the
  nearest thing is a one-minute window nobody can book, which is a trick rather
  than a statement. The fix is a `closed` flag on `track_windows` that the
  resolver reads before the times, plus a checkbox on the per-day row. Wait for
  someone to actually want it: a track that skips a day is often better said by
  not scheduling anything on it.

- **Strip the `Claude-Session:` links out of the git history.** Every commit
  Claude Code made carries a `Claude-Session: https://claude.ai/code/session_…`
  trailer, added by the harness unless told otherwise. Audited 2026-08-31:
  **158 commits across all refs** — 140 of 169 on `main`, 141 of 170 on `dev` —
  spanning 2026-08-28 (`7692079`) to today, naming four distinct sessions. The
  string is in commit messages only: it appears in no tracked file and `git log
  -S` finds it in no historical blob, so there is nothing to clean in the tree.

  Not urgent, and not a leak: fetching one of the URLs anonymously returns
  **403**, so the transcripts are not readable by anyone who is not signed in
  with access. What the links do expose is that the work was AI-assisted, the
  session ids and their timing — permanently, in a public repo. That is the
  reason to do it eventually, and the reason it gets more expensive with every
  clone and fork.

  Doing it means `git filter-branch --msg-filter` (no `git-filter-repo` here and
  no `pip3` to install it) over ~170 commits, then a force-push of `main`, `dev`
  **and both tags** (`v0.1.0`, `v0.2.0`). Before starting, decide two things:
  whether the `Co-Authored-By: Claude …` trailers go too (158 of those, 115 Opus
  5 / 44 Fable 5 — worth keeping, they are honest attribution), and how to
  coordinate with the `upstream` remote (`Valley-of-the-Commons/LibreSesh`) and
  anyone holding a clone, since every merged PR's SHAs become orphans. Work on
  a backup ref and show a before/after diff of a few commits before any push.

  New commits are already clean: `.claude/CLAUDE.md` §Git Conventions now
  forbids the trailer.

- **A track that closes at midnight reads as `18:00–00:00`.** Found 2026-09-01
  by the cloud review, verified in the source. `fmtMinute`
  (`server/src/shared/trackHours.ts:35`) and its twin `fmtMin`
  (`web/src/lib/format.ts:20`) both take the hour as
  `Math.floor(minute / 60) % 24`, so 1440 folds back to `00:00` and
  `windowLabel` prints a window that appears to end before it starts.

  1440 is a real input, not a defensive edge case: the importer explicitly
  admits `"24:00"` as an end and says so in a comment (`importEvent.ts:56-61`),
  `minuteOfDaySchema` is `.max(1440)` (`validation.ts:94`), and the docs promote
  the spelling. Nothing between the request and the row clamps it. The wrong
  label then shows up in the calendar column detail, the `SessionModal` track
  picker (`SessionModal.tsx:302`), the AdminPage track rows, and — worst — the
  server's refusal to an attendee, which tells them the track "only takes
  sessions between 18:00–00:00" as the reason their session was rejected.

  Display only: `assertWithinTrackHours` compares raw minutes and rejects
  correctly. Fix is one guard in each helper — return `'24:00'` when the minute
  is 1440, before the `% 24` folds it — and the two helpers should keep matching
  each other, which is the reason to do them in the same commit rather than
  fixing whichever one is noticed first.

## Low Priority / Ideas

- **Show an organiser the old addresses an event still answers to.** Renaming
  an event landed 2026-09-01 and every former slug goes on resolving, but
  nothing in the UI lists them — the only trail is the *renamed* rows in the
  audit log. `formerSlugs` was written for this and then removed rather than
  left as dead code (`git show` the rename commit for the four lines). Worth it
  only if an organiser ever asks "which names are burned?"; the guarantee they
  actually care about — the old link still works — is already in the Slug
  field's hint.

- **A real series, and a root event other events inherit from.** Deferred
  2026-08-31, deliberately and not for want of time. `repeat` expands to
  ordinary rows precisely because the event it was built for is one whose
  sessions *drift* — the planned 14:00 becomes 14:20 on the day, and a series
  that asked "does moving Tuesday move all of them?" would be answering the
  wrong question every single time. So the shipped design is right for this
  event, and the two ideas below are right for a different one, where a
  programme is planned centrally and holds:
  - **A series.** A repeat that persists, so editing the rule re-times every
    day at once. Wants a `session_series` table, a decision about what an edit
    to one occurrence means (detach? fork the rule?), and the grid to say which
    sessions are governed rather than free — none of which is worth carrying
    for an event that overrides its own plan daily.
  - **Events inheriting from a root.** A recurring meetup or a multi-city
    conference where the rooms, tracks, tags and the shape of a day are
    declared once and each instance overrides what differs. Today the closest
    thing is `POST /events/:slug/clone`, which is a copy and forgets its
    parent. Inheritance is a different data model, not a bigger clone.

  Both wait for a version that has an event asking for them. Filing them here
  rather than building them keeps the current answer honest: repetition is an
  authoring convenience and it stops at the door.

- **Quadratic voting on pitches.** Floated 2026-08-31 for a future instance,
  explicitly not for this one: it changes what a vote *is* (a budget spent
  across pitches, not a click per pitch), so it wants its own schema and its
  own thinking rather than a column bolted onto `proposal_interest`.

- **Numbered migrations again, before the first deployment that holds data.**
  Since the squash the working practice has been to edit `001_baseline.sql` in
  place — `public_id` went in that way on 2026-08-31. That is free exactly
  while every database is disposable, and stops being free the moment one
  isn't: the runner tracks migrations by filename, so an edit never reaches a
  database that already recorded the file, and the symptom is not a migration
  error but a crash at runtime (`table identities has no column named
  public_id` on the first request from a new browser). Nothing warns about it —
  tests build fresh databases every time, and so does a reseed. Low priority
  because no instance holds data yet, and the remedy until then is to delete
  and recreate. What it wants is a line in the ARCHITECTURE §Migrations
  section naming the deploy as the cut-over, so the first `002_*.sql` is
  written deliberately rather than remembered.

- **A one-line reset for the local database.** Wiping a dev instance is
  currently three commands: stop the api, `rm -f data/app.db data/app.db-wal
  data/app.db-shm`, restart and let boot reseed. Easy to get wrong in the
  direction that hurts — `rm data/app.db*` also takes the `app.db.backup-*`
  copies sitting in the same directory. Wants an `npm run db:reset` that names
  the three files explicitly and leaves `data/.cookie-secret` alone (deleting
  it signs every browser out, which is a different intent and should be its
  own flag). Noted 2026-08-31, prompted by fixture identities —
  `programme_team` and the five seeded attendees — showing up unexplained in
  the admin attendance list. Note the naming collision with the item below: if
  "seed" becomes "mock", this is `db:reset` either way, but its reseed step
  changes name.

- **Rename "seed" to "mock".** Floated 2026-08-31. Worth knowing before
  starting that the word means three unrelated things in this tree, and only
  the first is a mock: the demo fixture generator (`scripts/seed.ts`,
  `server/src/seed.ts`, `npm run seed` / `seed:long`, the `SEED_*` env vars,
  `config.seedDemoEvent`, `demoSeed.test.ts`); the test helpers
  `seedEvent`/`seedRoom`/`seedTag`, which insert real rows through the real
  schema and are not mocks in any sense — `makeRoom` or `insertRoom` would be
  the honest rename there; and `identities.display_name`, described as "the
  seed a newcomer is offered", where the word means a starting value and
  should not be touched at all. So it is three decisions, not one
  find-and-replace: 222 identifier hits across the TypeScript alone, plus
  README, ARCHITECTURE, CHANGELOG and the SPEC.

- **Print / PDF grid.** Unconferences put the grid on a wall. A print
  stylesheet would cover most of it.
- **Restore for rooms and tags.** `/trash` covers sessions and contributions,
  which are the vandalism targets; rooms and tags soft-delete too but have no
  restore path.

---

# Out of scope

Deliberately not built, so nobody re-litigates them by accident. Checked
against the code on 2026-08-30:

- **Per-user accounts** and **WebSockets**. These two matter most: SSE and
  shared per-event passwords are load-bearing design choices, not placeholders.
  The identity model has grown a lot since — profiles, device linking, speaker
  codes — but every bit of it is deliberately account-free: a speaker code
  binds a phrase to a person, and never asks for an email or a password.
- **Email of any kind**, **image uploads**, and **multi-language**. Still true
  to the letter — there is no mail, upload or i18n anywhere in the tree.
- **Per-room QR codes** — a code on a door that opens that room's schedule.
  Still out. Note that the tree now *has* a QR encoder, added 2026-09-01 for
  invite codes (CHANGELOG `[Unreleased]`, ARCHITECTURE §Invite QR codes), so
  what keeps this out is the decision and no longer the absence of the means.

## Voting: pitches yes, programme no

**Pitches are votable, and have been since the board shipped.** The
`proposal.vote` capability (`server/src/shared/capabilities.ts`) is granted to
every role by default, viewers included; `proposal_interest` stores it and the
board sorts by the count. Up/down votes were queued to replace that one-way
interest and were **dropped on 2026-08-31** — interest stays as it is, and
quadratic voting is parked under Low Priority for a future instance. The
hot/new split is still queued, under High Priority.

What stays out is voting on the **programme**: nobody votes a scheduled session
up or down. The board/programme line is the whole of the distinction, and it is
the only thing "no session voting" ever meant.

## Pulled in deliberately

Dark mode, iCal export and personal "my agenda" starring were on this list
originally (SPEC §12) and were pulled in on 2026-08-28. Pitch-board voting was
clarified as in-scope on 2026-08-29.
