# Importing a schedule

`POST /api/events/import` builds a whole event — rooms, tracks, tags and a full
grid of sessions — from one JSON document.

It exists because the usual way a programme arrives is not as data. It is a
printed booklet, a conference website, a photograph of a wall of sticky notes.
Someone has to turn that into a schedule, and doing it a session at a time
through the UI is an afternoon's work that goes wrong quietly. So the document
this route accepts is written the way a schedule is *printed* — room names and
wall-clock times, no ids — which is something a person can type and a program
can produce from a picture.

A copyable template lives at
[`examples/schedule-import.example.json`](examples/schedule-import.example.json).
The test suite dry-runs that exact file, so it is never stale.

## The recipe

The route is guarded by the **instance password**, like creating an event by
hand, because it makes an event rather than editing one.

### In the browser

**`/import`** is the same route with a screen in front of it, and is the way in
if you have a schedule rather than a terminal. Paste the document or pick the
file, press **Check it**, and read what would land; **Import** unlocks once that
rehearsal succeeds and locks again the moment you edit the document, so what you
approve is always what you send.

### From the command line

```bash
# 1. Rehearse. Validates everything, reports what would land, writes nothing.
curl -X POST 'https://your-host/api/events/import?dryRun=1' \
  -H "X-Instance-Key: $INSTANCE_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data @schedule.json

# 2. Keep it. Same request without the flag.
curl -X POST 'https://your-host/api/events/import' \
  -H "X-Instance-Key: $INSTANCE_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data @schedule.json
```

Do step 1 — the screen at `/import` will not let you skip it. A wrong
transcription and a right one look identical until something reads them, and the dry run is the only thing that reads one without keeping
it. It takes the same path as the real import and rolls back at the end, so
every check a real import would make has already run.

The response is the same either way:

```json
{
  "slug": "valley-2026",
  "eventId": 7,
  "dryRun": false,
  "counts": { "rooms": 3, "tracks": 2, "tags": 2, "sessions": 4, "people": 2 },
  "warnings": [],
  "generatedPasswords": {
    "viewerPassword": "cedar-lantern-quiet-river",
    "userPassword": "harbour-plum-steady-oak",
    "adminPassword": "willow-anchor-bright-fern"
  }
}
```

`eventId` is `null` on a dry run — nothing was written, so there is no id to
give. `counts.sessions` is what actually lands, repeats expanded, so it is the
first thing to read back against the programme. **Keep `generatedPasswords`**: they are stored hashed and that response
is the only place they can ever be read.

## The document

Unknown top-level keys are refused rather than ignored, so `"session"` for
`"sessions"` fails loudly instead of importing an empty grid.

### `event` (required)

| Field | Required | Notes |
| --- | --- | --- |
| `name` | ✓ | Up to 120 characters |
| `slug` | ✓ | 3–40 of `a–z`, `0–9`, `-`. Must be free — a taken one is a `409`. A slug an existing event has been *renamed away from* still counts as taken, because old links keep resolving to it |
| `timezone` | ✓ | IANA, e.g. `Europe/Berlin`. This is what turns printed times into instants |
| `startDate`, `endDate` | ✓ | `YYYY-MM-DD`. Every session must fall inside them |
| `dayStartMin`, `dayEndMin` | | Minutes from midnight for the visible hours. Default `480`–`1320` (08:00–22:00) |
| `userRoleLabel` | | What this event calls its middle role. Default `attendee` |
| `defaultView` | | Which view the schedule opens in for a reader who has not picked one: `list` or `cal`. Default `list` |
| `viewerPassword`, `userPassword`, `adminPassword` | | Leave any out and a four-word phrase is generated for it and returned once. All three must differ |

The importer does **not** become an organiser by virtue of importing. Roles are
earned at the gate, so whoever holds the admin phrase is the organiser — hand it
over the same way you would for any event.

### `rooms`

Array order is column order on the grid: list them the way they are printed.

| Field | Required | Notes |
| --- | --- | --- |
| `name` | ✓ | Up to 80 characters. Unique within the document |
| `description` | | Up to 500 characters — access notes, floor, how to find it |
| `capacity` | | Integer, or `null` for unknown |
| `color` | | `#RRGGBB`. One is assigned from the palette if omitted |
| `openBooking` | | `true` lets attendees schedule here themselves. Default `false` |

### `tracks` and `tags`

| Field | Required | Notes |
| --- | --- | --- |
| `name` | ✓ | 60 characters for a track, 40 for a tag. Unique within its own list |
| `description` | | Tracks only. Up to 500 characters — what the strand is for, who it is aimed at |
| `color` | | `#RRGGBB`. Tracks take one from the palette, tags default to grey |

