---
title: Identity, profiles, and the duplicate-person problem
kind: spec
status: built
written: 2026-08-30
updated: 2026-08-30
decisions: []
linear: []
---
# Identity, profiles, and the duplicate-person problem

Status: **decided and shipped 2026-08-30** (A1 + B1 + B2, in that order, as
recommended below). Decisions recorded at the end. Drafted 2026-08-30 after the
backlog's "People dedupe/merge" item was challenged as under-specified.

## The two problems are one problem

LibreSesh has two identifiers for a human being:

| | Where | Scope | Set by |
| --- | --- | --- | --- |
| `identities.token` | signed `cid` cookie | one browser, 400 days | minted automatically |
| `people.name` | `people` row per event | one event | typed by whoever names a speaker |

Neither is a reliable key for "a person", and they disagree in both directions:

- **One human, several `people` rows** → the duplicate problem. "A. Lovelace"
  and "Ada Lovelace" are different records.
- **One human, several `identities` rows** → the cross-device problem. The same
  person on a phone and a laptop is two unrelated actors to the server.

Fixing one without the other leaves the failure visible, so they are specified
together here.

## What breaks today, verified

Everything personal hangs off `identity_id`: roles (`001_init.sql:29`), claimed
profiles (`003_people.sql:9`), stars (`004_stars_and_ics.sql:4`), proposal
interest (`005_proposals.sql:30`), the iCal subscription token, and authorship
of every session, contribution and pitch.

### Opening the event on a second device

1. New cookie → new identity → a fresh random `attendee_x7f2k` display name.
2. **No role.** They re-enter the event password. Fine — it is a shared
   password and they know it.
3. **They cannot claim their own profile.** `PATCH /me/profile` calls
   `nameClash`; the profile is already claimed by device A's identity, so it
   throws `409 name_taken` — *"Someone else here already goes by that name"*
   (`people.ts:84`). There is no path out of this. The comment at
   `people.ts:78` shows the author hit exactly this class of bug for
   *unclaimed* rows and fixed it by claiming them; the claimed case was left
   with a hard error.
4. **Their starred agenda is empty**, and their iCal subscription URL points at
   a different, empty agenda.
5. **They cannot edit the session they created** on the other device —
   `assertMayMutate` compares `created_by` to the identity
   (`sessionRules.ts:138`): *"That is not your session"*.
6. **They cannot delete their own contributions** (`contributions.ts:73`).

The message in (3) is also actively misleading: it says someone *else* has the
name, when in fact *they* do.

### Duplicate people

`resolveSpeaker` (`proposals.ts:80`) matches an existing person by
`name = ?` — exact and case-sensitive — and silently inserts a new unclaimed
`people` row on any miss. So "ada lovelace", "Ada Lovelace" and "Ada Lovelace "
(pre-trim) are three people. There is no uniqueness constraint on
`people.name`; the only unique index is `(event_id, identity_id)`, so nothing
at the database level prevents this.

This is *deliberate* for an unconference — you must be able to pitch a session
naming a speaker who has not arrived yet. The tap is meant to be open. What is
missing is a way to tidy up afterwards.

## Directions

### A. Cross-device identity

**A1 — Transfer code (recommended).** Device A shows a short-lived, single-use
code or QR. Device B enters it and adopts A's identity token; both devices then
carry the same cookie. Reuses the capability-token pattern already used for
`ics_token`, adds no concept an attendee must understand, and keeps pillar 1
("no accounts") intact.

Honest risk: whoever reads that code becomes that person, including their role.
Roles hang off the identity, so a leaked admin code is an admin takeover.
Mitigations: 2-minute expiry, single use, invalidated on display close, and
never shown to a role the viewer does not already hold. Note this does not make
things much worse than they are — event passwords are shared, so anyone in the
room can already reach any role they know the password for.

**A2 — Recovery passphrase.** The attendee sets a passphrase on device A and
types it on device B. Works without device A present, but it is an account in
all but name, invites password reuse, and needs its own hashing and rate
limiting. Contradicts pillar 1 more than A1 does.

