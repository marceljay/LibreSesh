# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- **Import from a file, and give the event a new address.** The import page
  took a paste, with a file link in small print. Now there is a **Choose a JSON
  file** button, the box takes a dropped file, and the name and size of what
  was loaded are shown. Under the box an **Address** field overrides the
  document's `slug` — the edit every restored export needs, since its own
  address is taken on the instance it came from — without opening the file.
  Changing the address withdraws a rehearsal the same way editing the document
  does, so what you approve is always what you send.

- **Choose what an export carries.** The event export was all or nothing — a
  speaker list for a website, a programme to move elsewhere and a co-organiser's
  copy all came with every profile, pitch and comment. Manage Event → Backup now
  has four checkboxes: **Sessions**, **People**, **Pitches**, **Contributions**.
  The event's settings, rooms, tracks, tags, formats and breaks are always in
  the file; a part left out is absent from it rather than empty, so a reader can
  tell "none" from "not exported". From the command line it is
  `?include=sessions,people` on `export.json`; a plain GET is still everything.

- **A repeat is one line in the audit log, not fourteen.** Placing a session
  across a fortnight wrote fourteen entries, and an edit applied to a series
  wrote one per occurrence — enough to bury the rest of the morning's history,
  and enough for a single long run to push earlier actions past the retention
  cap on its own. A bulk action now reads as one line — *created 7 sessions
  "Morning yoga"* — that opens to show every session, each with its own id and
  time. Nothing is hidden: the rows are all still there, and the filter box
  finds a folded one by its id. Applies to placing a repeat, editing a series,
  and linking or unlinking a run.

- **The pitch board is now optional, and its button says what it does.** On an
  event with a fixed programme the board was a link in the header to a page that
  stayed empty all week. Manage Event → Settings has a **Pitch board** switch;
  turn it off and the button, the page and the pitch form all go. It is a hide,
  never a delete — the pitches, their interest and anything already placed from
  them stay exactly where they are, and come back untouched if you turn it back
  on. On by default, and a duplicate of an event keeps whichever way it was set.

  The button itself is **Pitch a session** rather than "Pitches": it says what
  you can do there, which is what somebody who has never been to an unconference
  needs to read. On a phone, where that row is already full, a lightbulb carries
  it.

- **Find a setting without knowing which tab it is on.** Manage Event is seven
  tabs of unrelated jobs, so knowing what you want to change told you nothing
  about where it was. There is a **Find a setting** box above the tabs now:
  type what you are after — including the words you would actually use, so
  "retention" finds the audit cap and "qr" finds the invite links — and picking a
  result switches to the right tab, scrolls to the field and rings it.

- **Search everywhere — the filters stop being about one day.** A tag, a room, a
  track, ★ my agenda and the filter box all narrowed *the day on screen*, so
  "show me everything tagged design" meant setting the tag and then walking the
  day strip, re-reading the same panel on each day. The filter panel now ends in
  **Search everywhere**, which takes the filters you have already chosen to the
  results page and applies them to the whole event, grouped by day. The page
  carries the same panel, so you can keep narrowing once you are there, and the
  whole question — query and chips — is in the URL, so it is a link you can send
  someone.

  One filter means something better off the day scope: **Now / next** on the
  grid can only mean a minute of the day being drawn, and on the results page it
  means *has not ended yet*, across dates. And the results page no longer drops
  your filters when you re-run the query.

- **An `@` menu in the comment box — pick a person instead of spelling them.**
  Typing `@` did nothing until the whole name was right, which asked people to
  know a username by heart and punished a typo with plain text. Now `@` opens a
  list of the event's people, filtered as you type; ↑/↓ moves, Enter or Tab
  picks, Escape dismisses that one menu, and a tap works on a phone. What it
  inserts is the directory's own spelling plus the space the parser needs, so a
  mention picked from the menu cannot fail to link. A surname finds the person
  ("@lovelace" → Ada Lovelace), a two-word name stays reachable after the space,
  and an email address still opens nothing.

- **Mentioning a person, first cut — names you can click, and `@username` that
  links.** A name in a comment used to be plain text, so the way to point at a
  co-host was to describe them. Now a comment's author links to their profile,
  and writing `@ada` in a comment links to Ada — the same profile a speaker's
  name on the session already opens. Matching is against the usernames the event
  actually holds (unique per event), case-insensitive and longest-match, so a
  multi-word username resolves and `a@b.com` stays an email. The parse is a
  shared tokenizer so a mention means the same thing everywhere it is written.
  **No notifications yet** — a mention links, it does not yet land anywhere that
  survives a closed tab. Spec and the delivery half:
  `_planning/specs/mentions-and-notifications.md`.

- **Linked sessions — keep a recurring session in step without locking it
  down.** A talk that runs every morning was placed one row per day, and those
  rows knew nothing about each other: renaming or re-rooming the run meant
  editing each day by hand. Attendees felt it most — someone offering morning
  yoga had no way to keep their copies together at all.

  You can now **link** same-named sessions into a series. The **Repeat** control
  places a session on several days at once and is no longer organisers-only —
  the attendee running morning yoga can lay down the whole week and keep it
  linked in one go (an attendee's run is held to the same per-day rules a single
  open session is). Or link after the fact: on a saved session, *Link matching
  sessions…* lists the other times you run it under that title (with select-all)
  and links the ones you tick.
  Editing a linked session then offers a reach — *this only*, *this and later*,
  or *all in the series* — and applies your change to the rest. The default
  stays this-session-only, and **time is never propagated**: each occurrence
  keeps its own slot, so moving one never moves the others. *Unlink this one*
  drops a session back out.

  Linking never grants edit rights you did not already have: the list only ever
  offers sessions that are yours, and a series edit skips — and tells you about
  — any occurrence that isn't ("applied to four of five"). Migration 017.

- **A session can say what kind of thing it is.** The app had one word for a
  session — `type`, meaning `official` or `open` — and that says who put it
  up, not what it is. So nothing anywhere distinguished a five-minute
  lightning slot from a three-hour hands-on workshop, and a reader had to
  infer it from the description and the height of the block.

  Sessions now carry a **format**: a talk, a workshop, a panel, a jam. It is
  the first control in the session form, above the title, because it is the
  first thing anyone asks about a session. It carries no length — what a
  session *is* and how long it runs are two different facts, and a workshop
  is a workshop at ninety minutes or at a whole afternoon. It shows as a
  coloured badge at the head of the session sheet, and it is named first
  there too: what the session is comes before who placed it.

  Formats are defined per event in Manage Event → Programme, beside rooms,
  tracks and tags, because an unconference invents them. Nothing is created
  by default; the section offers a dozen common ones — keynote, lightning
  talks, poster session, excursion — as one-click suggestions, and an event
  that runs none of them can type its own and never see the list again. An
  organiser who has defined none is told so in the session form rather than
  shown nothing, which was indistinguishable from the feature not existing.
  Deleting a format leaves its sessions where they are, without a kind.

  Its own table rather than a reserved tag: a session wears many tags and
  exactly one format, and a uniqueness rule the tag UI cannot express is a
  rule that gets broken. Clones carry formats over with the rooms and tags,
  the export carries them, and an import document declares them by name the
  way it already declares rooms and tracks. Migrations 014 and 015.

  The official/open control moved and was renamed in the same pass. It is
  **Placement** now — a second field called Type would have been
  indistinguishable from the format — and it sits at the top of the form
  beside it rather than at the bottom under Extras. Official is the default
  and the one choice that locks a session against whoever put it up; an
  organiser who never scrolled that far made everything official without
  ever being asked.

### Fixed

- **A phone's keyboard says what Enter will do.** At the gate the key reads
  *Go*, in the two search boxes *Search*, and when editing a name on a
  profile *Done* — rather than a return arrow that could mean anything. Only
  a label: the key did the right thing already, it just did not say so.

- **Adding a track, tag, format or expected person is announced.** The
  add-row stays open and clears itself after a save so the next one can be
  typed, which to a screen reader is indistinguishable from a save that was
  thrown away; the new row appears further up the page, where nothing is
  reading. A polite announcement now says *Lightning talks added*. A failed
  save is not announced twice: the message that reports it already is.

- **The "?" beside a session's placement and its hold-the-floor switch is
  big enough to tap.** It was 20 px across, under the 24 px that WCAG 2.2 sets
  as the floor for a touch target, and it sits in a row of chips with no
  room around it to make up the difference. Now 24 px; the glyph is the same
  size, so it still reads as a note rather than a button.

- **A screen reader hears which row the arrow keys are on.** The speaker
  field, the schedule search and the *Find a setting* box each showed a list
  under the box and let the arrows move a highlight through it, but only
  sighted people could tell where the highlight was: the box never named the
  row it was on. It does now, the way the ARIA combobox pattern asks, and
  the three lists share one keyboard handler instead of three that had
  quietly drifted apart at the ends of the list.

- **A password manager can save and fill the event password.** The gate's
  password box was a lone field with no form around it and no hint about
  what it was, so browsers and password managers never offered to remember
  it — every visit meant finding the password again. The password and the
  username are one real login form now, marked as such, so the manager
  offers to save on first entry and fills on the next. Enter works from
  either box, and arriving with the name empty says *Pick a username to
  enter* instead of doing nothing. The device-link phrase stays out of the
  manager: it is a one-time code, not a password to keep.

- **Enter submits an add-row from any field in it.** The new-room, new-break,
  invite-check and unlock rows were inputs and a button with no form around
  them, so Enter did whatever each field's own key handler said: it added the
  room from its name but not from its capacity, and made the QR from the
  password box but nowhere else. Every one of those rows is a real form now,
  with a real submit button — so Enter works from every field, a phone's
  keyboard labels the key, and a screen reader calls the button what it is.
  The browser's own validation bubbles are switched off on every form,
  including dialogs, so the app's sentence is the only one you see.
- **An event's own export imports back.** The importer's first field said it
  recognised `libresesh.event` and then refused every export carrying it — 103
  errors on a 96-session programme, starting with `breaks.0.start: Required`.
  The export and the import document were two formats under one name: ids and
  minutes on one side, room names and `HH:MM` on the other. An export is now
  translated at the door — ids to the names they stood for, minutes to `HH:MM`,
  `null` to an absent key — and imported as the programme it describes, so every
  export ever downloaded works, not only new ones. Give it a new address. The
  programme comes across whole (sessions now carry their `livestreams` through
  an import too); profiles, pitches, contributions and star counts do not, and
  the dry run's first warning says so. The round trip — export, import, export,
  compare — is a test now, which is what was missing.

- **The “everyone should be here” band sits straight.** The amber band a
  floor-holding session draws across the grid had its label pinned to the
  top-right corner, where it read as a caption for whichever block it landed on,
  and it was drawn 3px taller than the block inside it — so it showed a sliver of
  itself below the block and nothing above. The label is centred in the band now,
  and the band ends where its own session does.

- **The grid offers the next day, like the list does.** Reaching the bottom of
  a day in the calendar left you scrolling back up to the day strip to move on
  — which costs you your place in the day you were reading. The **Next day**
  button now sits under the last hour in the grid as well, and stays on the
  left of the screen on a grid too wide to see at once.

- **Changing the day lands on that day's first session.** The grid runs from
  the event's earliest hour to its latest — the edges of the whole event, not
  of any one day — so a day whose programme starts after lunch opened on a
  screenful of empty rows and read as an empty day until you scrolled. The day
  strip, the week rail and the Next day button at the end of a list now all
  open the day on its first session. An empty day, and the list, go to the top
  as before.

- **A short session on the grid no longer clips its own time.** Grid blocks
  carried enough vertical padding, plus a top margin on the tag dots, that a
  15–20 minute block spent its whole height on chrome and cut off the time row
  under it. The padding is tighter now and the tags sit near the top edge, so
  even the shortest block shows its time.

- **Starring a session moved its title, and a list card showed two stars.** On
  the grid, the star and the interest count sat in the row above the title, so
  starring a session pushed its title down a line — two identical blocks side
  by side read differently because of something that is not about either
  session. On a list card there were two stars for one fact: a ☆/★ toggle
  beside the title and a separate "★ 12" at the bottom, which reads as two
  different things about starring and leaves you working out which one is
  yours.

  Both surfaces now draw **one star and one number**, in the bottom-right
  corner. On the grid it is out of the flow entirely, so nothing above it moves
  when it appears, and it is a button that swallows the press that would
  otherwise drag the block — so a session goes on your agenda from the grid
  itself, which used to mean opening the sheet. On a list card the tally *is*
  the control, so the star you press and the count you read are one object.

- **The grid did not say which block the open sheet belonged to.** Opening a
  session left every block looking the same, so on a full day you lost track of
  which row the panel beside it was about. The open session now carries a ring,
  and the highlight overrides the filter-dim, so opening a session a filter had
  greyed out brings it back to full contrast instead of pointing at a ghost.

- **A break was labelled once, top-left, on a grid wide enough to hide it.** A
  band for lunch or dinner spans every column but named itself only at the
  left edge, so past two or three rooms the far side of the break had no marker
  and a session there looked to run through an unnamed gap. The label is
  repeated bottom-right when the grid is more than two columns wide and the
  band is tall enough (about half an hour) that the two cannot meet.

