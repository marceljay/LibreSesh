# Project Status

The shared queue: what is in flight, what is blocked, and what is planned.
Shipped work moves to [CHANGELOG.md](CHANGELOG.md) and is not repeated here.

Last updated: 2026-09-03

## In Progress

Working on `dev`; `main` is the released line and only takes merges.
`dev` is now pushed to `origin/dev` (`e633e4c`); local is one commit
ahead (`02fe2ed`, the Placement-row wrap fix, unpushed as of
2026-09-03). Suite at **858**, lint clean, build clean.

- **Form-layer overhaul** (`_planning/forms_overhaul_strategy.md`, an
  external strategy brief; audit confirmed in
  `_planning/forms-phase0-findings.md`, context in
  `_planning/forms-overview.md`). Six phases, one PR each. **Phase 0**
  (audit) and **Phase 1** are done: Phase 1 added the field primitives
  — `Field` owning id/label-association/error, `ControlShell` owning
  the border/height-floor/focus-ring/invalid, `TextInput` bare and
  16px-on-mobile — proven by rebuilding `NumberField`, no call sites
  converted. Landed on `dev` via PR #28 (`671c668`). **Next up: Phase 2**
  — convert the `inputClass` call sites (`git grep inputClass` is the
  worklist) and add the ESLint guardrails, *narrowed* per Phase 0 to
  banning raw `<input>`/`<textarea>` outside `ui.tsx` and allowlisting
  `<select>` (the plan's `<button>` ban is dropped — 82 legitimate raw
  buttons across 24 files). Phase 3 tokens use **paired** contrast
  values, not single (light needs ≥stone-500, dark needs ≤stone-400).
  The **Forms backlog group** below is now governed by this brief;
  "Expect someone" is its Phase 5 inline-create.

The pre-existing spec work still awaiting a browser pass:
That whole spec
(`_planning/specs/self-as-speaker-and-merge-ux.md`, six steps, plan at
`_planning/plans/2026-09-02-everyone-is-a-person.md`) is code-complete as
of 2026-09-02 and written up in CHANGELOG `[Unreleased]`; the suite stood at
730 then and is at **858** now, lint clean, build clean. What is left of it is the browser pass under Blockers.
The breaks rework has landed — `feat/event-level-breaks` (`5e53811`) is an
ancestor of `dev` — so its code half is done and written up in CHANGELOG
`[Unreleased]` and ARCHITECTURE §Breaks; what is left of it is the browser
confirmation under Blockers. 0.2.0 was tagged 2026-08-30; what shipped is in
CHANGELOG.md under `[0.2.0]`, and what has landed since is under
`[Unreleased]` — including tag colours (`3f723ac`, `0b08a00`),
multi-speaker sessions (`f26bde3`), the single Calendar menu item
(`5d020cb`) and per-field profile editing (`aa64417`), all four written up
2026-09-01 after landing unlogged. The evening of 2026-09-02 added **session formats** and the corrections that
came straight out of seeing them in the app: a format carries no length, the
duration picker reaches a day through an `Other…` field, Placement moved to
the top of the session form, and the word "open" left the UI in favour of an
opt-in **Official** badge. The same evening fixed a speaker being unable to
edit their own session — reported from use, three rules deep. All of it is
code-complete and in CHANGELOG `[Unreleased]`; migrations 014, 015 and 016.
What is left of it is the browser pass under Blockers. What is left of the
UI-overhaul plan lives in
`_planning/plans/2026-08-29-ui-overhaul-permissions-pitches.md`:

- **Whole-app UI sweep.** The primitives landed, the admin page is done, and
  as of 2026-08-31 every modal is on the `Modal` primitive (`fb5c759`).
  **Recounted against the tree on 2026-09-03: 38 bare `underline` usages** —
  one *more* than the 37 counted on 2026-09-01, which is exactly why this is
  recounted rather than carried forward. (Before that it claimed 21 three
  times running, because it was counted against a fixed list of files instead
  of the tree, so it could not move.) Excluding `ui.tsx` (8 — those are the
  primitives themselves) and the three `[&_a]:underline` in prose wrappers
  (links inside rendered markdown keep their underline deliberately), the
  spread is: ProfilePage 6, ProposalBoard 4, SessionDetail 4, SchedulePage 4,
  FilterMenu 3, AgendaPage 3, ImportPage 3, AdminPage 2, EventListPage 2,
  NewEventPage 2, SearchPage 2, Gate 1, Tour 1, AdminBackup 1. Count every
  `*.tsx` under `web/src`, then subtract `ui.tsx` and the `[&_a]:` hits —
  don't re-check the files this entry happens to name.

