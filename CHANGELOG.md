# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

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

### Changed

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