- **The session form's Placement row clipped on a phone.** Its two chips and
  the help "?" sat on a line that could not wrap, while the Attendance row
  right below it already did, so the tail of "Non-official: allow parallel
  sessions" ran off the edge and was cut — with an empty line beneath it. The
  row wraps now, like its sibling.

- **A speaker could not edit their own session.** An organiser schedules a talk
  and types the speaker's name onto it; that person arrives at the gate as an
  ordinary attendee — the role almost every speaker holds, since the speaker
  role is only handed out by a code somebody has to remember to send — and the
  session was read-only to them. Three separate rules had to agree before it
  worked, and none of them did:

  - the right to edit demanded the credits **and** the speaker role. Being
    credited is the qualification now, whatever role the person holds, for one
    of five co-hosts as much as for the only name, and on an official session
    as much as an open one — the official one is precisely the session an
    organiser typed their name onto;
  - editing was gated on the capability to *create* sessions, so an event that
    stops attendees adding their own — a curated conference, the ordinary case
    — also stopped its speakers fixing a typo in the talk it had scheduled for
    them;
  - and every placement check asked which fields the request carried rather
    than which had changed. The form posts the whole session on every save, so
    a speaker correcting a description was told only organisers can move
    official sessions, about a save that moved nothing.

  What has not changed: a speaker still cannot move an official session or
  delete it. The form now says so above the fields and disables them, rather
  than refusing after Save. The Delete button is no longer offered to someone
  who is credited on a session but did not create it.

### Changed

- **The whole-database backup says what it really holds.** The warning named
  the sign-in tokens and the code hashes. It now also names the calendar-feed
  tokens, which work against the live server as they are; the speaker-code
  hashes, which crack offline in minutes; and every name, bio, comment and
  who-starred-what on the instance — and it says to restore only onto a box at
  the same address with the same cookie secret, or everyone comes back a
  stranger.

- **The landing page stops looking like a toolbar and stops making offers it
  cannot keep.** Four things were wrong with the front door, and all four were
  the same mistake — the page borrowed the app's clothes. *New event* and
  *Import* were two link-coloured words in the footer: the least visible thing
  on the page, and an unqualified offer, since both routes want the
  **instance** password (the server owner's, not an event's), which almost
  nobody loading the page has. They are gone from the front door altogether.
  Explaining that password there was the tell — it defines, for every visitor,
  a thing almost none of them will ever meet, which is a question they did not
  ask. Both buttons already sit on `/events`, which is where whoever deployed
  the box is going anyway, and the one sentence that distinguishes the two
  passwords now sits under the list beside them.

  *Browse events* and *Self-host it* were the app's inline controls: 38px,
  `text-xs`, sized to line up beside a field in a toolbar. That restraint is
  right inside an event, where the schedule is the thing you look at, and wrong
  on the one page whose buttons *are* the content. The landing page owns its
  button sizing now — bigger box, softer corner, a real shadow, a hover that
  lifts (and does not, under `prefers-reduced-motion`).

  The page is also a screen shorter, and fits one without scrolling on a
  laptop: the block is gone, the vertical rhythm is tighter, and the preview
  shows three cards rather than four — a normal slot, an open one and the live
  one already say everything the picture is there to say.

  The board preview was being read as the running app and clicked at, because
  it is built from `ListView`'s own classes and so its cards, its star and its
  "anyone can claim this" pill *are* the real ones. It sits in a browser frame
  now — chrome around a thing is read as "here is that thing, pictured" before
  any caption is — with a deliberately fake host in the address bar, and with
  pointer events and text selection off inside it, which are the two ways a
  picture made of markup betrays itself.

  Finally, the source link wears GitHub's mark rather than spelling the word: a
  logo is recognised before it is read, and it is the paragraph's "open source"
  being made good. Reproduced as issued, taking `currentColor` so it inherits
  the link's hover and dark-mode colours.

- **Every form field now reads and focuses the same, and meets contrast.**
  The form layer was rebuilt on a small set of primitives so a text field, its
  label, its hint and its error, its border, height and focus ring all come
  from one place instead of a class string copied across ~90 call sites. What
  you can see: field borders are dark enough to meet the 3:1 contrast floor in
  both themes (they were below it), hint and label text meets 4.5:1, and
  focusing a field shows a single clean ring rather than a doubled "inner
  border". On a phone a field no longer zooms the page when you tap it. Buttons
  gained a keyboard focus ring. Native dropdowns (day, duration) match the text
  fields. No field changed what it does — this is a legibility and consistency
  pass.

- **Every dropdown is now the app's own, and the app loads in a quarter of the
  bytes.** The last controls that still looked like the browser rather than the
  app were the dropdowns: a native `<select>` cannot have its open menu styled
  at all, so "Room", "Track" and "Duration" dropped a grey system list over a
  carefully themed form. All of them — the session modal, the pitch board, the
  breaks editor, the admin pages — are now the same control, wearing the same
  border, height and focus ring as the field beside them. Dialogs went the same
  way: opening one now traps focus and hides the page behind it from screen
  readers, which the hand-rolled version never did.

  The library that makes this possible costs about 44 kB, and the app was
  already a single 224 kB download before anything appeared on screen. So the
  build was split: the first paint is now **61 kB**, and the heavier parts —
  the session editor, the dialogs, the admin pages — arrive when you open them.
  On a slow connection the schedule shows up markedly sooner than it did, and
  the parts of the app you never touch are never sent.

  Underneath: text stays selectable and laid out correctly if the interface is
  ever translated into a right-to-left language such as Arabic or Hebrew; a
  failed request now says what actually went wrong rather than echoing the
  server's own words; and counted things ("1 session", "3 sessions") are said
  by picking the right form instead of appending an "s".

- **The People table no longer badges an outstanding speaker code.** A small
  amber `code` sat beside the name of anyone whose speaker phrase had been
  minted and never used. It is a fact about one person, read down a column of
  everybody, and it says nothing about who they are or what they may do —
  which is what every other cell on that row is for. Their profile page still
  says it, where the code is minted and revoked, and says which of the three
  states it is in rather than flagging only one.

- **Archiving replaced deleting in the People list.** The row menu offered
  both, and Delete was the wrong tool in every case it was reached for: it
  refused outright for anybody holding their own profile — which is most of a
  live event — and where it did go through it stripped the name off every
  session that person was credited on, with no way back. Archiving does the
  same tidying up and keeps all of that: the profile leaves the People list
  and the speaker picker, including the **All** segment, and it keeps its
  sessions, its role and its way in. Either an organiser or the person
  themselves can take it back out.

  **And entering the event takes it out by itself.** An organiser tidying up
  at the end of a day cannot tell a profile that is finished with from one
  whose person is back tomorrow — only that person can, and the way they say
  it is by turning up. So the gate un-archives whoever comes through it, the
  change is announced like any other, and neither side has to remember that a
  filing decision was ever made. Only the gate does this: archiving signs
  nobody out, so somebody still reading from before stays filed until they
  next come in.

  Delete is gone from the menu, and there is no longer any call in the app
  that deletes a profile. Duplicates are still folded together with **Merge**,
  which is what Delete was usually being used as a blunt version of.

- **The People table gives its width back to the names in it.** Manage Event →
  People drew six fixed columns on every row: name, username, UID, role, last
  seen, and an actions column wide enough for an `Open` button and a `⋯` button
  side by side. Two of those columns — the UID and the last seen time — answer
  questions an organiser asks a handful of times an event, and they were
  `hidden sm:block`, which is that admission made silently: on a phone the
  table simply had different columns and there was no way to disagree with it
  in either direction. What was squeezed for all this was the name, the one
  thing every row is looked up by.

  A **Columns** button beside the search box now says which columns the table
  shows. A desktop starts with all five, as it always did; a phone starts with
  **Name, Username, Role and the actions menu**, which is the same call the
  breakpoint was making silently — the difference is that it is a default
  rather than a law, and disagreeing with it sticks at both sizes. The choice
  is remembered per browser, because it is a preference about reading a table
  rather than a fact about the event. Ordering by a column that is switched
  off comes home to the name, so the rows are never left in an arrangement
  with nothing on screen to explain or undo it.

  **Name and username now share what is left, equally.** They are the two
  things a person is looked up by, and the username was in a fixed narrow
  column while the name took every pixel that was going — `@margarethami…` is
  not a lookup. And where the columns no longer fit, **the table scrolls
  sideways rather than squeeze**, which is the bargain the grid already makes
  on a phone: a table that fits 375 pixels by giving every column sixty of
  them is not one anybody can read. The header scrolls with the rows, so a
  column is never read under the wrong heading, and the width it scrolls to is
  computed from the columns actually on — so a desktop, where they all fit,
  never scrolls at all.

  **Open left the row and became "Edit profile" in the menu**, which is the
  name it deserved — it is what an organiser goes there to do. The row loses
  nothing by it: the name and the username are now links to the same profile,
  which is where a finger was aiming anyway. What is left in the actions column
  is one icon-sized button under a heading that says **Edit**, drawn rather
  than set as the text `⋯` so it keeps one optical size across font stacks
  like the rest of the icon set. The columns between Role and the menu closed
  up with it.

- **The schedule no longer labels sessions "open", and marks nothing by
  default.** A block outside the published programme was badged `open session`
  on the grid and `open` in the list, which read as *open to join* — something
  every session on a schedule is. The word meant to mark the exception
  described the rule.

  The grid and the list now say nothing about placement unless an organiser
  asks. **Manage Event → Settings** has a switch that puts a small
  **Official** on blocks and cards, for the event that really does mix a
  published programme with a floor attendees book themselves. Marking the
  programme instead of the exception is the way round that works at both ends:
  where everything is official the badge is redundant, and on an open floor it
  was noise. The dashed border still tells them apart, and a session's own
  panel always says which it is.

  In the session form the control is **Placement**, offering **Official** and
  **Non-official: allow parallel sessions**, and its help text is rewritten in
  plain words — what each one means for who can edit and move the session, and
  why the second says what it says. Stored values are unchanged.

- **A session can run longer than three hours, and for any number of minutes.**
  The duration picker offered seven fixed choices ending at 180, and the server
  refused anything over 480 — so a full-day excursion, an all-afternoon poster
  hall and a hackathon were unplaceable, and the workaround was to chop one
  thing into three blocks that lied about what was happening. The list now runs
  to eight hours and ends in **Other…**, which takes any multiple of five up to
  a day; a day is the real limit, because a session already has to start and
  end on one. Editing a session whose length is not on the list opens straight
  into that field — before, the select silently showed the first option
  instead, so saving anything else would have quietly shortened the session to
  15 minutes. Both dialogs that place a session share one list now, so they
  cannot disagree about how long one may run.

- **Deleting asks in the app's own voice, and says where things go.** Every
  confirmation was a `window.confirm`: an alert drawn by the browser rather
  than the app, one line, unstyled, and it freezes the page while it is up,
  which on a phone in a hallway is indistinguishable from a hang. Worse, it
  could not answer the question a person deleting something actually has.
  "Delete X?" never said that a session goes to the bin and an organiser can
  put it back, while a room, a tag, a track, a profile or a pitch simply
  goes. Each dialog now says which of those two it is, and the archive
  prompt no longer wears a red button for something that deletes nothing.

- **A link no longer has to be on the web.** The rule was an allow-list of
  two schemes, http and https, which refused a session streamed over IPFS
  or Swarm, a magnet link, an RTMP feed from a room's own camera, and
  everything anyone might invent next. It is a deny-list now: anything that
  parses as a URI is a link, except the handful of schemes that run
  something on the reader's machine rather than fetching something —
  `javascript:`, `data:`, `vbscript:`, `blob:`, `file:` and friends.

  One rule, in `shared/links.ts`, used by the stream links, profile links,
  contribution links and the markdown in descriptions and bios, so a link
  written in a bio and a link typed into a field cannot disagree about what
  is allowed. It leans on the URL parser rather than matching text, which
  is what keeps `JavaScript:` and a leading space from getting through.

### Added

- **A session can carry more than one stream link.** One column held one
  link, so the main camera fitted and the room's own feed, the interpreted
  channel or a mirror somebody set up went into the description or nowhere.
  A session now holds up to six labelled links, in the shape profiles have
  used for theirs, and the session sheet lists them by name. A single
  unlabelled one still reads "Watch the livestream", as it always did.

  Migration 012 moves the existing link into the list and drops the old
  column. `SessionDto.livestreamUrl` is gone, replaced by `livestreams`.

- **The end of a day's list offers the next one.** Reaching the bottom is
  the moment a reader asks what happens tomorrow, and the answer was a day
  picker back at the top of the page. There is a button there now, naming
  the day it goes to. Only under a day that had something in it: on an
  empty day the page already says so, and a lone button under nothing
  reads as the day's entire content.