Both are optional, and both are declared here or not at all. A track's
`description` reaches attendees the same way a room's does: behind the info
button on the column header, where the schedule keeps what will not fit on the
card itself.

A track may also state the hours it keeps, which is how "workshops run in the
mornings" gets said once instead of being watched for:

| Field | Required | Notes |
| --- | --- | --- |
| `start`, `end` | | `HH:MM`, both or neither. Omitted, the track takes a session at any hour |
| `windows` | | Days that keep different hours: `[{ "date": "2026-09-02", "start": "14:00", "end": "18:00" }]`. One entry per date |

A day in `windows` *replaces* the track's own hours for that date rather than
narrowing them, so a day can be wider than usual as easily as shorter.

```json
{
  "name": "Workshops",
  "start": "09:00",
  "end": "13:00",
  "windows": [{ "date": "2026-09-02", "start": "14:00", "end": "18:00" }]
}
```

The hours bind attendees and speakers: a session of theirs that starts before
the track opens or runs past its close is refused, naming the window. Organisers
are not held to them — the grid stays the organiser's instrument — so an import,
which runs with the instance password, places whatever the document says.

### `breaks`

Lunch, dinner, the coffee break — the parts of the day that belong to the whole
event rather than to a room. They are not sessions: nobody hosts one, they sit
in no column, and nothing on the schedule opens them. They are drawn as a quiet
band behind the grid so nobody books over one by accident, and they stop
nothing — a session may still run through lunch.

| Field | Required | Notes |
| --- | --- | --- |
| `label` | ✓ | Up to 60 characters — `Lunch`, `Coffee`, `Dinner` |
| `start`, `end` | ✓ | Wall-clock `HH:MM`, on the 5-minute grid. `end` must be after `start` |
| `date` | | One day only, `YYYY-MM-DD`. **Omit it for every day of the event**, which is the usual case |

```json
"breaks": [
  { "label": "Lunch", "start": "12:00", "end": "14:00" },
  { "label": "Conference dinner", "start": "19:00", "end": "21:30", "date": "2026-09-02" }
]
```

Up to 40 of them. A `date` outside the event's dates is refused — a break
nobody is there for is invisible, and silently so.

### `sessions`

| Field | Required | Notes |
| --- | --- | --- |
| `room` | ✓ | The name of a declared room |
| `title` | ✓ | Up to 120 characters |
| `track` | | The name of a declared track, or `null` |
| `tags` | | Names of declared tags, up to 20 |
| `description` | | Markdown, up to 5000 characters |
| `speaker` | | Free text. Matches an existing profile in this event, or creates an unclaimed one |
| `type` | | `official` (default) or `open` |
| `blocksOpenBooking` | | `true` holds the floor: while this session runs, attendees can add nothing anywhere in the event. Official sessions only. Default `false` |
| `date`, `start`, `end` | ✓ | Local date and wall-clock times — see below |
| `startsAt`, `endsAt` | | ISO instants instead, for a document a program wrote |
| `repeat` | | Say the row once, land it on every day it happens — see below |

**Rooms, tracks and tags are declared once and referred to by name.** Matching
ignores case and collapses whitespace, because transcription is not consistent —
`"main  hall"` finds `"Main hall"`. A session naming something undeclared is
refused rather than invented: a typo that quietly grew a fourth column is far
harder to spot in a finished grid than an error naming the row it came from.

## Times

Use `date`, `start` and `end` — the date and the times as printed, in the
event's own timezone:

```json
{ "date": "2026-09-14", "start": "09:30", "end": "10:30" }
```

24-hour clock. `24:00` is a valid `end` and means midnight closing that day,
which is how a last session of the evening is usually printed.

A document written by a program may give `startsAt` and `endsAt` as ISO
instants instead. The two forms cannot be mixed within one session — a document
that tries is refused, because there would be no way to tell which one was
meant.

Times must land on a five-minute step and run between 5 minutes and 8 hours,
the same rules the session form applies.

## Repeating a session

Most of a long programme is the same thing every day: the two officials that
open and close it, the track that always runs 14:00–16:00, the meal nobody
writes down twice. `repeat` says that once.