**A3 — Do nothing, but fail gracefully.** Keep identity per-device. Fix the
misleading error message, and let an admin reassign a profile's `identity_id`
from the people list. Cheapest; leaves stars and authorship stranded.

### B. Duplicate people

**B1 — Reduce creation (prevent).** The speaker input becomes a combobox that
searches existing people case- and whitespace-insensitively, showing matches as
you type, with "Add <name> as someone new" as an explicit secondary action
rather than the silent default. Also normalise on write: trim, collapse runs of
whitespace, and match case-insensitively.

**B2 — Admin merge tool (cure).** Pick two or more people, choose the survivor,
then: repoint `sessions.speaker_id` and `proposals.speaker_id`, keep the
survivor's bio/links (filling blanks from the losers), soft-delete the rest,
and write an audit row. Rules that need stating:

- Merging two *claimed* profiles must ask whose `identity_id` survives, and the
  loser's identity ends up with no profile.
- The `(event_id, identity_id)` unique index means the loser's `identity_id`
  must be nulled in the same transaction, not after.
- Merging is not reversible through `/trash`, which currently covers only
  sessions and contributions.

B1 and B2 are complementary: B1 alone leaves the existing mess, B2 alone leaves
the tap running.

## Recommendation

A1 + B1 + B2, in that order. A1 removes the worst UX failure (a permanent
lockout from your own profile with a message blaming someone else), B1 stops
new duplicates, B2 cleans up what exists.

If only one thing ships, make it the fix to (3): claiming should succeed when
the clashing profile is unclaimed *or* the request can prove it is the same
person; otherwise the error should at least not accuse a stranger.

## Open questions

1. Is a transfer code acceptable against "no accounts", or does any
   cross-device continuity cross the line?
2. Should a transfer carry the **role**, or should device B re-enter the event
   password? (Re-entering is safer and barely more friction.)
3. Should merge be admin-only, or may a person merge a duplicate *into* their
   own claimed profile?
4. Do stars and proposal interest transfer, or is a personal agenda explicitly
   per-device?

## Decisions (2026-08-30)

A1 + B1 + B2 all shipped, with one refinement to A1: the transfer code is
encoded as **three words** (`house-dog-erratic`) rather than digits — a phrase
survives being read across a room or typed on a phone. ~588 words × 3 ≈ 27
bits, which is plenty for a code that is single-use, dies in ten minutes, is
stored hashed, and shares the password-guessing rate budget. Endpoints:
`POST /me/link-code` (mint) and `POST /me/link` (redeem, repoints the cookie).

The open questions resolved as follows:

1. **Transfer code vs "no accounts" — acceptable.** It transfers a browser
   identity; there is nothing to register, remember, or reset afterwards.
2. **Does the role transfer — dissolved.** Under token adoption this question
   does not exist: both devices are one identity row, so the role (and
   everything else) comes along *by construction*. Stripping it on device B
   would strip device A too. The safety valve is the code's expiry, not a
   role fence.
3. **Merge is admin-only** for now. Self-merge into one's own claimed profile
   is a plausible later loosening via the permission matrix.
4. **Do stars transfer — dissolved**, same reason as 2.

When both merge candidates are claimed, picking the survivor *is* picking
whose claim wins; the other identity ends up profile-less but intact.

## Follow-up direction: speakers

Discussed 2026-08-30 and **shipped the same day** (migrations 014/015), after
the migration runner learned rebuilds, a downgrade guard and pre-migration
backups. As built:

- A fourth **speaker role** between attendee and admin (migration 014, the
  first table rebuild). Inherits attendee defaults in the matrix; its one
  structural power is editing sessions whose speaker is the holder's claimed
  profile — words only, placement and deletion of official sessions stay
  with organisers.
- **Speaker codes** (migration 015): an admin-minted, per-person, revocable
  four-word phrase bound to a `people` row. All the identity work happens at
  *mint* time — an unclaimed person gets a fresh identity, the speaker role,
  and its name claimed at the event — so redemption is the same dumb token
  adoption `/me/link` already does, which is what makes one code work from
  any number of devices. Deliberately *not* an email/password account and
  *not* a fourth shared password — a shared speaker password would defeat
  the point (anyone holding it could post as any speaker).

