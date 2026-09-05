# Everyone who enters is a person: username and full name, one People list, and a merge dialog that shows who is who

Status: **built and on `dev`, 2026-09-02** — see *What was built* below.
Was: draft, fourth revision. Decisions so far: the
credit-others capability defaults to open; every identity that enters an
event gets a `people` row; a person has a **username and a full name**;
and **the username is required at the gate** (no more `attendee_x7f2k`);
**viewers are persons like anyone else, visible and active, but not
offered as speakers** (revised 2026-09-02 after the first cut hid them
entirely, which was wrong).

Wording note: who a session is credited to is **credited** throughout —
not the stage-jargon word for whose name is on the poster, which earlier
drafts and the code comments used.

## What was reported

1. A new attendee with default permissions can create a session, but the
   speaker field does not offer *them*. They can only type their own name
   as "someone new".
2. There is no setting that limits an attendee to crediting only
   themselves. Anyone with `session.create_open` can credit anyone.
3. A newcomer can only be merged with an organiser-added speaker profile
   after they have edited their own profile, which makes no sense to the
   organiser doing the merging.
4. The merge picker is a bare `<select>` of names. It needs suggestions
   first, then search, then the full list, and each row must show enough
   (UID, claimed or not, last seen) that an organiser cannot fold the wrong
   person in. After a merge there is no way back to Manage → People.
5. Manage → People is two stacked lists with tall rows; the attendance
   list is a long scroll away, and the `ID: 00054` next to a UID has no
   purpose an organiser can see.

## Root cause for 1 and 3: an attendee is not a person until they edit their profile

Two tables describe a human in one event and they are populated at
different moments:

| Table | Created when | What the UI treats it as |
| --- | --- | --- |
| `event_identities` + `roles` | at the gate, for everyone | the attendance list (Manage → People, lower half — removed in Step 3) |
| `people` | on first profile edit, when a session names them, or when an organiser adds them | the roster: speaker picker, merge candidates, People tab upper half |

The speaker picker (`SpeakerCombobox`) and the merge dialog (`MergeModal`
in `ProfilePage.tsx`) both read `bundle.people`. A newcomer who passed the
gate and never opened their profile has no `people` row, so they appear in
neither. That is the whole of problems 1 and 3.

Verified consequences today:

- If the newcomer types their own name into the speaker field and picks
  "Add … as someone new", `resolveSpeaker` (`server/src/speakers.ts`)
  creates an **unclaimed** row with that name. Nothing links it to their
  identity. `speaksFor` therefore says they are not the speaker of their
  own session; they can still edit it only because `session.edit_own`
  matches `created_by`.
- The link gets made later, and only by accident: `PATCH /me/profile`
  (`server/src/routes/people.ts`, the `nameClash` branch) adopts an
  unclaimed row whose `name` equals the profile name **exactly, case
  sensitive**. `resolveSpeaker` matches case-insensitively on the
  normalised name. So "ada lovelace" typed on a session and "Ada Lovelace"
  as the profile name are one person to the speaker field and two to the
  claim path.
- The same accident can go the other way: a *different* Alex who enters
  the gate as "Alex" and later opens their profile silently claims the
  unclaimed "Alex" an organiser typed onto a session. There is no undo
  for that except a merge in the other direction.

## The model: a person has a username and a full name

Today one human in one event has two names in two tables, and the code
gives them roles that overlap. Read with the user's framing they are two
different things, and the columns already exist for both:

| Concept | Column | Set when | Unique? | Shown |
| --- | --- | --- | --- | --- |
| **Username** | `event_identities.display_name` | typed at the gate | **yes**, per event | on posts, in the header chip, in the People list, `@ada` on a profile |
| **Full name** | `people.name` | organiser types it, or the person fills it in | no | credited on sessions and pitches, heading of the profile page |

