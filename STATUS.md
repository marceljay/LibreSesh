# Project Status

The shared queue: what is in flight, what is blocked, and what is planned.
Shipped work moves to [CHANGELOG.md](CHANGELOG.md) and is not repeated here.

Last updated: 2026-09-04

## In Progress

On `dev`; `main` is the released line and only takes merges. `origin/dev` sits
at the same commit — its reflog shows an `update by push` after each one — so
nothing local is unsaved. Suite at **997**, lint clean, build clean.

- **UI pass from your checklist** (live, 2026-09-04). You are walking the app
  and sending one item at a time; each lands as its own commit and its own
  CHANGELOG line. Landed today: the hold band's label centred and the band
  sized to the block inside it; the day strip, week rail and Next-day button
  all landing on that day's first session; the filters escaping the day
  (**Search everywhere**); the *Opens in* field cut back to **Default view**;
  the pitch board made an event setting with its button renamed **Pitch a
  session**; a **Find a setting** box over Manage Event's seven tabs; and the
  landing page's front door (its own button sizing, *New event*/*Import* moved
  out of the footer into a block that names the instance password, the board
  preview framed as a browser window, GitHub's mark on the source link).
  All code-complete and queued for your eyes as R19–R25.

Off this list because they are **done**, not because they were forgotten: the
form-layer overhaul and the Base UI migration are both written up in CHANGELOG
`[Unreleased]` → Changed, the migration is merged to `dev` (`bfcbca1`) and
documented in ARCHITECTURE §Form controls, and what survives of either is the
**Forms** backlog group below. Linked sessions, the everyone-is-a-person spec,
the breaks rework and session formats are likewise code-complete and logged
(migrations 014–017); all that is left of them is the browser pass in
**Awaiting your review**. 0.2.0 was tagged 2026-08-30; everything since is under
CHANGELOG `[Unreleased]`.

The 2026-08-29 UI-overhaul/permissions/pitches plan was **retired on
2026-09-04**: of its 28 open boxes, 25 had shipped without being ticked (every
`ui.tsx` primitive, room capacity/description, the explicit edit affordance, the
whole capability system, livestream URLs, the pitch creator) and one was
withdrawn (up/down votes — see §Voting below). What genuinely survived it is
here:

- **Whole-app UI sweep.** The primitives landed, the admin page is done, and
  as of 2026-08-31 every modal is on the `Modal` primitive (`fb5c759`).
  **Recounted against the tree on 2026-09-04: 49 bare `underline` usages**, up
  from 38 on 2026-09-03 — the Base UI migration and the pages added since wrote
  more of them, which is exactly why this is recounted rather than carried
  forward. (Before that it claimed 21 three times running, because it was
  counted against a fixed list of files instead of the tree, so it could not
  move.) **The method, so the next count is comparable:**
  `grep -roE '(^|[^-])underline' --include='*.tsx' web/src` — which counts
  `hover:underline` and skips `no-underline` — then drop `components/ui.tsx`
  (8, the primitives themselves) and the 3 `[&_a]:underline` in prose wrappers
  (links inside rendered markdown keep their underline deliberately). Today's
  spread: ProfilePage 7, ProposalBoard 6, SessionDetail 5, AdminPage 5,
  SessionModal 4, SchedulePage 4, ImportPage 3, AgendaPage 3, SearchPage 2,
  NewEventPage 2, MentionText 2, FilterMenu 2, EventListPage 2, Tour 1, Gate 1.
  Count the tree, not the files this entry happens to name.

- **ARCHITECTURE.md concurrency paragraph.** §Realtime documents broadcast and
  heartbeats but never states the model: last-write-wins, `assertNotStale`
  409 on an `updated_at` mismatch, no CRDT by design.

- **The two files that keep growing.** `SchedulePage.tsx` is **2,018 lines**
  and `AdminPage.tsx` **2,657** (2026-09-04). The retired plan flagged
  SchedulePage at 989 on 2026-08-29 and this entry said 1,957 and 2,577 a day
  ago — both grew again in the checklist pass above, which is the argument for
  the entry rather than any one line count. Nothing is broken by it: it is a
  reading cost, paid every time either file is opened, and it compounds. The
  natural seams are already visible: SchedulePage holds every handler the
  detail sheet needs (deliberately — see ARCHITECTURE §Frontend), so the split
  is by *section* rather than by concern. AdminPage now has one obvious first
  cut — the Settings tab is ~350 lines of form that the new `lib/adminSearch.ts`
  index already describes from the outside. Not urgent, but it will not get
  cheaper.