- **ARCHITECTURE.md concurrency paragraph.** §Realtime documents broadcast and
  heartbeats but never states the model: last-write-wins, `assertNotStale`
  409 on an `updated_at` mismatch, no CRDT by design.

## Blockers

- **Most of 2026-09-02 has not been seen in a browser.** The People list,
  the profile page and the merge dialog were looked at once and fixed from
  what that showed (`c00fef5`, `4d8dbc0` — the role select was discarding
  the role it had just set). Everything since is unseen: **asking for a
  profile** (the "This is me" button on an unclaimed profile, and the
  approval queue above the People list), **the next-day button** at the
  end of a day's list, **several stream links** on a session, which
  changed the session form, and everything from 2026-09-02's People work:

  - **The role tag.** The People list's role select is a coloured badge
    with a pencil in it, opening a menu, and the same control is on the
    profile page under the name. Look at whether the badge still fits the
    `w-24` role column at the longest role word an event can set, and
    whether the menu opens over the row rather than pushing it.
  - **Sortable columns.** Every heading in the People table is now the
    control that orders by it. Look at the arrow on the active column and
    whether the headings still line up with the rows under them.
  - **Archiving.** The row's three action buttons became `Open` plus a ⋯
    menu (Merge, Archive, Delete). Look at the menu's placement on the last
    row of a long list — it is `bottom-end` and flips, but that is
    untested against a real viewport — and at the amber notice on an
    archived profile, which is the one screen the holder is meant to find
    on their own.

  And from later the same day, **formats** (migration 014), none of it seen:
  the chip row at the top of the session form — whether a dozen formats wrap
  into three lines above the title, which is the case the design is weakest
  at, and whether picking one visibly moves the Duration select below it; the
  **Formats** section in Manage Event → Programme, where the suggestion chips
  are a dashed row that has never been rendered; and the format badge at the
  head of the session sheet, which now sits before the official/open badge and
  may crowd the title on a narrow phone. The official/open control's label
  changed to **Placement** in the same pass — worth checking it does not now
  read as a duplicate of the Room and Day fields it sits near.

  And from the evening of 2026-09-02, none of it seen — now the largest
  unseen block, and the first three are the ones most likely to be visibly
  wrong:

  - **The top of the session form.** Format chips, then Placement, then the
    title: two chip rows stacked above the first text field is a shape this
    form has never had. Watch a dozen formats wrapping to three lines above
    the title — the case the design is weakest at — and whether the Placement
    chip's `: allow parallel sessions` suffix pushes the pair onto two lines
    on a phone.
  - **A speaker editing their own session.** The flow that was actually
    reported. As an attendee credited on an official session: the Edit button
    should appear at all, Room/Day/Start/Duration should be disabled under the
    grey notice, Delete should be absent, and saving a changed description
    should go through. The API is covered by tests; nothing covers the button.
  - **The duration picker.** `Other…` reveals a number field — check it takes
    a typed 40, that the `· 1 h 30 min` echo appears past an hour, and that
    editing a session whose length is off the list opens straight into the
    field instead of showing a preset it does not have.
  - **The Official badge.** Off by default, so first confirm the grid and the
    list say nothing about placement at all; then turn it on in Manage Event →
    Settings and look at a grid block and a list card, in both themes.
  - **The Formats section** in Manage Event → Programme: the dashed suggestion
    chips have never been rendered, and neither has the session form's empty
    state for an event that defines no formats.

  The **gate** is still the one nobody has opened, and it is the screen
  every attendee must get through: it now refuses an empty username and
  asks "is that you?" when the name matches an unclaimed profile. A
  mistake there locks the room out rather than merely looking wrong.
  Restart the dev stack before looking — see the port note below.