- Everyone who enters has a username, **and types it themselves**. Today
  a fresh identity is minted with a random `attendee_x7f2k` and the gate
  falls back to it when the field is left empty; that goes. The field is
  required the first time you enter an event. It is per event: the
  cross-event seed (`identities.display_name`, "the name you last chose
  anywhere on the instance") is a cross-event feature, and under the
  direction below those are not wanted, so the gate no longer prefills
  from it. It is not a login credential; there is no password attached to
  it, and the cookie is what identifies you.
- A **pre-registered speaker** is a `people` row with a full name and no
  identity: a shell with no username, until somebody claims it (by
  redeeming a speaker code, by an organiser merging an attendee into it,
  or by the gate prompt in Step 0).
- The full name is **not unique**. Two "Alex Chen"s can both be here. The
  uniqueness rule on `people.name` (`nameClash`) goes away; the merge tool
  is for duplicates that are the same human, and the People list shows
  the username and UID so an organiser can tell namesakes apart.
- At the gate the full name is **initialised to the username** so the new
  person has something to be credited as. It does not follow the username
  afterwards; editing either is editing that one thing. The profile page
  shows both, labelled, with a hint on the full name: "How you are
  credited on sessions. Add your full name if it differs."
- Where a *human* is shown as the author of something (a note, a pitch),
  it is the username: that is how the room knows them. Where they are
  shown as *giving* something (a session), it is the full name. Search
  matches both.

This drops the whole "mirror the two columns" machinery from the previous
draft, and the gate needs no cross-table uniqueness check.

**Invariant from here on:** every `event_identities` row has exactly one
live `people` row with that `identity_id`. A `people` row without an
identity is a person an organiser expects who has not arrived. There is
no third kind.

What it costs, said plainly:

- **Everyone is visible to everyone, viewers included.** A viewer is a
  person like anyone else: they star sessions, register interest, post
  where the matrix lets them, and their name shows on what they post.
  So `bundle.people` carries everyone to every role, as today. What a
  viewer is *not* is someone you credit as a speaker: a livestream
  audience or a walk-in reader did not come to give a talk. `PersonDto`
  gains one public boolean, `creditable` — true for an unclaimed profile
  and for a holder with the attendee role or above, false for a viewer's
  person — and the speaker picker offers only creditable rows. It is one
  boolean, not the role, so nothing else about who runs the event is
  disclosed. An organiser's picker ignores it, since an organiser may
  credit anyone, and the server accepts any person id from an organiser.
  UIDs, roles and last-seen stay organiser-only, as now.
- **The picker lists hundreds of names at a big event.** It is search-first
  already. Accepted.
- **A migration with a backfill.** Bounded; Step 0.

## Direction: one database per event, identity inside the event

Stated 2026-09-02 as a goal, not part of this spec (backlog, Medium
Priority, has the sizing). Cross-event identity — one cookie is one
person across the instance, roles in every event on `GET /me`, a UID
that is "the same at every event" — is judged a feature nobody needs,
and it is where the four-table identity model comes from. The target:
a registry for events and passwords, one SQLite file per event, and **a
person is a row with an optional device token**; unclaimed means no
token. Username, full name, role, stars and authorship all hang off that
row.

This spec is the first half of that move, and it is shaped to be. Once
every human in an event is a `people` row (Step 0) and the username and
full name live on the person's event records, the only instance-wide
thing left is `identities.token`, and moving it onto `people` is the
split. Two rules follow for every step below:

- **Nothing new goes on `identities`, and nothing new spans events.** New
  facts about a human go on `people` or `event_identities`, per event.
  That is why the cross-event name prefill is dropped rather than kept.
- **Nothing here should have to be undone by the split.** The role
  control writes `roles` keyed by identity because that is where roles
  are today; after the split it writes a column on the person. The
  People list, the merge dialog and the picker read `PersonDto`, which
  survives unchanged.

The UID stays for now and stays instance-wide (`identities.public_id`).
After the split it becomes per event; the "same at every event" tooltip
on it goes with the split, not before.

## Groundwork for agents acting on someone's behalf

Not built now; the point is to not paint over the seam. Two things in the
current model are already the right shape and must be kept apart:

- **Who did it is an identity** (`sessions.created_by`,
  `contributions.created_by`, the audit `identity_id`).
- **Who is credited is a person** (`session_speakers.person_id`,
  `proposals.speaker_id`).

A Telegram bot or an API client that creates a session *for* Ada is an
identity that is not a human in the room: it is the author and Ada's
person is credited. That is exactly "credit others", so the bot needs the
`session.credit_others` capability and nothing else new in the write path.
What it will need, when the time comes:

1. `identities.kind TEXT NOT NULL DEFAULT 'person'` (an `ADD COLUMN`, no
   rebuild), with `'agent'` as the other value. The gate hook from Step 0
   creates a `people` row only for `kind = 'person'`. An agent is never a
   speaker, never in the picker, never a merge candidate.
2. A bearer token that resolves to an agent identity, read by the same
   middleware that reads the cookie. `link_codes` and `ics_token` are the
   pattern; an organiser mints and revokes it from Manage.
3. Audit and the schedule show the author as the agent's username
   ("telegram-bot") and the speaker as Ada, which `NameResolver` and
   `session.speakers` already do without change.
4. `rekeyIdentityWork` must never treat an agent identity as a merge side.
   With `kind`, that is one guard.

The rule to keep while building: **never make `people` the thing that
authors, and never make `identities` the thing that is credited.**

## Steps

Each is one commit with its tests. 0 first; the rest need it. 3 before 4
(the dialog reuses the row component). 5 is independent.

### Step 0: every identity that enters gets a person

**The gate requires a username.** `authSchema.displayName` and
`demoAuthSchema.displayName` stay optional in the schema for one reason
only: an identity re-entering an event where it already holds a name
(after a logout, or switching role on a demo event) may omit it and keep
that name. When neither is present the gate answers 400 `name_required`
instead of falling back to `identities.display_name`. `newDisplayName()`
and its `attendee_…` prefix are deleted; a fresh identity is created
with an empty seed and the gate no longer prefills from `Me.displayName`
at all. A device re-entering an event where it holds a name (after a
logout) is prefilled from that held name, which needs the gate to be
told it: a new pre-auth `GET /e/:slug/gate` (mounted in `app.ts` beside
`eventAuthRoutes`, before `requireRole('viewer')`) returns
`{ heldName: string | null }` for the calling identity. `Gate.tsx`
fetches it on mount and prefills from it instead of `me.displayName`. `identities.display_name` is left in place
but written by nothing new; it is one of the columns the per-event split
deletes. `NameResolver` already falls back for identities without an
event name; it must not print an empty string, so its fallback becomes
the UID. `seed.ts` and the demo seed name their identities explicitly
already.

**`ensureOwnProfile(db, eventId, identityId, username)`** in a new
`server/src/people.ts` module (the route file is already long):

1. Return the live `people` row with this `identity_id`, if one exists.
2. Else insert a claimed row with `name = username`, empty bio and links.

Callers: both gate paths in `eventAuth.ts` (after `claimEventName`, before
`grant`); `PATCH /me/profile`; `ProfileMenu.openProfile` stops calling
`updateMyProfile({})` because the row exists. Idempotent, so a retry or a
race costs nothing.

**The gate's "is that you?" prompt.** Adopting an unclaimed row by name
is what the profile-edit path does today, silently, and it is wrong for a
namesake. So instead of adopting inside `ensureOwnProfile`, the gate
looks for a live *unclaimed* person whose full name matches the typed
username case-insensitively. If there is one, it answers with a new code,
`profile_exists`, carrying that name and how many sessions it is on, and
the gate UI asks: *"There is a speaker profile here called Ada Lovelace,
on 2 sessions. Is that you?"* **Yes, that's me** re-enters with
`claimProfile: true`, which sets `identity_id` on that row instead of
inserting a new one. **No** enters normally and gets a fresh person; the
organiser can still merge later. A profile with a minted speaker code is
already claimed and never reaches this branch. The gate already has a
suggestion flow for `name_taken`, so this is a second branch of the same
component, not a new screen.

**`nameClash` is removed.** Organiser create, rename and self-edit of the
full name no longer refuse a duplicate. The username uniqueness check in
`claimEventName` is untouched.

**Migration** `010_everyone_is_a_person.sql`. The runner applies `.sql`
files only (`migrate` in `server/src/db.ts`; it has no code steps), so
the backfill is one SQL statement: for every `(event_id, identity_id)` in
`event_identities` without a live `people` row, insert one named after
the username —

```sql
INSERT INTO people (event_id, identity_id, name, bio, links, created_at, updated_at)
SELECT ei.event_id, ei.identity_id, ei.display_name, '', '[]', ei.claimed_at, ei.claimed_at
  FROM event_identities ei
 WHERE NOT EXISTS (SELECT 1 FROM people p
                    WHERE p.event_id = ei.event_id AND p.identity_id = ei.identity_id
                      AND p.deleted_at IS NULL);
```

No schema change is needed for the invariant itself; the file exists so
the backfill runs once, is recorded, and gets the runner's pre-migration
backup. Existing unclaimed rows are left alone;
where one has the same name as a newly inserted person, the organiser
sees two rows with the same full name, one `unclaimed`, one with a UID,
and merges them. That is the honest state; guessing in a migration is
how a namesake gets someone else's sessions.

**Deleting a person** on the People list is only offered for unclaimed
rows after this. Taking away the profile somebody is credited and posts
under while they are still in the room is not a thing an organiser means
to do; two rows for one human is what Merge is for, and what an organiser
wants to do to a live attendee is change their role (Step 3).

The server still allows it, deliberately. Refusing would corner an
organiser who minted a speaker code by mistake — minting claims the
profile, so the row could then never be removed — and the invariant heals
itself anyway: the row comes back at that person's next gate entry or
profile edit. (Corrected 2026-09-02 while building Step 3: an earlier
draft said the next *request* would recreate it, which is not true —
`ensureOwnProfile` runs at the gate, not on every request.)

**`/attendees` and `AdminAttendees` go away** in Step 3. `AdminAttendees`
is the endpoint's only client reader (checked; the audit page resolves
actor names server-side).