- **A role is the badge everyone already knows, with a pencil in it.** In
  the People list the role was the one thing on the row rendered as a bare
  `<select>`, so the column an organiser scans to answer "who runs this
  event" was four identical grey boxes whose text had to be read one at a
  time — while the header chip, the merge dialog and the invite page all
  showed the same fact as a coloured badge. It is that badge now, in the
  same colours, with a small pencil inside the pill and a menu that spells
  out what each role may do rather than listing four bare words. The colour
  map lives in one place, so the badge and the control cannot drift apart.

- **A role can be changed from the profile page.** An organiser who opened
  a profile usually came for the reason the profile was worth opening —
  the role is wrong — and the only place to change it was the row they had
  just left. The role now sits under the name, organisers only, as the same
  editable badge; a profile nobody holds shows why it has none instead.

- **A profile can be archived instead of deleted.** The profiles that pile
  up at a real event are the ones made while testing the room, a shell typed
  twice, a walk-in who never came back — and deleting was the only tidy-up
  there was. It cannot be undone, it strips the name off every session the
  profile was credited on, and it refuses outright for anyone who holds their
  own profile, which is exactly the case an organiser most wants tidied.

  An archived profile keeps its sessions, its bio, its role, its speaker code
  and whoever holds it. All it loses is its place in the lists: every segment
  of Manage → People except the new **Archived** one drops it, and the speaker
  picker stops offering it. Crediting by name still finds it rather than
  making a twin.

  **Whoever holds it can take it back out.** They still have their cookie and
  their role, so an archived profile tells its holder what happened and offers
  them the way back — no organiser needed. That is the difference from
  deleting, and it is why an organiser can file a profile away without having
  to be sure the person is gone for good.

  The row's three action buttons became a menu behind ⋯ to make room for the
  fourth, keeping Open in the row; the actions column got narrower doing it
  and the name column took the space.

- **Every column of the People table sorts, both ways.** One button offered
  two of the five orders — by name, or by last seen — so "who has no
  username yet", "who is still only a viewer" and "whose device is this
  UID" could only be answered by reading the whole list. Each heading is
  now the control that orders by it, with an arrow on the one in force.

  A column opens the way that column is usually asked rather than always
  ascending: last seen starts at the most recent, role starts at the
  organisers, names start at A. The second click reverses it. Rows with
  nothing in the column — no username, no UID, never seen — stay at the
  bottom either way, and full name breaks every tie, so a role change
  somewhere else in the event cannot shuffle rows that did not change.

- **The profile page says whether a speaker code was ever generated.**
  Speaker access knew only about a phrase minted in that page's own
  lifetime, so an organiser returning the next day was offered "Generate
  phrase" whether they had already sent one or not — and the only way to
  find out was to mint a second, which silently invalidates the first. The
  section now reads the code's state off the person: **code unused** for a
  phrase still sitting in an unread message, **code used** once it has been
  typed at the gate, and nothing when none exists, with Revoke switched off
  rather than hidden. `PersonDto.codePending` became `codeState`, three
  states, because the boolean could answer "are they still waiting?" but
  never "did I ever send them one?".

## [0.2.3] — 2026-09-02

### Added

- **Everyone who enters an event is a person there.** A `people` row used
  to appear only when someone edited their profile, was typed onto a
  session, or was added by an organiser — so a newcomer who had passed the
  gate was in neither the speaker picker nor the merge dialog, and typing
  their own name on a session bred an unclaimed twin. The gate now makes
  the row the moment a username is claimed (migration 010 backfills every
  existing entrant), and a person has two names with two jobs: a
  **username**, typed at the gate, unique in the event, on posts and in
  the header; and a **full name**, credited on sessions, free to repeat.
  Two "Alex Chen"s can both be here; the merge tool is for two rows that
  are one human, not for namesakes.

  The username is now required the first time in — nothing like
  `attendee_x7f2k` is generated any more — and a device re-entering an
  event gets its own name back from the new `GET /e/:slug/gate`. Arriving
  under the name of a profile an organiser typed onto a talk before you
  came no longer adopts it silently: the gate asks *"There is a speaker
  profile here called Ada Lovelace, on 2 sessions. Is that you?"* and
  takes it only on a yes. Spec:
  `_planning/specs/self-as-speaker-and-merge-ux.md`.

- **The speaker field offers you.** Your own row is pinned to the top of
  the picker as "· you", claimed rows show `@username` so two namesakes can
  be told apart, and a new session or pitch by anyone but an organiser
  starts credited to its author, one click to remove. A viewer's person is
  visible like anyone's — they star and post — but is not on offer as a
  speaker (`PersonDto.creditable`), and the server refuses a non-organiser
  crediting one. Organisers may still credit anyone.

- **You can ask for the profile an organiser left for you.** An organiser
  adds *Marcel Jackisch* as a speaker before he arrives; Marcel enters as
  `marcel`, gets a profile of his own, and the shell sits there with his
  talks on it. Joining the two took a minted speaker phrase, an organiser
  merging by hand, or the gate happening to offer the shell because the
  username typed matched its full name — every route needing somebody else
  to act first, or a coincidence.

  Now the person asks. An unclaimed profile carries a "This is me" button,
  and the request waits in a queue above the People list until an organiser
  agrees. **It stops at asking on purpose**: a shell is usually credited on
  sessions, and holding the profile a session credits is the right to
  rewrite that talk, so left unguarded this would have been the cheapest
  way into somebody else's keynote. Approving runs exactly the merge an
  organiser would have run by hand, with the shell surviving so it keeps
  its name and its sessions, and everyone else waiting on that profile is
  told they were not chosen. Declining says so rather than letting the
  request vanish. Both are audited.

- **A profile page goes back where you opened it from.** Every profile sent
  you to the schedule, so an organiser working through Manage → People had
  to navigate back in for each person they looked at. The link now names
  where you came from, and an organiser who arrived by deep link gets
  "Manage → People" outright. The heading is the full name a session is
  credited to, with the `@username` the room calls them beneath it; the
  `ID: 00054` under the name has gone, since the profile's row id is in the
  address bar and needed nowhere else.

- **A merge dialog that shows who is who.** Merging is the only thing an
  organiser cannot undo, and it asked for the decision through a bare
  `<select>` of names — two people called Ada Lovelace look identical in a
  dropdown, and one of them may be a real person with three talks and a
  device in the room. The dialog now leads with the rows that look like the
  same human and says why ("same name", "initials match", "same surname"),
  then a search over name, username and UID, then everyone else; every row
  carries the same facts the People list shows.

  Picking somebody does not merge them. It shows the two side by side and
  the sentence for *this* merge: sessions move and nothing else; or the
  other profile's holder takes this one over; or — the case that costs the
  most, and the one that was never spelled out — everything that person
  did in the event moves across and their device is signed out of it.
  Merge is also reachable from each row of the People list now, not only
  from a profile page.

- **Manage → People is one list, and hands out roles.** It was two stacked
  lists — speaker profiles above, an attendance list of everyone who had
  entered below — which asked an organiser to hold "profile" and "person
  who is here" apart as separate ideas, and put the second a scroll away.
  Now that entering an event creates a profile they are the same list: one
  dense row per person carrying full name, `@username`, UID, one badge,
  session count and last seen, with segments (All, Arrived, Unclaimed,
  Organisers, Speakers) that carry counts, a search box over name,
  username and UID, and an order toggle between name and last seen.

  Each row has a **role control**: `PUT /people/:id/role` hands somebody
  viewer, attendee, speaker or organiser, audited as `role_set`. Before
  this the only way to change a role was to tell someone a different
  password and ask them to enter again, which is not something you can do
  to a person already in the room. It refuses to demote the last organiser
  — an event nobody can administer has no way back — which is the same
  reasoning the permission matrix uses to force admin on everywhere.

  `GET /attendees` and its `AttendeeDto` are gone, replaced by three
  organiser-only fields on the person: `lastSeenAt`, `joinedAt` and
  `sessionCount`. The `ID: 00054` beside a name goes too — it was the
  per-event row id, which is already in the profile URL; the UID is the
  identifier that means anything across the audit log. Delete is offered
  only for a profile nobody holds.

### Fixed

- **A change to one person no longer rewrites what everyone else sees.**
  `person.created` / `person.updated` frames go to every subscriber, but
  `isMine` and the organiser-only facts are computed for whoever caused
  the change — so an organiser editing a bio told the owner the profile
  was not theirs, and any edit blanked the role badges on another
  organiser's People list until they reloaded. The wire frame now never
  carries the private facts (the reply to the caller does, when they are
  an organiser), and the client keeps what it had worked out for itself
  about a row it already holds.

### Added

- **A capability for crediting other people.** `session.credit_others`
  joins the permission matrix, open by default for attendees and speakers:
  the app leans towards rooms where people trust each other and invite
  co-hosts. Switched off, the speaker field is a toggle between you and
  nobody, no free text, and the server holds you to it on sessions and
  pitches alike — except that editing your own talk keeps the co-host an
  organiser added. Organisers are never held to it.

- **A session can be given by more than one person.** `sessions.speaker_id`
  held exactly one, which is wrong for most of what an unconference actually
  runs: a panel, a pair, a workshop with two facilitators, a talk and its
  translator. It also decided more than the label — being the speaker is what
  grants the right to edit the session you are giving, and a second name on the
  poster had none of it.

  The session form's speaker field is now a chip field that takes as many
  people as are giving it, matching names against the roster and creating the
  ones it does not find, exactly as one speaker always did. Order is the
  credits: the first name is the one a cramped grid block truncates to. A pitch
  still names one person, through the same control. Everything downstream
  follows the whole list — the profile page, the merge tool, the ICS feed,
  search ranking, the export document, and the importer, which takes
  `speakers` beside the older `speaker`.

- **A new tag takes a colour nobody else is wearing.** Every tag started life
  the same grey, so an event's tags were told apart by reading them — which is
  most of what a colour on a chip is for. A new tag now takes the first free
  colour from a palette of eight, the way a room and a track already did, and
  the add-tag row shows the colour it is about to get instead of springing it
  on you.

  The palette is Okabe-Ito, chosen because "told apart at a glance" has to hold
  for the roughly one in twelve men who would read a red/green pair as the same
  chip. It is bright rather than dark, so a chip no longer assumes white text:
  the ink is picked black or white by luminance wherever a tag is drawn — the
  list, the detail panel, the pitch board — and for a custom colour typed in by
  hand, which no palette could have answered for.

- **A profile is edited a field at a time.** Opening your own profile used to
  show a name and, if you had written one, a bio — with everything else simply
  absent, and one **Edit profile** button that put every field in a dialog.
  The first profile anyone sees is their own empty one (the menu creates it on
  the way there), and it was the least legible thing on the site: nothing said
  a bio or a set of links existed to be filled in.

  Each field now reads in place and edits in place. An empty one keeps its
  spot and says what it is — "Nothing about you yet. **Add a bio**" — and the
  pencil beside a filled one opens just that field, with Save and Cancel under
  it. Every save is its own request carrying only that field, so a slow-typed
  bio no longer holds a name hostage, and two people editing different halves
  of a profile no longer overwrite each other. A failed save keeps the editor
  open with the message under the control and your text still in it, instead
  of a toast across the page.

  Empty *and* not yours to fill is the one case that draws nothing: a stranger
  reading a sparse profile sees a name and what there is, not a column of
  blanks. Your display name stays a field of its own — it is your identity in
  the event rather than a column of this profile, it saves through the rename
  route, and an organiser editing your profile still cannot touch it.

- **About LibreSesh links to the source.** Under the "?", beside the licence.

- **The organiser says which view a schedule opens in.** Manage Event →
  Settings has an **Opens in** choice: the list, one column in time order, or
  the calendar, a grid of rooms. New events open in the list.

  It used to be the browser's call — under 640px wide you got the list, above
  it the grid — which answers a question about the device when the question is
  about the event. A dense multi-room programme is unreadable as a list on a
  laptop; a single-track unconference is a column of empty grid on a desktop.
  Only the *default* moves: the view switch above the grid still works for
  everybody, and a view somebody picks travels in the link they share. The
  choice carries into a clone, exports with the event, and is honoured on
  import.

- **A help menu behind the "?", with the version in it.** The button beside
  your name now opens two things: **Take the tour**, and **About LibreSesh** —
  what this is, and the exact build you are looking at, selectable, which is
  the first thing anyone is asked for when they report something odd.

- **A running event opens at the current time.** The day already defaulted to
  today, but the grid still opened at the day's first hour: arriving at half
  past three meant scrolling past the whole morning, or finding **Now**, before
  seeing what was actually on. A schedule opened while the event is running now
  lands on the current time.

  Once per visit, and never over a position you asked for. A link to one
  session, or a URL carrying `?day=`, already says where to be and is left
  alone; and outside the day's hours there is no now line to jump to, so the
  day opens at its start as it always did. It lands rather than travels —
  no animated scroll to sit through on the way in.

- **The week rail says when the line goes on.** A long event's weeks scroll
  sideways on one line, with the scrollbar hidden — which left nothing at all
  to say there was more. Past the third or fourth chip the rail simply looked
  like a shorter conference: on a touch screen you found out by flicking, and
  on a desktop, with no horizontal wheel, you did not find out.

  There is now an arrow at each end of the rail, up only while there is more
  that way, and a press moves the line by most of a screenful — an overlap, so
  the week you were reading is still there afterwards. They are pointer
  affordances rather than tab stops: every chip they scroll to is a button of
  its own, and tabbing to one already brings it into view.