- **Waiting on a decision: whether to purge the local dangling objects from
  the accidental commit.** Verified across every ref, both worktrees,
  stashes and the whole object store on 2026-09-02: the Valley event export
  is **in no commit on any branch or tag and was never pushed**. `origin/dev`
  was pushed at 11:22 UTC; the accidental commit `d096fec` was made at 11:58
  UTC and amended away a minute later, so nothing between those two moments
  left the machine. No reachable blob anywhere in history contains
  export-shaped JSON.

  What remains is local only: Git keeps `d096fec` in this clone's reflog, so
  the file contents sit in `.git` as unreachable objects until the reflog
  expires in ninety days. This removes them now:

  ```
  git reflog expire --expire-unreachable=now --all && git gc --prune=now
  ```

  It is irreversible and indiscriminate — it drops every unreachable object,
  not only these. Nothing of value is in that set today, since both earlier
  versions of the commit were superseded by `2c913e3`.

  Also noticed while checking: `_planning/valley-2026-09-02.json` and its
  `.import.json` twin are **no longer on disk**, though
  `export-to-import.py` still is. If nobody deleted them deliberately, an
  editor buffer may be the last copy.

**Kept from the breaks investigation, because it will happen again: when the
UI looks stale, check `ss -tlnp | grep 3000` and the start time of whatever
owns the port.** A vite that has been up for a day serves current source
through HMR — which is why this hid for so long — but its config, its env
stamp and its dependency graph are from whenever it started. That was the
whole of the "older app" mystery: a dev stack from the previous day still
holding 3000 with its API half no longer listening on 3001.

---

# Backlog

_The only queue of future work, priority-ordered. Top High-Priority item = next up._

## High Priority

- **Publishing a session: a link that works without the gate.** Every read
  under `/api/e/:slug` sits behind `event.use(requireRole(db, 'viewer'))`
  (`server/src/app.ts:69`), so today there is no way to show one session to
  someone who has not been given a password. Sharing a session means sharing
  the event, and the only link that exists — the invite QR — hands over a
  role, which is the opposite of what "here is the talk I am giving" wants.

  There is one precedent for reading before the gate and it is worth copying
  the shape of, not the substance: `calendarRoutes` is mounted _above_ the
  role check (`app.ts:66`, route at `routes/agenda.ts:71`) and authenticates
  by `identities.ics_token` in `?token=` instead of a cookie. It still
  refuses unless that token's owner holds a role, so it is not public — a
  published session would be the first genuinely unauthenticated read in the
  app, and the first place a wrong decision leaks a real event.

  **Decided 2026-09-02: the snapshot.** Publishing copies the session into a
  table nothing else joins to, and the public route reads only that table.
  Nothing private can leak by omission, because nothing private is in there —
  which is the property worth paying for on the app's first unauthenticated
  read. The costs are known and accepted: a re-publish after every edit (an
  "update the public copy" button, or a republish on save), and a second place
  a session's text lives. The rejected alternative is kept here because it is
  the one to revisit if the re-publish step turns out to annoy people more
  than the safety is worth.

  Two shapes were on the table. **Live, flagged**: a `published_at` on `sessions`, plus a route above
  the gate that reads the row now and strips what must not travel. Edits show
  up immediately; the stripping is a filter that has to stay correct as
  `SessionDto` grows. **Snapshot, copied**: publishing writes a frozen row
  into a table nothing else joins to — the "unprotected DB area" — and the
  public route reads only that table. Nothing private can leak by omission
  because nothing private is in there, at the cost of a re-publish after
  every edit and a second place a session's text lives.

  What must not travel, either way: contributions are this app's comments —
  `ContributionDto` (`shared/types.ts:273`) carries `kind` (`note` / `link` /
  `question`), a `body`, `createdBy`, `createdByName` and a `hidden` flag —
  and none of them go on a public page. Nor do stars, agendas, `createdBy` /
  `createdByName` on the session itself, or anything about who is in the
  room. Speakers are the exception a programme exists to show, but a
  `PersonRef` leads to a profile carrying a bio, links and a claim state, so
  decide what a public page renders for a speaker rather than linking to the
  profile page and finding out. Anonymised contributions are a later
  question, not this one.

  Also to settle: who may publish (organiser only, or a speaker for their own
  session), whether unpublishing is real revocation or only a hidden link,
  whether the URL is guessable (`/s/:id`) or a capability (a random token
  like the ics one), and what an unpublished-but-linked page says. And the
  event's own visibility bounds it — a session inside an archived event
  should not stay readable because a link was minted once.