## Awaiting your review

Everything here is code-complete and cannot move without you — it needs your
eyes or your call. This is the queue that used to read "awaiting a browser
pass"; the point is that each item now names the one thing to check, so a
basic sanity look *is* the review.

**To run it:** `npm run dev` (or type `! npm run dev`), then open the URL the
editor forwards — the port is not fixed. A stale dev stack is the usual reason
something "looks wrong": if in doubt, `ss -tlnp | grep 3000`, note its start
time, and restart (a Vite up for a day serves fresh source over HMR but stale
config/env/deps — that was the old "why does it look old" mystery). Where an
item says *phone* or *both themes*, narrow the window or toggle the theme —
that is where these break.

**To report back:** one line per item — the id and a verdict. `R3 ok` /
`R6 bad: chips overrun the title` / `D1 yes`. Skip any you didn't reach. Each
*ok* I record as seen and clear; each *bad* becomes a fix.

### Look at these (browser)

Freshest first — **R19–R25 are today's checklist pass** and are the ones I have
never seen rendered; R1–R2 are the forms overhaul and the grid-block fix, R3–R5
the mentions, linked-sessions and clash work. Each takes a minute.

1. **R19 · The “everyone should be here” band** (the item you sent twice — I
   found two faults, so this is the one to look at first). On a day with a
   floor-holding session, the amber band across the grid. *Pass:* its label sits
   centred in the band rather than jammed into the top-right corner, and the
   band's bottom edge lines up with the bottom of the hold's own block — no
   3px sliver of amber showing under it. **If what bothered you was the amber
   pill in the session sheet instead, say `R19 wrong thing` and I'll look
   there** — its padding is symmetric, so nothing jumped out at me.
2. **R20 · Changing the day lands on its first session.** On an event whose day
   starts at 08:00 but whose first session is after lunch, use the day strip,
   the week rail, and the **Next day** button at the foot of a list. *Pass:* all
   three open the day on its first session with a little air above it, not on a
   screenful of empty grid. An empty day, and the list view, still go to the top.
3. **R21 · Search everywhere.** Set a tag (or a room, or ★) in Filter, then press
   **Search everywhere** at the foot of the panel. *Pass:* the results page opens
   with the same chips still on, showing every matching session grouped by day;
   the chips can be taken off there; the URL carries the whole question. Then
   re-run the query from the box on that page and check the chips survive it.
   *Also:* **Now / next** on that page means "has not ended yet" across dates,
   where on the grid it means a minute of the day on screen.
4. **R22 · Default view field** (Manage Event → Settings). *Pass:* the label
   reads **Default view**, the hint is two sentences, and the select is wide
   enough to show "List — one column, in time order" without it running under
   the chevron.
5. **R23 · Pitch a session, and turning the board off.** *Pass:* the header
   button reads **Pitch a session** with a bulb; **narrow the window** and the
   words go, leaving the bulb (check the row does not wrap badly). Then Manage
   Event → Settings → **Pitch board** off: the button, the page and the form all
   go, an old `/proposals` link says the board is shut rather than 404ing, and
   turning it back on brings every pitch back untouched — the toggle counts what
   is on the board before you shut it.
6. **R24 · Find a setting** (Manage Event, above the tabs). Type "retention",
   "qr", "clone", "unconference". *Pass:* each finds the right setting and names
   the tab it is on; picking one switches tab, scrolls to the field and rings it
   for a moment; ↑/↓ and Enter work; Escape closes. In **both themes** — the
   ring is the app's yellow.
7. **R25 · The landing page** (`/`, logged out, in **both themes**). *Pass:*
   **Browse events** and **Self-host it** read as the page's two offers — full
   buttons, not the toolbar-sized controls they were — and the hover lift is
   there (and gone if your system asks for less motion). Below them, the page
   ends at *Holding a link to an event?* — **New event** and **Import**
   are not on it at all, and the whole page should sit inside one screen with
   no scrollbar (this is the bit I could not check: there is no browser in the
   container, so the fit is reasoned, not measured — if it still scrolls, say
   by how much). The board preview sits in a browser frame with a fake host in
   its address bar: check it no longer invites a click — nothing hovers,
   nothing selects. The footer's source link wears GitHub's mark. **Narrow the
   window** too: the two columns stack and no button row wraps badly.
   Then **`/events`**: the note under the list is where the instance-password
   sentence went, beside the **New event** / **Import** buttons that want it.