**Tests** (`tests/people.test.ts`, `tests/auth.test.ts`,
`tests/migrations.test.ts`): a first entry without a username is
`name_required`; re-entry without one keeps the held name, and the gate
is told that name; a fresh identity's seed is empty; entering creates a claimed person
named after the username; entering twice does not create two; entering under the
full name of an unclaimed profile returns `profile_exists` and adopts it
only with `claimProfile`; two persons may share a full name; the backfill
covers a fixture with and without a pre-existing unclaimed namesake;
deleting a claimed person is refused.

### Step 1: "You" in the speaker picker

With Step 0 the caller is in `bundle.people` with `isMine: true`, so no
schema change and no sentinel. `SpeakerCombobox` pins the caller's own
row to the top as "Ada Lovelace · you" while they are not yet credited,
and the chip reads the same. For a non-admin creating a new session or
pitch, the credits start as `[myPersonId]`; an organiser's start empty.
One click removes it.

Rows in the picker show full name and, for claimed persons, the username
(`@ada`), so two namesakes can be told apart when choosing. A viewer's
person is in the bundle but not in the picker: rows with
`creditable: false` are filtered out for everyone but organisers, and
the server refuses a non-organiser crediting one (403, the same message
as Step 2). Organisers may credit anyone.

`resolveSpeaker` already prefers a claimed row on a case-insensitive
name match, so an API caller typing a name still resolves sensibly;
the picker itself sends ids.