- **The format exists; three places still do not use it.** Landed 2026-09-02
  (migrations 014 and 015, `session_formats`): defined per event in Manage
  Event, picked at the top of the session form, shown on the session sheet,
  carried by clones, the export and the importer. It carries no length —
  migration 014 gave it one and 015 took it away, because a format that
  retimes the session it describes makes one field answer two questions. What
  was left out on purpose, because none of it is needed for a format to be
  worth having, and each is a separate decision:

  - **Filtering by format.** It is the obvious second filter after tags, and
    `useFilters.ts` already carries `rooms`, `tags` and `tracks` in the URL —
    a fourth is the same shape. Wants a decision about the filter panel on a
    narrow header before it goes in, since that row already wraps.
  - **The format on a block.** The grid card has room for about one more word.
    It now spends it on the **Official** badge when an event turns that on
    (migration 016), so this is no longer a free line — decide whether a
    format shows as a colour dot rather than a name, and what happens on a
    block that would carry both. Worth looking at a real grid first.
  - **A placed pitch has no format.** `POST /proposals/:id/place` builds the
    session without one (`routes/proposals.ts`), which is defensible — a pitch
    never said what kind of thing it was — but it means the one path that
    creates a session outside the form always creates a formatless one. Either
    the pitch form gains the picker, or placing one asks.

  Also from the same pass, and not backlog because they are done: the
  official/open control is **Placement** now and sits at the top beside the
  format rather than under Extras; the duration picker runs to eight hours with
  an **Other…** field behind it (any multiple of five up to a day —
  `shared/sessionLimits.ts`, `MAX_DURATION_MINUTES` raised from 480); and the
  grid and list stopped labelling placement at all unless an organiser turns
  the **Official** badge on (migration 016).

  Two smaller notes from building it. The import document now has `format` at
  the top meaning "this is a LibreSesh document" **and** `format` on a session
  meaning what kind of session it is; they are different scopes and both read
  correctly, but it is a collision worth remembering before either is renamed.
  And `SUGGESTED_FORMATS` in `shared/formats.ts` is the seed list — suggestions
  an organiser clicks, never rows created for them — so adding to it is free.

- **Mentioning a person, and somewhere for a mention to land.** Nothing in the
  app addresses anyone. A `@name` typed into a description, a contribution, a
  pitch or a bio is plain text that renders as plain text, so the way to tell
  a co-host their room moved is to find them in the hallway. Two halves, and
  the second is the larger one: resolving `@name`, and having a place a
  resolved mention shows up.

  Resolution is the cheap half and the app is already shaped for it. Display
  names are unique per event (migration 009) and `people` rows are per event
  (010), so `@ada` means exactly one person inside one event and means
  nothing outside it — no global user table to consult, no ambiguity to
  disambiguate. `NameResolver` (`server/src/eventIdentity.ts`) already turns
  an identity into the name to show. Mentions belong in the same shared
  renderer the links went into (`shared/links.ts`), so a mention written in a
  bio and one written in a session description cannot disagree about what
  parses — and so the parse happens once, on the server, rather than in each
  of the four places markdown is rendered.

  Delivery is the half with nothing built. There is no notification concept
  at all: `sse.ts` is an in-process broker per event slug that carries
  schedule changes to open tabs, which is the right transport and not the
  storage — a mention has to survive a closed tab. That wants a
  `notifications` table (recipient, event, source, read-at), a panel in the
  header with an unread count, and answers to the questions such a table
  always raises: what else creates one besides a mention (being added as a
  speaker, a session you starred moving, a pitch of yours scheduled), whether
  anything leaves the app by mail (nothing does today, and adding it changes
  what this project stores about people), and pruning, since `pruneAudit`
  already exists as the precedent for a table that would otherwise grow
  forever.

  Two edges that are specific to this app, and both are the reason to design
  before building. **Merging**: identities merge (`mergePeople.ts`) and
  profiles archive (migration 013), so notifications must follow a person
  through a merge the way authorship does, or an organiser tidying up
  duplicates silently deletes someone's inbox. **Unclaimed profiles**: an
  organiser can type a speaker's name onto a session before that person ever
  arrives, so a mention can be addressed to a profile with no identity behind
  it. It should wait and be delivered on adoption (`adoptProfile` in
  `people.ts`), not be dropped for having nowhere to go.