- **An event can be renamed, and its old address keeps working.** Manage Event
  → Settings has a **Slug** field. Changing it moves the event to the new URL —
  `/e/unconf-2026` becomes the real address, not a redirect to the old one —
  and every slug the event has ever had goes on resolving to it.

  Nobody loses anything in the move. A role is stored against the event, never
  against its name, and identity is a cross-event cookie, so an organiser stays
  an organiser and an attendee's starred agenda is still there: no one is
  signed out and nothing is re-entered. The links already handed out keep
  working too, and not merely in the browser — the invite URL on a badge, a
  QR code taped to a door, a subscribed calendar feed and any API caller
  written against the old slug all still answer, because the old name resolves
  server-side rather than 302-ing. Open tabs move themselves to the new address
  when the rename is broadcast; nothing needs reloading.

  A slug that still redirects cannot be claimed by a new event, a clone or a
  JSON import, so an old link can never be quietly re-pointed at somebody
  else's event. Renames are logged in the audit trail under their own word,
  *renamed*, rather than as a generic edit.

- **Filter the schedule by track — including the sessions on no track.** The
  Filter panel gained a **Tracks** section beside Rooms and Tags, with a chip
  per track and an **Unassigned** chip for sessions nobody has put on a strand
  yet. It is the same shape as the other chips: several tracks can be on at
  once, an empty selection narrows nothing, and each one comes off from the
  active-filter row beside the button.

  The **Unassigned** chip is the point of the change. Untracked sessions are
  real programme — they already get their own column on the track axis — but
  until now they were the one thing the filters could not ask for, and "what
  still needs a strand?" is the question an organiser asks most while a
  programme is being built. It appears only when some session actually has no
  track, so an event that tracks everything never sees it.

  Like every other filter, it lives in the URL (`?track=3,-1`, where `-1` is
  the unassigned bucket), so a filtered view is a link somebody else can open.

- **A track can say what it is for.** Tracks now carry a description, the way
  rooms always have. Manage Event → Tracks → **Edit** takes up to 500
  characters — "hands-on, bring a laptop", who the strand is aimed at, what to
  expect — and the schedule shows it behind the info button on the track's
  column header.

  That is deliberately the same place a room's directions appear, because a
  track column and a room column are the same furniture: the card carries what
  fits on a card (the session count, the hours the track keeps) and the button
  carries the one thing that does not. A track with nothing to say and no hours
  still has no info button, so nothing changes for an event that does not use
  the field.

  It travels with the event too — it is written by the JSON import (`tracks[].
  description`) and comes back in the export, so a transcribed schedule keeps
  the context it was transcribed with.

- **Enter an event by scanning a QR code.** Manage Event → Settings → **Invite
  by QR** turns one of the three event passwords into a code for a badge, a
  poster or a sheet of paper at the door. Scanning it opens the gate with the
  password already applied — no password box, a badge reading *Invited as
  Attendee*, one name field and one **Enter** button. The name is still asked
  for, because names are unique inside an event and everyone arriving under an
  auto-generated one is a roster nobody can read.

  The password rides in the URL **fragment** (`…/e/democonf#k=…`), which
  browsers never send to a server: it appears in no access log and no `Referer`
  header, and the gate strips it with `history.replaceState` the moment it
  reads it. So the URL an attendee is left holding — the one they paste into a
  group chat — is a plain `/e/democonf` that asks the next person for the
  password rather than handing it to them. The code itself still carries it,
  exactly as if the password were printed on the poster; that is what it is
  for.

  Beside the code is a warning about where it may travel, pitched at what the
  password actually grants: an attendee code is permission to write, an
  organiser code is the whole event including the other passwords, and a viewer
  code is a schedule that is nonetheless not public. Each says what to do if
  one gets out.

  The organiser types the password to encode it, because the event stores
  bcrypt hashes and the server has no plaintext to give. It confirms the typing
  instead — a new admin-only `POST /e/:slug/password-role` names the role a
  password grants without granting it, so a code is never drawn for a typo, and
  minting one is audited. The address the code points at is shown and editable
  beside it: behind a real hostname the current origin is right, and on a
  forwarded dev port or a laptop on the local network it is not.

- **A track can keep hours.** "Workshops run in the mornings" was a rule that
  lived in the organiser's head and was enforced by watching the grid; a track
  now says it once — a window of the local clock — and the schedule holds
  attendees and speakers to it. A session that starts before the track opens or
  runs past its close is refused, naming the window. Days that differ are said
  as days: a date with its own hours *replaces* the usual ones rather than
  trimming them, so "except the Saturday, when they have the afternoon" is one
  row and not a special case. Organisers are exempt, because the grid is their
  instrument and someone has to be able to place the exception. Setting or
  narrowing a window moves nothing that is already scheduled and badges nothing
  — it is a rule about what may be booked next — and a session that predates
  the window stays editable by whoever owns it. The hours show under the track's
  column on the schedule and in the session form's track picker for the day
  being placed, with an ⓘ beside the track's name for what the times cannot say
  themselves — that they are a rule, who it binds, and which other days differ;
  they travel
  through export and import (`"start": "09:00", "end": "13:00"`, plus
  `windows`). Every existing track keeps no hours and behaves exactly as before.

- **Importing a schedule no longer needs a terminal.** `POST /api/events/import`
  has been able to build a whole event from one JSON document for a while, but
  only through curl, which serves the person running the server and not the
  person holding the programme. `/import` puts a screen on it: paste the
  document or pick the file, press **Check it**, read what would land, then
  import. The check is not optional — the dry run is the real transaction rolled
  back, so the counts and warnings shown are the ones the import would produce,
  and **Import** stays locked until a rehearsal of that exact text has
  succeeded. Editing the document locks it again, because a result that no
  longer describes what is in the box is worse than no result. Bad JSON is
  caught before the request is made and reported by line and column rather than
  by byte offset.

- **Search that finds a session on any day.** The header has a search box that
  spans the whole programme, not just the day on screen: it drops down the best
  five hits with the day, time, room and the matched words in bold, the arrow
  keys open one directly, and Enter takes the query to `/e/:slug/search`, where
  every hit is grouped by day and the query lives in the URL so a search can be
  sent to someone. The matcher itself changed with it — the old one was a single
  `includes` over title, speaker and description joined together, so "lovelace
  ada" found nothing and every hit ranked the same. Words are matched in any
  order, accents fold away, and a title hit outranks a speaker hit outranks a
  description hit, with a bonus when the whole query sits in one title. Typing
  more always narrows, because every word has to appear somewhere.

- **Filters live behind one button.** Room and tag chips used to share a row
  with the search box and scroll off the right edge, which on an event with a
  dozen rooms hid most of them. They are a Filter panel now, with a count on the
  button and the active ones listed beside it as chips you can take off one at a
  time. The panel keeps its own mini search, which is the old behaviour — it
  writes `q` into the URL and narrows the day being drawn. Finding a session and
  narrowing the grid are two different questions, and they have two controls.

- **Lunch, dinner and coffee belong to the event, not to a room.** Breaks are
  their own thing now: an organiser types “Lunch, 12:00–14:00, every day” once
  in Manage Event → Programme → Breaks, and it is drawn as a quiet band behind
  every day of the schedule. There is nothing to click — it is background
  information, not a session anyone attends — and it stops nothing: running a
  session through lunch is still allowed. A break can be pinned to one day
  instead, which is how the conference dinner on the Wednesday is said.

  This replaces the first attempt, which made a break a flag on an official
  session. That shape was wrong in a way that showed: it needed a room it did
  not use, carried a speaker, tags, a description and contributions it would
  never have, and had to be repeated onto every day like a real session. The
  flag and its column are gone, and the importer takes a top-level `breaks`
  list instead. Any session that carried the flag stays exactly where it is as
  an ordinary session, which the organiser can delete and re-add as a break.

- **A session can hold the floor.** An organiser can mark an official session
  *everyone should be at this* — a keynote, the closing plenary — and while it
  runs an attendee cannot add a session anywhere in the event, not even in a
  room that allows booking. The schedule shades the hour with the session's
  name across it, so the rule is visible before anyone runs into it. It is a
  mark on the session rather than a switch on the event, because at a real
  unconference most of what is "official" is registration, coffee and a track
  that runs all afternoon: a rule keyed on the type would have closed the grid
  for the whole event instead of protecting the keynote. Partial overlaps count
  — a session starting ten minutes early and running through it is exactly the
  case the rule is for — while back-to-back is not competing. Organisers and
  speakers are not stopped, since a speaker with a talk to give is part of the
  programme rather than someone it is being protected from; what they place is
  badged **competing** on the grid. Sessions booked before the mark went on
  stay where they are and stay editable: refusing a title fix afterwards would
  punish an attendee for the organiser's later decision. Repeats carry the mark
  onto every day of a run, and the JSON importer takes it as
  `blocksOpenBooking`.

- **The session form can put one session on many days.** Adding a session as an
  organiser now offers **Repeat**: an *Until* day, a row of weekday chips, and a
  live count — *Creates 15 separate sessions* — with the button following suit
  (**Create 15 sessions**). The day picked above is always the first
  occurrence, so its weekday chip stays on and cannot be switched off. One
  request (`POST /sessions/repeat`) creates them all in a transaction, and the
  form says plainly what lands: fifteen independent sessions, not a series, so
  moving or deleting one leaves the rest where they are. That is the right
  trade for a programme whose sessions drift from their planned start on the
  day — the thing this was built for. Organisers only; the calendar rule is
  shared with the JSON importer (`server/src/shared/repeat.ts`), so the form
  counts the run exactly as the server will create it, and a run one refuses
  the other refuses too.

- **An imported session can repeat.** A three-week programme is mostly the same
  thing every day — the officials that open and close it, the track that always
  runs 14:00–16:00 — and the importer made you type each one out per day.
  A session row now takes `repeat: { until, days, except }`: `until` is the
  inclusive last day, `days` names weekdays (omit it for every day), `except`
  lists the days the run skips. Twenty days of three daily officials is three
  rows. What lands is *ordinary sessions* — no series, no series id, nothing
  that remembers they were one line — because this schedule is last-write-wins
  rows anyone can drag, retitle or delete, and a series entity would have to
  answer "does moving Tuesday move all of them?" on the first edit. The cost is
  stated rather than hidden: changing a repeated session afterwards means
  changing each day. `repeat` refuses `startsAt`/`endsAt` and resolves each day
  through the event timezone separately, so a run across a clock change stays
  at the printed time instead of sliding an hour halfway through. A repeat that
  contradicts its own row is refused (an `until` before the session's date, a
  `days` list without the weekday it starts on, an `until` past the end of the
  event, a `days`/`except` pair that lands on no day at all); an `except` the
  run never reaches warns. Warnings about a repeating row are reported once and
  name the rule rather than a date, since they are true of every occurrence.
  `docs/schedule-import.md` and the shipped template cover it, and
  ARCHITECTURE.md §Importing a schedule records why there is no series.

- **A session can be opened as a full page.** The panel is right for glancing
  at a session while the grid stays behind it, and wrong for a session that has
  collected forty notes. `/e/:slug/s/:id/full` — reached by ⤢ in the panel's
  header — renders the same session full-width: two columns from `lg`, with the
  discussion given the width and the things you act with (star, edit, composer)
  in a sticky rail beside it, and nothing collapsed, since reading all of it is
  what the page is for. The event bar stays for context; the weeks, filters and
  day rail belong to the grid and are dropped. **Back to the schedule** returns
  to the panel with your filters intact. Both presentations are one component
  (`SessionDetail`), so a new field or permission rule cannot land in one and
  miss the other.

- **The session panel grows on a desktop, and long discussions collapse.** The
  detail panel was a fixed `sm:w-96` at every width above `sm`, so on a wide
  screen the description, the three contribution lists and the composer all
  wrapped early while the grid behind them had room to spare; it now steps up
  through `lg` and `xl`. The session editor was the same shape of problem — its
  two- and three-column field grids collapsed to one column at the default
  modal width — and is now `wide`. Separately, each contribution kind shows
  only its most recent three, with **Show N earlier notes** above the list and
  a count beside the heading: a busy open session gathers notes faster than
  anyone reads them, and all of them at once pushed the composer off the
  bottom of the panel. The collapsed window keeps the *tail* rather than the
  head, because the newest note is the one the panel is open for.

- **The schedule header keeps the brand mark on a phone.** The header put the
  full wordmark beside the event name at every width, and below `sm` the two
  competed for a line that isn't wide enough for both — the event name, the one
  piece of information that changes per page, was the half that truncated. Under
  `sm` the wordmark is now replaced by the mark alone (the brackets and the
  calendar, near-square), so the name gets the width back; from `sm` up nothing
  changes. Both marks ship as a light/dark pair like the other brand artwork,
  and at 1.3 kB each Vite inlines them, so the phone case costs no extra
  request. `Logo` grew a `mark` variant for it.

