---
name: libresesh-schedule
description: Read and act on a LibreSesh (un)conference schedule for the person you are helping — what is on now, what is in a room, build them an agenda, post a question to a session, pitch one. Use when someone gives you a LibreSesh event link (a URL ending /e/<slug>) and a password.
---

# LibreSesh event schedule

A LibreSesh instance hosts conference and unconference events. Each event lives
at `/e/<slug>` on its host and holds rooms, a programme of sessions across days,
a board of pitched sessions, and notes, links and questions on each session.

On the same host: `/agents.md` is the full operating manual, `/api.md` the
endpoint reference, and `/llms.txt` a one-paragraph description of the
instance.

## When to use this

The person gives you an event link and a password, and wants to know what is
on, wants a schedule built for them, or wants to say something on the board.

## What you need from the person

- **The event URL** — the `/e/<slug>` part gives you the host and the slug.
- **A password.** There are three per event, granting different things:
  viewer (read), attendee (read and write), organiser (the programme). They are
  handed out at the event on badges, slides and QR codes. Ask; never guess —
  attempts are capped at five per quarter hour.

There is no public view of any event. Without a password there is nothing to
read.

## Get in, and read the whole thing

Two calls. Keep a cookie jar across them — identity is a signed cookie and
there is no bearer token.

```bash
curl -c jar -b jar -X POST "$HOST/api/e/$SLUG/auth" \
  -H 'Content-Type: application/json' \
  -d '{"password":"'"$PW"'","displayName":"scheduling-bot"}'

curl -b jar "$HOST/api/e/$SLUG/bundle"
```

The bundle is the **entire event in one response** — rooms, tracks, tags,
breaks, every session with its times and speakers, people, pitches, star counts,
and a `permissions` map saying what your role may do. Do not crawl anything;
there is nothing to crawl and no pagination.

To stay current, subscribe rather than poll:

```bash
curl -N -b jar "$HOST/api/e/$SLUG/stream"     # Server-Sent Events, unlimited
```

## Answering questions from the bundle

Everything below is local work on that one response.

- **"What's on now?"** — filter `sessions` where `startsAt <= now < endsAt`.
  Times are UTC ISO-8601; render them in `event.timezone`, never in UTC and
  never in the viewer's own zone unless they ask.
- **"What's in the main hall?"** — `sessions` filtered by `roomId`, matched
  against `rooms`.
- **"What should I go to?"** — `sessions` carry `tagIds`, `trackId` and a
  `description`; `starCounts` says what other people are interested in. Suggest;
  let the person choose.
- **"What are people pitching?"** — `proposals`, ordered by `interestCount`.
- **Comments on a session** — the bundle carries only counts. Fetch
  `GET /api/e/$SLUG/sessions/<id>` for the notes, links and questions.

## Acting for the person

Each needs the attendee password or better. Check the `permissions` map first
rather than provoking a `403`.

| They asked for | Call |
| --- | --- |
| Save this to my agenda | `PUT /api/e/$SLUG/sessions/<id>/star` |
| Subscribe my calendar | `POST /api/e/$SLUG/calendar-token`, then `GET /calendar.ics?token=…&mine=1` |
| Ask a question on a session | `POST /api/e/$SLUG/sessions/<id>/contributions` with `{"kind":"question","body":"…"}` |
| Leave a note or a link | the same, `kind` of `note` or `link` (a link needs `url`) |
| Pitch a session | `POST /api/e/$SLUG/proposals` with `{"title":"…","description":"…"}` |
| Book a room that allows it | `POST /api/e/$SLUG/sessions` — needs `roomId`, `title`, `startsAt`, `endsAt` |

Times you send must land on a **5-minute step in the event's timezone** and
inside its day viewport. When editing, send `expectedUpdatedAt` — the
`updatedAt` you read — so a clash returns `409 stale` rather than overwriting
somebody.

## Rules

**Write only what was asked for, once.** A pitch, a question and a note all
appear under the person's name to a room of people who will answer them.

**Never star, vote or pitch on your own initiative.** Stars and pitch interest
are private signals of what a human wants to attend, and the event uses them to
decide what gets a bigger room. Manufacturing them corrupts the thing they are
for.

**Say you are a program** — a recognisable `User-Agent`, and a display name
that reads like software.

**Do not carry a credential between events, and do not republish a schedule.**
You were given a password for one event by one person.

**Stop and ask when unsure.** Every write is live on every open browser within
a second, and sits in the organiser's audit log with your identity against it.

## If something fails

Errors are always `{"error":{"code":…,"message":…}}` — branch on `code`.

- `401 unauthorized` — no role yet. Sign in. Under `/api/e/<slug>/` this also
  means "no such endpoint", so sign in before concluding one is missing.
- `403 forbidden` — wrong password, or your role is not enough.
- `409 stale` — someone edited it since you read it. Re-read, then decide.
- `409 name_taken` — that display name is in use here. Pick another.
- `429 rate_limited` — honour `Retry-After`. If you are hitting this, you are
  polling something you should be subscribing to.
