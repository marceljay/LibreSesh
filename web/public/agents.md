# agents.md — LibreSesh

The operating manual for an AI agent acting on this instance. What you can do
here, how to get in, and what not to do on a person's behalf.

If you want the endpoint-level reference, it is [`/api.md`](/api.md). If you
want a one-paragraph description of this site, it is [`/llms.txt`](/llms.txt).
If your harness consumes packaged skills, [`/SKILL.md`](/SKILL.md) is this one
in that format.

## What this instance is

A scheduling tool for conferences and unconferences. It hosts one or more
**events**, each at `/e/:slug`. An event has rooms, a programme of sessions
across days, a board of pitched sessions people vote interest in, and notes,
links and questions attached to each session. Everything updates live.

| Capability | |
| --- | --- |
| Read a schedule | Yes, with a password. There is no public view of any event |
| Live updates | Yes — Server-Sent Events, one stream per event |
| Write | Yes: pitch sessions, book rooms that allow it, post notes and questions, star a personal agenda |
| Calendar | iCalendar feed per person, per event |
| Payments, accounts, personal data | None. There are no accounts and no profiles beyond a display name |
| MCP endpoint | None. This is a plain JSON HTTP API |
| OpenAPI document | None yet |

## Discovery

| Path | What it is |
| --- | --- |
| `/llms.txt` | What this site is, in a paragraph |
| `/agents.md` | This file |
| `/SKILL.md` | The same capabilities as a packaged skill |
| `/api.md` | The full HTTP reference |
| `/api/events` | The only unauthenticated JSON endpoint: names and dates of the events on this instance, no schedule content |

## Getting in

**Everything except `/api/events` needs a role, and a role comes from a
password.** A human has to give you one — they are handed out on badges, slides
and QR codes at the event itself. There are three per event and they grant
different things: viewer (read), attendee (read and write), organiser (the
programme). Ask which one you have; do not try passwords.

```bash
curl -c jar -b jar -X POST https://this-host/api/e/<slug>/auth \
  -H 'Content-Type: application/json' \
  -d '{"password":"…","displayName":"scheduling-bot"}'
# → {"role":"user"}
```

That sets a signed `cid` cookie. **Keep the jar** — identity here is the
cookie, there is no bearer token, and a client that drops it gets `401` on
everything while filling the instance's identity table with junk.

A person may instead hand you their own identity: they mint a three-word phrase
from the menu behind their name and you redeem it at `POST /api/me/link`. You
then *are* them — their role, their name, their authorship. Treat it as the
credential it is.

## The flow

1. `POST /api/e/<slug>/auth` — once, with the password you were given.
2. `GET /api/e/<slug>/bundle` — **once**. This is the entire event in one
   response: rooms, tracks, tags, breaks, every session, people, pitches, and a
   `permissions` map telling you what your role may do. There is nothing to
   crawl and no pagination.
3. `GET /api/e/<slug>/stream` — subscribe. Server-Sent Events, every change,
   not rate limited. Patch your copy rather than re-reading.
4. Write only what the person asked for, using the endpoints in
   [`/api.md`](/api.md).

An agent following those four steps cannot hit a rate limit. One that polls the
bundle in a loop, or throws its cookie away between requests, will — and the
cost lands on the people sharing its network, not on it.

## What you should know before writing

- **Times are UTC ISO-8601, but every rule about them is evaluated in the
  event's own timezone.** Session times must land on a 5-minute step in local
  time. Do not do this arithmetic in UTC.
- **Send `expectedUpdatedAt` when you edit** — the `updatedAt` you read. You
  get `409 stale` instead of silently overwriting a person's work.
- **Deletes are soft and reversible.** Nothing you remove is gone.
- **A display name is not an identity.** Names are unique within an event and
  nothing more. Never treat one as proof of who someone is.
- Errors are always `{"error":{"code":…,"message":…}}`. Branch on `code`;
  messages are written for humans and change. `429` carries `Retry-After` —
  honour it rather than spinning.

## Limits

Per person: 300 reads, 30 writes, 12 session edits and 10 contributions a
minute. The same buckets keyed on your network address are a hundred times
that, because a conference is a room of people behind one access point and they
must not throttle each other — which is also why exceeding your share is
antisocial here in a way it is not on most APIs. `/stream` is not limited: hold
one connection, not many.

Password attempts are limited hard, per person and per address: five per
quarter hour. Do not guess.

## Policy

**Say you are a program.** Put something recognisable in your `User-Agent`, and
if you enter an event under a display name, let it read like software rather
than a person. People at an unconference are talking to each other; they should
be able to tell when they are not.

**Read freely, write narrowly.** Reading a schedule for someone is what this is
for. Writing is different: a pitch, a question and a note all appear under a
human's name, to a room of people who will answer them.

**Some things are nobody's to automate.** Stars and pitch interest are private
signals of what a person wants to attend — they are never broadcast and never
attributed, and they are the event's way of deciding what gets a bigger room.
Do not manufacture them. Do not vote, star, or pitch except on explicit
instruction for that specific thing.

**Nothing here is public.** You reached a schedule because a human gave you a
password for one event. Do not republish its contents, and do not carry a
credential from one event to another.

## Getting it wrong

If you are unsure whether an action is wanted, stop and ask the person. This is
a live schedule that a room of people is reading; a wrong edit is visible in
under a second on every open browser, and the organiser finds it in the audit
log with your identity against it.