- **A production event export is sitting untracked in a directory git will
  happily commit.** Noticed 2026-09-02 when a `git add -A` swept
  `_planning/valley-2026-09-02.json` (72 KB, 2447 lines), its `.import.json`
  twin and `export-to-import.py` into a commit; they were taken back out
  before it was pushed, but nothing stops it happening again. `.gitignore`
  covers only `_planning/transcripts-backup/` and
  `_planning/deployment-guide.md`, so every other working file there is
  fair game — and this one is a real event's export, carrying real
  attendees' names, in a repo whose upstream is public
  (`Valley-of-the-Commons/LibreSesh`).

  **Nothing leaked** — verified 2026-09-02 across every ref, both worktrees,
  stashes and the object store; details under Blockers. The hole is still
  open, though, and that is what this item is: the next `git add -A` in that
  directory does the same thing again.

  The fix is a line or two: ignore `_planning/*.json`, or invert it and
  ignore `_planning/` while un-ignoring `specs/`, `plans/` and anything else
  meant to be shared. Decide which way round, because the inverted form is
  the one that stays safe as new working files appear.

- **An event this app exported cannot be imported back.** Found 2026-09-02
  restoring a production event onto a fresh staging box: the export downloads,
  the import rejects it. The first error reads `breaks.0.start: Required`, but
  that is one of **103** — every one of the 96 sessions fails too, and the real
  answer is that these are two different formats wearing one name.

  `exportEvent.ts` writes a dump keyed by database id: `startMin`/`endMin`
  integers on breaks and tracks, `roomId`/`trackId`/`tagIds` on sessions,
  `date: null` where there is no date. `eventImportSchema` takes the authoring
  document: `start`/`end` as `HH:MM`, rooms/tracks/tags **by name**, and an
  absent key rather than a null. It is also `.strict()` at the top level, so
  the export's `people`, `proposals`, `contributions` and `exportedAt` are
  rejected outright rather than ignored.

  What makes this a bug and not a documented limitation is the importer's own
  first field: `format: z.literal('libresesh.event').optional()`, commented
  "Present on a document this app produced; ignored, but not rejected". It
  says it recognises our export and then refuses it. There is no round-trip
  test in the suite, which is why nobody noticed.

  One piece of luck sizes the fix: `importSessionSchema` already accepts
  `startsAt`/`endsAt` as ISO instants, so no timezone conversion is involved —
  the mapping is id → name, minutes → `HH:MM`, null → absent, plus tolerating
  the export-only top-level keys. A converter proving that is in
  `_planning/` (it turned the Valley export into a document the schema
  accepts, verified against `eventImportSchema` itself), but it belongs in the
  app, not in a script an organiser has to be handed.

  Decide where it goes: the importer accepting both shapes, or export learning
  to emit the authoring document. Whichever, the missing test is the round
  trip — export an event, import it, and compare. Note also what the export
  cannot carry back either way: `people` profiles, `contributions` and every
  `starCount`. If restoring an instance is the real goal, the encrypted
  whole-database backup is the tool; this path is for moving one event.

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
  next thing to establish is _which_ of the three states is wrong and when —
  note that `busy !== null` disables every switch in the table during a save,
  and a disabled `Toggle` restyles, which is a visible change that is not a
  revert and could easily read as one.

