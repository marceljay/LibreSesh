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
identity for good. That is why the event's key is [encrypted at rest](#key-management)
and why the [Publish tab](#configuration-routes-and-admin-ui) has an export
button.

**A relay is a WebSocket server that stores events and hands them out.** A
client sends `["EVENT", …]`; the relay answers `["OK", id, true|false,
reason]`. A reader sends `["REQ", subscription, filter]` and gets every stored
event matching the filter — by author, kind, tag or time. Relays are
independent: they do not federate, they owe nobody storage, they may refuse or
drop anything. Clients read from several relays and rebroadcast what they
read to the others they use, so an event posted to three relays is soon
stored on more. Publishing is therefore effectively permanent.

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
| `k`                                    | The kind of a deleted event                                          | In kind 5 beside the `a` tag, as NIP-09 asks                         |
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
who follows whom. To follow the event, a client adds its npub and reads from
relays that hold its events; the relay hints in every `naddr` and the
instance default relays tell it which.

**[NIP-52](https://github.com/nostr-protocol/nips/blob/master/52.md) is the
calendar vocabulary.** A NIP (*Nostr Implementation Possibility*) is a
numbered document specifying one part of the protocol. Kind `31923` is a
time-based calendar event, `31924` a calendar that lists them by coordinate,
`31925` an RSVP that points at one. Flockstr, Coracle and a few others render
31923; most clients do not, which is why kind-1 notes are published as well.

**What Nostr does not give you.** No accounts, no editing a note, no
private-by-default, no delivery guarantee, no takedown, no way to know who
read what. This design accepts all of these; the enable switch's warning states them.

**Terminology.** Nostr owns the word *event*, and LibreSesh uses it for a
conference, so this file qualifies: **event** on its own is the LibreSesh
event, the conference; the protocol object is always a **Nostr event** or
named by its kind. A **tick** is one pass of a `setInterval` loop — the
announcer's every 60 s, the sync loop's every 10 s; nothing runs between
passes. The **publish queue** is a table of work owed: a write marks a row
dirty and returns, the sync loop sends later, so the request path never waits
on a relay. (Not to be confused with Nostr's *outbox model*, NIP-65 relay
selection, which this design does not use.) **Calendar sync** keeps the
addressable events (31923, 31924, kind 0) equal to the database — state, not
history. **Kind-1 notes** are the change log — history, not state. A
**transport** renders an announcement in its own format; a **trigger** is a
reason to post one; a **coordinate** is `kind:pubkey:d`.

## Architecture and decisions

```
writes ──► queue marks  ──► sync loop (10s, coalesced)   ──► 31923 per session
                                                            31924 per event
                                                            kind 0 profile
                                                            kind 5 on delete
writes ──► added/changed/pitched/placed ─┐
tick   ──► up_next/digest ───────────────┴► announcer ──► telegram.send
                                                        └► nostr.note (kind 1)
```

**Calendar sync** is state: one 31923 per published session, one 31924 calendar
and one kind-0 profile per event, kept equal to the database by a publish
queue. Calendar clients read those. **Kind-1 notes** are change: one note when
a pitch is placed, a session is added or moved, a slot is about to start, a
day begins. Followers read it, and each note references the published session by
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
| Signing key                                | Per event, generated on enable or imported from an `nsec` made elsewhere; encrypted at rest under the instance's at-rest secret, which defaults to `COOKIE_SECRET` |
| Reading back                               | None in v1. `d` tags are stable so RSVPs can be ingested later without republishing                                       |
| Existing data                              | Enabling publishes everything already written; the warning says so and the organiser's acknowledgement covers it         |
| Delivery                                   | A version is pending per relay until that relay accepts it; the badge shows once one has                                  |
| Telegram                                   | One announcer, two transports ([announcements.md](announcements.md))                                                       |
| Note triggers                              | All six, each a checkbox in a **Publish** tab of Manage Event                                                              |
| Default relays                             | Open — D6 in [STATUS.md](../../STATUS.md)                                                                                  |

## Selective publishing of data

Sessions are published as state. Enabling Nostr publishes every non-draft
session that is not opted out, including sessions written before the switch
was turned on, and keeps them current: **title, description, start and end,
room, event name, format, tags, speaker names, livestream links, and a link
back to the session.** A pitch has no calendar event; its data leaves only
inside a kind-1 note. The `pitched` note (off by default) carries **title,
description, the pitcher's display name, and a link to the board** for
pitches made while the trigger is on. The `placed` note (on by default)
carries the **title and the pitcher's display name** of any pitch placed,
including one written before Nostr was on. All of it under the event's key,
to the relays the organiser configured, for as long as those relays store it.

Never published: contributions (notes, links, questions), stars, interest,
drafts, breaks, anyone's UID, any password, any role, the audit log, the
people list.

- **Off by default**, per event, admin capability only. The switch carries the
  list above, a sentence that everything already written goes out too, and a
  sentence that relays keep copies and a deletion is a request: read, tick
  *I understand*, enable.
- **Every form that writes a published thing says so** while Nostr is on: one
  line above the session and pitch forms, *"This event publishes its programme
  and pitch board to Nostr"*, with the opt-out checkbox beside it. The notice is visible before the user types anything.
- **Opt-out is the author's and the organiser's** — exactly the set that may
  edit the item (`canMutate`). No new permission switch. A speaker who is not
  among a session's editors cannot opt out; the editors and the organiser can,
  on their behalf. The opt-out follows the item: a pitch that is placed hands
  its opt-out to the session it becomes.
- **Turning Nostr off retracts nothing.** The switch says so and offers
  **Retract everything** beside it, available whether Nostr is on or off. It
  sends a kind-5 deletion for every published Nostr event — sessions,
  calendar and profile — marks every row deleted and turns Nostr off. Enabling
  again republishes everything as new versions dated after the deletion.
  Archiving an event retracts nothing either.

## Key management

Two secrets are involved: the event's **signing key**, which is its Nostr
identity, and the instance's **at-rest secret**, which encrypts the signing
key in the database.

**Signing key.** Enabling generates one with `nostr-tools`
(`generateSecretKey`, `getPublicKey`) when the event has none; enabling again
after a disable reuses the stored key, so the npub and its followers survive
the round trip. An admin can instead **import** a key made elsewhere —
`nak key generate`, another library, a signer's export — as an `nsec…` through
`POST /import-key`. Importing replaces the event's key and therefore its
identity: it marks every row dirty so the new pubkey republishes the
programme, and it writes an audit row. The public key is stored in hex; the
private key is stored encrypted.

**At-rest encryption.** The helper is general — `server/src/secretsAtRest.ts`,
`encryptAtRest(plain, purpose)` / `decryptAtRest(blob, purpose)` — and the
Telegram bot token ([LIB-213](https://linear.app/libresesh/issue/LIB-213)) is
its second caller. **AES-256-GCM** under a key derived by **HKDF-SHA256** from
the at-rest secret with the info string `libresesh/<purpose>/v1`, a fresh
12-byte nonce per encryption. The stored blob is `v1.<keyid>.<base64 of nonce,
ciphertext and tag>`, where `keyid` is the first eight hex digits of the
SHA-256 of the secret, so boot can tell which secret made a blob without
trying it.

**The at-rest secret has one default and one override.** By default it *is*
`COOKIE_SECRET`: one secret to manage, and
[SECURITY.md](../../SECURITY.md) already keeps it off the database's volume in
production, so a copied database holds ciphertexts it cannot open (outside
production the generated secret sits in `.cookie-secret` beside the database,
and that property does not hold). An operator who wants the two lives apart
sets `SECRETS_AT_REST_KEY`, and the cookie secret can then rotate without
touching any stored key. **Rotation of whichever secret is in use:** set the
old value in `SECRETS_AT_REST_KEY_PREVIOUS`, restart; boot re-encrypts every
blob whose `keyid` matches the previous secret, logs the count, and the
variable can be dropped. Without it, rotating the secret in use **loses every
event's Nostr key**: the keys cannot be recovered, so the events' relay data
can be neither updated nor retracted. The Publish tab therefore shows
**Export key** (the `nsec…`, admin capability, behind the `auth` rate limit,
one audit row per export) with the sentence *"Keep a copy: if this instance's
secret changes, this key is gone."*

**Where the decrypted key exists:** in the sync loop and the announcer while
signing, and in the export route while building its response. Nowhere else —
not in a DTO, an export, a clone or a log — with a test.

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

**Publish queue table**

```sql
CREATE TABLE nostr_published (
  event_id      INTEGER NOT NULL REFERENCES events(id),
  entity        TEXT NOT NULL CHECK (entity IN ('session','calendar','profile')),
  entity_id     INTEGER NOT NULL,          -- session id; the event id otherwise
  d_tag         TEXT NOT NULL,
  last_event_id TEXT,                      -- hex id of the latest version built
  published_at  TEXT,                      -- first relay acceptance of that version
  dirty_since   TEXT,                      -- first unpublished mark; NULL when clean
  touched_at    TEXT,                      -- latest mark; NULL when clean
  pending       TEXT NOT NULL DEFAULT '[]',-- JSON: relays yet to accept the latest version
  deleted       INTEGER NOT NULL DEFAULT 0,
  tries         INTEGER NOT NULL DEFAULT 0,
  next_try      TEXT,                      -- backoff; NULL when due now
  last_error    TEXT,                      -- "<relay>: <reason>" of the latest failure
  PRIMARY KEY (event_id, entity, entity_id)
);
```

**Dirty marking.** `markDirty(db, eventId, sessionId?)` is a function call beside
the `audit()` call in every write that changes what a 31923 or the calendar
would contain: session create, update, delete, restore, link, unlink, repeat,
draft publish, pitch place; room, tag or format rename or delete, and event
name, date or timezone change, which mark every session of the event and the
calendar (a rename marks the profile too, since both carry the event name). It
upserts `touched_at = now` and sets `dirty_since = now` only where it is NULL,
does no relay I/O and never throws into the request. **Not via the SSE broker** (see the announcements spec). Safety net for a
missed call site: every five minutes the sync loop marks dirty any session
whose `updated_at` is
later than its row's `published_at`, and any session of an enabled event with
no row at all. **Resync** in the Publish tab marks every row dirty.

**Sync loop** — `setInterval` at 10 s, `unref`'d, beside the announcer in
`index.ts`. Per tick, per enabled event whose key decrypts:

1. Take rows that are due: dirty with `touched_at` at least 15 s old (so a
   burst of drag edits is published once) or `dirty_since` at least 60 s old
   (so a burst that never pauses still goes out), plus clean rows whose
   `pending` list is not empty; in both cases `next_try` null or past.
2. For a dirty row, build the 31923 from the **current** row; the mark only
   flags it. A row now deleted, draft or opted out becomes a kind-5 deletion
   carrying the `a` coordinate and a `k` tag, and sets `deleted = 1`. Record
   the new version's id, set `pending` to every configured relay, and clear
   `dirty_since` and `touched_at` **only where `touched_at` still equals the
   value read**, so a mark that landed during the build survives.
3. If membership changed, rebuild the 31924.
4. `SimplePool.publish(pending, event)`, one promise per relay. Each `OK`
   removes that relay from `pending`; the first sets `published_at`. If the
   list is empty afterwards, clear `tries`, `next_try` and `last_error`.
   Otherwise `tries + 1`, `next_try = now + min(60s · 2^tries, 1h)`,
   `last_error`. A relay that keeps refusing therefore keeps its rows pending
   at one retry an hour and shows up in the status table; it never blocks the
   others, and a new mark replaces the pending version with the newer one.

Delivery is at-least-once: republishing an addressable event is idempotent on
the relay. On boot the loop resumes from the table. A restored session
re-enters dirty with `deleted = 0`; the new version's `created_at` is later
than the deletion's, which is what NIP-09 tells a relay to accept.

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
and dropped, since the calendar events are the durable copy. The transport
decrypts the signing key for the duration of `signNote` and drops it.

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
and links the board. **An opted-out session or pitch is named in no note**:
it drops out of its slot, the digest and a move, and a note that would name
only opted-out items is not sent. The cut is in the Nostr transport, not the
announcer, because Telegram still carries it. `digest` is the day's programme, one line per session,
breaks included, capped at 40 lines with *"… and N more"*; an empty day posts
nothing.

## Configuration, routes and admin UI

**Instance:** `NOSTR_DEFAULT_RELAYS`, comma-separated `wss://` URLs, the list
a new event starts with (D6); `SECRETS_AT_REST_KEY` and
`SECRETS_AT_REST_KEY_PREVIOUS`, both optional, per
[Key management](#key-management). `PUBLIC_URL` is what every link is built from;
with it unset, notes carry no links and calendar events no `r` tag for the site,
rather than a `localhost` address on a public relay. Relay URLs are validated
as `wss://` (`ws://` only outside production), at most 10 per event.

**Per event**, one migration at the next free number (022 is the latest on
`dev`; the Telegram branch takes the one after it):

```sql
ALTER TABLE events ADD COLUMN nostr_enabled  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN nostr_pubkey    TEXT;             -- hex
ALTER TABLE events ADD COLUMN nostr_seckey    TEXT;             -- encrypted blob
ALTER TABLE events ADD COLUMN nostr_relays    TEXT;             -- JSON array
ALTER TABLE events ADD COLUMN nostr_triggers  TEXT NOT NULL
  DEFAULT '["placed","up_next","digest"]';
ALTER TABLE sessions  ADD COLUMN nostr_optout INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN nostr_optout INTEGER NOT NULL DEFAULT 0;
```

`nostr_seckey` and `nostr_pubkey` are never exported, cloned or returned to a
client, with a test. `nostr_enabled`, `nostr_relays` and `nostr_triggers` do
not travel either, per [announcements.md](announcements.md): a clone starts
with Nostr off. The opt-out columns *do* travel with an export: they are the
author's choice about the item.

**Routes**, all admin capability, under `/e/:slug/nostr`

| Route              | Does                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `GET /`            | Status: enabled, npub, relays, triggers, publish counts, and per relay the number of rows pending for it and the latest `last_error` naming it — all derived from `nostr_published` |
| `POST /enable`     | Body `{ acknowledged: true }` or 400. Generates and encrypts a private key if the event has none, seeds relays and rows, marks all dirty |
| `POST /disable`    | Stops the sync loop for the event. Retracts nothing; marks keep accumulating and go out on the next enable |
| `POST /retract`    | Kind 5 for every published Nostr event, every row `deleted`, Nostr off ([Selective publishing](#selective-publishing-of-data)) |
| `PATCH /`          | `relays`, `triggers`. A relay added to the list is appended to every row's `pending`, so it receives the whole programme |
| `POST /resync`     | Every row dirty                                                                                 |
| `POST /test`       | Republishes the kind-0 profile now and returns each relay's `OK` or refusal text verbatim — the *Send a test* of announcements.md, without a visible post |
| `POST /import-key` | Body `{ nsec }` or 400. Replaces the signing key, marks all dirty, audit row `nostr_key_imported`. `auth` rate limit |
| `POST /export-key` | The `nsec…`. `auth` rate limit, audit row `nostr_key_exported`                                  |

The session and proposal DTOs gain `nostrOptOut`, accepted on PATCH under the
ordinary edit permission; the session DTO also gains `nostr: { naddr } | null`
for the badge.

**Admin UI: Publish tab.** An eighth tab in Manage Event holding all
outbound publishing settings. **Nostr**: the switch and its warning;
once on, the npub with a copy button and an *Open on njump* link, the relay
list editor, the six trigger checkboxes each with the **Example** button
announcements.md gives every option, **Send a test**, the status table (per
relay pending rows and latest error, per event counts), **Resync**, **Retract
everything**, **Export key**, **Import key**. **Telegram**: the section
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

- **Encrypt/decrypt at rest** round trip; wrong purpose and wrong secret
  fail; the blob's `keyid` names its secret; boot with `_PREVIOUS` set
  re-encrypts exactly the blobs made under it.
- **Builders**: snapshot of the exact 31923, 31924 and kind-0 JSON against a
  fixture with every field set; drafts, opted-out, deleted and breaks
  excluded; `d` unaffected by a slug rename.
- **Publish queue**: a drag storm of 20 PATCHes yields ≤ 2 publishes; a
  storm that never pauses publishes within 60 s; a mark during a build is not
  lost; a delete yields one kind 5 with `a` and `k` and a calendar rebuild;
  an event rename marks sessions, calendar and profile; restore re-enters;
  the sweep catches a row updated without a mark; boot resumes dirty and
  pending rows; a relay refusing keeps the row pending for that relay only
  and backs off; a relay added by PATCH receives every row.
- **Notes**: snapshot per trigger; `a` tags and `naddr` references match the
  calendar event's `d`; digest cap; Nostr off sends nothing.
- **Routes**: enable without acknowledgement is 400; enable after disable
  keeps the npub; import replaces it and marks all dirty; retract deletes
  every row, turns Nostr off and a later enable republishes; the private key
  never appears in any response, export or clone, nor do the enabled, relay
  and trigger columns; export-key and import-key are admin-only, rate limited
  and audited; opt-out obeys `canMutate`; a placed pitch inherits it; the
  badge appears once one relay has accepted and not after a deletion.
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
2. **Keys and schema**: `secretsAtRest.ts` with the `keyid` and rotation
   path, the migration, `nostr-tools`, the enable/disable/import/export
   routes, the warning copy, SECURITY.md —
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
and roles; remote signing (NIP-46), which would keep the key out of the
database altogether; `p` tags for speakers; zaps, DMs, relay hosting,
recurring events.

**Documentation updated in the same commits:** [ARCHITECTURE.md](../../ARCHITECTURE.md) (the
announcer and its transports, calendar sync, `nostr_published` in the table of
tables), [SECURITY.md](../../SECURITY.md) (what leaves, the encrypted key, the
at-rest secret and its rotation, the import and export routes), [docs/schema.md](../../docs/schema.md),
`deploy/*.env.example`, [web/public/api.md](../../web/public/api.md), and after
step 1 [telegram-announcements.md](telegram-announcements.md).