8. **R1 · Forms overhaul — fields, focus, buttons** (Phases 2–3). Open a form
   (Add session, Manage Event → Settings). *Pass:* field borders read a touch
   darker and even; **clicking into a field shows one clean focus ring, not a
   doubled/inner border** — check the **speaker/host** field especially, in
   **both themes**; a text field does **not** zoom the page on a phone; tabbing
   to a button shows a focus ring; hint text under a field is legible; native
   selects (day, duration) match the text fields.
9. **R2 · Grid block padding.** On the calendar grid, a session block's tags sit
   near the top edge and a short (15–20 min) block still shows its time row.
   *Pass:* nothing is clipped at the bottom of a short block; tags aren't
   floating with a gap above them.
10. **R3 · Clickable authors & `@username` mentions in a comment.** Open a
   session, post a comment that names someone with `@theirusername` (a real
   username from the People tab). *Pass:* the `@name` renders as a blue link and
   opens that person's profile; the comment's own author name (under the body)
   also links to a profile; a plain `@notauser` and an email like `a@b.com` stay
   as text, not links. Try a multi-word username if the event has one.
11. **R4 · Link a recurring run as an attendee.** As a non-organiser, add a
   session and set **Repeat** across several days with "keep linked" on. *Pass:*
   the whole run lands on the grid without a reload; every occurrence is open;
   a day that would clash or fall outside the window is refused with the day
   named, not placed wrong. An organiser's run is unchanged (may be official,
   may hold the floor).
12. **R5 · Link after the fact, and the edit reach.** On a saved session,
   *Link matching sessions…* lists your other same-titled runs (with select-all)
   and links the ones you tick. Editing a linked session then offers *this only*
   / *this and later* / *all in the series*. *Pass:* the default is this-only;
   changing a description with *all* updates the rest but **never the time**; an
   occurrence that isn't yours is skipped and reported ("applied to four of
   five"); *Unlink this one* drops a session back out.
13. **R6 · A clash narrows only the clashing sessions.** Put two sessions
   overlapping in one room, with a third alone elsewhere in that room's column.
   *Pass:* only the overlapping pair split into lanes; the lone 09:00 talk keeps
   full width even though an unrelated 15:00 pair clashes (the `4f9afdb` fix).
   While here, R6b: open a session from **search** and confirm the detail panel
   now leads with the weekday and date, not just the time (`2c4a542`).
14. **R7 · Star & ring on the grid.** Tap a session block's corner star: it
   should toggle without opening the sheet or dragging the block. Open a
   session: its block gains a ring. *Pass:* both work; the ring shows in both
   themes.
15. **R8 · Break label on a wide grid.** With 3+ rooms, a lunch/dinner band
   shows its name+time bottom-right as well as top-left. *Pass:* both corners
   labelled, and a short break doesn't stack them on top of each other.
16. **R9 · Placement row (phone).** Add session, narrow window. *Pass:* the
   "Non-official: allow parallel sessions" chip + "?" wrap to a second line
   instead of clipping off the edge.
17. **R10 · People table.** *Pass:* headings line up with the rows; the active
    sort column shows an arrow; the Columns button toggles UID / Last seen; on a
    phone the table scrolls sideways rather than crushing the name; name and
    username share the width.
18. **R11 · Role tag & archiving.** Role is a coloured badge with a pencil,
    opening a menu; the ⋯ menu holds Merge / Archive. *Pass:* the badge fits the
    role column at the longest role word an event can set; both menus open over
    the row (and the ⋯ menu flips *up* on the last row of a long list, not
    off-screen); an archived profile shows its amber notice; re-entering the
    event un-archives.
19. **R12 · The gate — highest stakes, a mistake locks people out.** *Pass:* an
    empty username is refused with a message; a name matching an expected
    profile asks "is that you?" and can claim it; an ordinary name enters.
20. **R13 · Claim & queue.** The "This is me" button on an unclaimed profile, and
    the approval queue above the People list. *Pass:* asking to be a profile
    shows in the queue; approving hands it over. Also: the next-day button at the
    end of a day's list, and several stream links on one session.