- **Pitch board.** Showing the creator is done — a card reads "pitched by
  {name}" (`ProposalBoard.tsx:332`). What is left is defaulting the creator as
  host (a new pitch starts with an empty speaker field,
  `ProposalModal.tsx:42`) and splitting the board into hot/new. The plan is
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
  - **Importing into an _existing_ event.** The route only creates, so a whole
    transcribed programme still cannot be dropped into the event you are
    already running; the session form is the only way in, one session (or one
    run) at a time. Wants `POST /events/:slug/import`, gated on event admin
    rather than the instance key, matching rooms/tracks/tags to the existing
    ones by name instead of creating duplicates — same transaction and same
    `dryRun` as now.
  - **A UI for the importer itself.** `POST /events/import` is curl plus a JSON
    file, which is right for a transcription and wrong for everything else.
  - **Duplicate a day.** The repeat control repeats _one_ session; copying a
    whole day's programme onto other days is still hand work. Same expansion,
    a different front door — an action on the day rail rather than in the
    session form.

  Two smaller things noticed alongside: `POST /events/:slug/clone` copies rooms
  and tags but **not tracks**, which post-date it and look simply forgotten;
  and a track carries no time of its own, so "Tech runs 14:00–16:00" is said by
  a repeating session rather than by the track. Track defaults in the import
  document would be cheap; `start_min`/`end_min` on the `tracks` table is the
  bigger version and changes what a track means in the session form, the grid
  and the filters — worth doing only to make the app _enforce_ track hours.

- **Nothing imports an event _export_.** `POST /events/import` builds an event
  from a JSON schedule, but does not read `GET /export.json` back: an export is
  a record of ids, instants and authorship belonging to identities the target
  instance has never seen, and reading one back wants a new slug, fresh ids and
  a decision about those names. So the encrypted whole-DB backup is still the
  only restore path.