- **Merging two people now merges their work.** `POST /people/:id/merge`
  repointed sessions and pitches but left everything keyed on the loser's
  *identity* — stars, contributions, proposal interest, authorship — where it
  was, so one human's history stayed visibly split across two names and the
  losing device kept ownership of words that now described someone else's
  profile. Decided and shipped: a both-claimed merge re-keys all of it onto
  the surviving identity, deduping anything both sides did (a shared star
  collapses to one), and the losing device is signed out of the event — role
  revoked, exactly like /logout — rather than left signed in owning nothing.
  Deleting the identity itself would not be safe (it may be a real person at
  other events, and the audit log points at it); its name row stays so the
  attendance list and old audit entries keep their label. Scoped to the event
  being merged — the same identity at another event keeps its work and its
  role — and the device can re-enter through the gate as a fresh participant.
  Merge stays admin-only, irreversible and audited. ARCHITECTURE §Merging two
  people rewritten, diagram included.

- **UIDs are now random hex codes, not row numbers.** The identity id shown to
  admins (and to you, in the menu behind your name) was the database row id —
  sequential, so `UID: 00012` told anyone that eleven identities came before it
  and where to guess for the rest. Every identity now carries a `public_id` of
  5 random hex characters, unique across the instance and shown as
  `UID: A3F9C`; a UID reveals nothing about how many identities exist and can't
  be enumerated. It is only a name, never a credential — quoting one proves
  nothing — and row ids no longer leave the server. Five hex chars is ~1M
  values, far more than any instance will hold. Went straight into the baseline
  schema (nothing is deployed yet), so a dev database from before needs
  deleting once. Per-event row ids beside sessions and profiles are unchanged
  (`ID: 00012`).

- **Manage Event → People lists everyone who has joined.** The roster only ever
  showed speaker/host *profiles*, so an organiser — including the one asking
  "why am I not in the People tab?" — could not see who was actually in their
  event or match a UID from the audit log to a person. A second table now lists
  every identity that has ever passed the gate: name, UID, role, a link to
  their profile if they hold one, and when they were last seen anywhere on the
  instance. Admin-only (`GET /attendees`). Since reading the schedule requires
  entering, and entering records a name and a role, this is the complete set
  of people who have ever seen the event; signing out keeps the entry, minus
  the role.

- **A whole schedule can be imported as JSON.** `POST /api/events/import`
  builds an event with its rooms, tracks, tags and sessions from one document,
  guarded by the instance password like creating an event by hand. It is
  deliberately *not* `export.json` read backwards: an export is a record of
  ids and instants, while the thing an import usually describes is a printed
  programme or a photo of one, so the document names rooms, tracks and tags
  instead of numbering them and takes the wall-clock times the schedule prints,
  which the event's timezone turns into instants. Everything lands in one
  transaction, so a document that fails on its last row leaves nothing behind,
  and `?dryRun=1` runs every check and rolls back — worth doing first, because
  a wrong transcription and a right one look identical until something reads
  them. Contradictions are refused with the row that caused them
  (`sessions[3] "Opening keynote": …`); a session outside the hours the
  schedule shows, or double-booked against another, is imported and named in
  `warnings` instead, since both are things an organiser is allowed to do and
  neither is a reason to throw the file away. Speaker names create unclaimed
  profiles the way the session form does, and passwords left blank are
  generated and shown once.

- **The audit log and the roster show ids, not just names.** An entry read
  `Marcel edited person "attendee_4skp9"` — the label resolved, so the id it
  already had was hidden, and neither the actor nor the thing acted on could be
  pinned down. Names are editable and profile names are not unique, so both are
  now shown with their id: the actor's **identity id**, which is the same
  number at every event on this instance and the only thing about them that
  never changes, and the entity's own id beside its current name. The People
  roster shows the holder's identity id too, and the audit filter searches ids
  as well as names. Both are written zero-padded and labelled — `(UID: 00007)`
  for an identity, `(ID: 00012)` for the row acted on — so a column of them
  lines up and the two id spaces are never mistaken for one another. Organisers only, as before — a public profile still shows
  only the per-event profile id, because printing an identity id beside a name
  would tie one person's names together across events.

- **Profiles carry an id, because names do not identify anyone.** A profile
  page and each row of the People roster now show `#12` — the id already in the
  address bar, unique within the event. Deliberately the *profile* id and not
  the identity id: an identity is the same number at every event on the
  instance, so printing it beside a name would tie the "Ada" at one event to
  the "A. Lovelace" at another, which is the precise thing per-event names
  exist to prevent. Your own identity id is shown to you alone, in the menu
  behind your name, where you can quote it to an organiser.

- **The People roster says who holds each profile.** Manage Event → People
  showed a name and, at most, the word "claimed". Each row now carries the role
  its holder has at this event, an **unclaimed** marker when nobody holds it,
  and **code unused** when a speaker code was minted for it and never redeemed
  — which "claimed" cannot express, because minting attaches an identity the
  moment the phrase is printed, so a profile can read as claimed by someone who
  has never opened the link. Organisers only: the fields are absent from the
  bundle for everyone else rather than null, so an attendee is not handed a
  list of who runs the event.

- **The audit log prunes itself, at a size you choose.** New events and every
  existing one start at **1000 entries** (migration 016), settable per event in
  Manage Event → Settings; 0 keeps everything. Past the cap the oldest go as
  new ones arrive — checked once every hundred writes rather than on each one,
  so no action in the app pays for a `DELETE` it does not need, and applied
  immediately when an organiser lowers the cap. Instance-level rows (a
  whole-database backup, an event created from the landing page) carry no event
  id and are never pruned by this. Said plainly in the UI, because it is a real
  trade: a cap means an organiser who sets it low and then makes a thousand
  edits can push an earlier action off the end.

- **The audit log is readable, in Manage Event → Audit.** The `audit` table has
  been filled since the first migration by thirteen route files and had no
  reader at all — so the recovery story for vandalism was "restore it from
  Trash and guess who did it". Admin-only, newest first, keyset-paged (the log
  only grows at the head, so an offset would skip rows as it does). Each line
  names the actor by their display name in this event and the thing they
  touched by its title, looked up at read time — soft deletes are what make
  that possible, so a deleted session is still named in the line recording its
  deletion. Deletions and failed password or device-phrase attempts are
  coloured, being what anyone opening this is looking for. The filter box
  searches what has been loaded and says so.

- **Two backups, in Manage Event → Backup.** Neither existed; the only backup
  was a cron job on the host, which is no use to an organiser who has never
  seen a shell.
  - **Export this event** (`GET /api/e/:slug/export.json`, event admin) — the
    programme as one JSON document: rooms, tracks, tags, people, sessions,
    pitches and contributions, with star and interest counts but never who
    starred what. It is its own archive shape rather than a bag of DTOs, and
    it has nowhere to put a password hash, an identity token or a code hash —
    so a future secret column cannot leak into it by being added. Safe to hand
    to a co-organiser, which is the point of it existing separately.
  - **Back up the whole instance** (`POST /api/backup`, instance password) —
    `VACUUM INTO` a snapshot, seal it with AES-256-GCM under a scrypt key
    (N=2^15) from a passphrase typed at download time, stream it, delete the
    snapshot. The header carries its own KDF parameters, so a file written
    today still opens after we raise the cost. `npm run decrypt-backup --
    backup.lsbk restored.db` opens one, and the test suite runs that script
    against a real download rather than a re-implementation of it — a backup
    nobody has ever restored is a guess. The UI says plainly that the file is a
    credential: it carries every identity token in clear and the hashes of
    every device and speaker code.


- **Event passwords can be left blank.** Inventing three passwords at the
  moment of creating an event is a chore that invites bad ones, so a blank
  field is filled in rather than rejected. A real instance generates a
  four-word phrase per role and shows it once on creation — it is stored
  hashed and unreadable afterwards. A demo instance (`DEMO_MODE=1`) uses the
  published DemoConf values instead, where the gate ignores passwords anyway
  and predictable ones keep the docs and screenshots honest; it falls back to
  generating one if a published value would collide with something the
  creator typed.


- **The demo event ships in production.** The DemoConf fixture moved from
  `scripts/seed.ts` into `server/src/seed.ts`, so it is compiled into the
  build and exists in the runtime image, where `scripts/` and `tsx` are pruned
  away. The server creates it at boot when it is missing — only when missing,
  so a redeploy never wipes what people added to it, and deleting it stays
  deleted. `SEED_DEMO_EVENT=0` turns it off. `npm run seed` is now a thin
  wrapper over the same fixture and still replaces the event, as before.

- **A one-file Railway deploy.** `railway.json` points Railway at
  `deploy/Dockerfile` instead of letting its Node autodetection guess. The guess
  was fatal: a plain `npm ci` honours the repo's `.npmrc` (`ignore-scripts=true`),
  which skips `better-sqlite3`'s install step, so the native addon is never
  fetched or built and the app dies at boot with `Could not locate the bindings
  file`. The Dockerfile already ran `npm ci --ignore-scripts=false` for exactly
  this reason. Hosting notes gained a PaaS section covering the `/data` volume
  the SQLite file needs to survive a redeploy.

- **A speaker role.** Fourth role, between attendee and organiser. Speakers
  inherit every attendee default in the permission matrix and may rewrite the
  description of sessions they hold — the words, not the slot: moving or
  deleting an official session stays with organisers. Granted by speaker
  codes, never by a shared password.

- **Speaker codes.** From a profile page, organisers mint a four-word phrase
  bound to that person. Typing it at any event gate signs the device in *as*
  that person, speaker role included — the "session created on their behalf,
  speaker arrives later" flow without an email/password account. Works from
  any number of devices, shown once, stored hashed, revocable.

- **Hardened migrations for running instances.** The server now refuses to
  boot a database migrated by a newer build, takes a `VACUUM INTO` backup
  before applying pending migrations to an established database, and can run
  table-rebuild migrations (how SQLite widens a CHECK) safely, verifying
  foreign keys before each commit.

- **Link another device.** The menu behind your name mints a three-word phrase
  (`pine-otter-lantern`); typing it at the gate on another device makes that
  device *you* — same name, role, stars and sessions — closing the "my phone
  is a stranger" hole. Phrases are single-use, expire after ten minutes, are
  stored hashed, and guesses share the password rate-limit budget.

- **Speaker search instead of a dropdown.** The speaker field on sessions and
  pitches is now a combobox that searches the roster case- and
  whitespace-insensitively; creating a person is an explicit "Add … as someone
  new" action, never the silent result of a typo. The server matches the same
  way (and prefers a claimed profile over an unclaimed twin), so "ada lovelace"
  no longer spawns a duplicate of "Ada Lovelace".

- **Merge duplicate people.** Organisers can fold one profile into another from
  the profile page: sessions and pitches are repointed, blanks fill from the
  duplicate, a claim on the duplicate moves to the survivor, and the duplicate
  is soft-deleted. Audited; not undoable via /trash, hence admin-only.

- **A landing page at `/`.** The root said nothing about what LibreSesh is —
  that copy lived in the About dialog, behind the "?" you cannot reach until
  you are inside an event and past its password, so the one page a stranger is
  guaranteed to see was the one page that explained nothing. `/` now answers
  what this is, the licence, and what to do if you are holding an event link.
  The list of every event moved to `/events`, which also stops a public
  instance enumerating every event on the box to anyone who loads the root.

  Its hero is markup rather than the design draft's screenshot: the app has a
  light theme and a dark one, so a single PNG is wrong half the time, and a
  pair goes stale the first time a card changes because nothing renders it.
  `BoardPreview` is built from the classes `ListView` uses, and is
  `aria-hidden` behind a real caption — the sessions in it are not real.

### Changed

- **The star is an icon in the corner, not a row of text.** Opening a session
  put "Add to my agenda" across the top of the panel, above the description and
  the notes that are what somebody opened it for — a full-width button spelling
  out what a hollow star already says. It is now a 36px star under the sheet's
  close button, in the same column and the same shape as the expand and close
  controls, with the words kept in the tooltip and the accessible label. The
  full-page view drops it from the sticky rail and puts it in the same
  top-right corner, so it is in one place wherever you meet a session.

- **One colour control, and it is a circle.** Tags, tracks and rooms each drew
  the browser's own `<input type="color">` — a rectangle every browser paints
  to its own taste, which beside a row of round swatches read as a different
  kind of thing entirely. They now share one picker: the palette as swatches,
  with the system picker still underneath the last one, because nothing
  hand-rolled beats it on a phone. A tag in Manage Event is also drawn as the
  chip it actually is, and pressing it opens the editor — the old neutral pill
  with a dot beside it showed the colour at a size nobody could judge it at.

- **One Calendar item in the menu, not two.** Calendar export and Subscribe
  opened the same dialog at its two halves, so the menu spent two rows saying
  what the dialog says in one — and "Subscribe" on its own reads like a mailing
  list rather than an ICS feed. The item is just **Calendar**; the dialog still
  holds both halves and still opens at the one that was asked for.

- **The week rail is one line that scrolls, not two that wrap.** On a phone a
  four-week conference wrapped its week chips onto a second line and a six-week
  one onto a third, each of them header height the grid wanted. The rail now
  scrolls sideways within a single line, the same way the day strip beside it
  already did.