21. **R14 · Top of the session form.** Format chips, then Placement, then the
    title. *Pass:* a dozen formats wrap to ≤3 tidy lines above the title;
    picking a format visibly moves the Duration select below it.
22. **R15 · Speaker edits their own session** (the reported flow). As an attendee
    credited on an official session. *Pass:* Edit appears; Room / Day / Start /
    Duration are disabled under the grey notice; Delete is absent; saving a
    changed description goes through.
23. **R16 · Duration `Other…`.** *Pass:* a typed 40 is accepted; the
    "· 1 h 30 min" echo appears past an hour; editing an off-list session opens
    straight into the field, not a preset it doesn't have.
24. **R17 · Official badge & Formats.** With the badge off (default) the grid
    and list say nothing about placement; turn it on in Manage Event → Settings
    and check a grid block + a list card in both themes. In Manage Event →
    Programme, the Formats suggestion chips (dashed row) and the "no formats
    yet" empty state render.
25. **R18 · Number fields** (capacity, audit-keep, week-rail) after the Phase 1
    primitives. *Pass:* they still validate inline, and on a phone focusing one
    does **not** zoom the page (the 16px fix).

### Decisions I need from you

- **D1 · Purge the local dangling git objects?** The accidental Valley-export
  commit never left this machine (verified across every ref, both worktrees,
  stashes and the object store); it lingers only in this clone's reflog for
  ~90 days. On your word I run
  `git reflog expire --expire-unreachable=now --all && git gc --prune=now` —
  irreversible, drops *all* unreachable objects, none of value today. Separately:
  `_planning/valley-2026-09-02.json` and its `.import.json` twin are gone from
  disk (`export-to-import.py` remains); if that wasn't deliberate, an editor
  buffer may be the last copy.
- **D2 · The pitch board's server guard.** You said deactivation is "a simple
  hide from UI and route". I went one step further: `POST /proposals` returns
  403 while the board is off, because hiding a form does not stop a tab that was
  open before the switch. Everything else on the board — reading, interest,
  placing what is already there — is untouched. Keep the guard, or drop it?

*Resolved and removed:* **push `dev`** (it is pushed — `origin/dev` matches, and
its reflog shows a push after each commit) and **start forms Phase 2** (phases
0–3 landed 2026-09-04; 4–6 were overtaken by the Base UI migration).

## Blockers

_None — what's outstanding is your review and decisions above. Nothing is
waiting on anything external._

---

# Backlog

_The only queue of future work, priority-ordered. Top High-Priority item = next up._

## High Priority

- **Search cannot find a person.** Phases 2–4 of
  `_planning/specs/search.md`, which is written and settled — phase 1
  (event-wide filters and the "Search everywhere" hand-off) shipped
  2026-09-04. `@ada` resolves in a comment and a speaker's name opens a
  profile, so the app knows who people are, but typing a name into the
  search box searches the *billing* on sessions: it finds their sessions
  and not them. What is left, in order:

  - **`scorePerson` and the merge rule.** Username 60 exact / 45
    word-start, name 40, bio 6 — and two ranked lists rather than one
    score across both types, because a single scale would have to promise
    that 45 points of username mean the same as 45 of session title. The
    merge: an exact hit first whatever it is (an attendee whose username
    is `design` must not outrank the session called "Design"), then people
    who were named, then sessions, then bio-only people. Person rows in
    both the popdown (max 3) and the page (a People section).
  - **`@handle`** — a query starting with `@` is a people query: strip it,
    match usernames only. Same grammar as a mention, which is where people
    learn it.
  - **Bio-only matches**, page only. Never in the popdown: a row there
    that cannot say why it is present reads as a bug.

  Decided and not to be relitigated: tags are **not** offered as rows in
  the search box (a tag is a lens, not a destination — it has no page to
  open), and there is no separate "Advanced search" mode, because the
  search page is it.

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

