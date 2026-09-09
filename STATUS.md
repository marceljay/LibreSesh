# Project Status

The shared queue: what is in flight, what is blocked, and what is planned.
Shipped work moves to [CHANGELOG.md](CHANGELOG.md) and is not repeated here.

Last updated: 2026-09-10

Every item below carries its Linear issue in brackets, `[LIB-123]`, and the
issue holds the same text. Linear is the shared view; this file stays the
working queue, so an item that moves here moves there in the same edit, and a
new item is filed in both. Issues live in the LibreSesh team, one project per
group below. Unbracketed items have no issue on purpose: they are prose about
the state of a branch, not work to pick up.

## In Progress

On `dev`; `main` is the released line and only takes merges. `origin/dev` sits
at the same commit — its reflog shows an `update by push` after each one — so
nothing local is unsaved. Suite at **1648**, lint clean, build clean.

- **UI pass from your checklist** [LIB-183] (live, 2026-09-04). You are walking the app
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
  All code-complete and queued for your eyes as R19–R25. From 2026-09-05:
  an **eye beside the event password** at the login page that shows what you
  typed (the `PasswordInput` primitive in `ui.tsx`, used only there so far —
  the instance-password boxes on New event, Import and the admin pages are
  still bare), filed under R28. Three more from today, all filed under
  **R30**: tags wear their colour as a pale wash instead of filling with it,
  with the format moved out of that row to sit beside the title; the header
  gives the event name back about three characters on a phone; and the demo
  login page asks for a name *before* offering the roles. **First verdicts landed
  2026-09-07** through the review sheet (the artifact at
  `claude.ai/code/artifact/ad99a753…`, verdicts in its `verdicts`
  collection): eight items cleared, three bad, two faults on a fourth — the
  fixes are the top backlog group.