```json
{
  "room": "Main hall",
  "track": "Tech",
  "title": "Tech track",
  "date": "2026-09-14",
  "start": "14:00",
  "end": "16:00",
  "repeat": { "until": "2026-10-02", "days": ["mon", "tue", "wed", "thu", "fri"] }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `until` | ✓ | `YYYY-MM-DD`, inclusive. Must not be after the event's `endDate` |
| `days` | | `mon`…`sun`. Omit it for every day |
| `except` | | Dates the run skips — a holiday, an excursion day |

The session's own `date` is the first occurrence, `until` is the last, and
every matching day in between gets one. Twenty days of three daily officials is
three rows.

The session form does the same thing for one session at a time — **Repeat**,
under the day and time — and shares this rule, so a run the form offers is a
run this document could have said. Use the form for a session or two inside an
event that already exists; use a document when a whole programme is being
transcribed at once.

**What lands is ordinary sessions.** There is no series, no link between them,
nothing that remembers they were written as one line: twenty rows that can each
be dragged, retitled, given a different speaker or deleted on their own. That
is deliberate. A schedule is edited constantly, and a series that fought back
the first time one day's keynote moved an hour would cost more than the typing
it saved. The flip side is the honest one: **changing a repeating session after
the import means changing each day**, so dry-run until the run is right.

`repeat` needs `date`/`start`/`end` and refuses `startsAt`/`endsAt`. A repeat is
a claim about the printed clock — "14:00 every day" — and each day is resolved
through the event's timezone separately, so a run that crosses a clock change
stays at 14:00 instead of sliding by an hour halfway through. An instant cannot
say that, so a document that tries is refused rather than quietly reinterpreted.

## What is refused, and what is only flagged

Contradictions **inside the document** are refused. The whole import is one
transaction, so a document that fails on its last row leaves nothing behind and
the fix is always "correct the file and run it again". Every message names the
row it came from:

```
sessions[3] "Opening keynote": no room called "Balcony" is declared
sessions[3] "Opening keynote": 2026-07-04 is outside the event dates 2026-09-14…2026-09-15
sessions[3] "Opening keynote": Start time must land on a 5-minute step
sessions[3] "Opening keynote": only an official session can hold the floor
sessions[3] "Opening keynote": only an official session can be a break
Two rooms are both called "Main hall"
```

A repeat is refused when it contradicts the row it sits on — an `until` before
the session's own date, a `days` list that leaves out the weekday it starts on,
an `until` past the end of the event, or a combination of `days` and `except`
that lands on no day at all. Once expanded, each occurrence is checked like any
other session, and a message that names one names its date:

```
sessions[3] "Morning circle" on 2026-09-19: no room called "Balcony" is declared
sessions[3] "Morning circle": repeats until 2026-10-04, after the event ends 2026-10-02
```

A session outside the event's own declared dates is refused because the dates
and the session are in the same file: one of the two is a transcription error,
and refusing says which.

Things that are merely **suspicious come back in `warnings`** and are imported
anyway, because both are things an organiser is allowed to do:

- *runs outside the hours the schedule shows* — the session is in the database
  and off the top or bottom of the grid, which reads as a failed import.
  Widening `dayStartMin`/`dayEndMin` in Manage Event → Settings reveals it.
- *overlaps …* — two sessions double-booked in one room. Organisers may do
  this, and the grid badges the clash. Breaks are not sessions and never raise
  it: lunch occupies no room.
- *imported as an ordinary session* — a session carrying `background`, which
  used to mean "this is a break". Breaks are their own list now, so the flag is
  ignored rather than refused: the row still lands, and the warning says to
  move it into `breaks`.
- *excepting that day does nothing* — a `repeat.except` date the run never
  reaches, which is the shape a mistyped date takes and is otherwise invisible:
  the grid just quietly has that day.

A warning about a repeating row is reported once and names the rule rather than
a date — `sessions[0] "Morning circle" (repeats every day) runs outside the
hours…` — because it is equally true of every occurrence, and twenty copies of
it would bury the warnings that differ.

## From a photo to a document

The pipeline this was built for:

1. Photograph the programme — a page, a poster, a wall.
2. Transcribe it into the shape above. Read the room names off the column
   headings and declare them in the order they appear; read the times off the
   rows.
3. Dry-run it and read the `warnings` back against the photo. This is where
   transcription errors surface: a session in the wrong column, a 13:00 that
   was really 15:00, a room named twice.
4. Run it for real and hand out the admin phrase.

Two things are worth knowing before step 2. The event's `timezone` is what
makes the printed times mean anything, so get it right before anything else.
And a session with no `speaker` is fine — an empty string is better than a
guess, since a wrong name creates a profile someone then has to merge away.

## What it deliberately does not do

- **It does not read `export.json` back.** An export is a record of ids,
  instants and authorship belonging to identities the target instance has never
  seen; importing one wants a new slug, fresh ids and a decision about those
  names. The encrypted whole-database backup remains the restore path. See
  ARCHITECTURE.md §Importing a schedule, and why it is not the export read
  backwards.
- **It only creates events, never updates one.** There is no way to add a day
  to an event that already exists, or to re-run a corrected document over the
  top of a previous import. Delete the event and import again.
- **Request bodies are capped at 256 KB**, which is a large schedule but not an
  unlimited one. A document over the cap is rejected by Express before this
  route sees it, as a `413` naming the limit; `/import` checks the size before
  sending, so a wrong file is caught with the file still in hand.
