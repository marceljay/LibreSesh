# The LibreSesh HTTP API

For programs: scripts, integrations, and AI agents acting for someone at an
event. Everything here is what the web app itself uses — there is no separate
machine API, and no endpoint the browser cannot also reach.

This file is served by the instance you fetched it from, so it describes that
instance's build. Replace `https://example.org` below with its address.

This is the reference. Three shorter documents sit in front of it:
[`/llms.txt`](/llms.txt) says what this site is, [`/agents.md`](/agents.md) is
the operating manual for an agent acting here — access, the flow, the policy on
writing for a human — and [`/SKILL.md`](/SKILL.md) is the same in the packaged
skill format. Read `/agents.md` first; come here for the detail.

## Read this first, if you are an agent

Three sentences will keep you out of every wall in this document:

1. **Fetch `GET /api/e/:slug/bundle` once.** It is the whole event in one
   response — rooms, tracks, tags, breaks, every session, people, pitches. You
   do not need to walk anything.
2. **Then subscribe to `GET /api/e/:slug/stream`** and patch your copy from it.
   It is a normal SSE stream and it is not rate limited.
3. **Keep your cookie jar.** Identity is a cookie. A client that discards it
   gets `401` on every request and mints a junk identity row each time.

An agent that does those three things cannot hit a rate limit. One that polls
`/bundle` in a loop with no cookie will exhaust the identity-minting budget for
its whole network address, which hurts the people sitting next to it more than
it hurts itself.

Say you are a program. Put something recognisable in your `User-Agent`, and if
you enter an event under a display name, let it read like software rather than
a person.

## Authentication

There are three credentials, and they are not interchangeable.

### 1. An event password → a cookie

The ordinary one. Every event has three passwords — viewer, attendee, organiser
— and the role you get is derived from which one you send.

```bash
curl -c jar -b jar -X POST https://example.org/api/e/democonf/auth \
  -H 'Content-Type: application/json' \
  -d '{"password":"…","displayName":"scheduling-bot"}'
# → {"role":"user"}
```

The response sets a signed `cid` cookie. Send it on every subsequent request.
`displayName` is required on a first entry and must be unique within the event;
omit it when re-entering on a device that already holds one.

There is **no bearer token**. `Authorization: Bearer …` and an unsigned cookie
both answer `401`; the cookie's signature is checked against the instance's
`COOKIE_SECRET`. Any HTTP client with a cookie jar works — `curl -c/-b`,
`requests.Session()`, `fetch` with a jar. A stateless client does not.

### 2. `X-Instance-Key` — a header, no cookie needed

The instance password. It gates creating an event, importing one, and taking a
whole-database backup. It is the strongest credential on the instance; do not
hand it to anything that only needs to read.

```bash
curl -X POST 'https://example.org/api/events/import?dryRun=1' \
  -H "X-Instance-Key: $INSTANCE_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' --data @schedule.json
```

### 3. A calendar token — read-only, cookie-free

`POST /api/e/:slug/calendar-token` (needs a role) returns a token that then
works with no cookie at all:

```
GET /api/e/democonf/calendar.ics?token=…       whole schedule
GET /api/e/democonf/calendar.ics?token=…&mine=1  only starred sessions
```

It grants exactly what its owner's role allows, for that one event, and dies
when the role is removed. It returns iCalendar, not JSON, and covers sessions
only — no pitches, no comments.

### Being handed an identity

A person can pass their identity to a program out of band: they mint a
three-word phrase from the menu behind their name and you redeem it with
`POST /api/me/link`. You then *are* them — same role, same authorship, same
name. Phrases are single-use and live ten minutes. Organisers can also mint a
standing speaker code for a person, which does the same thing until revoked.

Treat either as the credential it is. Redeeming one replaces whatever identity
your cookie jar already held.

## Reading an event

| | |
| --- | --- |
| `GET /api/e/:slug/bundle` | The whole event, one response |
| `GET /api/e/:slug/stream` | SSE; patch your copy from it |
| `GET /api/e/:slug/sessions/:id` | One session **plus its contributions** — the only thing not in the bundle |
| `GET /api/e/:slug/export.json` | Organisers only; `?include=sessions,people,proposals,contributions` |
| `GET /api/events` | Public. Every event on the instance, names and dates only — no schedule |
| `GET /api/me` | Who this cookie is, and its roles |

The bundle carries `role` and a `permissions` map (capability → the roles
allowed to use it), so you can tell what you are allowed to do without
provoking a `403` to find out.

For scale: a fourteen-day, 186-session event is one response of about 100 KB,
6 KB compressed, built in under 5 ms.

### The stream

`GET /api/e/:slug/stream` is `text/event-stream`. Event names:

```
session.created   session.updated   session.deleted
proposal.created  proposal.updated  proposal.deleted
contribution.created  contribution.updated  contribution.hidden  contribution.deleted
room.*  tag.*  track.*  format.*  break.*  person.*
event.updated     permissions.updated
```

