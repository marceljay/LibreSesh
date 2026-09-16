# Nostr publishing spec

**Status:** designed 2026-09-16, not built. No branch yet. Decided in an
interview the same day (see [Decisions](#architecture-and-decisions)). The announcement rules are
shared with Telegram and defined in [announcements.md](announcements.md);
this file defines the Nostr transport and calendar event sync. Dependencies
on the Telegram branch are listed in
[Dependencies](#dependencies-and-implementation-order).

## Contents

- [Purpose and scope](#purpose-and-scope)
- [Nostr protocol basics](#nostr-protocol-basics)
- [Architecture and decisions](#architecture-and-decisions)
- [Selective publishing of data](#selective-publishing-of-data)
- [Key management](#key-management)
- [Calendar event sync (NIP-52)](#calendar-event-sync-nip-52)
- [Kind-1 notes](#kind-1-notes)
- [Configuration, routes and admin UI](#configuration-routes-and-admin-ui)
- [Tests](#tests)
- [Dependencies and implementation order](#dependencies-and-implementation-order)

## Purpose and scope

A LibreSesh event is a website behind a viewer password. Nobody outside the
event can follow the schedule, subscribe to it, or see when a pitch is
placed. Nostr fits this gap: following requires only a public key, calendar
events are a standard kind
([NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md)) that
existing clients render, and the publisher controls its own key.

Scope of this iteration: **write only**. Nothing is read back from relays
and there is no sign-in with a Nostr key. Both are follow-ups that depend on
this one.

## Nostr protocol basics

For readers who have not used Nostr.

**There is one kind of object: the event.** A Nostr event is a small JSON
object with seven fields: `pubkey` (who signed it), `created_at` (unix
seconds, set by the signer), `kind` (a number saying what sort of thing it
is), `tags` (a list of string lists), `content` (a string), `id` (the SHA-256
of the other fields) and `sig` (a Schnorr signature over that id). Anyone can
verify it with nothing but the event itself. It is immutable: change a byte
and it is a different event with a different id. A note, a profile, a calendar
entry and a deletion request are all events of different kinds.

**An identity is a keypair, and nothing else.** The private key signs; the
public key is the identity. Both are 32 bytes, hex on the wire and `nsec1…` /
`npub1…` (bech32,
[NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md)) for
people. There is no account, no server that owns the key, no password reset:
lose the `nsec` and the identity is gone; leak it and someone else is that
identity for good. That is why the event's key is [sealed at rest](#key-management)
and why the [Publish tab](#configuration-routes-and-admin-ui) has an export
button.

**A relay is a WebSocket server that stores events and hands them out.** A
client sends `["EVENT", …]`; the relay answers `["OK", id, true|false,
reason]`. A reader sends `["REQ", subscription, filter]` and gets every stored
event matching the filter — by author, kind, tag or time. Relays are
independent: they do not federate, they owe nobody storage, they may refuse or
drop anything. Clients read from and publish to several relays, so an event posted to three
relays is soon stored on more. Publishing is therefore effectively permanent.

**Deletion is a request.**
[NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md) defines
kind 5, an event listing the events its author wants removed. A relay *should*
honour it and *may* not. The design sends one on every delete and promises
nothing beyond that.

**The kind decides how a relay stores the event.**

| Range                                  | Rule                                                   | Used here                      |
| -------------------------------------- | ------------------------------------------------------ | ------------------------------ |
| Regular (`1`, `5`, …)                  | Every event kept                                       | Kind 1 notes, kind 5 deletions |
| Replaceable (`0`, `3`, `10000`–`19999`) | One per `(pubkey, kind)`; the newest `created_at` wins | Kind 0, the profile            |
| Addressable (`30000`–`39999`)          | One per `(pubkey, kind, d)`; newest wins               | 31923 sessions, 31924 calendar |

An addressable event is a **row with a key the author chose** — the `d` tag.
Publish again with the same `d` and the relay replaces the earlier version.
That is what makes calendar sync possible: an edited session is a new version of
the same row, not a correction posted under the old one. A kind-1 note is the
opposite: a post, kept forever, never edited. **Kind 0 is the profile**, a
replaceable event whose content is JSON (`name`, `about`, `picture`); without
one, followers see a bare `npub1…`.

**Tags are how events point at things.** Each tag is a list of strings, the
first being its name. Single-letter tags are indexed by relays and can be
filtered on. The ones used here:

| Tag                                    | Means                                                                | Note                                                                 |
| -------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `d`                                    | The row key of an addressable event                                  | `e<eventId>-s<sessionId>`                                            |
| `a`                                    | A reference to an addressable event by **coordinate** `kind:pubkey:d` | How a note points at a session, and a session at its calendar        |
| `e`                                    | A reference to an event by id                                        | Only in kind 5, naming the version to delete                         |
| `p`                                    | A person's pubkey                                                    | Notifies that person — not used until sessions carry real npubs      |
| `t`                                    | A topic                                                              | One per LibreSesh tag                                                |
| `r`                                    | A URL                                                                | The session page, the livestreams                                    |
| `title`, `start`, `end`, `location`, … | [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md)'s own vocabulary | See [the mapping](#calendar-event-sync-nip-52)                        |

**A coordinate is an address; `naddr` is its shareable form.** `kind:pubkey:d`
names an addressable event wherever it lives.
[NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) encodes it,
with relay hints, as `naddr1…`;
[NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md) says
`nostr:naddr1…` inside content is a link, and clients render it as one.
`njump.me/<naddr>` resolves any of these in a browser without a Nostr
client; the *on Nostr* badge links there.

**Following is reading, not subscribing.** A client holds a list of pubkeys
and asks the relays it knows for their events; nothing server-side remembers
who follows whom. Following the event means adding its npub on relays that hold its events;
the relay hints in every `naddr` and the instance default relays provide
that.

**[NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md) is the
calendar vocabulary.** A NIP (*Nostr Implementation Possibility*) is a
numbered document specifying one part of the protocol. Kind `31923` is a
time-based calendar event, `31924` a calendar that lists them by coordinate,
`31925` an RSVP that points at one. Flockstr, Coracle and a few others render
31923; most clients do not, which is why kind-1 notes are published as well.

**What Nostr does not give you.** No accounts, no editing a note, no
private-by-default, no delivery guarantee, no takedown, no way to know who
read what. This design accepts all of these; the enable switch's warning states them.

**Terminology.** A **tick** is one pass of a `setInterval`
loop — the announcer's every 60 s, the sync loop's every 10 s; nothing runs
between passes. The **outbox** is a table of work owed: a write marks a row
dirty and returns, the sync loop sends later, so the request path never waits
on a
relay. **Calendar sync** keeps the addressable events (31923, 31924, kind 0) equal
to the database — state, not history. **Kind-1 notes** are the change log —
history, not state. A
**transport** renders an announcement in its own dialect; a **trigger** is a
reason to post one; a **coordinate** is `kind:pubkey:d`.

## Architecture and decisions

```
writes ──► outbox marks ──► sync loop (10s, coalesced)   ──► 31923 per session
                                                            31924 per event
                                                            kind 0 profile
                                                            kind 5 on delete
writes ──► added/changed/pitched/placed ─┐
tick   ──► up_next/digest ───────────────┴► announcer ──► telegram.send
                                                        └► nostr.note (kind 1)
```

**Calendar sync** is state: one 31923 per published session, one 31924 calendar
and one kind-0 profile per event, kept equal to the database by an outbox. Calendar clients read those. **Kind-1 notes** are change: kind-1 notes when a
pitch is placed, a session is added or moved, a slot is about to start, a day
begins. Followers read it, and each note references the published session by
coordinate. Both are signed by **the event's own signing key**: enabling Nostr
generates a keypair for the event. The npub is the event's identity on
Nostr; it can be followed and exported, and belongs to the event, not to a
person.

**Decisions (2026-09-16)**

| Question                                   | Decision                                                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| What goes out                              | Both: [NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md) calendar events and kind-1 notes                     |
| Attendee-written pitches and open sessions | Published when the event has Nostr on, **opt-out per item, default on**; the forms say so before anyone writes             |
| The gate                                   | Admin-only toggle, off by default, with a warning listing the fields that leave and that relays keep copies. A link back may land on the login page in v1 |
| Signing key                                | Per event, generated on enable, encrypted at rest; no bring-your-own nsec in v1                                            |
| Reading back                               | None in v1. `d` tags are stable so RSVPs can be ingested later without republishing                                       |
| Telegram                                   | One announcer, two transports ([announcements.md](announcements.md))                                                       |
| Note triggers                              | All six, each a checkbox in a **Publish** tab of Manage Event                                                              |
| Default relays                             | Open — D6 in [STATUS.md](../../STATUS.md)                                                                                  |

## Selective publishing of data

Enabling Nostr publishes, for every non-draft session that is not opted out:
**title, description, start and end, room, event name, format, tags, speaker
names, livestream links, and a link back to the session.** For every pitch not
opted out: **title, description, the pitcher's display name, and a link to the
board.** All of it under the event's key, to the relays the organiser configured, for
as long as those relays store it.

Never published: contributions (notes, links, questions), stars, interest,
drafts, breaks, anyone's UID, any password, any role, the audit log, the
people list.

- **Off by default**, per event, admin capability only. The switch carries the
  list above and a sentence that relays keep copies and a deletion is a
  request: read, tick *I understand*, enable.
- **Every form that writes a published thing says so** while Nostr is on: one
  line above the session and pitch forms, *"This event publishes its programme
  and pitch board to Nostr"*, with the opt-out checkbox beside it. The notice is visible before the user types anything.
- **Opt-out is the author's and the organiser's** — exactly the set that may
  edit the item (`canMutate`). No new permission switch.
- **Turning Nostr off retracts nothing.** The switch says so and offers
  **Retract everything** beside it, which sends a kind-5 deletion for every
  published event. Archiving an event retracts nothing either.

## Key management

Enabling mints a keypair with `nostr-tools` (`generateSecretKey`,
`getPublicKey`). The public key is stored in hex; the private key is stored
sealed: **AES-256-GCM** under a key derived by **HKDF-SHA256** from
`COOKIE_SECRET` with the info string `libresesh/nostr-seckey/v1`, a fresh
12-byte nonce per encryption, nonce and tag stored with the ciphertext in one
base64 column. The helper is general — `server/src/secretsAtRest.ts`,
`seal(plain, purpose)` / `open(blob, purpose)` — and the Telegram bot token
([LIB-213](https://linear.app/libresesh/issue/LIB-213)) is its second caller.

[SECURITY.md](../../SECURITY.md) already keeps `COOKIE_SECRET` off the
database's volume, so a copied database holds a ciphertext it cannot open.
Identity tokens are stored in clear because they are useless without the
secret; encrypting the private key puts it in the same position.

**Consequence:** rotating `COOKIE_SECRET` already signs everyone out; with
this it also **loses every event's Nostr key**. The keys cannot be recovered,
so the events' existing relay data can be neither updated nor retracted. The
Publish tab therefore shows **Export key**
(the `nsec…`, admin capability, behind the `auth` rate limit, one audit row per
export) with the sentence *"Keep a copy: if this instance's secret changes,
this key is gone."* The decrypted key lives in the sync loop's memory only
while signing; it never enters a request handler, a DTO, an export or a log.

## Calendar event sync (NIP-52)

**Session → kind 31923 mapping**

| Tag                      | Value                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `d`                      | `e<eventId>-s<sessionId>`. Stable for the life of the session; not the slug, which can be renamed     |
| `title`                  | Session title                                                                                         |
| `start`, `end`           | Unix seconds                                                                                          |
| `start_tzid`, `end_tzid` | The event's IANA timezone                                                                             |
| `D`                      | Day-granularity unix timestamp of the start day in the event's timezone (NIP-52 lists it as required) |
| `location`               | `Room name · Event name`                                                                              |
| `summary`                | `Format · Room · Speaker, Speaker`, whichever exist                                                   |
| `t`                      | One per tag on the session, lower-cased                                                               |
| `r`                      | The session's link on the site, then each livestream link                                             |
| `a`                      | `31924:<eventPubkey>:programme` — the calendar it belongs to                                          |

`content`: the speakers line, a blank line, the description as written (it is
markdown; calendar clients show it as text), a blank line, the site link. No
`p` tags in v1: a `p` tag notifies a real person, and no session yet carries
anyone's npub. Not published: drafts, deleted sessions, sessions opted out,
breaks (no room, no author), and sessions of an event with Nostr off.

**Calendar, kind 31924:** `d` = `programme`, `title` = the event name, one
`a` tag per published session, content one sentence naming the event, its dates
and the site link. Republished whenever the set of published sessions changes.

**Profile, kind 0:** `name` = the event name, `about` = its dates and the
site link, no picture in v1. Published on enable and again on rename, so a
follower sees the conference's name instead of `npub1…`. Both are rows in
`nostr_published` like the sessions, so they use the same sync loop, backoff
and resync.

**Outbox table**

```sql
CREATE TABLE nostr_published (
  event_id      INTEGER NOT NULL REFERENCES events(id),
  entity        TEXT NOT NULL CHECK (entity IN ('session','calendar','profile')),
  entity_id     INTEGER NOT NULL,          -- session id; the event id otherwise
  d_tag         TEXT NOT NULL,
  last_event_id TEXT,                      -- hex id of the latest version on relays
  published_at  TEXT,
  dirty_since   TEXT,                      -- NULL when clean
  deleted       INTEGER NOT NULL DEFAULT 0,
  tries         INTEGER NOT NULL DEFAULT 0,
  next_try      TEXT,                      -- backoff; NULL when due now
  last_error    TEXT,
  PRIMARY KEY (event_id, entity, entity_id)
);
```

**Dirty marking.** `markDirty(db, eventId, sessionId?)` is a function call beside
the `audit()` call in every write that changes what a 31923 or the calendar
would contain: session create, update, delete, restore, link, unlink, repeat,
draft publish, pitch place; room, tag or format rename or delete, and event
name or timezone change, which mark every session of the event (a rename marks
the profile too). It upserts `dirty_since = now`, does no relay I/O and never
throws into the request. **Not via the SSE broker** (see the announcements spec). Safety net for a
missed call site: every five minutes the sync loop marks dirty any session
whose `updated_at` is
later than its row's `published_at`, and any session of an enabled event with
no row at all. **Resync** in the Publish tab marks every row dirty.

**Sync loop** — `setInterval` at 10 s, `unref`'d, beside the announcer in
`index.ts`. Per tick, per enabled event whose key opens:

1. Take rows with `dirty_since` at least 15 s old (so a burst of drag edits is published once), or older than 60 s regardless, and `next_try`
   null or past.
2. Build each 31923 from the **current** row; the mark only flags the row. A row now deleted, draft or opted out becomes a kind-5 deletion
   carrying the `a` coordinate and the last event id, and sets `deleted = 1`.
3. If membership changed, rebuild the 31924.
4. `SimplePool.publish(relays, event)`, one promise per relay. **One relay
   accepting counts as published**; none accepting is a failure: `tries + 1`,
   `next_try = now + min(60s · 2^tries, 1h)`, `last_error`. Success clears
   all three.

Delivery is at-least-once: republishing a replaceable event is idempotent
on the relay, so this loop needs no mark-before-send. On
boot it resumes from the table. A restored session re-enters dirty with
`deleted = 0`; the new version has a new id, so a relay that honoured the
deletion takes it as fresh.

## Kind-1 notes

**Announcer integration.** Triggers, the 60-second loop, the time window,
at-most-once delivery, write-path hooks and excluded data are defined in
[announcements.md](announcements.md). Nostr is a transport of that announcer:

```ts
{ name: 'nostr',
  enabled: (event, trigger) => event.nostr_enabled && triggers(event).has(trigger),
  send:    (event, a) => publish(signNote(event, render(a))) }
```

What Nostr adds: **its own trigger set**, `events.nostr_triggers`, default
`placed`, `up_next`, `digest`, independent of Telegram's; **one verbosity level**; **no room scope in v1**
(added when Telegram's is); and **no retry** — a failed publish is logged
and dropped, since the calendar events are the durable copy.

**Note format.** Plain text, times in the event's timezone. One `a` tag per
session mentioned plus the same reference inline as `nostr:naddr…`; the site
link last. No hashtags, no mentions.

```
Up next at 14:00 at LongConf

Room A — Scaling an unconference (Ada)
Room B — Zines as documentation (Grace, Linus)

nostr:naddr1… · nostr:naddr1… · https://sesh.example/e/longconf
```

```
Placed from the pitch board: Zines as documentation
Tomorrow 11:00 in Room B · Grace

nostr:naddr1… · https://sesh.example/e/longconf/s/42
```

`pitched` says the title, the pitcher's name and a line of the description,
and links the board. `digest` is the day's programme, one line per session,
breaks included, capped at 40 lines with *"… and N more"*; an empty day posts
nothing.

## Configuration, routes and admin UI

**Instance:** `NOSTR_DEFAULT_RELAYS`, comma-separated `wss://` URLs, the list
a new event starts with (D6). `PUBLIC_URL` is what every link is built from;
with it unset, notes carry no links and calendar events no `r` tag for the site,
rather than a `localhost` address on a public relay. Relay URLs are validated
as `wss://` (`ws://` only outside production), at most 10 per event.

**Per event**, migration 025:

```sql
ALTER TABLE events ADD COLUMN nostr_enabled  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN nostr_pubkey    TEXT;             -- hex
ALTER TABLE events ADD COLUMN nostr_seckey    TEXT;             -- sealed blob
ALTER TABLE events ADD COLUMN nostr_relays    TEXT;             -- JSON array
ALTER TABLE events ADD COLUMN nostr_triggers  TEXT NOT NULL
  DEFAULT '["placed","up_next","digest"]';
ALTER TABLE sessions  ADD COLUMN nostr_optout INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN nostr_optout INTEGER NOT NULL DEFAULT 0;
```

`nostr_seckey` and `nostr_pubkey` are never exported, cloned or returned to a
client, with a test. The opt-out columns *do* travel with an export: they are
the author's choice about the item.

**Routes**, all admin capability, under `/e/:slug/nostr`

| Route              | Does                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `GET /`            | Status: enabled, npub, relays, triggers, per-relay last OK and last error, publish counts        |
| `POST /enable`     | Body `{ acknowledged: true }` or 400. Generates and seals the private key, seeds relays and rows, marks all dirty |
| `POST /disable`    | Stops the sync loop for the event. Retracts nothing                                                  |
| `POST /retract`    | Kind 5 for every published event                                                                 |
| `PATCH /`          | `relays`, `triggers`                                                                            |
| `POST /resync`     | Every row dirty                                                                                 |
| `POST /export-key` | The `nsec…`. `auth` rate limit, audit row `nostr_key_exported`                                  |

The session and proposal DTOs gain `nostrOptOut`, accepted on PATCH under the
ordinary edit permission; the session DTO also gains `nostr: { naddr } | null`
for the badge.

**Admin UI: Publish tab.** An eighth tab in Manage Event holding all
outbound publishing settings. **Nostr**: the switch and its warning;
once on, the npub with a copy button and an *Open on njump* link, the relay
list editor, the six trigger checkboxes, the status table (per relay last OK
and last error, per event counts), **Resync**, **Retract everything**, **Export
key**. **Telegram**: the section
[LIB-210](https://linear.app/libresesh/issue/LIB-210) builds, moved here; its
four checkboxes become the same six. `lib/adminSearch.ts` indexes every
control on the tab. On the session sheet, a small **on Nostr** badge links to
`https://njump.me/<naddr>` with the event's relays as hints; nothing on the
pitch board, since a pitch has no published calendar event.

**Operational limits.** Outbound WebSockets from the container must be allowed (they are
on Railway and any ordinary VPS); a restrictive egress policy shows up as every
relay failing in the status table. A relay that is down does not block the
others, backoff caps at one hour per row, and signing never happens on the request path; a write adds at most one
upsert.

## Tests

Unit tests for the pure functions; relay I/O behind a fake pool.

- **Seal/open** round trip; wrong purpose and wrong secret fail.
- **Builders**: snapshot of the exact 31923, 31924 and kind-0 JSON against a
  fixture with every field set; drafts, opted-out, deleted and breaks
  excluded; `d` unaffected by a slug rename.
- **Outbox**: a drag storm of 20 PATCHes yields ≤ 2 publishes; a delete yields
  one kind 5 and a calendar rebuild; restore re-enters; the sweep catches a row
  updated without a mark; boot resumes dirty rows; zero relays accepting sets
  `next_try`, one accepting clears it.
- **Notes**: snapshot per trigger; `a` tags and `naddr` references match the
  calendar event's `d`; digest cap; Nostr off sends nothing.
- **Routes**: enable without acknowledgement is 400; the private key never appears in
  any response, export or clone; export-key is admin-only, rate limited and
  audited; opt-out obeys `canMutate`; a placed pitch inherits it; the badge
  appears only when published and not deleted.
- **Manual, yours** ([LIB-220](https://linear.app/libresesh/issue/LIB-220)):
  a seeded event on a public relay renders in Flockstr or Coracle; a follow in
  an ordinary client shows the notes; a moved session updates in place; a
  deleted one disappears from at least one relay.

## Dependencies and implementation order

**From `feat/telegram-announcements` (in review):** the announcer loop, which
exists there for Telegram only — step 1 extracts it into `announcer.ts` per
[announcements.md](announcements.md), or, if that branch has not merged, creates
`announcer.ts` from the neutral spec and the Telegram branch is rebased onto it
as a transport; `PUBLIC_URL` in `config.ts`, trivial to add here if needed; and
the Publish tab, which the first transport to land creates. The other
direction: this project writes `secretsAtRest.ts` and
[LIB-213](https://linear.app/libresesh/issue/LIB-213) becomes its second
caller.

**Independent of it:** key management, the schema, calendar sync, the forms
and the badge, the manual verification. Calendar sync is the larger half and
can be built and verified on a public relay before the notes exist.

**Implementation order.** Each step is one Linear issue and one commit series;
[STATUS.md](../../STATUS.md) carries the same list. Preferably branch from
`dev` after the Telegram PR merges; if it is still open, do steps 2 and 3 first.

1. **Land the shared announcer** per [announcements.md](announcements.md) —
   [LIB-214](https://linear.app/libresesh/issue/LIB-214)
2. **Keys and schema**: `secretsAtRest.ts`, migration 025, `nostr-tools`, the
   enable/disable/export routes, the warning copy, SECURITY.md —
   [LIB-215](https://linear.app/libresesh/issue/LIB-215)
3. **Calendar sync**: builders, `markDirty` at every site, the sync loop, deletion,
   resync, the sweep — [LIB-216](https://linear.app/libresesh/issue/LIB-216)
4. **Kind-1 notes**: the Nostr transport, the note renderer —
   [LIB-217](https://linear.app/libresesh/issue/LIB-217)
5. **Publish tab**, Telegram's section moved in —
   [LIB-218](https://linear.app/libresesh/issue/LIB-218)
6. **Forms and badge** —
   [LIB-219](https://linear.app/libresesh/issue/LIB-219)
7. **Verification on a public relay**, yours —
   [LIB-220](https://linear.app/libresesh/issue/LIB-220)

**Out of scope:** reading RSVPs or comments back (untrusted input: signature checks, sanitisation, moderation; a separate
project after calendar sync has run at a real event); signing in with a Nostr
key ([NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) /
[NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md)), which raises permission questions the app currently answers with passwords
and roles; importing an existing `nsec` (a private key pasted into a web
form; a generated key covers the need — revisit with NIP-46); `p` tags for
speakers; zaps, DMs, relay hosting, recurring events.

**Documentation updated in the same commits:** [ARCHITECTURE.md](../../ARCHITECTURE.md) (the
announcer and its transports, calendar sync, `nostr_published` in the table of
tables), [SECURITY.md](../../SECURITY.md) (what leaves, the sealed key and the
rotation cost, the export-key route), [docs/schema.md](../../docs/schema.md),
`deploy/*.env.example`, [web/public/api.md](../../web/public/api.md), and after
step 1 [telegram-announcements.md](telegram-announcements.md).