- **Branch `fix/review-round-2`** is all shipped: seven commits in **0.3.6**
  (PR #55), the last two — the login page wearing the logo and a link to the other
  events (**R36**), the audit log linking to what it names (**R37**) — into
  `dev` via PR #57 (`561c9ac`). Still queued for your eyes as **R31–R37**:
  shipped is not seen. The worktree `.claude/worktrees/review-fixes` can go.

- **Permissions, page side** [LIB-182] (2026-09-08, on `dev`): you found a viewer
  could not add notes in production despite the matrix allowing it. Every
  control the page gated by the role's *name* now reads the matrix instead —
  see CHANGELOG `[Unreleased]` → Fixed — and `tests/permissionParity.test.ts`
  holds page and server to the same answer for every capability and role
  (48 cases), with the production case itself pinned under jsdom. Queued for
  your eyes as **R38**: grant viewers *Add notes, links and questions* and
  open a session as a viewer.

- **Branch `chore/react-19`** (2026-09-07, off `561c9ac`, `origin/dev`
  merged in at `2a84e69`): the DOM smoke suite, React 19, and
  `npm run browser-pass` — the built app driven through the container's
  Chromium, fourteen steps on desktop and phone, console and network clean
  under React 19 with the time-mask fix in. Local `dev` had been left
  pointing at `main`'s merge commit (`35d08b5`) rather than at `origin/dev`,
  so the work went on a branch; land it with `git branch -f dev origin/dev`
  then `git merge chore/react-19` on `dev`.

- **Branch `fix/now-line-placement`** [LIB-157] (2026-09-08, worktree
  `.claude/worktrees/review`, off `dev` at `5255ae7`): the two fixes from the
  2026-09-08 review, one commit each, both in CHANGELOG `[Unreleased]`. The
  **R31 verdict** — the list's now line crosses every running card instead
  of sitting under the row (your two follow-ups the same morning: no time
  chip on it, every running session's card, not one row, the line where the
  minute is rather than snapped to a seam, which had put it below the card,
  and behind the card's text, paler); on the grid the time chip moved into
  the time gutter — and the
  **comment box's
  *Post as*** naming the instance seed instead of the event name (on the
  sheet as **R38**; R31 reworded for the new rule). Checked in headless
  Chromium at four clock times, desktop, phone and dark. Suite green, lint
  clean. Land it with `git merge fix/now-line-placement` on `dev`. Two
  `serveStatic` tests fail *in that worktree only*: Express's `sendFile`
  refuses a path with a dot-directory segment (`.claude/worktrees/…`), so the
  built index never serves from there — an environment quirk, not a
  regression, though `dotfiles: 'allow'` on that one `sendFile` would spare
  the next worktree.

Off this list because they are **done**, not because they were forgotten: the
form-layer overhaul and the Base UI migration are both written up in CHANGELOG
`[0.3.0]` → Changed, the migration is merged to `dev` (`bfcbca1`) and
documented in ARCHITECTURE §Form controls, and what survives of either is the
**Forms** backlog group below. Linked sessions, the everyone-is-a-person spec,
the breaks rework and session formats are likewise code-complete and logged
(migrations 014–017); all that is left of them is the browser pass in
**Awaiting your review**. The export/import work and the `@` menu are the same:
both in CHANGELOG `[0.3.0]`, both waiting only as R26 and R27. Everything
collected since 0.2.3 (2026-09-02) was cut as **0.3.0**; `[Unreleased]` has
filled again since — the bell (migration 020), the time fields and their day
cap, the eye, the calmer tags, help folded into the profile menu, and the
drag-hold, system-theme, phone-header and demo-login page fixes — all on `dev`,
merged to `main` up to the bell (PR #50) and untagged. Only v0.1.0 and v0.2.0
carry git tags — 0.2.3 and 0.3.0 do not, which is worth settling before the
next cut [LIB-156]. (v0.3.5, v0.3.6 and v0.4.0 were tagged on `main` since.)

The 2026-08-29 UI-overhaul/permissions/pitches plan was **retired on
2026-09-04**: of its 28 open boxes, 25 had shipped without being ticked (every
`ui.tsx` primitive, room capacity/description, the explicit edit affordance, the
whole capability system, livestream URLs, the pitch creator) and one was
withdrawn (up/down votes — see §Voting below). What genuinely survived it is
here:

- **Whole-app UI sweep.** [LIB-153] The primitives landed, the admin page is done, and
  as of 2026-08-31 every modal is on the `Modal` primitive (`fb5c759`).
  **Recounted against the tree on 2026-09-05: 51 bare `underline` usages**, up
  from 49 on 2026-09-04 and 38 on 2026-09-03 — the bell, the landing page and
  the split-out admin tabs each brought one or two, which is exactly why this
  is recounted rather than carried forward. (Before that it claimed 21 three
  times running, because it was counted against a fixed list of files instead
  of the tree, so it could not move.) **The method, so the next count is comparable:**
  `grep -roE '(^|[^-])underline' --include='*.tsx' web/src` — which counts
  `hover:underline` and skips `no-underline` — then drop `components/ui.tsx`
  (8, the primitives themselves) and the 3 `[&_a]:underline` in prose wrappers
  (links inside rendered markdown keep their underline deliberately). Today's
  spread (54 before the 3 prose wrappers come off): ProfilePage 7,
  ProposalBoard 6, SessionDetail 5, AdminPage 5, SessionModal 4,
  SchedulePage 4, LandingPage 3, AgendaPage 3, SearchPage 2, NewEventPage 2,
  ImportPage 2, MentionText 2, FilterMenu 2, EventListPage 2, AdminBackup 1,
  AdminAudit 1, NotificationBell 1, Tour 1, Login page 1.
  Count the tree, not the files this entry happens to name.

- **ARCHITECTURE.md concurrency paragraph.** [LIB-154] §Realtime documents broadcast and
  heartbeats but never states the model: last-write-wins, `assertNotStale`
  409 on an `updated_at` mismatch, no CRDT by design.

- **The two files that keep growing.** [LIB-155] `SchedulePage.tsx` is **2,022 lines**
  and `AdminPage.tsx` **2,665** (2026-09-05). The retired plan flagged
  SchedulePage at 989 on 2026-08-29 and this entry said 2,018 and 2,657 a day
  ago — both grew again with the bell and the header, which is the argument for
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

Freshest first. **R26 is the export/import work**, R21–R22 what is left of
the 2026-09-04 checklist pass, R1–R2 the forms overhaul and the grid-block
fix, R5–R6 linking and clashes, R7–R18 the older sweep, **R27** the `@` menu,
**R28** the forms close-out, and **R31–R37 the things you sent in chat
on 2026-09-07**, on `fix/review-round-2` until it is merged. Each takes a
minute.

**Verdicts so far (from the review sheet, 2026-09-07):** R3, R4, R16, R19,
R20, R23, R29 and R30 came back *ok* and are cleared from this list (R23's
narrow-window check and R16's "off-list" wording were the only unticked
boxes — an off-list session is one whose duration is not a preset, a typed
40 say). R24, R25 and R27 came back *bad*, and R30 carried two faults
despite its *ok*; the open ones are filed as **Fixes from your review** at
the top of the backlog. R25 is fixed (the preview's address bar was widening
the page's one column; it is pinned to the screen now) and back on the list
below for a second look on the phone. R35 came back *bad* the same evening —
`0725` typed into a filled box came out wrong, four zeros left a stray digit,
Enter did nothing; that was the third go at the time box — and is rebuilt on
`fix/time-box-caret`, back on the list below. **R31** came back *bad* on
2026-09-08 — the line belongs over the running card, and the time must not
cover a title — and is fixed on `fix/now-line-placement`, reworded on the
sheet for a second look. Verdicts live in the sheet's own store, so ticking
there is enough — nothing needs pasting back.

**Machine-checked since 2026-09-09 (`test/review-queue-jsdom`).** The part of
this queue that did not actually need eyes is walked by the suite now, in a
real DOM against the real server — `tests/reviewFlows.test.tsx`. Covered in
full: **R33** [LIB-177] (the leave guard both ways, and no dialog after Save),
**R13** [LIB-170] (claim and queue), **R32** [LIB-176] (the page re-themes on
`visibilitychange` and on a bfcache `pageshow`, menu closed), **R34** [LIB-178]
(the `@` menu in a session description, and the saved name linking), **R37**
[LIB-181] (the audit log's session and actor links). Covered in the part that
is not layout: **R21** [LIB-160] (the chips reach the search page and the URL;
both days answer), **R26** [LIB-158] (the checkbox interlock and the
`?include=` link — *not* the import walk-through or the phone paragraph),
**R5** [LIB-164] (the picker's list and select-all; this-only the default;
*all* carries the words and not the times), **R7** [LIB-98] (starring a block
without opening it), **R10** [LIB-167] (the sorted column's arrow, and Columns
adding UID), **R11** [LIB-168] (the badge's menu, with the held role ticked),
**R22** [LIB-161] (the label, the hint and the long option).

**Still yours, and only yours:** R25, R2, R8, R9, R1, R14, R6, R18, R28's
screen-reader and phone-keyboard checks and the Arrange drag, R35 on a phone,
R36, and R26's import walk-through. There is **no browser in this container** —
Debian's chromium is not installed and Playwright's download host is
unreachable from here — so `npm run browser-pass` cannot stand in for any of
them.

0. **R26 · Export what you choose, and import it back.** [LIB-158] Manage Event → Backup:
   four checkboxes above the download button. *Pass:* unticking **Sessions**
   greys out **Contributions** with a note saying why; the download link
   carries `?include=…` for what is ticked (hover it); the file has no key for
   a part left out. Then open **Import a schedule**: **Choose a JSON file** (or
   drop it on the box) shows the name and size; the summary says *An export
   made <date>*; **Check it** lists the counts and, if people/pitches were in
   the file, a first warning naming what is not carried; leave **Address**
   blank and Import is refused naming that field; fill it in and the rehearsal
   is withdrawn until you check again; **Import** lands the programme. Compare
   the two events' grids side by side — speakers, tags, streams, breaks, track
   hours. While there: the Backup tab's amber warning now runs to feeds, codes
   and names — check it still reads as one paragraph on a phone.
1. **R25 again · The landing page on a phone.** [LIB-159] Open `/` on the phone that
   needed the zoom-out. *Pass:* the page is the width of the screen — no
   zooming out, no right edge cut off; the preview's address bar ends in an
   ellipsis instead of pushing the frame wider; the two buttons sit on their
   own lines if they must. This one was reasoned, not measured — there is
   still no browser in the container — so if it still overflows, say by how
   much and which phone.
2. **R21 · Search everywhere.** [LIB-160] Set a tag (or a room, or ★) in Filter, then press
   **Search everywhere** at the foot of the panel. *Pass:* the results page opens
   with the same chips still on, showing every matching session grouped by day;
   the chips can be taken off there; the URL carries the whole question. Then
   re-run the query from the box on that page and check the chips survive it.
   *Also:* **Now / next** on that page means "has not ended yet" across dates,
   where on the grid it means a minute of the day on screen.
3. **R22 · Default view field** [LIB-161] (Manage Event → Settings). *Pass:* the label
   reads **Default view**, the hint is two sentences, and the select is wide
   enough to show "List — one column, in time order" without it running under
   the chevron.
4. **R1 · Forms overhaul — fields, focus, buttons** [LIB-162] (Phases 2–3). Open a form
   (Add session, Manage Event → Settings). *Pass:* field borders read a touch
   darker and even; **clicking into a field shows one clean focus ring, not a
   doubled/inner border** — check the **speaker/host** field especially, in
   **both themes**; a text field does **not** zoom the page on a phone; tabbing
   to a button shows a focus ring; hint text under a field is legible; native
   selects (day, duration) match the text fields.
5. **R2 · Grid block padding.** [LIB-163] On the calendar grid, a session block's tags sit
   near the top edge and a short (15–20 min) block still shows its time row.
   *Pass:* nothing is clipped at the bottom of a short block; tags aren't
   floating with a gap above them.
6. **R5 · Link after the fact, and the edit reach.** [LIB-164] On a saved session,
   *Link matching sessions…* lists your other same-titled runs (with select-all)
   and links the ones you tick. Editing a linked session then offers *this only*
   / *this and later* / *all in the series*. *Pass:* the default is this-only;
   changing a description with *all* updates the rest but **never the time**; an
   occurrence that isn't yours is skipped and reported ("applied to four of
   five"); *Unlink this one* drops a session back out.
7. **R6 · A clash narrows only the clashing sessions.** [LIB-165] Put two sessions
   overlapping in one room, with a third alone elsewhere in that room's column.
   *Pass:* only the overlapping pair split into lanes; the lone 09:00 talk keeps
   full width even though an unrelated 15:00 pair clashes (the `4f9afdb` fix).
   While here, R6b: open a session from **search** and confirm the detail panel
   now leads with the weekday and date, not just the time (`2c4a542`).
8. **R7 · Star & ring on the grid.** [LIB-98] Tap a session block's corner star: it
   should toggle without opening the sheet or dragging the block. Open a
   session: its block gains a ring. *Pass:* both work; the ring shows in both
   themes.
9. **R8 · Break label on a wide grid.** With 3+ rooms, a lunch/dinner band
   shows its name+time bottom-right as well as top-left. *Pass:* both corners
   labelled, and a short break doesn't stack them on top of each other.
10. **R9 · Placement row (phone).** [LIB-166] Add session, narrow window. *Pass:* the
   "Non-official: allow parallel sessions" chip + "?" wrap to a second line
   instead of clipping off the edge.
11. **R10 · People table.** [LIB-167] *Pass:* headings line up with the rows; the active
    sort column shows an arrow; the Columns button toggles UID / Last seen; on a
    phone the table scrolls sideways rather than crushing the name; name and
    username share the width.
12. **R11 · Role tag & archiving.** [LIB-168] Role is a coloured badge with a pencil,
    opening a menu; the ⋯ menu holds Merge / Archive. *Pass:* the badge fits the
    role column at the longest role word an event can set; both menus open over
    the row (and the ⋯ menu flips *up* on the last row of a long list, not
    off-screen); an archived profile shows its amber notice; re-entering the
    event un-archives.
13. **R12 · The login page — highest stakes, a mistake locks people out.** [LIB-169] *Pass:* an
    empty username is refused with a message; a name matching an expected
    profile asks "is that you?" and can claim it; an ordinary name enters.
    **Came back bad, and the page was rebuilt on `feat/gate-two-step`**
    (2026-09-10): the first refusal could never be seen. The name box sat below
    the button and behind a rule, the button was disabled until it held
    something, and a browser's implicit submission clicks that same button — so
    Enter from the password box did nothing either, and the sentence was a
    string no press reached. The page **asks for the password first, and for a
    username only once that password is right**. It needed no new endpoint:
    `POST /auth` checks the password before it claims a name, so a password
    with no name answers `name_required` when right and 403 when wrong,
    granting nothing either way. Both boxes stay in one form (the second
    hidden, not absent) so the password manager still sees a login to save —
    R28's one ticked box. The first card is only ever the password: a device
    that already holds a name here is entered under it rather than shown a box
    for a name it already chose. The **invite card keeps its button disabled**
    until it has a name, since there the name box is the field directly above
    it. All three boxes are machine-checked in `tests/loginEntry.test.tsx`.
14. **R13 · Claim & queue.** [LIB-170] The "This is me" button on an unclaimed profile, and
    the approval queue above the People list. *Pass:* asking to be a profile
    shows in the queue; approving hands it over. Also: the next-day button at the
    end of a day's list, and several stream links on one session.
15. **R14 · Top of the session form.** [LIB-171] Format chips, then Placement, then the
    title. *Pass:* a dozen formats wrap to ≤3 tidy lines above the title;
    picking a format visibly moves the Duration select below it.
16. **R15 · Speaker edits their own session** [LIB-172] (the reported flow). As an attendee
    credited on an official session. *Pass:* Edit appears; Room / Day / Start /
    Duration are disabled under the grey notice; Delete is absent; saving a
    changed description goes through. **Came back bad and is fixed on
    `fix/speaker-edits-own`** (2026-09-09): the form filtered rooms to the ones
    open for booking on an edit as well as a placement, so a speaker on an
    organiser's stage got an empty Room box, the "nowhere for you to add a
    session" notice and a dead Save — the description could not be saved at
    all. All four boxes are machine-checked now in
    `tests/speakerEdit.test.tsx`; nothing here needs your eyes.
17. **R17 · Official badge & Formats.** [LIB-173] With the badge off (default) the grid
    and list say nothing about placement; turn it on in Manage Event → Settings
    and check a grid block + a list card in both themes. In Manage Event →
    Programme, the Formats suggestion chips (dashed row) and the "no formats
    yet" empty state render.
18. **R18 · Number fields** [LIB-184] (capacity, audit-keep, week-rail) after the Phase 1
    primitives. *Pass:* they still validate inline, and on a phone focusing one
    does **not** zoom the page (the 16px fix).
19. **R28 · Forms close-out** [LIB-174] (2026-09-05, on `docs/forms-overhaul-close-out`,
    the eight leftovers from `_planning/forms-overhaul-review.md`). At the
    login page: your browser or password manager **offers to save** the event
    password on entry and fills it next visit; Enter enters from the name box
    as well as the password box, and Enter with no name says *Pick a username
    to enter*; the link phrase is **not** offered for saving; the **eye**
    beside the password shows the characters and hides them again, without
    submitting, and the caret stays where it was. In Manage Event:
    Enter adds a room from the **capacity** box, a break from any of its
    boxes, and the unlock box and the QR check both submit on Enter; adding a
    track with a screen reader on announces *… added*. The **?** beside
    Placement is a touch bigger. On the speaker field with VoiceOver or NVDA,
    arrowing through the list reads the row you land on. On a phone, the
    Enter key reads *Go* at the login page and *Search* in the search box. **Every
    time field** (session Start, break From/To, track hours, Day starts/ends)
    is now a box plus a chevron: type `930` or `2pm` and tab away — it reads
    09:30 / 14:00; type `noon` — the box goes red and reverts on blur; ↑/↓
    move five minutes; the chevron opens quarter hours dropped *below* the
    field, in both themes, and **only the event's hours** — type `7` on a
    nine o'clock day and it lands on 09:00 (Day starts/ends stay open). Enter in the box settles the time and does **not**
    save the dialog; a second Enter does. Two
    from your 2026-09-05 notes: in **Arrange**, a dropped block stays put and
    never flashes back to its old slot before landing; and with the theme on
    *System*, flipping the OS to dark re-themes the page at once, menu closed.
    **Progress 2026-09-07:** 2 of the 17 checks ticked on the review sheet
    (the password-manager save, and the eye) — the time fields and the two
    2026-09-05 notes are still unseen.
20. **R31 · The now line in List view.** [LIB-175] On the day of the event, switch to
    List. *Pass:* the same yellow line as the grid, with the time on it, sits
    between the rows — after a session that is running (its cards say *now*)
    and before the next one to start; after the last row once everything has
    started; nowhere on any other day. **Now** in the header scrolls to it;
    opening the schedule mid-event lands on it.
21. **R32 · Dark mode catches up.** [LIB-176] Theme on *System*. Put the app in the
    background (another tab, or the phone's home screen), flip the OS to
    dark, come back. *Pass:* the page is dark the moment it is on screen,
    with the profile menu closed. Also try the browser's Back into the app.
22. **R33 · Leave without saving.** [LIB-177] Manage Event → Settings, change the name,
    then click another tab. *Pass:* a dialog asks *Leave without saving?*;
    **Cancel** keeps you and your edit; **Leave without saving** switches tab
    and, back on Settings, the name is the saved one. The same for a
    **Find a setting** result on another tab, and for **← Schedule**. Press
    **Save settings** and switch tab: no dialog. A reload with an edit
    pending gets the browser's own warning. The browser's Back button does
    not ask — known, not covered.
23. **R34 · A mention in a description.** [LIB-178] Add or edit a session, type `@` in
    **Description**. *Pass:* the same menu as the comment box; pick a name;
    save. On the session panel the name is a link that opens the profile
    without a page reload; a `@name` inside backticks stays plain. The named
    person's bell rings once, the entry says *X mentioned you in “Title”*
    and opens the session; edit the description keeping the name and it
    does **not** ring again; add a second name and only that person hears.
    Placing a repeat with a mention rings once, not once per day. Then your
    **profile → Bio**: the same menu; on the profile the name links; the
    named person's entry reads *ada mentioned you in their bio* and opens
    that profile.
24. **R35 · The time box knows its hour from its minutes.** [LIB-179] Any time field.
    *Empty:* type `0` `7` `2` `5` — the box reads `0`, `07:`, `07:2`,
    `07:25` and nothing else. *Already filled:* click on the hour — it
    highlights; type `0` `9` — the box reads `09:` with the old minutes still
    there, now highlighted; type `2` `5` — `09:25`. Click on the minutes and
    type `4` `5` — only the minutes change. Click at the very end of a full
    time and type `0` `0` `0` `0` — the minutes read `00`, nothing left over.
    Backspace over the colon takes the hour digit with it. Up/Down with the
    caret in the hour steps the hour; in the minutes, five minutes. **Enter**
    settles the time and saves the dialog, as from any other field. On a
    **phone**: tap the hour or the minutes and the numeric keyboard types
    over it. (Branch `fix/time-box-caret`, after your 2026-09-07 report:
    `0725` "sometimes turning into 07:23", four zeros after `11:10` leaving a
    stray `0`, Enter doing nothing. The first was the old mask seeing five
    digits go into four places whenever you typed into a time that was
    already there. The fix is a box that knows which segment the caret is in
    — `lib/timeBox.ts`, typed into key by key in `tests/timeBox.test.ts`, in
    a real DOM in `tests/timeField.test.tsx`, and driven through the
    container's headless Chromium before it was committed.)

25. **R36 · The login page has a way out.** [LIB-180] Open an event link logged out, so the
    password card shows. *Pass:* above the card, the LibreSesh mark on the
    left and **All events** on the right; the mark opens `/`, the link opens
    `/events`; in **both themes** and on a **phone** the header fits the
    card's width.

26. **R37 · The audit log links.** [LIB-181] Manage Event → Audit, on an event with
    some history. *Pass:* an actor's name opens their profile; a session's
    title opens the session, and a deleted session's title opens **Trash**
    (hover: *Open in Trash*); a deleted note also opens Trash, a live one
    the session it sits on; a pitch opens the board; a room or tag opens the
    Programme tab. Links are quiet at rest (a faint underline) and plain
    under the pointer. Open a folded batch (*Show all N*): each member's
    title links too. A line about something the server can no longer find
    stays plain text.

### Decisions I need from you

_`D<n>` ids only ever increment: a settled decision keeps its number for good,
none is ever reused or renumbered, and a new one takes the next free number
(highest used: D5). Documents are named after the decision they carry, so a
reused number would repoint a filename and every link to it. Rule recorded in
`.claude/CUSTOM.md`._

- **D1 · Purge the local dangling git objects?** [LIB-99] The accidental Valley-export
  commit never left this machine (verified across every ref, both worktrees,
  stashes and the object store); it lingers only in this clone's reflog for
  ~90 days. On your word I run
  `git reflog expire --expire-unreachable=now --all && git gc --prune=now` —
  irreversible, drops *all* unreachable objects, none of value today. Separately:
  `_planning/valley-2026-09-02.json` and its `.import.json` twin are gone from
  disk (`export-to-import.py` remains); if that wasn't deliberate, an editor
  buffer may be the last copy.
- **D2 · The pitch board's server guard.** [LIB-100] You said deactivation is "a simple
  hide from UI and route". I went one step further: `POST /proposals` returns
  403 while the board is off, because hiding a form does not stop a tab that was
  open before the switch. Everything else on the board — reading, interest,
  placing what is already there — is untouched. Keep the guard, or drop it?

*Resolved and removed:* **push `dev`** (it is pushed — `origin/dev` matches, and
its reflog shows a push after each commit) and **start forms Phase 2** (phases
0–3 landed 2026-09-04; 4–6 were overtaken by the Base UI migration, and what
they left behind landed 2026-09-05 as R26).

- **D4 · Per-device sign-in, decided — build behind D3.** [LIB-103] Settled
  2026-09-09. Approach **B**: one random token per device, issued at
  redemption, stored hashed in a `devices` table (identity, hashed token,
  origin `login page|phrase|code|link`, first seen, last seen), the cookie carrying
  the device token, revocation per device. This is what lets "revoke the
  speaker code" evict the devices it let in, and an organiser sign out one
  device without the others. Rejected: A (rotate the token, evicting every
  other device at once) as too blunt; C (a device id plus a block list) as B's
  plumbing without B's list. **No IP address or geolocation, ever** — comparing
  login locations is unreliable (a venue is one NAT, a VPN is anywhere) and
  turns a scheduling tool into a tracker; the model-free signal that a takeover
  happened is the redemption itself. Who sees it: everyone their own devices,
  organisers a device *count* and sign-out on a profile — no browser strings on
  show. Its own branch, a migration on identity, so it follows the token
  hashing in D3. Device *counting* needs no fingerprinting: a redemption is an
  audited event, so "how many devices joined this account" is already exact;
  telling them *apart* is what B adds.

- **D5 · Should a speaker code keep working after its first use?** [LIB-102] Today it
  does: the code, and the link that carries it, redeem any number of times
  until an organiser revokes or replaces it (measured 2026-09-08 — one link
  opened from three fresh browser contexts made all three the same speaker).
  That was chosen so one code covers a speaker's phone and laptop, but it
  makes the link a standing credential: forwarded, photographed or left in a
  mailbox, it signs in whoever has it, indefinitely, and revoking does not
  evict devices already in. You said (2026-09-08) multi-use is not
  necessarily the right future. The alternatives, cheapest first:
  - (a) **single-use** — one condition in the redemption query; the code
    burns on first redemption like a device phrase does. A second device is
    then added by the speaker from their menu (**Link another device**, a
    three-word phrase that lives ten minutes), which already works and needs
    no organiser. Cost: an organiser who opens the link to check it consumes
    it, so the "switch or stay" prompt must become "this will use it up".
  - (b) **single-use plus expiry** — the same, and the code dies unused
    after a window (say seven days), so a forgotten email is not a live
    key. Cost: a re-mint for late arrivals.
  - (c) **multi-use with a device ceiling** — needs the per-device tokens
    of D4 to count anything; not available before D4 lands.
  - (d) **keep multi-use**, and document it as the accepted risk it already
    is in SECURITY.md.
  I recommend **(b)**, with (a) as the fallback if a window feels like
  friction. Either way, two things found while measuring should go in the
  same change: the login page shows *"revoked or replaced"* for a rate-limited
  attempt too (four wrong codes from one address, then the correct link is
  refused for fifteen minutes with the wrong reason), and the server's own
  message still says codes "work once and expire after 10 minutes", which
  was never true of a speaker code.

- **R39 · The event login's failure limits.** [LIB-101] D3 phase 2, merged
  into `dev` on 2026-09-10 and never seen in a browser. Get an event password
  wrong six times: the sixth answer should name a two-minute wait, and five
  wrong ones after that a fifteen-minute one. A correct password clears the
  count. On Manage Event → Audit, an organiser whose event is being guessed at
  sees a notice with a button that clears the failures. Check New event and
  Settings in the same pass: the password fields now lead with the generated
  phrase and carry the advice that replaced the withdrawn policy.

## Blockers

_None — what's outstanding is your review and decisions above. Nothing is
waiting on anything external._

---

# Backlog

_The only queue of future work, priority-ordered. Top High-Priority item = next up._

## High Priority

- **Lockdown, deferred out of D3 on 2026-09-09.** [LIB-188] Designed in full
  as §4 of the D3 spec and phases 3 and 5 of its plan; not being built now.
  The principle: any admin may freeze an event, and only the instance
  password lifts it, which closes today's hole where anyone holding the admin
  password can undo an archive. Wants migration `018_lockdown.sql` (three
  columns), `requireWritable` refusing `409 locked`, a freeze and lift route
  pair, the red band and a Security section in Settings; the second cut adds
  a `LOCKDOWN=1` env switch, a `.lockdown` file beside the database and
  **Evict everyone**. Nothing in the three approved phases depends on it.

- **Account notices, and account history on the profile.** [LIB-104] Endorsed
  2026-09-09; buildable now, needs none of D4's model change. Two parts.
  (1) **Notify the person** whenever someone becomes them or their profile
  moves under them, intended or not: a device signed in via speaker code,
  speaker link or device phrase; a profile merged into theirs or theirs into
  another; a claim approved or declined; a role changed (the live frame
  already moves the state — this keeps the record). New notification kinds on
  the existing per-identity inbox (`notifications.ts`, migration 020); the
  redemption notice is the smallest, highest-value first commit, since it is
  the earliest possible takeover warning and costs nothing in privacy. Each
  new kind gets a mute toggle and a bell test, per the silence rules the
  suite already pins. (2) **Account history on the profile, organisers only:**
  the audit already records code mint/revoke, phrase mint, redemption,
  redemption-failed, role set, claim request/approve/decline and merge — so
  this is a query over existing rows plus one missing detail (the redemption
  row carries no event and does not name which code adopted the device). The
  device *count* shown here is exact today; the per-device list and sign-out
  are D4.

- **Finer permissions** [LIB-105] (your words, 2026-09-08: "there should maybe be a
  few more granular permissions"). First, what is already true, because it
  was not what you thought: a speaker credited on an official session — a
  keynote an organiser typed their name onto — **can edit its words** today,
  whatever role they entered with, as long as their profile is linked to
  them (claimed, or entered through a speaker code or link). What they
  cannot do is move it or delete it. `tests/sessionSpeakers.test.ts` pins
  all three. If a speaker you watched could not edit, the profile was not
  theirs yet — that is the claim flow, not the matrix. Candidates for new
  switches, each one line in `capabilities.ts` plus a server check and a
  client predicate, with the parity test walking them for free:
  - **session.edit_credited** — make the "credited = may edit" rule a
    switch rather than a constant, for events that want official copy
    frozen.
  - **session.move_credited** — let a credited speaker reslot their own
    official talk (room, time), today organiser-only.
  - **contribution.edit_own** — edit a note after posting; today the only
    edit is delete-and-repost.
  - **proposal.moderate** — withdraw anyone's pitch, today organiser-only
    and not switchable.
  - **person.edit_credited** — let a speaker fix the bio of a co-host they
    share a session with.
  Not proposed: switches on rooms, tags, settings, trash, roles — those are
  what administering an event *is*, and the matrix's own comment says so.
  Phase 4 of `_planning/plans/2026-09-08-permission-integrity.md`; phases
  1–3 are in CHANGELOG, so each new switch is one line in
  `capabilities.ts`, a server check, a client predicate, and a row in each
  of the two sweeps.

- **Fixes from your review** (2026-09-07, from the review sheet — each is a
  bug you saw in a real browser, so they go before anything reasoned). One
  commit each; when one lands, its line leaves here and the CHANGELOG gets
  it.
  - **R24 · Find a setting only rings some settings, and knows too few.** [LIB-95]
    Your words: *"The picking and finding with yellow ring only works for
    some items. Also, not enough settings are indexed."* Two faults in
    `lib/adminSearch.ts` and the scroll-and-ring hand-off: the index is
    missing settings, and for some of the ones it has, picking the result
    does not reach the field. Likely the fields whose `id` the index names
    are not the ones rendered, or sit inside a tab section that mounts
    lazily — check each index entry against a real element.
  - **R27 · The `@` menu does not narrow as you type, and drops the phone
    keyboard.** [LIB-96] Your words: *"It's not as narrow as you type. Also keyboard
    doesn't stay up on phone!"* In `MentionTextArea.tsx`: the filter is not
    applied (or is applied to the wrong query — `findMentionQuery` vs. what
    is rendered), and a tap on a row blurs the textarea before the insert —
    the row needs `onPointerDown` + `preventDefault`, or focus restored
    after the insert.
  - **R30a · The format beside the title wraps too early.** [LIB-97] Your words:
    *"Format is shown but line breaks too early, there is space left."* The
    format chip beside the title breaks onto its own line while the title
    row still has room — a `flex-wrap`/`min-width` interaction on the title
    row (2026-09-05, tags change).
  - **R30b · No invite link for a speaker code.** Your words: *"Invite link
    for speaker code or otherwise is missing."* **Done 2026-09-07** on
    `feat/speaker-link`: the login page has an *I have a speaker code* door, and the
    profile page shows the code as a link (`/e/:slug#c=<phrase>`) and a QR
    that signs the opening device in as the speaker. ARCHITECTURE §One
    person, many devices.

- **Hash identity and calendar tokens at rest.** [LIB-112] From your security question
  (2026-09-05): a copy of the database — a backup, a volume snapshot, a
  screenshot of a `SELECT` — should not be a sign-in credential. The tokens
  are random (~131 bits), so a plain `SHA-256` at rest is enough: cookie and
  feed URL keep carrying the plaintext, the server hashes on lookup. Migration
  018 hashes `identities.token` and `ics_token` in place, which keeps every
  existing cookie working and every old backup restorable. `identity.ts` and
  `agenda.ts:78` change; the backup warning and the threat-model row get
  weaker in the good sense. It does **not** protect anyone from the running
  server — see SECURITY.md, *The running server can act as any
  user* — and the file still needs encrypting for the names in it and the
  crackable speaker-code hashes. Its own branch: it is a migration on identity.

- **Search cannot find a person.** [LIB-106] Phases 2–4 of
  `_planning/specs/search.md`, which is written and settled — phase 1
  (event-wide filters and the "Search everywhere" hand-off) shipped
  2026-09-04. `@ada` resolves in a comment and a speaker's name opens a
  profile, so the app knows who people are, but typing a name into the
  search box searches the *credits* on sessions: it finds their sessions
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

- **The format exists; three places still do not use it.** [LIB-107, LIB-108, LIB-109] Landed 2026-09-02
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

- **Mentions in pitches.** [LIB-110] Delivery landed 2026-09-05 (the bell, R29);
  descriptions and bios followed on 2026-09-07 (`fix/review-round-2`, R34):
  `renderMarkdown` takes the event's names and links a mention in the
  rendered prose (`linkMentionsInHtml`, skipping code and links), the
  description and bio boxes are `MentionTextArea`s, and `notifyMentionsIn`
  tells a newly named person once, for a `session` or a `person` subject.
  What is left is the same three steps for a pitch (`ProposalBoard`,
  `ProposalModal`, `routes/proposals.ts`): the `people` list where it
  renders, the composer, and a notify call on its write route with a
  `proposal` subject — which the bell already knows how to open. And
  resolution is still by username only, so a mention of an unclaimed profile
  — a name typed onto a session before that person arrives — has no inbox to
  wait in; deliver on adoption (`adoptProfile` in `people.ts`) when this is
  picked up.

- **A production event export is sitting untracked in a directory git will
  happily commit.** [LIB-111] Noticed 2026-09-02 when a `git add -A` swept
  `_planning/valley-2026-09-02.json` (72 KB, 2447 lines), its `.import.json`
  twin and `export-to-import.py` into a commit; they were taken back out
  before it was pushed, but nothing stops it happening again. `.gitignore`
  covers only `_planning/transcripts-backup/` and
  `docs/hosting.md`, so every other working file there is
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

- **The permissions matrix still flicks on a switch.** [LIB-113] Reported 2026-08-31
  together with the grid's drop flicker. The grid half is **found and fixed**
  (2026-09-05, `91a497e`, CHANGELOG `[Unreleased]` → Fixed, R28): the hold
  was never handed the save to wait for, so it let go on the next tick — the
  lane re-layout this entry used to suspect was not it. The matrix half is
  untouched and still needs eyes on a real browser: neither the container nor
  the suite has a DOM, so the paint itself is untested.

  For the permissions matrix there is no remaining suspect on file. The
  optimistic overlay does move the switch on click, so if it still flicks, the
  next thing to establish is _which_ of the three states is wrong and when —
  note that `busy !== null` disables every switch in the table during a save,
  and a disabled `Toggle` restyles, which is a visible change that is not a
  revert and could easily read as one.

- **Pitch board.** [LIB-114, LIB-115] Showing the creator is done — a card reads "pitched by
  {name}" (`ProposalBoard.tsx:332`). What is left is defaulting the creator as
  host (a new pitch starts with an empty speaker field,
  `ProposalModal.tsx:42`) and splitting the board into hot/new. The plan that
  carried these was retired on 2026-09-04; its
  up/down-vote assumption is **withdrawn** (decided 2026-08-31): interest stays
  one-way, so no `proposal_votes` table, no migration, and `interestCount`
  keeps its name and its meaning in `EventExport`. The button already wears an
  up-arrow rather than a star, which was only ever about the glyph colliding
  with "on my agenda".

- **Instance-level audit rows have no screen — and no pruning.** [LIB-116] A
  whole-database backup, an event created from the landing page, or any
  device-link mint/redeem/failure carries no `event_id`, so those rows are
  invisible in Manage Event → Audit, which is per-event by design. They are the
  instance owner's business and there is no instance admin page to put them on.
  Noticed 2026-08-31: `pruneAudit` deletes by `event_id`, so these rows also
  grow without limit — slowly (they are all rare actions), but forever.

- **The importer still only creates an event, and is still curl-only.** [LIB-117, LIB-118, LIB-119, LIB-120]
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

- **Compact button overrides do nothing.** [LIB-121] `SecondaryButton className="py-1"`
  and the `py-1.5` variants in DetailSheet, ProfilePage, ProposalBoard and
  AdminPermissions are dead: Tailwind emits `.py-1` and `.py-1.5` _before_ the
  primitives' `.py-2.5`, so the base always wins and those buttons are full
  height. Verified in the built CSS on 2026-08-31. Predates the button-height
  fix — that change kept the situation identical rather than creating it. Wants
  either a real `size` prop on the button primitives or `tailwind-merge`; a
  call site cannot win this with a class name.

- **Profile and identity data-model items** [LIB-122, LIB-123, LIB-185] live in
  `_planning/profile-and-identity-todo.md` (split out 2026-09-09 at your
  request): the login page not suggesting device linking to a merged-out device,
  and the new one — a lost account cannot be merged back under its old
  username, because the username is held by the signed-out identity and the
  rename is refused. Design agreed 2026-09-09 in
  `_planning/specs/account-recovery-merge-and-link.md`: the merge absorbs
  the losing identity and redirects its device, rotating the survivor's
  token by default.

- **No write path under flaky connectivity.** [LIB-124] Reads recover well — `EventSource`
  auto-reconnects and `useEventData` refetches the whole bundle on reopen, and
  the header shows "reconnecting…". Writes do not: every mutation is a bare
  `fetch` with no queue or retry, so a star/note/edit attempted while offline
  fails with a toast and is lost. There is also no service worker, so a cold
  load with no connectivity renders nothing. Full offline editing is an explicit
  v1 non-goal (SPEC §Non-goals — no CRDT), but a small outbox that retries
  queued writes on reconnect would cover the hallway-wifi case without one.

- **Dependency bumps — phases 0–3 done, 4–6 open.** [LIB-125] Plan and reasoning in
  `_planning/plans/2026-09-05-dependency-bumps.md`. `npm audit` went **10 → 2**:
  the vitest critical, the vite high and the esbuild/qs moderates are cleared,
  by the versions that actually fix them rather than by `latest`. What is left:
  - **Phase 4 — `react` + `react-dom` 18 → 19 ✅ done 2026-09-07** on
    `chore/react-19`, behind a DOM smoke suite (`tests/routes.test.tsx`)
    that mounts every route against the real server and fails on any
    console.error. Two type edits, no runtime change, 1249 green. Still
    wants a browser pass over the R-items below for what jsdom cannot show
    (layout, drag, the time box) — and that pass exists now:
    `npm run browser-pass` (`scripts/browserPass.ts`) boots the built app
    and drives it through `/usr/bin/chromium`, which is in the dev container
    image since the 2026-09-07 rebuild (`.devcontainer/` is gitignored, so
    that line travels with the host, not the repo). First run under React 19:
    fourteen steps green, console and network clean. Drag is still unpassed.
  - **Phase 5 — server majors**, in order: zod, express, marked, bcryptjs,
    better-sqlite3. Each one needs `npm run rebuild:native` after, because
    `.npmrc` sets `ignore-scripts=true` and any install leaves better-sqlite3
    without its binding (553 tests fail with "Could not locate the bindings
    file" until you do).
  - **Phase 6 — vite 6 → 7/8 and vitest 3 → 4/5.** The Node alignment they were
    blocked on is done: production is on `node:22-bookworm-slim`, `engines` is
    `>=22.13` and `@types/node` is 22.x. No advisory is behind either bump now,
    so they can wait behind Phase 4.
- **Cloning still demands all three passwords.** [LIB-126] Creating an event lets you
  leave any of them blank — a four-word phrase is generated and shown once on
  a confirmation screen — but `POST /events/:slug/clone` kept the old
  all-required schema. Deliberate for now: the clone UI has nowhere to reveal
  a generated secret, and an organiser who never sees one cannot hand it out.
  Wants the same reveal screen, then `resolveEventPasswords` wired into the
  clone route so the two creation paths stop disagreeing.

- **Manual browser pass — now with a specific backlog.** [LIB-183] Automated coverage is
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
  - the login page's **"Nobody can get in as organiser"** panel: it is the only
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
  - the login page's **"Enter as Ada 2"** link, which is only reachable by taking a
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
    rendered code; that the login page then shows **Invited as …** with no password
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

- **Deploy paths, and what is actually proven.** [LIB-127] Railway builds from
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
  VPS deploy as their test. Railway notes: `docs/hosting.md` §10.
- **No component test coverage, and no error boundary.** [LIB-128] 703 tests as of
  2026-09-01, and the web-side ones cover pure functions or assert on source
  text (`format.test.ts`, `numberField.test.ts`, `gridChrome.test.ts`) — there is no jsdom/testing-library stack, so nothing renders a
  component. The drag maths, the SSE reducer and the clash detection are the
  parts most likely to regress silently, and the Calendar column refactor on
  2026-08-30 went in on a read-through alone. The build-stamp crash the same
  day — a component that threw on every render, blanking the page, while the
  whole suite stayed green — is what the gap costs. A React error boundary
  would have contained it; there is still none.

- **`X-Forwarded-For` is unguarded, and the login limits now depend on it.**
  [LIB-129] With `TRUST_PROXY=1` the app reads the address from the header, so
  an instance also reachable off-proxy lets a caller write their own address.
  That was a limit-evasion problem before D3 phase 2 and is a denial-of-service
  one after it: a forged address escapes the per-address wait, and forging ten
  distinct ones trips the per-event closure that stops an event admitting
  anybody. `SECURITY.md:148` and the `deploy.md` env table say to set
  `TRUST_PROXY=1` behind a proxy; neither says the app must then be
  unreachable except through it. Documentation first, since that is the actual
  control; a hop count or a trusted-proxy list is the code answer if a
  deployment ever needs one.


- **27 React Compiler findings, surfaced by eslint-plugin-react-hooks 7.** [LIB-130]
  The flat-config migration brought fourteen new rules with it. Eleven pass and
  are on. Three are switched off in `eslint.config.js`, named, because they flag
  existing code: `react-hooks/refs` (13 sites — reading a ref during render),
  `react-hooks/set-state-in-effect` (13 — `setState` called synchronously in an
  effect, which costs a second render pass), and
  `react-hooks/preserve-manual-memoization` (1, `ProfilePage.tsx:111`). The
  clusters are worth reading together rather than file by file: the `refs` ones
  are mostly popover/listbox measurement, the `set-state-in-effect` ones mostly
  "derive state from props" that wants to be computed during render instead.
  Each rule turned back on is its own commit.

## Medium Priority

- **Day navigation on a phone.** [LIB-189] Raised 2026-09-09. The week rail
  sits above the day strip as a line of chips of its own
  (`SchedulePage.tsx:1179`), and on a phone those two rows are most of what
  stands between the event bar and the day's first session. Collapse it into a
  `W2 ▾` dropdown at the head of the strip, carrying the range label, session
  count and today-dot the chips carry now; the strip gives up about a day of
  width and the page gets a row back. Only above `weekRailFrom` (default 8
  days). Two smaller faults in the same chunking to take with it: a
  Sunday-start event splits every weekend, because the boundaries fall every
  seven days from day one; and a tail chunk can be a single day (15 days
  → 7 / 7 / 1), so "Week 3" labels one date. A configurable week start is
  explicitly *not* wanted — chunking from the start date already gives the
  fewest chips possible, and calendar alignment is what would turn a Wednesday
  fortnight into three of them.

  The day strip wants the rail's arrows as well: it is a bare
  `overflow-x-auto no-scrollbar` box, so the hidden scrollbar leaves nothing
  saying the line goes on — the very gap `Rail` was written to close for the
  weeks, and it matters more once the strip is the only day navigation left.
  `Rail` does not drop straight in: its fade is hardcoded to the page's ground
  (`stone-50`) and the strip's is `white`, its arrows would sit on the strip's
  border and past its radius, and it has to shrink or the view toggle wraps to
  the second line this item exists to save.

- **An attendee's action row is a whole line holding one `+`.** [LIB-190] Raised
  2026-09-09. Manage / Arrange / Add sit in a `basis-full` block
  (`SchedulePage.tsx:1420`) so the organiser's three buttons take their own
  line below `sm` — sound for an organiser, except Manage and Arrange are both
  admin-only, so an attendee gets a full-width row holding one right-aligned
  `+` hanging under the Now button. It is the wrong neighbour too: `+` and
  **Pitch a session** are the two ways an attendee puts a session into the
  world, and they sit a row apart. Move the `+` beside Pitch for anyone who is
  not an organiser, minding the event that has the board switched off and the
  attendee with no open-booking room.

- **"Propose" and "Pitch" are the same word for two different acts.** [LIB-191]
  Raised 2026-09-09. `SessionModal` heads itself *Propose a session* for a
  non-organiser while the board beside it says *Pitch a session* — synonyms,
  offered a few taps apart, for two genuinely different things. Worse, nothing
  is proposed: `canCreateSession` wants `session.create_open` and a room with
  `openBooking`, and with those the session lands on the grid unreviewed, so
  the word promises an approval step the code does not have. *Pitch* was chosen
  deliberately for the board and stays; *propose* is the one to retire. The
  open question is how far the rename travels — the route is `/proposals`, the
  components are `Proposal*` and the capability is `proposal.create`, while the
  setting is `pitchesEnabled`.

- **Inline create inside `SpeakerCombobox`.** [LIB-131] The other half of the affordance
  that landed on 2026-09-04 (`InlineCreate` in `ui.tsx`, used by the tag, track,
  format and expected-person rows): typing a name the event does not know into
  the speaker field should offer to create that person there, rather than
  sending the organiser to the People tab and back. Same control, harder host —
  the combobox already has a listbox, a create-a-person row and the
  `onlySelf`/`isAdmin`/archived rules to respect.

- **A real date/time picker for the session modal.** [LIB-132] The native
  `<input type="date">`/`<input type="time">` are the last controls not wearing
  the app's own field styling, and the browser's popup cannot be themed — the
  same complaint that moved every `<select>` to Base UI. Deferred out of the
  shadcn/Base UI migration on 2026-09-04 because the right control depends on
  a decision nobody has made: a one-day unconference wants a time picker and
  no calendar at all, while a fortnight-long event wants a month grid. A real
  calendar means `react-day-picker` (~12 kB gz) on top of Base UI, which is a
  bundle question as much as a design one. Decide the shape first, then build.

- **A calendar token is minted once and can never be revoked.** [LIB-187]
  Noticed 2026-09-09. `POST /calendar-token` writes 24 random bytes into
  `identities.ics_token` the first time somebody subscribes a calendar app and
  returns the same value forever; the feed route looks the identity up by it
  and serves the schedule as long as that identity still holds a role. No
  route nulls the column and nothing offers to, so a URL pasted into a shared
  team calendar keeps working indefinitely — and because the token sits on the
  identity rather than the event, one leaked link reads every event that
  person can see. Wants a *Reset my calendar link* action first (one route,
  one button); scoping the token per event is the larger fix. Hashing it at
  rest (D3 §5) protects a stolen backup and does nothing about a leaked URL.

- **Publishing a session: a link that works without the login page.** [LIB-133] A published
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

- **Linked sessions: auto-detect matches instead of an always-on link.** [LIB-134] Today
  the session editor shows "Link matching sessions…" on every saved session,
  even when the actor has no other same-titled session — a click that dead-ends
  on "no matches". Detect matches up front (the `link-candidates` query already
  finds them) and only surface the affordance when there is something to link,
  ideally as a nudge ("You run 'Morning Yoga' on 3 other days — link them?").
  Deferred out of the first cut on 2026-09-03; the controls now live in the
  When-and-where group's **Series** field. Follow-ups from the same review:
  tz-aware time-of-day propagation, and `series_id` on export/import.

### Forms

_A group, so form work is not scattered through the priorities._

- **The same pass over every other form on the site.** [LIB-135] This is the first of
  them, not the only one — sessions, rooms, tracks, tags, formats, breaks and
  the event settings all have forms that have grown by addition. Worth doing
  as one considered sweep once the pattern above has been used in anger:
  what is a button and what is a field standing open, where the hint goes,
  what a form looks like at rest. Not yet specified — this is the placeholder
  that stops it being rediscovered from scratch.

- **Two judgement calls from 2026-09-02 that nobody has pushed back on yet.** [LIB-136, LIB-137]
  Both were made deliberately and flagged; neither is a bug, and either could
  reasonably be reversed once the screens have been used.

  - **A credited `viewer` may edit the session they are credited on.**
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

- **Goal: one database per event, and identity that lives inside the event.** [LIB-138]
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

- **Put the last two popdowns on `usePopover`.** [LIB-139] `ProfileMenu` and
  `SpeakerCombobox` still position themselves and still carry their own
  outside-click/Escape effects. Neither can overhang today — one is `right-0
w-48`, the other `w-full` — so they are exempted by name in
  `tests/popoverOverflow.test.ts`, which also asserts the reason still holds.
  Moving them over would delete the last two copies of the dismiss effect and
  let that allowlist go away.

- **Revisit what Floating UI costs the first paint.** [LIB-140] Adopting
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
  code-split — one chunk carries the admin pages, the calendar and the login page
  alike, and a route-level `React.lazy` on the admin section would likely dwarf
  18 kB. Check that first; the popover dep may not be the thing worth cutting.

- **A track window cannot close a day.** [LIB-141] Noted 2026-09-01 when track hours
  landed. An override row is a window and a window must end after it starts, so
  "the workshops track does not run on the last day" cannot be said — the
  nearest thing is a one-minute window nobody can book, which is a trick rather
  than a statement. The fix is a `closed` flag on `track_windows` that the
  resolver reads before the times, plus a checkbox on the per-day row. Wait for
  someone to actually want it: a track that skips a day is often better said by
  not scheduling anything on it.

- **Strip the `Claude-Session:` links out of the git history.** [LIB-142] Every commit
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

- **A track that closes at midnight reads as `18:00–00:00`.** [LIB-143] Found 2026-09-01
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

- **The People list cannot put somebody out of the event.** [LIB-144] Left undone
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
  back in through the login page with the password they still know — so it is a
  nudge, not a ban, and the UI should not imply otherwise. Wait until an
  organiser actually asks.

## Low Priority / Ideas

- **React 18 → 19, and react-router 6 → 7.** Deferred through the whole Base UI
  migration and never needed: Base UI supports React 18, so nothing was blocked
  on it. It stays worth doing eventually — 19 is where the ecosystem is heading
  and the router bump comes with it — but there is no pull for it now, and a
  major React bump on a working app is risk bought for nothing. Revisit when a
  dependency actually asks for it.

- **Show an organiser the old addresses an event still answers to.** [LIB-145] Renaming
  an event landed 2026-09-01 and every former slug goes on resolving, but
  nothing in the UI lists them — the only trail is the _renamed_ rows in the
  audit log. `formerSlugs` was written for this and then removed rather than
  left as dead code (`git show` the rename commit for the four lines). Worth it
  only if an organiser ever asks "which names are burned?"; the guarantee they
  actually care about — the old link still works — is already in the Slug
  field's hint.

- **A real series, and a root event other events inherit from.** [LIB-146] Deferred
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

- **Quadratic voting on pitches.** [LIB-147] Floated 2026-08-31 for a future instance,
  explicitly not for this one: it changes what a vote _is_ (a budget spent
  across pitches, not a click per pitch), so it wants its own schema and its
  own thinking rather than a column bolted onto `proposal_interest`.

- **A one-line reset for the local database.** [LIB-148] Wiping a dev instance is
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

- **Rename "seed" to "mock".** [LIB-149] Floated 2026-08-31. Worth knowing before
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

- **`HelpMenu` falls back with `??`, which only catches `undefined`.** [LIB-150] So an
  empty `VITE_BUILD_COMMIT` prints blank rather than `unknown`
  (`HelpMenu.tsx:26-27`); `||` fixes it. All that is left of the "About shows
  no commit" report from 2026-09-01 — the cause was a stale dev server, not
  the stamping, and a fresh one stamps correctly. Two characters.

- **Print / PDF grid.** [LIB-151] Unconferences put the grid on a wall. A print
  stylesheet would cover most of it.
- **Self-hosting a single event without being a sysadmin.** [LIB-186] Floated
  2026-09-09 out of the "what if the host is not trusted" question. A shared
  instance cannot offer that guarantee, because the host serves the
  JavaScript and could serve a build that takes the key; encrypting content
  client-side protects a stolen backup, not the operator, and costs the
  server-side search, filters, mentions, calendar feed and the permission
  matrix as a real boundary. The honest answer is that the event runs its own
  instance, which makes this packaging rather than cryptography: one command
  to stand up, a generated and persisted `COOKIE_SECRET`, backup and restore
  a non-expert can perform, an upgrade that is not a terminal session, and
  docs for someone who has never used Docker. `deploy/` has all the pieces
  and none has been run end to end — that is the deploy-coverage item above,
  and it comes first.

- **Restore for rooms and tags.** [LIB-152] `/trash` covers sessions and contributions,
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
  invite codes (CHANGELOG `[0.3.0]`, ARCHITECTURE §Invite QR codes), so
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