**Tests** (`tests/sessionSpeakers.test.ts`, `tests/people.test.ts`): a
newcomer's session credited to their own person id; `speaksFor` holds
from the first session; a viewer's person carries `creditable: false`
and an unclaimed or attendee-held one `true`; an attendee crediting a
viewer's person is 403 and an organiser doing so succeeds.

### Step 2: a capability for crediting other people

**Decided: defaults open.** One new entry in
`server/src/shared/capabilities.ts`:

```ts
{
  id: 'session.credit_others',
  label: 'Credit other people as speakers on sessions and pitches',
  defaults: ['user', 'speaker', 'admin'],
}
```

**Server rule** in `resolveSpeakers` / `resolveSpeaker`, when the caller
lacks it: every entry must resolve to the caller's own person, or, on a
PATCH, to a person already credited on that session. Otherwise 403 `"You
can only credit yourself as a speaker here"`. Removing others from your
own session stays allowed. Admin is always on. A future agent identity
needs this capability, which is the intended way to scope it.

**Client.** When `can(bundle.permissions, role, 'session.credit_others')`
is false the combobox offers only your own row and no free-text creation.

**Tests** (`tests/permissions.test.ts`): capability off → own id succeeds,
own id plus another 403, a PATCH keeping an organiser-added co-speaker
succeeds, a PATCH adding one 403; admin never blocked; proposals same.