- **Compact button overrides do nothing.** `SecondaryButton className="py-1"`
  and the `py-1.5` variants in DetailSheet, ProfilePage, ProposalBoard and
  AdminPermissions are dead: Tailwind emits `.py-1` and `.py-1.5` _before_ the
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
  signed-out shape). Scenario documented in ARCHITECTURE §Merging two people. @claude: this should go into a separate to-do file for profile/user related data modelling issues and improvements.

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
  on a phone. From 2026-09-01:
  - the **session star**, now a 36px icon under the sheet's close button rather
    than a labelled row. Two things to see: that the sheet's right-hand column
    reading expand / close / star does not crowd the title on a narrow phone,
    and that the star still reads as a control at all without its label — the
    hollow-vs-filled distinction carries the whole state now;
  - **Event passwords** in Manage Event → Settings: that "Show passwords"
    reveals three rows, that a typed one reads "set by you — not stored"
    rather than looking broken, and that Replace's confirm dialog is legible
    on a phone;
  - the gate's **"Nobody can get in as organiser"** panel: it is the only
    place a wrong instance password is typed, and the error has never been
    seen rendered.

  From 2026-08-31:
  - the **Repeat** control in the session form — the only part of it with no
    automated coverage, since the server route is tested and the modal is not.
    Worth watching: the weekday chips wrapping under `sm` inside a `FormGrid`
    that is already two columns; that the start day's chip reads as _fixed_
    rather than broken when clicking it does nothing; and that the live count
    and the **Create N sessions** button track the _Until_ select as it moves.
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
    a description and tracks with hours, and that hover, focus and tap all open
    the panel. The touch half is the point — it is the bug fixed on 2026-09-01
    by moving the card onto `usePopover`, and a real finger is the only thing
    that proves it, since the tap is a synthesised mouse sequence no test here
    can produce. Watch too that the panel still opens flush under _its own_
    card in a row of different-height cards (the `c7ae002` bug, now `shift`'s
    job rather than an `alignEnd` prop's) and that on the last column it slides
    back inside the viewport instead of hanging off the end;
  - the **track editor**: the hours toggle, the per-day rows and their day
    picker offering only dates without a window, and that the list row reads
    `09:00–13:00 +1 day`;
  - the **session form's track picker**, which labels each option with the
    hours for the day being placed, and the refusal that arrives from the
    server when an attendee books outside them;
  - the **invite QR**, which has had no camera anywhere near it. The encoder is
    verified — the symbol renders with correct finder patterns and the URL
    round-trips through the fragment, both under test — but _scanning_ is the
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
    menu, Manage/Arrange/Add sit together and go icon-only below `sm`. As of
    2026-09-01 they end the search/Filter/Now row rather than the day-strip row
    above it, and take a line of their own only below `sm` (`basis-full`) —
    so what wants watching is where that row breaks between `sm` and a laptop,
    and how it looks with several active-filter chips beside it;
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
- **No component test coverage, and no error boundary.** 703 tests as of
  2026-09-01, and the web-side ones cover pure functions or assert on source
  text (`format.test.ts`, `numberField.test.ts`, `gridChrome.test.ts`) — there is no jsdom/testing-library stack, so nothing renders a
  component. The drag maths, the SSE reducer and the clash detection are the
  parts most likely to regress silently, and the Calendar column refactor on
  2026-08-30 went in on a read-through alone. The build-stamp crash the same
  day — a component that threw on every render, blanking the page, while the
  whole suite stayed green — is what the gap costs. A React error boundary
  would have contained it; there is still none.

- **Brute-forcing an event password costs an attacker one cookie.** The gate
  spends a token from `LIMITS.auth` (5 attempts / 15 min) on two buckets, the
  identity and the IP, refunding both when a password is right
  (`eventAuth.ts:62-86`). The identity half is keyed on `req.identity.id`,
  which is whatever the caller's cookie says: dropping the cookie mints a new
  identity and a full bucket, so that half stops an honest typo and nothing
  else. The IP half is the only real limit, and it is `req.ip` — the socket
  address unless `TRUST_PROXY=1` (`config.ts:128`, `app.ts:48`). Behind a proxy
  with that unset, every attendee shares the proxy's bucket, which is a lockout
  for the whole venue at 5 wrong guesses; with it set, the app must not also be
  reachable off-proxy, or `X-Forwarded-For` is the attacker's to write.

  What is missing is a counter the caller cannot reset: failures per _event_,
  surviving a new cookie, growing the wait as they pile up. `auth_failed`
  already lands in the audit log on every miss (`eventAuth.ts:76`), so the
  count exists — nothing reads it, and no organiser is ever told that someone
  has been guessing at their event all afternoon. Raising the capacity is not
  the fix and would only hurt the typo case; bcrypt already makes each guess
  cost something, which is why this is a real backlog item and not a fire.

## Medium Priority

### Forms

_A group, because the first item is one instance of a pattern and the rest of
the site's forms are the others. Add to it rather than scattering form work
through the priorities._

- **"Expect someone" should be a button, not a field standing open.** The
  People tab ends in a permanently-open **Expect someone** text field with its
  own hint paragraph, which costs the bottom of the tab a form-sized block for
  something an organiser does a handful of times an event — and it reads as
  something waiting to be filled in rather than an action they can take.

  Make it an inline create affordance: a button labelled **Add new
  Guest/Speaker**, which on click reveals the name field (focused) with its
  hint, and collapses again on save or cancel. The affordance is the button;
  the field is the consequence of pressing it. Keeps the tab's foot to one
  line at rest, and says what pressing it does — which "Expect someone" over
  an empty box does not.

  Nothing about what it creates changes: an unclaimed profile the person
  claims at the gate or with a speaker code. The hint text is worth keeping,
  moved into the revealed state.

- **The same pass over every other form on the site.** This is the first of
  them, not the only one — sessions, rooms, tracks, tags, formats, breaks and
  the event settings all have forms that have grown by addition. Worth doing
  as one considered sweep once the pattern above has been used in anger:
  what is a button and what is a field standing open, where the hint goes,
  what a form looks like at rest. Not yet specified — this is the placeholder
  that stops it being rediscovered from scratch.

- **Two judgement calls from 2026-09-02 that nobody has pushed back on yet.**
  Both were made deliberately and flagged; neither is a bug, and either could
  reasonably be reversed once the screens have been used.

  - **A credited `viewer` may edit the session they are billed on.**
    `assertMayMutate` lost its role floor entirely, so being on the bill is the
    whole test. That is the literal reading of "a speaker owns their own
    session, whatever role they hold", and a viewer only gets there because an
    organiser explicitly credited them. If it should floor at attendee instead,
    it is one condition in `sessionRules.ts` — but note the reason the floor
    was removed: the speaker role is minted by a code somebody has to remember
    to send, so a floor of any kind is a floor most real speakers fall below.
  - **The session sheet still names the placement whatever the badge setting
    says.** `show_official_badge` governs the grid and the list only; the panel
    always shows `Official` or `non-official`. Deliberate — a detail view is
    where a reader goes to find out — but an organiser who switched the badge
    off may expect it off everywhere.

- **Goal: one database per event, and identity that lives inside the event.**
  Stated 2026-09-02. Cross-event identity — one cookie is one person across
  the instance, `GET /me` lists roles in every event, a UID that is "the same
  at every event" — is judged a feature nobody needs, and it is the source of
  the three-table identity model (`identities` / `event_identities` /
  `roles` / `people`) that keeps confusing everyone. The target shape: a
  registry (`events`, `event_slugs`, passwords) and one SQLite file per
  event, where a **person is a row with an optional device token** —
  unclaimed means no token — and username, full name, role, stars and
  authorship all hang off that one row. Merge becomes trivial (everything
  keys on the person), device linking and speaker codes still work (adopt a
  person's token), export/import gets closer to "the file", backup is a
  copy, and a missed `event_id` in a query can no longer leak across events
  because there is no other event in the file.

  Not feasible while an event is live: it touches every server route
  (`ctx.db` becomes a per-request handle, 19 files; `req.identity` is used
  109 times), the migration runner, backup, clone, the cookie (one per
  event, `cid_<eventId>`, since the token must not follow a person between
  files), and the test helpers. A split script is straightforward — copy
  each event's rows into its file, drop the column — but it is the biggest
  change since the identity work and wants a quiet week and a tagged
  release before it. ARCHITECTURE §One database, many events records the
  opposite decision and must be rewritten when this is taken up.

  **Rule for everything built until then:** put nothing new on
  `identities` and nothing new that spans events. New facts about a human
  go on `people`, per event. The "everyone is a person" spec above is the
  first half of this goal — once `people` is the primary human record, the
  only instance-wide thing left is the token, and moving it is the split.

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

  The argument _for_ reducing: `@floating-ui/react-dom` is roughly a third of
  the weight and does the whole job the bug needed — `strategy: 'fixed'`,
  `shift`, `flip`, `size`. Everything above that line is convenience.

  The argument _against_, which is why the fuller package was chosen: the extra
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

- **The People list cannot put somebody out of the event.** Left undone
  deliberately in the identity work (2026-09-02, spec
  `self-as-speaker-and-merge-ux.md` §What was built). The role control
  moves a person between viewer, attendee, speaker and organiser, and a row
  whose holder has no role reads `signed out` — but only a merge or the
  person's own logout can produce that state. So an organiser can hand a
  role back but cannot take one away entirely, and somebody admitted by
  mistake stays admitted until the event password changes.

  It is a `DELETE /people/:id/role` calling the `clearRole` that
  `/logout` already uses, plus a "Sign out of this event" item on the role
  select. What needs deciding first is what it means: the person keeps
  their username, their profile and everything they wrote, and can walk
  back in through the gate with the password they still know — so it is a
  nudge, not a ban, and the UI should not imply otherwise. Wait until an
  organiser actually asks.

## Low Priority / Ideas

- **Show an organiser the old addresses an event still answers to.** Renaming
  an event landed 2026-09-01 and every former slug goes on resolving, but
  nothing in the UI lists them — the only trail is the _renamed_ rows in the
  audit log. `formerSlugs` was written for this and then removed rather than
  left as dead code (`git show` the rename commit for the four lines). Worth it
  only if an organiser ever asks "which names are burned?"; the guarantee they
  actually care about — the old link still works — is already in the Slug
  field's hint.

- **A real series, and a root event other events inherit from.** Deferred
  2026-08-31, deliberately and not for want of time. `repeat` expands to
  ordinary rows precisely because the event it was built for is one whose
  sessions _drift_ — the planned 14:00 becomes 14:20 on the day, and a series
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
  explicitly not for this one: it changes what a vote _is_ (a budget spent
  across pitches, not a click per pitch), so it wants its own schema and its
  own thinking rather than a column bolted onto `proposal_interest`.

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

- **`HelpMenu` falls back with `??`, which only catches `undefined`.** So an
  empty `VITE_BUILD_COMMIT` prints blank rather than `unknown`
  (`HelpMenu.tsx:26-27`); `||` fixes it. All that is left of the "About shows
  no commit" report from 2026-09-01 — the cause was a stale dev server, not
  the stamping, and a fresh one stamps correctly. Two characters.

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
  Still out. Note that the tree now _has_ a QR encoder, added 2026-09-01 for
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
