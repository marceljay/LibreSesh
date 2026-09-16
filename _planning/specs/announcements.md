# Announcement engine spec

**Status:** written 2026-09-16. Shared rules for the Telegram and Nostr
transports, extracted from the Telegram spec. Transport-independent: no wire
format, message layout or database column is defined here.
[telegram-announcements.md](telegram-announcements.md) (on
`feat/telegram-announcements` until
[PR #116](https://github.com/marceljay/LibreSesh/pull/116) merges) and
[nostr-publishing.md](nostr-publishing.md) define the per-transport rendering and delivery. This file defines the
announcement data, the conditions that produce one, and the data that is
excluded.

## Contents

- [Purpose](#purpose)
- [Announcement data and triggers](#announcement-data-and-triggers)
- [Settings: triggers, scope, verbosity](#settings-triggers-scope-verbosity)
- [Scheduler loop and write-path hooks](#scheduler-loop-and-write-path-hooks)
- [Excluded data](#excluded-data)
- [Storage and admin UI](#storage-and-admin-ui)
- [Transport interface and tests](#transport-interface-and-tests)
- [Implementation status (2026-09-16)](#implementation-status-2026-09-16)

## Purpose

Telegram and Nostr both need the same announcements: what starts next, a
daily digest, a session added or moved, a pitch made or placed. The rules
that make those correct (at-most-once delivery, a time window rather than an
instant, only a move counts as a change, drafts excluded) are independent of
the transport. Implementing them twice would produce two loops with
different behaviour. Therefore one **announcer** decides what to announce and
when, and each **transport** only renders and sends.

## Announcement data and triggers

A value, built from database rows, handed to each enabled transport:

```
{
  trigger:  'up_next' | 'digest' | 'added' | 'changed' | 'pitched' | 'placed'
  event:    the event row (name, slug, timezone)
  at:       the instant it is about (a slot's start; the digest's day)
  sessions: the sessions concerned, with rooms, speakers, tags, format
  before:   for 'changed', the previous start/end/room
  proposal: for 'pitched' and 'placed', the pitch
}
```

The announcer does no rendering. Telegram renders the value as HTML
messages, Nostr as a plain-text note with references; the output differs per
transport.

**Triggers**

| Trigger   | Fires when                                                       | Source     |
| --------- | ---------------------------------------------------------------- | ---------- |
| `digest`  | Once a day at a local time (default 08:00), the whole day        | scheduler  |
| `up_next` | `lead` minutes before each distinct start time (default 15)      | scheduler  |
| `added`   | A non-draft session is created directly, or a draft is published | write path |
| `changed` | An already-announced session moves or is cancelled               | write path |
| `pitched` | A pitch is made on the board                                     | write path |
| `placed`  | A pitch is placed on the grid and becomes a session              | write path |

`placed` is a separate trigger from `added` so that an organiser can announce
placed pitches during the event without announcing every session entered
while building the programme.

`changed` counts only a **move** — start, end or room, as `isAMove` already
defines it for notifications — and only for a session this transport has
already announced. A text edit is not announced; a cancellation of a never-announced session is
not announced either, since it would disclose a session that was never
public.

## Settings: triggers, scope, verbosity

Three independent settings:

- **When** — which triggers fire, stored as a set per event, per transport.
  Modes (Off, Light, Medium, Heavy, Custom) are presets over that set, derived by matching and never stored; unticking the digest under Medium
displays Custom. An empty set with
  the transport still configured is **paused**.
- **What** — which sessions are in scope. Default everything; narrowing is by room, the most common request. Scope filters
  every trigger, the digest included. Official versus open is not a scope option.
- **How much** — `terse`, `normal` or `full` per session. The digest is always
  terse. A transport may support one level only.

## Scheduler loop and write-path hooks

One `setInterval` at 60 s in `server/src/index.ts`, `unref`'d, beside the
identity sweep. **A tick is one execution of the interval callback**: read SQLite, determine
what is due, pass it to each enabled transport, return. Nothing runs between
ticks.

Per tick, for each event that is not archived and has a transport enabled:

1. Select sessions with `starts_at - lead <= now < starts_at`, `draft = 0`,
   `deleted_at IS NULL`, in scope.
2. Group by `starts_at`: five rooms at 10:00 is one announcement.
3. For each transport with `up_next` on, skip a group already sent — an
   in-memory set keyed `${transport}:${eventId}:${startsAt}` — otherwise
   **mark sent, then send.**
4. The digest the same way, keyed on the day.

**Time window, not instant.** A session created at 13:40 for 13:45 is inside
the window as soon as it exists and is announced on the next tick. Firing
only at the instant `starts_at - lead` passes would miss that case, which is
the main use case.

**Mark before send.** A send that times out after the remote end accepted
it would otherwise be repeated; a duplicate post cannot be removed, a missed
one can be resent. The set is in memory, so a restart inside a window
repeats that slot. Accepted. If this turns out to matter in practice, add an
`announced` table keyed `UNIQUE(transport, event_id, trigger, key)`.

**Per transport.** The sent set and the trigger set are keyed by transport,
so a failing or disabled transport does not affect another.

**The write path**

`added`, `changed`, `pitched` and `placed` do not use the scheduler loop: the route that
creates or moves a session calls the announcer beside its `audit()` call.
**Never hook the SSE broker** — `Broker.publish` returns early with no
subscribers; it is delivery to open tabs, not an event bus.

Rate rules:

- `added` or `placed` suppresses the `up_next` for that session when the two
  would land within `lead` minutes.
- `changed` is coalesced over 60 s: a reshuffle is one announcement, not one
  per drag.
- Imports and `POST /sessions/repeat` announce one summary line or nothing.
- A pitch edited after `pitched` announces nothing again.

## Excluded data

- **Drafts**, under any trigger. Publishing a draft is the event that is
  announced.
- **Deleted sessions**; **archived events** announce nothing at all.
- **Contributions, notes, links, questions, stars, interest.**
- **Anything beyond a display name**: no UIDs, roles, audit rows, people list.

Every transport publishes data outside the password gate: titles, speakers,
rooms and times become readable to anyone with access to the destination. The
enable switch states this in its section, not in a tooltip, and [SECURITY.md](../../SECURITY.md) records it per transport.

## Storage and admin UI

A secret belongs to whoever deploys or, where organisers bring their own, to
the event as a sealed column. A **choice** belongs to the event: per event and
per transport, the trigger set, `lead`, the digest's local time, verbosity and
room scope, each a column that transport's migration adds. Settings are independent per transport. None of these columns
travel in exports or clones, and every change is an `audit` write.

**Publish tab.** All outbound publishing settings live in one admin-only tab
in Manage Event, not in Settings. Each transport is a section; the first
transport implemented creates the tab. Every section has an **Example**
button per option, rendered from the event's own schedule, and a **Send a
test** button that verifies delivery and shows the remote error text
verbatim, because the effect of these settings is only visible in the
external service.

## Transport interface and tests

```ts
interface Transport {
  name: 'telegram' | 'nostr';
  enabled(event: EventRow, trigger: Trigger): boolean;
  send(event: EventRow, announcement: Announcement): Promise<void>;
}
```

`send` renders and delivers. It may throw; the announcer logs the error,
keeps the sent mark, and continues. Announcements are not retried.

**Tests**, with a fake transport that records what it was handed: window not
edge; at-most-once per transport, and one transport throwing does not stop
the other; `placed` without `added`; `added` suppresses `up_next` inside
`lead`; `changed` only for a move of an announced session, coalesced; import
one line; drafts, deleted and archived silent; scope filters the digest; an
empty day is silent; a paused transport resumes on the next tick.

## Implementation status (2026-09-16)

The scheduler loop exists once, in `server/src/telegram.ts` on
`feat/telegram-announcements` (in review): the `Announcer` class with
`up_next` built and `digest`, `added`, `changed` filed as
[LIB-211](https://linear.app/libresesh/issue/LIB-211) and
[LIB-212](https://linear.app/libresesh/issue/LIB-212). It renders and sends inside the tick and supports a single transport.

Whichever of Nostr and Telegram merges second implements this file. If Telegram
merges first, [LIB-214](https://linear.app/libresesh/issue/LIB-214) extracts
the announcer into `announcer.ts` with Telegram as its first transport and its
suite unchanged; if Nostr goes first, it creates `announcer.ts` from this file
and the Telegram branch is rebased onto it as a transport. After the merge the
Telegram spec's *three axes*, *posting loop* and *what must not travel* become
a pointer here; the message shapes, the bot, the group binding and the commands
stay there.