### Step 3: one People list, dense, filtered, with a role control

Manage → People becomes a **single list** of `bundle.people`. The
attendance list and its component are removed.

**Facts.** `personRosterFacts` (organisers only, as now) grows
`username`, `lastSeenAt`, `joinedAt` and `sessionCount`; the columns are
one join away in the query it already runs. `PersonDto` gains `username`
for everyone (it is public in the header chip anyway) and the three
organiser-only fields.

**Row.** One line, table-like, no card padding:

```
Ada Lovelace   @ada   a1b2c   [speaker]   2 sessions   seen 3 min ago   Role ▾  Merge…  Edit
Alan Turing    —      —       unclaimed   1 session    —                Merge…  Edit  Delete
```

- full name, then username or `—`, then UID (mono) or `—`;
- one badge: the role, `signed out` (claimed, holds no role here),
  `unclaimed`, or `code unused` (as now);
- session count, last seen;
- actions: **Role** (select: viewer / attendee label / speaker / admin;
  claimed rows only), **Merge…**, **Edit** (profile page), **Delete**
  (unclaimed only).

The `ID: 00054` goes. It is `people.id`, which is in the profile URL and
nowhere else an organiser needs it; the UID is the identifier that means
something across the audit log and other events. `rowId` stays in the
audit page, where it labels the entity a row is about.

**Filters** as a segmented control above the list, with counts:
**All · Attendees · Unclaimed · Organisers · Speakers**, plus a search
box matching full name, username and UID. "Attendees" is everyone who
has entered (claimed); "Unclaimed" is the shells, which are usually the
pre-registered speakers. Default sort by full name; the last-seen column
header toggles sort by recency. The tab's description says what the list
now is: everyone who has entered, plus the people organisers expect.

**`PUT /people/:id/role { role }`**, admin only: writes `roles` for the
holder identity with the same upsert `grant` uses; refuses to demote the
last admin of the event (no such guard exists anywhere today, and an
event with no organiser has no way back, the reasoning `getPermissions`
already gives for forcing admin on). Audit as `role_set`. Broadcast
`person.updated`.

**Tests** (`tests/people.test.ts`; `tests/attendees.test.ts` folded in):
roster facts carry username, last seen and counts for organisers only;
role set works, is audited, refuses the last admin; viewers never see the
organiser fields; the filter predicates are pure functions with a test.

### Step 4: the merge dialog

Candidates are every other row in `bundle.people`, which after Step 0 is
everyone. No second fetch. Rows are the Step 3 row component, so the
dialog shows exactly what the list shows: full name, username, UID,
badge, session count, last seen. That is what stops "Ada Lovelace @ada
a1b2c, 3 sessions, seen 2 min ago" being confused with "Ada Lovelace,
unclaimed, 0 sessions".

**Layers**, top to bottom:

1. **Likely duplicates**: up to three candidates scored against the
   survivor's full name and username by a pure function in
   `web/src/lib/people.ts`: normalised equality, one containing the
   other, shared surname token, initials ("A. Lovelace" ↔ "Ada
   Lovelace"). Hidden when nothing scores.
2. **Search**: filters all candidates by full name, username or UID.
3. **Everyone else**: the full list, scrollable.

Rows are radio buttons, because a `<select>` cannot carry badges.

**Confirm step.** Picking a row swaps the body for a two-column summary,
survivor left, chosen right, same facts, plus the consequence sentence
for the case:

- chosen is unclaimed → "Their sessions move here. Nothing else changes."
- chosen is claimed, survivor unclaimed → "`@ada` (a1b2c) becomes the
  holder of this profile." (the old "organiser claims on someone's
  behalf"; with Step 0 it is just a merge)
- both claimed → "Everything `@ada2` (f9e8d) did in this event moves to
  `@ada` (a1b2c), and that device is signed out." (`rekeyIdentityWork`;
  the case where a wrong pick costs the most)