- **Mentioning a person: the delivery half.** The **first cut landed
  2026-09-04** (CHANGELOG `[Unreleased]`) — a comment's author links to their
  profile, and `@username` in a comment body links too, via a shared tokenizer
  (`shared/mentions.ts`, `web/src/components/MentionText.tsx`). It resolves but
  does not yet *deliver*: a mention links, it does not land anywhere that
  survives a closed tab. Full design in
  `_planning/specs/mentions-and-notifications.md`.

  What is left is everything that makes a mention arrive. There is no
  notification concept at all: `sse.ts` is an in-process broker per event slug
  that carries schedule changes to open tabs — the right transport, not the
  storage. That wants a `notifications` table (recipient, event, source,
  read-at), a header panel with an unread count, and answers to the questions
  such a table raises: what else creates one besides a mention (being added as
  a speaker, a starred session moving, a pitch of yours scheduled), whether
  anything leaves by mail (nothing does today, and adding it changes what this
  project stores about people), and pruning (`pruneAudit` is the precedent).
  When delivery lands the parse moves server-side (the tokenizer is written to
  run there too), so the stored mention and the rendered link cannot disagree.

  Two edges specific to this app, both the reason to design before building.
  **Merging**: identities merge (`mergePeople.ts`) and profiles archive
  (migration 013), so notifications must follow a person through a merge the
  way authorship does, or an organiser tidying duplicates silently deletes
  someone's inbox. **Unclaimed profiles**: an organiser can type a speaker's
  name onto a session before that person arrives, so a mention can be addressed
  to a profile with no identity behind it — it should wait and be delivered on
  adoption (`adoptProfile` in `people.ts`), not be dropped. (The first cut
  resolves by username only, so an unclaimed profile is not yet a mention
  target; that arrives with delivery.) Extending mentions from comments to
  descriptions, bios and pitches — which render through `renderMarkdown` — is a
  separate step queued behind this.

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
  stashes and the object store; details in **Awaiting your review**. The hole is still
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
  `ProposalModal.tsx:42`) and splitting the board into hot/new. The plan that
  carried these was retired on 2026-09-04; its
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

- **Inline create inside `SpeakerCombobox`.** The other half of the affordance
  that landed on 2026-09-04 (`InlineCreate` in `ui.tsx`, used by the tag, track,
  format and expected-person rows): typing a name the event does not know into
  the speaker field should offer to create that person there, rather than
  sending the organiser to the People tab and back. Same control, harder host —
  the combobox already has a listbox, a create-a-person row and the
  `onlySelf`/`isAdmin`/archived rules to respect.

- **A real date/time picker for the session modal.** The native
  `<input type="date">`/`<input type="time">` are the last controls not wearing
  the app's own field styling, and the browser's popup cannot be themed — the
  same complaint that moved every `<select>` to Base UI. Deferred out of the
  shadcn/Base UI migration on 2026-09-04 because the right control depends on
  a decision nobody has made: a one-day unconference wants a time picker and
  no calendar at all, while a fortnight-long event wants a month grid. A real
  calendar means `react-day-picker` (~12 kB gz) on top of Base UI, which is a
  bundle question as much as a design one. Decide the shape first, then build.

- **Publishing a session: a link that works without the gate.** A published
  session would be the app's first genuinely unauthenticated read — sharing one
  talk without sharing the event or handing over a role. No commit yet. Design
  is done and lives in `_planning/specs/publishing-a-session.md`: the **snapshot**
  approach (decided 2026-09-02 — copy the session into a table nothing else joins
  to, and read only that, so nothing private can leak by omission), what must not
  travel (contributions, stars, agendas, authorship, and a speaker's full
  profile), and the open questions (who may publish, real revocation vs. hidden
  link, guessable URL vs. capability token, archived-event bounds). Moved down
  from High on 2026-09-04: worth doing, but nothing is blocked on it and it wants
  its questions answered before code.

- **Linked sessions: auto-detect matches instead of an always-on link.** Today
  the session editor shows "Link matching sessions…" on every saved session,
  even when the actor has no other same-titled session — a click that dead-ends
  on "no matches". Detect matches up front (the `link-candidates` query already
  finds them) and only surface the affordance when there is something to link,
  ideally as a nudge ("You run 'Morning Yoga' on 3 other days — link them?").
  Deferred out of the first cut on 2026-09-03; the controls now live in the
  When-and-where group's **Series** field. Follow-ups from the same review:
  tz-aware time-of-day propagation, and `series_id` on export/import.

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

- **React 18 → 19, and react-router 6 → 7.** Deferred through the whole Base UI
  migration and never needed: Base UI supports React 18, so nothing was blocked
  on it. It stays worth doing eventually — 19 is where the ecosystem is heading
  and the router bump comes with it — but there is no pull for it now, and a
  major React bump on a working app is risk bought for nothing. Revisit when a
  dependency actually asks for it.

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