- **A room's column header is its name, and nothing else.** The header used to
  carry a second line — the seats, and "attendees may book this room" — in the
  176 pixels of a column card, where it truncated, while the organiser's
  directions sat behind the ⓘ. That asked a reader to look in two places for
  one room, and spent the busiest space on the schedule on a standing claim
  that never changes.

  The card is now just the room. The seats, the booking permission and the
  directions are together behind the info button, which appears whenever there
  is any of the three and stays away when there is none — so its presence still
  means there is something to read.

  Track columns keep their second line: what it says there — how many sessions
  are on the track, the hours it is keeping today — changes with the day on
  screen, and that is worth seeing without a hover.

- **A room card says what the room is, not what the database lacks.** Every
  room without a capacity announced "no capacity set" under its name on the
  schedule — a note about an empty column, told to attendees, on most rooms of
  most events, since capacity is optional by design. The card now shows what
  the room actually has: the seat count when there is one, and the booking
  permission when it has one. The organiser's directions — which floor, which
  door, what to bring, editable in the room editor and visible nowhere else on
  the schedule until now — sit behind a small ⓘ beside the room's name, which
  appears **only** when there are directions to read. The panel holds what the
  card cannot, and nothing the card already says: a hover that repeats the line
  above it is noise twice. A room with nothing set shows its name alone and
  offers no button.

- **The last hand-rolled modals moved onto the primitive.** Six callers still
  built their own intro paragraph and button row rather than passing
  `description` and `footer`; they now match every other modal, and the ones
  holding a form submit on Enter. The session panel's expand and close controls
  became shared icons on one 36px target apiece.

- **Arrange is admin-only.** It used to appear for attendees too, whenever the
  event had any open-booking room. Arrange is a whole-grid drag mode, though,
  and the grid is the organiser's instrument: an attendee has at most one open
  session of their own on it, and dragging is a clumsy way to move the one
  thing you may touch past everything you may not. They still change that
  session's time, room and length through **Edit session** — the same edit,
  named rather than aimed at. The server never knew about Arrange; it gates the
  underlying edit, and that rule is unchanged. This also settles a disagreement
  with the README, which has always said organisers arrange by drag and drop.

- **The schema is one file again.** Seventeen migrations squashed into
  `001_baseline.sql`, done now because no instance yet holds data and this is
  the only moment it is free. Four of the old files existed solely to backfill
  rows or rebuild a table to widen a `CHECK`, and the final shape of `roles`,
  `link_codes` and `people` was not visible in any single file — you had to
  replay the sequence to know what the schema was. Verified rather than
  trusted: a database built by replaying all seventeen and one built from the
  baseline were compared on every column, default, foreign key, index and
  `CHECK` that SQLite reports, and matched exactly. That check caught four
  indexes the hand-written baseline had renamed or dropped. The old files
  remain in git history.

  **Any existing database must be deleted and reseeded** — the runner tracks
  migrations by filename, so one that recorded the old names now refuses to
  start against this build. That is the newer-build guard working, and the
  reason this could not have waited until after a real deploy.

- **Manage Event is tabbed instead of one long page.** Rooms, tracks and tags
  sit under **Programme**; people, permissions, event settings and the bin each
  get their own tab, and Backup and Audit joined them later in this release —
  seven in all. Nine stacked panels meant scrolling past four unrelated jobs to
  reach the fifth. The open tab lives in the URL (`?tab=`),
  so a reload or a link to a co-organiser lands on the same one, and the bin is
  only fetched when its tab is opened. The header's **Proposal pool** link is
  gone — the pitch board is a click away on the schedule, where people actually
  are.

- **A pitch is upvoted with an arrow, not a star.** The interest button on the
  pitch board wore the same ★ as "on my agenda" on the schedule, so the one
  glyph stood for two different acts — backing a pitch that may never be
  scheduled, and marking a session you mean to attend. Interest is a ▲ now, and
  blue rather than the agenda's amber; the count and the behaviour are
  unchanged.

- **The schedule header makes room on a phone.** Five controls were competing
  for whatever width the event name left over. The theme switcher moved into
  the profile menu behind your name — it is a preference you set once, not a
  control you reach for — and **Manage Event** moved down beside Arrange and
  Add session, so an organiser's three actions sit together at every width
  instead of being split between the header and the toolbar. Add session,
  Arrange and Manage Event each keep their glyph and drop their label below
  `sm`, which is what actually buys the space; every one carries a real label
  for assistive tech and a tooltip. The events list keeps its own theme
  switcher, having no profile menu to hide it in.


- **The event-creation form explains the instance password.** It is the
  server's password, not an event's, and the page never said so — a new
  organiser had no way to tell which of the four password fields in front of
  them was which. The form now names the two kinds and says where to get the
  instance one; the README gained a section on the same distinction.

### Fixed

- **Arrange is gone from the list view.** `arrange` is read by the calendar
  grid and by nothing else, so in the list the button toggled a mode with no
  effect — it lit up, said "Done arranging", and changed nothing under it.
  Switching away from the grid now also turns the mode off, rather than leaving
  it open behind a button that is no longer on screen. Editing from the list is
  unaffected: it never went through Arrange.

- **Number fields no longer accept nonsense.** Every typed number in the app
  was a `type="number"` input, which enforces `min` and `max` on the spinner
  and on form submit — and a React form reading `e.target.value` never
  submits. So the bounds were decoration. Worse, the characters the browser
  half-accepts (`e`, `+`, `-`, `.`) come back out of `e.target.value` as `''`,
  meaning a field silently emptied itself while you were typing into it.

  What the empty then meant was decided by whatever coercion sat at the save:
  `Number('')` is `0`, so clearing the audit-retention box to retype it saved
  "keep every entry for ever"; `Number(x) || 8` meant a mistyped week rail
  saved 8. Neither said anything. An out-of-range number, meanwhile, went all
  the way to the server before anyone objected.

  There is now one `NumberField` primitive over one pure module
  (`web/src/lib/numberField.ts`). Digits are the only thing that can enter it,
  typed or pasted, capped at the width of the field's own maximum; the range
  is checked where the number is typed and shown under it; and a field that
  did not parse blocks the save rather than becoming a value nobody entered.
  Room capacity, the week rail and audit retention are all on it. The specs
  mirror the server's zod schemas, and a test holds the two to the same answer
  either side of every boundary — the server still decides, so the client may
  be stricter (capacity stops at four digits, because no venue this is for
  seats ten thousand) and may not be looser.

- **The settings form checks what it can before asking the server.** A slug
  that was too short, a password under six characters, or a number out of
  range were all discovered by pressing Save and reading a toast. They are now
  named under the form, which disables Save while one stands. The server
  checks all of them still; this is the form answering sooner, not the
  validation moving.

- **Dialogs opened from the schedule header appeared off screen.** About
  LibreSesh, and device linking before it, were laid out inside the header
  rather than over the page: the dark backdrop covered a strip at the top and
  the panel itself — which sits at the bottom of its container on a phone —
  was pushed off the bottom of the screen.

  `position: fixed` is only fixed to the viewport while no ancestor has a
  transform, a filter or a `backdrop-filter`. Any of those quietly become the
  containing block for every fixed descendant, and the schedule header has
  `backdrop-blur`. Dialogs now render into the page body through a portal, so
  where a dialog is written no longer decides where it lands — which fixes
  every dialog opened from anywhere blurred, not just the two that showed it.

- **The header folds in the grid too, and by the button as well as by
  scrolling.** The fold listened to one named box: first the grid's own
  scroller, later the grid's in one view and `<main>` in the other. Which box
  actually has the overflow depends on the day's length, the header's height
  and whether a banner is up, so a name fixed in advance kept leaving the fold
  listening to something that never moved — the grid, most recently. It now
  listens to both and reads whichever one has somewhere to scroll.

- **No permanent scrollbars across the day.** On the platforms that draw them,
  a horizontal bar sat along the bottom of the grid for the whole time you
  were reading it, saying what the room cards and the time gutter already say.
  The grid hides its bars, like the day strip and the week rail above it.

- **The header folds in the list view too.** Folding was pinned to the grid's
  own scroller, so in the list — which has none of its own — there was nothing
  for it to listen to and the header simply never folded. With the list now
  where an event opens by default, that was most people.

- **A filter row that fits a phone.** Three things were spending width nobody
  had: the collapse button carried the day as text, so it was a different size
  in each state and a different size again on a Tuesday than on a Wednesday —
  a control that moves under the thumb reaching for it. It is a calendar and
  an arrow now, the same width in both states. The **Filter** button drops its
  label below `sm`, like Manage and Add above it, and has lost the ▾ at every
  width — a panel opening under the button already says that. And the search
  field is sized for what it holds rather than for its own placeholder.

- **The version pill is gone from the corner of every page.** It sat over the
  bottom-right of the grid on a phone, permanently, for a question asked twice
  a year. It is in **About LibreSesh** under the "?" now.

- **The week rail's arrows are drawn rather than typed.** ‹ and › are set on
  the text baseline at the font's own optical size, so they came out small and
  sitting low against the chips they belong to. They are icons now, centred by
  the same flexbox that centres the rest of the row — as is the cog on
  **Manage Event**, which was a ⚙ glyph and rendered at a different size and
  weight in every browser.

- **The tour no longer shows up uninvited.** A first visit to an event opened
  the schedule under a stack of coach-marks, before anyone had seen the thing
  they came for. The tour is unchanged and is still one press away on the **?**
  button beside your name — it just waits to be asked for now, every time,
  rather than remembering whether it has been taken.

- **Signing in on a phone no longer leaves the app zoomed in.** Safari on iOS
  zooms the page whenever you focus a field whose text is under 16px, and it
  does not zoom back out when you leave it. The event password gate is a text
  field on an otherwise empty page, so the first thing an iPhone did with a
  new event was magnify it and strand you there, with the right-hand side of
  every screen off the edge and a pinch the only way back.

  Text entry is floored at 16px on a touch screen, where that zoom exists;
  fields stay their designed size on a desktop, where it does not. Pinch zoom
  is untouched — the cheap cure for this is a viewport that forbids zooming
  altogether, which takes it away from the people who need it to read.

- **The folded header no longer runs off the right of the screen.** With the
  header fold in, the profile menu at the end of the event bar sat half off the
  edge on a phone, and a long event's week rail stopped scrolling and ran off
  the same edge — everything past the third week was unreachable rather than
  merely out of sight.

  One cause for both. The fold wraps each row in a grid so it can animate its
  own height, and a grid's default column grows to fit its content instead of
  constraining it: a row wider than the phone made the row wider than the
  header rather than being made to fit, and `overflow-x: clip` — the net that
  stops a stray element widening the page — hid what was left. The column is
  now pinned to the width that is actually there, which hands the squeeze back
  to the rows, each of which already knows how to take it: the event bar
  truncates, the rail scrolls.

- **Scrolling down the grid no longer takes the room names with it.** Past the
  first screenful of a day the column labels were gone, while the event bar,
  the week rail and the day strip — the chrome you were done with — stayed
  exactly where they were. What was left was an unlabelled field of blocks: you
  could see a 14:00 session but not which room it was in, and getting the
  answer meant scrolling back up.

  The cause was two scrollers, one of them accidental. The room cards are
  `sticky top-0` inside the grid's own scroll box, so they hold their place
  only while the grid is the thing being scrolled. That box was sized
  `calc(100vh - 200px)` — a guess at the header's height — and the header is
  routinely taller than 200px, with a week rail on a multi-week event and a
  filter row that wraps on a phone. The surplus made the *document* scrollable
  too, so once the grid hit its bottom the page took over, the sticky header
  slid up under the page header, and the labels went with it.

  The schedule is now an app shell: the viewport holds the header and the grid,
  the page itself cannot scroll, and the grid takes the height that is left
  rather than guessing at it. The room cards stay on screen for the whole day,
  at every header height, on every screen.

- **The schedule header folds itself away once you are into the day.** Reading
  the afternoon of a conference on a laptop, the top ~150px went on choosing a
  day you had already chosen. Past 24px of scroll the event bar, the week rail
  and the day strip fold away, leaving one row: which day you are on, search,
  filters, and **Now** — moved down beside **Filter**, because jumping to the
  current time is the thing you reach for mid-scroll and the row it used to
  live in is one of the rows that folds.

  Scrolling back to the top of the day brings everything back. So does the
  ⌄/⌃ button at the head of the row that stays: it is the way back that does
  not cost you your place in the day, and it folds the header by hand from the
  other side. A header you opened stays open until you deliberately scroll
  another 120px down — the momentum still arriving from the flick that folded
  it is not an instruction to fold it again — and one you folded by hand stays
  folded until you come back to the top of the day.

  The fold and the button used to fight, which made the button look broken: you
  pressed it, the header came back, and the next flick of the wheel put it
  away. Three rules keep them apart. The header unfolds at the very top and
  folds at 24px rather than swapping on one threshold in both directions.
  Nothing folds while a fold is still moving, because every height the
  animation passes through fires scroll events of its own. And it will not fold
  when folding would move the day under you: the rows hand the grid the height
  they were using, and on a day not much longer than the screen that is more
  scroll than is left, so the browser clamps the position back — a lurch, and
  at the top an instant unfold, leaving the header flickering a notch either
  side of the threshold. Days that short do not fold at all. The rule measures
  the rows rather than assuming a height, so a wrapped filter row on a phone
  and a week rail on a long conference are both accounted for.

  The fold takes 700ms and is a movement rather than a cut: the rows shrink to
  nothing while the grid grows into the space, so it reads as one gesture with
  the wheel that started it instead of the header being chopped off. The height
  animates `grid-template-rows` from `0fr` to `1fr`, which means nothing has to
  name a max-height larger than the content — a number that would ease through
  empty space and be wrong the day a row wraps onto another line. Anyone who
  has asked their system for less motion gets the old instant swap.

  Past 160px into the day, a **↑** button appears in the bottom-right corner:
  one press back to the top, however far down you are. It scrolls rather than
  jumps, so the header unfolds on the way up. It has its own threshold rather
  than riding on the fold's, so it still appears on a day too short to fold.

