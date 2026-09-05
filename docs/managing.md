# Managing an event

**Manage Event** — the link beside your name, organisers only — is seven
tabs. The open tab lives in the URL as `?tab=`, so a link lands a
co-organiser on the same one.

| Tab | What it holds |
| --- | --- |
| Programme | Rooms, tracks and tags |
| People | Everyone who has joined, plus speaker and host profiles: who holds each, at what role, and whether their code is still unused |
| Permissions | Which roles may do what at this event |
| Settings | Name, address, dates, day bounds, passwords, audit retention, duplicate, archive |
| Trash | Deleted sessions and contributions, with restore |
| Backup | The event as JSON, and the encrypted whole-instance download |
| Audit | Who created, edited, deleted or restored what, by name and UID |

Browser backups and the host-side ones: [deploy.md](deploy.md#backups).

## Audit log

The audit log records every write, plus failed password and device-phrase
attempts, and nobody can edit it — organisers included. It keeps the newest
1000 entries per event by default; past that the oldest are dropped as new
ones arrive. Settings changes the number, and 0 keeps everything. That is a
real trade rather than a detail: a low cap means someone making a great
many edits can push an earlier action off the end.

## Renaming an event

An event's address is its slug — `/e/valley-2026` — and Settings can
change it after the fact, for the typo, the rebrand, or the slug picked
before the event had a name. **The old address goes on working.** Every
slug an event has ever had keeps resolving to it, so the invite link on a
badge, a QR code taped to a door, a subscribed calendar feed and any
script written against the old name all still answer; the app moves the
address bar to the current slug when it notices.

Nobody is signed out and nothing is re-entered either — a role is held
against the event, not against its name, so organisers stay organisers and
starred agendas stay starred. Open browsers follow the rename without a
reload.

A slug that still redirects cannot be claimed by a new event, a duplicate
or a JSON import, so an old link can never be quietly re-pointed at
somebody else's event. Renames appear in the audit log under their own
word, *renamed*.

## Importing a schedule from JSON

`POST /api/events/import` builds a whole event — rooms, tracks, tags and a
full grid of sessions — from one JSON document. It is guarded by the
instance password, like creating an event by hand, because it makes an
event rather than editing one.

**[`/import`](/import)** is that route with a screen in front of it: paste
the document, check it, import. From a terminal:

```bash
# Rehearse first: this validates everything and writes nothing.
curl -X POST 'https://your-host/api/events/import?dryRun=1' \
  -H "X-Instance-Key: $INSTANCE_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' --data @schedule.json

# Then drop the ?dryRun=1 to keep it.
```

The document is written the way a schedule is printed — room names and
wall-clock times, no ids — so it can be typed by hand or transcribed from a
photo of a programme:

```json
{
  "event": {
    "name": "Photo Conf",
    "slug": "photoconf",
    "timezone": "Europe/Berlin",
    "startDate": "2026-06-01",
    "endDate": "2026-06-02"
  },
  "rooms": [{ "name": "Main hall", "capacity": 200 }, { "name": "Side room" }],
  "tracks": [{ "name": "Design" }],
  "sessions": [
    {
      "room": "Main hall",
      "track": "Design",
      "title": "Opening keynote",
      "speaker": "Ada Lovelace",
      "date": "2026-06-01",
      "start": "09:00",
      "end": "10:00"
    }
  ]
}
```

Rooms, tracks and tags are declared once and referred to by name — a
session naming one that was not declared is refused rather than invented —
and room order is column order. Everything lands in one transaction, so a
document that fails on its last row leaves nothing behind. Contradictions
are refused naming the row that caused them; a session outside the visible
hours or double-booked against another is imported and named in `warnings`
instead.

**[schedule-import.md](schedule-import.md)** is the full field reference,
the error and warning catalogue, and the photo-to-document workflow.
[`examples/schedule-import.example.json`](examples/schedule-import.example.json)
is a template to copy; the test suite dry-runs it, so it cannot go stale.

An event's own `export.json` is not written in this form — it is a record of
ids — but the importer reads one anyway: it is translated at the door and
imported as the programme it describes. Give it a new address — the **Address**
field on `/import` — since its own is taken; profiles,
pitches, contributions and star counts stay behind, and the first warning says
so. See [schedule-import.md §Importing an export](schedule-import.md#importing-an-export).