Each frame's `data` is the same DTO the bundle uses for that thing. Heartbeats
arrive every 25 seconds. On reconnect, refetch the bundle — there is no replay
yet.

Stars and pitch interest are private: they are never broadcast and never
attributed in any payload. Only aggregate counts leave the server. Do not build
anything that tries to work out who starred what.

## Writing

Everything below is JSON in and JSON out. Bodies are capped at 256 KB.

```bash
curl -b jar -X POST https://example.org/api/e/democonf/sessions \
  -H 'Content-Type: application/json' -d '{
    "roomId": 3,
    "title": "Schedules as commons",
    "description": "Markdown is fine here.",
    "startsAt": "2026-10-01T07:00:00.000Z",
    "endsAt":   "2026-10-01T08:00:00.000Z",
    "speakers": [12, "Ada Lovelace"],
    "tagIds": [1, 5]
  }'
```

`speakers` takes a mix of ids (someone already on the roster) and names
(someone who is not, matched or created). `PATCH` the same shape; an omitted
key is left alone, `[]` clears a list, `null` clears a nullable field.

`"draft": true` keeps a session off the schedule. Only organisers, its creator
and the people credited on it are ever sent it — in the bundle, on the stream,
anywhere — and to everyone else its routes answer `404`. It claims no room or
time until `PATCH`ed to `"draft": false`, which is checked like a new booking.
Only the creator and organisers may change the flag.

Three rules that will bite a program in particular:

- **Times are UTC ISO-8601 strings, but every rule about them is evaluated in
  the event's timezone.** Session times must land on a **5-minute step** in
  local time, and inside the event's date range and day viewport. Kathmandu is
  UTC+05:45 and DST exists; do not do this arithmetic in UTC.
- **Pass `expectedUpdatedAt` when you edit.** It is the `updatedAt` you read.
  If someone changed the session since, you get `409 stale` instead of
  silently overwriting a human's work. Always send it.
- **Deletes are soft.** A deleted session is recoverable from
  `POST /api/e/:slug/sessions/:id/restore`, and it still owns its
  contributions and stars.

## Errors

Every failure has the same shape:

```json
{ "error": { "code": "stale", "message": "Someone else changed this session while you were editing" } }
```

Branch on `code`, never on `message` — the messages are written for people and
change freely.

| Code | Status | Means |
| --- | --- | --- |
| `validation` | 400 | The body did not match the schema; the message names the field |
| `name_required` | 400 | Entering an event without a display name |
| `unauthorized` | 401 | No role here yet — send the password to `/auth` |
| `forbidden` | 403 | Wrong password, or a role that is not enough |
| `not_found` | 404 | No such event, session, person… |
| `name_taken` | 409 | That display name is held by someone else in this event |
| `profile_exists` | 409 | A speaker profile of that name is waiting; re-send with `claimProfile` |
| `already_claimed`, `claim_pending` | 409 | Profile claims |
| `stale` | 409 | Someone edited it since your `expectedUpdatedAt` |
| `overlap`, `blocked` | 409 | The room is busy, or the slot is held against open booking |
| `room_in_use`, `room_missing` | 409 | Deleting a room that has sessions; restoring into a room that is gone |
| `slug_taken`, `tag_exists`, `track_exists`, `format_exists` | 409 | The name is taken |
| `placed` | 409 | That pitch is already on the schedule |
| `draft` | 409 | Adding a note to a draft session; notes open once it is published |
| `last_admin` | 409 | Refusing to remove the last organiser |
| `archived` | 409 | The event is archived and read-only |
| `too_large` | 413 | Over 256 KB |
| `rate_limited` | 429 | Slow down; honour `Retry-After` |
| `login_closed` | 429 | The event stopped taking new sign-ins after repeated wrong passwords |
| `too_many_identities` | 429 | This address minted too many new identities — you are probably not keeping your cookie |
| `internal` | 500 | A bug. Please report it |

A `429` always carries `Retry-After` in seconds. Honour it; do not spin.

## Rate limits

Two buckets per request: one for you, one much larger for your network address.

| Bucket | Per person | Per address |
| --- | --- | --- |
| Reads | 300 / min | 30,000 / min |
| Writes | 30 / min | 3,000 / min |
| Sessions (create + edit) | 12 / min | 1,200 / min |
| Contributions | 10 / min | 1,000 / min |
| Password attempts | 5 / 15 min | 5 / 15 min |
| New identities | — | 300 / 15 min |

The address bucket is a backstop against one machine flooding the process, not
a second personal allowance — a conference is a room of people behind one
access point, and they must not throttle each other. Password attempts are
counted per address on purpose: that is how guessing is caught.

`GET /stream` is not rate limited. It is one long-lived connection; hold one,
not many.

## Every endpoint

Event-scoped routes live under `/api/e/:slug/`. The rest are instance-wide.

**The slug is an address, not a key.** Renaming an event keeps the old slug
resolving, so a client written against the old name keeps working. Read
`event.slug` from the bundle if you want the current one.