- **The filter panel no longer shoves the page sideways on a phone.** Opening
  **Filter** on mobile zoomed the whole schedule out and left you pinching back
  in to read it. The panel was positioned `absolute left-0` inside a wrapper
  that sits partway along the filter bar, and sized `min(22rem, 100vw - 2rem)` —
  a width that is only ever right for an element starting at the left edge of
  the screen. Its right edge therefore landed at *the button's* left edge plus a
  full viewport, hanging a couple of hundred pixels off the page. Nothing
  clipped it, so the document itself became wider than the screen, and a mobile
  browser answers that by shrinking everything to fit. The search box's results
  had the same bug and 28rem of it.

  Both panels are now placed by Floating UI: positioned against the *viewport*
  rather than the document, slid back inside it when they would overhang,
  flipped above the anchor when there is no room below, and capped to the width
  and height actually left beside them — which also retires a `max-h-[70vh]`
  that counted the strip behind the address bar. The same move deletes four
  hand-rolled copies of "close on outside click or Escape", and closing the
  filter panel now returns focus to the button that opened it. Tapping
  **Filter** deliberately does *not* focus the search field inside, so a phone
  keyboard no longer covers the panel you just opened.

  Behind them, `html` is `overflow-x: clip` as a backstop, so no future element
  can widen the page this way — `clip` rather than `hidden`, which would make
  `html` a scroll container and stop the schedule header sticking.

- **The session sheet fits the phone it opens on.** The sheet is bottom-anchored
  inside a `fixed inset-0` parent, but capped its height with `max-h-[85vh]` —
  and `vh` measures the viewport with the mobile address bar *hidden*. With the
  bar showing, the sheet was taller than the box holding it, so its top was
  clipped away: the session's own title sat above the screen with no scrolling
  that could reach it. It is `dvh` now, the unit that tracks what you can
  actually see, matching what `Modal` already does.

- **A dropped block no longer leaps past where you put it.** The server writes
  the SSE `change` frame *before* it answers the PATCH, and the broker echoes to
  every subscriber including the one that made the write — so your own move
  normally comes back down the stream first. The calendar held a dropped block
  as an offset from the session's own row, and once the echo had already moved
  that row the offset was added on top of the value it was meant to produce:
  the block jumped twice as far as the drag, then snapped into place when the
  response cleared the hold. The hold is now absolute grid coordinates
  (`DragTarget`), drawn through `drawnAt`, where the drag target wins outright
  and is never combined with the row — so the echo moves nothing and releasing
  the hold onto an already-updated row moves nothing either. A live drag also
  no longer gets yanked sideways when another organiser moves the same block.
  **Partial:** a residual flicker on drop is still reported and is now a
  backlog item — the horizontal lane re-layout is the leading suspect.

- **A permission switch moves when you click it.** The matrix drew each
  checkbox straight from the saved bundle with nothing held locally, so the
  click painted the new state, React's next render put it straight back, and it
  flicked forward again a round trip later — three states for one click, the
  middle one a lie. Each switch now carries an optimistic value until the saved
  matrix catches up, compared by value rather than by when the request resolved,
  since the response and the server's SSE echo of it race and either may land
  first. The comparison ignores role order on purpose: the server returns a
  capability in `ROLE_ORDER` once an override row exists but in the capability's
  own declared order while it sits at its defaults, so a switch flipped back to
  default comes home as the same set in a different order. A rejected save now
  puts the switch back — `savePermissions` was swallowing the error, which would
  have left the optimistic value standing over a change that never happened.

- **Deleting someone's profile no longer bars them from having one.** The
  uniqueness rule behind "one profile per person per event" covered deleted
  rows too, so a soft-deleted profile went on holding its owner's slot. The
  next time that attendee edited their profile the insert hit `UNIQUE
  constraint failed: people.event_id, people.identity_id` and they got an
  opaque 500 — permanently, with nothing they could do about it. Migration 017
  narrows the index to live rows. The tombstone keeps its `identity_id`, so the
  record of who owned it survives for the audit trail.

  Deleting a profile was, and remains, only that: the person stays signed in
  with their role and their name in the event, including when an organiser
  deletes their own profile from the People list.

- **A restart no longer signs the room out — and a name you had is no longer a
  dead end.** Without `COOKIE_SECRET` the signing key was invented at every
  boot, so each restart invalidated every identity cookie: visitors came back
  as strangers and could not even re-enter under their own names, because the
  name is held (uniquely, per event) by the identity they had just lost. Two
  changes. An unconfigured secret is now generated **once** and kept beside the
  database as `.cookie-secret` (0600), so it survives a restart the way the
  data does; production still demands an explicit one, and a boot that can
  neither read nor write the file says loudly that the next restart will sign
  everyone out. And the gate now recovers from the collision: "already called
  that" comes with a one-click **Enter as “Ada 2”**, which walks up the
  variants until one is free — on the password gate and the demo role picker
  alike.

- **A speaker code no longer outlives the profile it stands for.** Merging a
  duplicate person into another, or deleting a person outright, left the code
  minted for it sitting in `link_codes` — and the phrase still worked. Whoever
  typed it adopted an identity that keeps its **speaker** role and no longer
  appears on the roster, and no organiser could take it back: revoking loads
  the person first, and a soft-deleted one is a 404, so the only way to kill it
  was SQL. Deleting a person now revokes its code in the same transaction, and
  a merge settles the loser's: the code follows the survivor when the survivor
  inherited that identity — so a phrase already handed to a speaker keeps
  working — and is destroyed when the survivor kept its own, because then it
  points at an identity the merge abandoned. Redemption also refuses any code
  whose person has been soft-deleted, as a backstop for rows written before
  this. Device phrases, which belong to no person, are untouched.

- **A demo instance no longer opens every event on it.** `DEMO_MODE=1` made
  the gate a role picker for *all* events, so a real conference running beside
  the demo — or one created through the UI to try the thing out — was open to
  anyone at any role, organiser included, and blank passwords on it were filled
  in with the values printed in this README. The free-for-all now applies only
  to the seeded fixtures (`DEMO_EVENT_SLUGS` if you seed your own); every other
  event checks its passwords exactly as it would on a normal instance. `/me`
  reports the open slugs rather than a single instance-wide flag, and the boot
  warning names them instead of claiming the whole instance is open.

- **Buttons line up with the inputs beside them.** A `text-sm` input with
  `py-2` stands 38px tall; a `text-xs` button with `py-2` stands 32. `FormRow`
  bottom-aligns its children, so the mismatch showed as a step along the top
  edge — "New track" against "Add track", and every other add-row in Manage
  Event. The three button primitives are `py-2.5` with a border (transparent on
  the primary) now, which is the same 38px, and the colour swatches take a
  shared `controlHeightClass` rather than their own `h-9`.

- **Organisers no longer get the tour uninvited.** The first visit to an event
  auto-started the coach-marks for everyone, including the person who had just
  created it — so the walkthrough of how to read a schedule stood between an
  organiser and the first thing they came to do. Admins are skipped now; the
  "?" button still opens it for anyone who wants it.

- **A tall modal is no longer cut off at the top.** The panel was centred with
  `items-center` and capped at `90vh`. An overflowing flex child centred that
  way has its top edge *above* the container's, where no scrolling can reach
  it — and `vh` counts the area behind a mobile address bar, so `90vh` could
  exceed what is actually on screen. The overlay itself now scrolls, wrapping a
  `min-h-full` row, and the cap is in `dvh`.

- **A demo instance seeds the long fixture again.** Boot seeding only created
  DemoConf, so LongConf — the fortnight with tracks, a week rail and empty
  weekends — was missing from deployed demos, and with it every screen only
  that event reaches. `DEMO_MODE=1` now seeds both.


- **A production instance checks its whole deployment at boot, once.**
  `loadConfig` threw on the first missing variable it met, so a fresh deploy
  with three things wrong took three rounds of edit-redeploy-read-the-log,
  each revealing exactly one more problem. A preflight now collects them all —
  missing `COOKIE_SECRET`, missing `INSTANCE_ADMIN_PASSWORD`, a data directory
  that is not a mounted volume, a data directory that exists but cannot be
  written to, an existing database file that cannot be written even though its
  directory can (what a single run as root leaves behind — a root-owned
  `app.db` that surfaces only as `SQLITE_CANTOPEN`), and a missing
  `TRUST_PROXY` behind a platform proxy (a warning, not a failure) — and
  prints each with the fix
  beside it, tailored to whether it is running on a PaaS. Volumes and
  variables cannot be declared in `railway.json`, so the instructions live in
  the program instead: `deploy/railway.env.example` documents the variables,
  and the boot output tells you the rest.

- **A production instance refuses to start on storage that will not survive a
  redeploy.** `openDb` creates the directory it is pointed at, so a container
  with no volume attached got a working `/data` inside its own filesystem —
  SQLite wrote to it, migrations ran, the demo event was seeded, every log line
  looked healthy, and the whole database was discarded on the next build. The
  first symptom was an event disappearing. The server now checks at boot that
  the database's directory is a mount point (its `st_dev` differs from its
  parent's) and exits with instructions if it is not. `ALLOW_EPHEMERAL_DB=1`
  opts a deliberately disposable instance out; development is unaffected.


- **An event's three passwords must now be different from each other.** They
  are the only thing telling the roles apart, and `roleForPassword` checks
  admin first — so an organiser who set one password for all three was not
  giving everyone the same access, they were making every attendee an
  organiser, silently. Creating an event, cloning one, and changing passwords
  in settings all reject a collision now; the settings check compares against
  the stored hashes too, so a new password cannot quietly land on a role that
  is staying put. Swapping two passwords in a single request still works.

### Fixed

- **The ⓘ on a column card can be opened by a finger.** Tapping it flashed the
  panel open and shut in the same gesture, so on a phone it could not be
  pinned at all. A touch browser synthesises the mouse sequence on a tap —
  `mouseenter`, `focus`, `click`, as separate events — and the card opened on
  the enter and toggled shut on the click.

  That is most of what the column card now says. The redesign cut a room card
  down to its name and moved the seats, whether attendees may book it, and the
  organiser's directions behind the ⓘ; the track work put the strand's
  description and its hours there too. None of it was reachable on a phone,
  which is where somebody standing in a corridor actually reads a schedule.

  The card is on the same `usePopover` as search, Filter and the "?" menu now,
  which tells a real mouse from a synthesised one (`mouseOnly` hover,
  focus-visible only) and hands the tap to the button's own click. Two things
  come with the move: the panel dismisses on an outside press like every other
  popdown, and it positions itself rather than being placed — on the last
  column it slides back inside the viewport instead of needing a
  right-align prop to stop it hanging off the end of the grid.

### Changed

- **The organiser's three buttons moved down beside the filters.** Manage
  Event, Arrange Sessions and Add session had a row of the schedule header to
  themselves, held there by the day strip and the Grid/List and Rooms/Tracks
  toggles beside them — which on a desktop left a wide empty gap to the right
  of those toggles and a whole row of header height paying for three buttons.
  They now end the row that carries search, Filter and Now, which had the same
  gap on its right, and the header is one row shorter.

  Below `sm` they still take a line of their own: on a phone they do not fit
  beside the search box, and cramming them there is what the icon-only
  treatment was already avoiding. The move also puts them outside the part of
  the header that folds away as you scroll into a day — Arrange in particular
  is a thing you reach for mid-scroll, and it used to fold out from under you.

- **The logo means home, and home is `/`.** The logo in the schedule, agenda,
  search and event-list headers used to be labelled "All events" and open the
  list; it goes to the landing page now, as does the catch-all for a URL that
  no longer resolves — most often a stale or mistyped event link, which the
  page explaining what to do with an event link answers better than a list of
  events that are not yours. The "back to all events" links in the error
  states and the back links on Import and New event are about the list, not
  about home, and still point at `/events`.


## [0.2.0] — 2026-08-30

### Added

- **A "?" beside the session type.** Official versus open is an authority
  distinction, not a scheduling one, and nothing on screen said so. The note
  explains that official is the published programme, open is attendee-placed
  and stays editable by whoever put it up — so promoting a session to official
  locks it against its creator — and that neither type affects timing.