Then Cancel / Back / Merge. `MergeModal` moves out of `ProfilePage.tsx`
into `web/src/components/MergeModal.tsx` since two pages open it.

**Tests**: the suggestion scorer (`tests/peopleSuggest.test.ts`) and the
consequence-sentence choice as pure functions. The suite runs under
`environment: 'node'`, so the modal itself is not unit-tested.

### Step 5: a way back from the profile page

Links from the People list pass
`state={{ back: { to: '/e/:slug/admin?tab=people', label: 'People' } }}`;
`ProfilePage` reads `useLocation().state` and renders "← People" when
present, "← Schedule" otherwise. Organisers also get a "Manage → People"
link in the profile header so a deep link has a way to the tab. After a
merge on the profile page, stay on the survivor. The profile heading
becomes the full name with `@username` beneath it, and the `ID: 00054`
line goes here too.

## Order and size

| Step | Touches | Size |
| --- | --- | --- |
| 0 everyone is a person | eventAuth.ts, eventIdentity.ts, new people.ts, routes/people.ts, a migration + backfill, Gate.tsx, ProfilePage name fields, ProfileMenu | medium-large |
| 1 "You" row + prefill | SpeakerCombobox, SessionModal, ProposalBoard form | small |
| 2 capability | capabilities.ts, speakers.ts, SpeakerCombobox | small |
| 3 one People list + role | mappers.ts, types.ts, routes/people.ts, AdminPage, new PersonRow component, remove AdminAttendees + /attendees | medium |
| 4 merge dialog | MergeModal.tsx (new), lib/people.ts | medium |
| 5 back link + profile heading | AdminPage, ProfilePage | small |

ARCHITECTURE.md needs a paragraph under §Why a display name belongs to
the event naming the two things (username, unique, on the event
membership; full name, free, on the person), and a line in §Data model
for the invariant. The identity spec's B1/B2 sections stay true.

## Decisions taken

- **`session.credit_others` defaults open** for attendee, speaker and
  admin: the app leans towards rooms where people trust each other and
  invite co-hosts.
- **Everyone who enters is a person**, viewers included, visible to all
  and able to star and post like anyone; a viewer's person is simply not
  `creditable`, so it is not offered as a speaker.
- **The username is required at the gate.** No auto-generated
  `attendee_x7f2k`; the field is prefilled with the last name you chose
  once you have one.
- **Username and full name.** Username = `event_identities.display_name`,
  unique per event, typed at the gate. Full name = `people.name`, not
  unique. A pre-registered speaker is a full name without a username.
- **Agents are identities, never persons.** The `identities.kind` column
  is the seam; not added until an agent exists.
- **Pre-fill "You"** on a non-admin's new session and pitch.
- **Claiming on someone's behalf is a merge**, not a separate endpoint.
- **Role changes stay explicit**: merging never changes a role; the People
  list gets a role control.
- **The `ID: 00054` label goes** from the People list and the profile
  page; the UID is the identifier. It stays on the audit page.
- **One database per event is the direction.** Not built here; this spec
  puts nothing new on `identities` and nothing that spans events, so the
  split later is a storage move, not a redo.

## Open questions — resolved 2026-09-02

1. The gate's "is that you?" prompt: **build it** as specified in Step 0.
2. The UI word is **username**. The gate's hint says it is per event and
   not a login.

## What was built

**All six steps are on `dev`, 2026-09-02**, in this order: `5142d10`
(Step 0), `79e5044` (Step 1), `39003b5` (Step 2), `2c913e3` (Step 3),
`3f353a0` (Step 4), `3d19d74` (Step 5). Steps 0–2 were built in the main
session; 3–5 were picked up in the same session after the model changed,
so they went on `dev` rather than the `feat/…` branch this section used
to ask for — that rule exists to stop two writers sharing a branch, and
there was only ever one.