### Instance-wide

| | |
| --- | --- |
| `GET /api/events` | Public list of events |
| `POST /api/events` | Create one. `X-Instance-Key` |
| `POST /api/events/import` | Build a whole event from one document. `X-Instance-Key`, `?dryRun=1` first |
| `POST /api/events/:slug/clone` | Copy rooms, tags and formats into a new event |
| `POST /api/backup` | Encrypted whole-database download. `X-Instance-Key` |
| `GET /api/me`, `PATCH /api/me` | This cookie's identity, and its display name |
| `POST /api/me/link-code`, `POST /api/me/link` | Mint and redeem a device phrase |

### Per event

| | |
| --- | --- |
| `GET /login`, `POST /auth`, `POST /logout` | Entering and leaving |
| `GET /bundle`, `GET /stream` | The whole event, and its changes |
| `GET /sessions/:id` | One session with contributions |
| `POST /sessions`, `PATCH /sessions/:id`, `DELETE /sessions/:id` | The programme |
| `POST /sessions/repeat` | Repeat one across days |
| `GET /sessions/:id/link-candidates`, `POST /sessions/link`, `POST /sessions/unlink` | Linked sessions |
| `PUT`/`DELETE /sessions/:id/star` | Your own agenda (private) |
| `POST /proposals`, `PATCH`/`DELETE /proposals/:id` | The pitch board |
| `PUT`/`DELETE /proposals/:id/interest` | Register interest (private) |
| `POST /proposals/:id/place` | Give a pitch a room and a time |
| `POST /sessions/:id/contributions` | Notes, links, questions |
| `DELETE /contributions/:id`, `PATCH /contributions/:id/hidden` | Delete your own; organisers moderate |
| `POST /rooms`, `PATCH`/`DELETE /rooms/:id` | Rooms. Organisers |
| `POST /tags`, `PATCH`/`DELETE /tags/:id` | Tags. Organisers |
| `POST /tracks`, `PATCH`/`DELETE /tracks/:id` | Tracks. Organisers |
| `POST /formats`, `PATCH`/`DELETE /formats/:id` | Session formats. Organisers |
| `POST /breaks`, `PATCH`/`DELETE /breaks/:id` | Lunch and friends. Organisers |
| `PATCH /tracks` | Reorder the tracks |
| `GET /people/:id`, `POST /people`, `PATCH /people/:id`, `DELETE /people/:id` | The roster |
| `PATCH /me` | Rename yourself **in this event**. Names are unique here, so this is where `name_taken` comes from; the instance-wide `PATCH /api/me` only moves the seed and cannot clash |
| `PATCH /me/profile` | Your own profile here |
| `PUT /people/:id/role` | Change what someone may do. Organisers |
| `POST`/`DELETE /people/:id/archive` | File a person out of the lists |
| `POST /people/:id/merge` | Fold one profile into another |
| `POST`/`DELETE /people/:id/speaker-code` | Mint and revoke a standing speaker code |
| `POST /people/:id/claim`, `POST /claims/:id/approve`, `POST /claims/:id/decline`, `DELETE /claims/:id` | Claiming a profile |
| `GET /notifications`, `POST /notifications/read`, `PATCH /notifications/mutes` | Your inbox |
| `POST /calendar-token`, `GET /calendar.ics` | The calendar feed |
| `GET /export.json` | Whole-event JSON. Organisers |
| `GET /audit`, `GET /login-health`, `POST /login-attempts/reset` | The log, and the sign-in stop |
| `GET /trash`, `POST /sessions/:id/restore`, `POST /contributions/:id/restore` | Undo |
| `PATCH /settings`, `PATCH /permissions` | The event itself, and its capability matrix |
| `POST /confirm-admin`, `POST /password-role` | Re-typing the organiser password; asking what a password grants |

## Two things that will confuse a program

**A 200 does not mean an endpoint exists.** Any path that is not under `/api`
and not a real file returns the app's `index.html` with status 200, because the
router in the browser needs to answer deep links. Probe `/api`, not the root.

Under `/api` you get a real answer, though the order of the middleware shows
through: an unknown path answers `404 not_found` — but an unknown path under
`/api/e/:slug/` answers `401 unauthorized` first if you do not hold a role
there, because the role check runs before anything decides the route does not
exist. So a `401` means *either* "sign in" *or* "no such endpoint". Sign in
before concluding an endpoint is missing.

**A display name is not an identity.** Names are unique within an event and
nothing more; anyone can enter under any free name. Identity is the cookie.
Never treat a name as proof of who someone is.

## What this API deliberately does not have

No OpenAPI document yet. No CORS headers and cookies are `SameSite=Lax`, so
browser-side callers on another origin will not work — this is for server-side
clients. No pagination anywhere: the bundle is the whole event by design. No
bulk edit of an existing event; `POST /api/events/import` builds a new one and
is the only bulk path.

Nothing here is a public read. Viewing a schedule requires the viewer password,
by design — there is no anonymous view of an event.