- **Tracks.** Thematic strands running across rooms and days, defined per event
  from the admin page and ordered like rooms, because that order is the order
  of the columns. A session sits on at most one — unlike a tag, because the
  grid can lay tracks out as its columns and a session occupies exactly one
  column. Once an event has any, the grid gains a Rooms / Tracks switch; read
  by track, each block gains its room on the card, and sessions with no track
  gather in a trailing "Unassigned" column rather than vanishing. Deleting a
  track keeps its sessions — they lose the track, not their room. The choice
  rides in the URL like every other filter. An event with no tracks is
  untouched and never mentions them.

- **Week grouping for long events.** Past a threshold the schedule's day tabs
  stop being one horizontal scroller and split in two: a rail of weeks, each
  labelled with its dates and its session count, and below it only that week's
  days. Days with nothing scheduled are dimmed, and the week holding today is
  marked. The threshold is an event setting — "Group days into weeks past",
  default 8 days — so a one- to three-day unconference looks exactly as it did.
  The selected week is derived from the selected day rather than held in state,
  so a shared `?day=` link still opens on the right week.

- **A fortnight-long demo event.** `npm run seed:long` builds "LongConf 2026"
  — fourteen days from today, weekends clear, alongside the two-day DemoConf
  rather than replacing it. The seed takes `SEED_SLUG`, `SEED_NAME` and
  `SEED_DAYS`, so any length is one command away; `npm run seed` is unchanged.

- **Tag editing.** A tag's name was fixed at creation — the API had accepted a
  rename since the beginning, the admin page just never offered one, and the
  only editable thing was a colour swatch that saved on blur with no way back.
  Clicking a tag now opens an editor with name, colour, and a delete that first
  says how many sessions and pitches carry it.

- **Display names are unique per event.** `PATCH /me` wrote the name with no
  check at all, so anyone could take an organiser's. The name now belongs to
  `(event, identity)` and is unique inside the event — not across the instance,
  which would have let the first person to type "Ada" hold it everywhere
  forever. You claim it at the gate, where a clash comes back in place before
  any role is granted, and change it on your profile. The same name in two
  different events is two different people, and each session or note is
  credited to the name its author uses there.

- **Brand assets.** The LibreSesh logo replaces the placeholder initial-letter
  square: the stacked mark with its "open source scheduling" tagline heads the
  event list, and the one-line wordmark sits in the schedule header, linking
  home. Each variant ships light and reversed artwork rather than one tinted
  with `currentColor`, because the mark is three colours — dark mode *darkens*
  the calendar cells while it lightens the wordmark. An SVG favicon and a
  180px apple-touch-icon are linked from `index.html`.
- **Per-event permission matrix.** Nine capabilities — commenting, moderating,
  pitching, voting, starring, creating and editing open sessions, editing your
  own profile — each assignable to any of the three roles, edited from the
  admin page and enforced server-side by `requireCapability`. Defaults
  reproduce the previous fixed matrix exactly, and only differences from them
  are stored. The organiser column is locked on: an event nobody can moderate
  would have no way back. Structural rules stay fixed — official sessions
  remain organiser-only and open sessions still need an open-track room.
- **Room colours.** Every room carries a colour, shown on its schedule column
  and its header card, and editable in the admin room editor from a palette of
  washed-out watercolour tints or a free-form picker. A new room defaults to
  the first colour none of its neighbours is using. Existing rooms are spread
  across the palette by column order on migration.
- **Room editing.** Capacity and description are editable after creation. The
  API had always accepted them; the admin page exposed neither.
- **Session livestream link.** Optional http(s) link on a session, hidden
  entirely when unset rather than shown as an empty row.
- **Demo mode** (`DEMO_MODE=1`, `npm run dev:demo`). The event gate becomes a
  role picker instead of a password prompt, for public demo deployments. An
  env var rather than a per-event column, so it cannot survive an event clone
  or be flipped on a real event by mistake. Off by default, warns at boot.
- **Build stamp.** The nearest git tag, short commit and build time are stamped
  at build time and shown bottom-right — outright on demo instances, on hover
  elsewhere. Dockerfile takes `BUILD_TAG`/`BUILD_COMMIT` build args, since that
  stage has no `.git`.

### Changed

- **`rooms.open_track` is `rooms.open_booking`.** The column never held a
  track — it is a boolean meaning "attendees may schedule here". The word left
  the UI on 2026-08-30; with real tracks now in the schema the name had gone
  from vague to wrong, so the column, `RoomDto.openTrack`, the API field and
  the "not an open track" error all follow. `openBooking` is a breaking change
  to the room API.

- **The permission matrix opens locked.** Every switch in it saves the instant
  you click it and there is no undo, so it now greys out until the organiser
  password is typed. A new `POST /e/:slug/confirm-admin` checks the password
  and grants nothing — deliberately not the auth endpoint, which upserts a
  role, so an organiser who typed the *viewer* password into a confirmation box
  would have quietly demoted themselves out of the page they were standing on.

- **Room cards lead with what you can do in the room.** "Attendees may book
  this room" moves above the capacity rather than trailing it. Capacity is a
  three-digit number in a narrow field now, not a half-width one, and a typed
  minus sign is dropped. The colour a new room will get is a note beside the
  button rather than a form field pretending to be editable, and the palette
  shows the hex it has landed on.

- **Duplicating an event is behind a button.** Seven fields for a thing that
  happens once in an event's life, if ever, sat permanently open above Trash.
  The section now expands on request, and says "Duplicate Event/Conf".
- **Form fields in a grid line up.** `FormGrid` bottom-aligned its children, so
  a field without a hint had its input lifted by the height of its neighbour's
  — which is what knocked the room editor's Name and Capacity out of line. It
  aligns tops now; every child is a `Field` whose label is one line, so the
  inputs align and hints hang below. The room card also stacks with `FormStack`
  rather than a run of hand-placed margins.

- **The room panel's create form matches its editor.** Name, capacity and
  colour sit on a grid; the booking permission gets its own line below; the
  button gets its own row. Everything used to share one line, which needed a
  hand-tuned margin on the colour swatch to fake a baseline. The permission
  now reads "Attendees may book this room" in all three places it appears, and
  in the editor it is part of the form — it used to save the instant you
  clicked it, so Cancel could not undo it.

- **The schedule header is sorted by what each control is for.** Pitches moves
  down beside the grid/list switcher and the Now button — it is another way of
  looking at the programme. Calendar export and Subscribe move into the name
  menu and lose their toolbar button; both are personal to you, and the
  subscription link literally is.

- **The identity chip opens a menu, not a modal.** Tapping your name in the
  schedule header used to open a panel that could rename you *and* change your
  role by typing another event password — two consequential changes one stray
  click apart. It is now a two-item dropdown: view/edit your profile, or sign
  out. Your display name moved onto the profile form, beside the profile name
  it was always a separate record from, and roles follow the passwords an
  organiser issues, so changing yours means signing out and entering another.

- **Form layout primitives.** `Field` no longer carries its own bottom margin,
  which had forced every adjacent button to hardcode a matching `mb-3` to sit
  on the same baseline — and broke whenever a field grew a hint. Spacing now
  belongs to `FormStack`/`FormRow`/`FormGrid`. Adds `Section`, `DangerButton`,
  `IconButton`, `TextLink` and `Toggle`; the admin page moves onto them, losing
  its underlined-at-rest links and its text-link "delete" actions.
- **Identity is held in context.** `useMe` fetched `/me` wherever it was
  called, so a second caller meant a second round trip for the same answer.
- The demo event's open-track room is called "Unconf Room".
- **Nothing user-facing calls a booking permission a "track" any more.** No
  track is implemented anywhere — `rooms.open_track` is a boolean meaning
  "attendees may schedule here" — so the schedule badge now reads "anyone may
  book", and the session modal and tour say what they mean.
- **The schedule's room band is detached from the grid.** Each room is a
  card with a "Room" axis label beside it, rather than a row of table cells
  flush on the time grid, which read as weekday headers.

### Fixed

- **A dragged session flashed back to its old slot before landing.** On drop
  the drag state was cleared before the PATCH was even sent, and the block's
  position comes entirely from that state — so it repainted where it started
  for a whole round trip, then jumped forward when the response arrived. The
  block now waits where you dropped it until the server answers, and a
  rejected move snaps back at the moment we learn it failed. A block whose
  save is still in flight can no longer be picked up again, which would have
  raced its own `expectedUpdatedAt`.

- **The build stamp took the whole app down in dev.** Vite's `define` is only
  substituted in a production build, so the identifiers survived verbatim and
  threw `ReferenceError` on render — with no error boundary, that blanked the
  page. Now read from `import.meta.env`, with defaults rather than assertions.

## [0.1.0] — 2026-08-29

First release. Everything below is new.

### Added

- **Schema and migrations.** Numbered `.sql` migrations applied at boot, SQLite
  in WAL mode with foreign keys on. Soft deletes throughout and an append-only
  audit log of every write.
- **Anonymous identity.** A signed httpOnly cookie minted on first contact, with
  a renamable display name. No accounts, no email.
- **Per-event roles.** Three shared passwords per event — viewer, user, admin —
  checked highest first. Entering a higher password upgrades your role; a lower
  one downgrades it. Viewing requires the viewer password, so schedules are
  never public.
- **Rooms, tags, sessions and contributions API.** The permission matrix is
  enforced server-side: users may only place open sessions in open-track rooms,
  inside the event dates and day viewport, and never overlapping; admins may
  double-book. Edits carry `expectedUpdatedAt` and return 409 when stale.
- **Live updates over SSE.** One in-process channel per event with a 25-second
  heartbeat. Every write publishes the fresh entity, so clients patch a single
  bundle by id instead of refetching.
- **Schedule UI.** Calendar and list views on a five-minute grid, day tabs, a
  live now-line with a "Now" jump button, and deep-linked session sheets.
  Mobile-first, down to 360px.
- **Editing UI.** Create/edit modals for admins and open-track users, drag to
  move and resize (250ms hold on touch), conflict toasts with snap-back, plus an
  admin page for rooms, tags, passwords and archiving.
- **Contributions.** Notes, links and questions per session, grouped by kind,
  with author names and relative times. Authors delete their own; admins delete
  or hide anything. Descriptions render as markdown with raw HTML escaped
  before parsing.
- **Duplicate an event.** Organisers can clone an event from its admin page;
  rooms and tags carry over, sessions and contributions do not.
- **Reorderable room columns.** Arrow controls in the admin page, renumbering
  the list so rooms created before this existed sort themselves out.
- **Overlap badge.** Admins may double-book a room, so clashing blocks are
  badged on the calendar rather than prevented.
- **Proposal board.** Pitch a session with no room or time, register interest in
  other people's pitches, and let organisers place the popular ones on the grid.
  Placing carries the pitch's tags, speaker and interested people across.
- **Undo for deletions.** Organisers can list and restore soft-deleted sessions
  and contributions. Restoring a session whose room has since been deleted is
  refused rather than resurrecting a dangling reference.
- **Star counts.** How many people have a session on their agenda, flagged when
  it exceeds the room's capacity.
- **Agenda clash warnings.** Two starred sessions that overlap are called out,
  in the banner and on the row.
- **Cross-day search.** Text search reaches every day of the event, not only the
  one on screen.
- **Personal agenda.** Star sessions to build your own agenda, filter the
  schedule down to it, and share that filter as a link. Stars are private to
  you and never broadcast.
- **Calendar export.** Download the whole schedule or just your starred agenda
  as an `.ics` file, or take a personal subscription link your calendar app
  refreshes on its own. The link authenticates by capability token, since a
  calendar app cannot present a session cookie, and only ever grants what your
  role already allows.
- **Dark mode.** Light, dark, or follow the system setting.
- **Speaker and host profiles.** Speakers are per-event records rather than free
  text, each with a bio, links and a page listing their sessions. Organisers
  curate the roster; anyone with a role owns at most one profile and may edit
  it, viewers included.
- **Guided tour.** Seven to ten coach marks on first visit, anchored to the real
  controls and tailored to your role. Replayable from the header.
- **Named participant role.** Each event chooses what it calls its middle role,
  defaulting to "attendee"; anonymous identities are `attendee_xxxxx`.
- **Filters in the URL.** Room and tag multi-select, free-text search and a
  "now / next" quick filter, all held in the query string so a filtered view is
  shareable.
- **Rate limiting.** In-memory token buckets keyed by identity *and* IP. Auth is
  capped at 5 attempts per 15 minutes, refunding the token on success.
- **Deployment.** Docker Compose and systemd run modes behind Caddy, a nightly
  `VACUUM INTO` backup script with retention, and a VPS runbook in the README.
- **Tests.** 171 Vitest cases covering the role matrix, session and proposal
  write rules, overlap and stale-edit handling, contribution moderation, undo,
  the rate limiter, timezone maths, iCal generation and the SSE stream.
- **Documentation.** `ARCHITECTURE.md` describes the design and the threat
  model — including what is deliberately *not* defended against.