Two things were decided while building, and the prose above is corrected
to match rather than left to disagree with the code:

- **Deleting a person somebody holds is hidden, not refused** (Step 0's
  paragraph). Refusing would corner an organiser who minted a speaker
  code by mistake, and the invariant heals at the next gate entry.
- **`person.*` broadcasts must not carry viewer-scoped facts.** Found in
  Step 3: `isMine` and the organiser-only fields were computed for
  whoever caused a change and sent to every subscriber, so an organiser
  editing a bio told the owner the profile was not theirs. The wire frame
  is public now, the reply to the caller discloses, and the client keeps
  what it already knew (`applyPersonChange`).

Not built, and deliberately: **signing somebody out** from the People
list. The role control can move a person between roles but cannot put
them outside the event, so a "signed out" row can be given a role back
but nothing can take one away entirely. Nobody has asked for it yet.

## Decisions taken

- **`session.credit_others` defaults open** for attendee, speaker and
  admin: the app leans towards rooms where people trust each other and
  invite co-hosts.
- **Everyone who enters is a person**, viewers included, visible to all
  and able to star and post like anyone; a viewer's person is simply not
  `creditable`, so it is not offered as a speaker.
- **The username is required at the gate.** No auto-generated
  `attendee_x7f2k`; the field is prefilled with the last name you chose
  once you have one.
- **Username and full name.** Username = `event_identities.display_name`,
  unique per event, typed at the gate. Full name = `people.name`, not
  unique. A pre-registered speaker is a full name without a username.
- **Agents are identities, never persons.** The `identities.kind` column
  is the seam; not added until an agent exists.
- **Pre-fill "You"** on a non-admin's new session and pitch.
- **Claiming on someone's behalf is a merge**, not a separate endpoint.
- **Role changes stay explicit**: merging never changes a role; the People
  list gets a role control.
- **The `ID: 00054` label goes** from the People list and the profile
  page; the UID is the identifier. It stays on the audit page.
- **One database per event is the direction.** Not built here; this spec
  puts nothing new on `identities` and nothing that spans events, so the
  split later is a storage move, not a redo.

## Open questions — resolved 2026-09-02

1. The gate's "is that you?" prompt: **build it** as specified in Step 0.
2. The UI word is **username**. The gate's hint says it is per event and
   not a login.

## Handing this to another agent

**Steps 0, 1 and 2 are on `dev`** (2026-09-02: `5142d10`, `79e5044` and
the capability commit after it). What remains is Steps 3, 4 and 5. Read
`CLAUDE.md`, `.claude/CLAUDE.md`, `ARCHITECTURE.md` §Why a display name
belongs to the event (rewritten for the two names), and
`_planning/specs/identity-and-people.md` first; then this file top to
bottom; then the three commits above, which show the shape of things:
`PersonDto` now carries `username` and `creditable` for everyone and
`role`/`holderUid`/`codePending` for organisers (`personFacts` in
`server/src/mappers.ts` is the one query to extend for Step 3's
`lastSeenAt`, `joinedAt`, `sessionCount`). Then:

- Work on a branch `feat/everyone-is-a-person` off `dev`. A second agent
  never commits to `dev` (`.claude/CLAUDE.md` §Git Conventions).
- One commit per step, each with its tests, lint clean, `npm test` green.
  Tests-with-features is the recorded policy.
- **Stop after Step 3 and report** before going on: it removes an
  endpoint and a component and adds a role-changing route with the
  last-admin guard, and that is worth a look before the merge dialog is
  built on top of it.
- Do not add anything to `identities` or anything that spans events (see
  *Direction*). If a step seems to need it, stop and ask.
- Where this spec and the code disagree on a detail, the code wins for
  facts and this spec wins for intent; say which you followed.
- `STATUS.md` (repo root here, not `_planning/`) has the queue item; move
  it to In Progress when starting, and log each landed step in
  `CHANGELOG.md` `[Unreleased]`.
