# Holons integration — second review

**Status:** review of [holons-integration-analysis.md](holons-integration-analysis.md),
2026-09-16. No decision taken, no D-number, no branch. Licences are out of
scope by the owner's instruction and are not weighed anywhere below. A
non-technical summary for collaborators is
[holons-integration-brief.md](holons-integration-brief.md).

**Question asked:** is the first analysis right; is integrating LibreSesh into
Holons a bad idea or merely a lot of work; are LibreSesh's permissions even
needed when small unconference groups trust each other, or do they carry their
own value at bigger events; how good is the Holons code (clean, responsive,
Sybil-resistant); and could the LibreSesh UI simply be ported onto Holons with a
different data model.

**Answer in one line:** the first analysis reached the right recommendation
for partly wrong reasons — Holons' real weakness is not a missing capability
matrix but that, on its active branch, any Nostr key can overwrite any record in
any holon; that makes "absorb" worse than the first analysis said, "federate"
already half-written on their side, and a UI port technically easy but
pointless until they have a write boundary to port it onto.

## Contents

- [What was re-checked and against which code](#what-was-re-checked-and-against-which-code)
- [Corrections to the first analysis](#corrections-to-the-first-analysis)
- [Bad idea or just a lot of work](#bad-idea-or-just-a-lot-of-work)
- [Are LibreSesh's permissions necessary](#are-libreseshs-permissions-necessary)
- [Holons code quality](#holons-code-quality)
- [Holons security and Sybil resistance](#holons-security-and-sybil-resistance)
- [Porting the LibreSesh UI onto Holons](#porting-the-libresesh-ui-onto-holons)
- [What to do next](#what-to-do-next)
- [Confidence and what was not checked](#confidence-and-what-was-not-checked)

## What was re-checked and against which code

The first analysis read Holons `main` at `ed2644d` (2026-08-30). Three heads
were compared this time:

| Branch | Tip | Date | GUN dependency |
|---|---|---|---|
| `main` = `dev` | `ed2644d` | 2026-08-30 | present |
| `remove-gun` | `2974050` | 2026-09-07 | removed |
| `nostr-relay` | `9cf8a9a` | 2026-09-16 | removed |

`nostr-relay` was committed this morning and is 686 files and 95,000 lines
away from `main`. It is the branch the project is living on. Everything below
about storage, trust and Sybil resistance is read from it, and the first
analysis' open question 1 ("is `remove-gun` the real future?") is answered:
yes, and it has moved on again to `nostr-relay`.

LibreSesh is read on `feat/openapi` at `2c5cc5f`.

To reproduce:

```sh
git clone --depth 1 https://github.com/liminalvillage/holons.git
cd holons && git fetch --depth 1 origin nostr-relay && git checkout FETCH_HEAD
```

## Corrections to the first analysis

The recommendation survives. Four of the supporting claims do not, and two of
them matter.

**The holosphere implementation is in the repo.** The first analysis says
`holosphere` is "a vendored `.d.ts` with no implementation in this repo" and
counts it as 2 files / 934 lines. It counted only `.ts`. `packages/holosphere`
holds about 9,400 lines of `.js` on `main` and 19,000 on `nostr-relay`, with
`canWrite`, a signing layer, a federation module and a store. Open question 2
("does `canWrite()` do more than the type says?") could have been answered
from the clone. The answer is no: `canWrite` returns true for the owner, for a
key in an in-memory `_allowedAuthors` set, or for a key in the holon's
federation list, and nothing in the write path calls it before storing.

**There is a two-role membership model, on `main`.** `signing.js` has an
`enforce: 'membership'` mode: a signed, append-only `_members` log on the
holon, rooted at a genesis event, where only admins may add or remove members
and reads drop anything not signed by a member as of its timestamp. That is a
real authority model with `admin` and `member`, per holon. The first analysis
described authorization as "one boolean"; it is one boolean per holon plus one
admin bit. Still no per-lens or per-capability grant, but "structurally cannot
host one" is too strong: the read-time predicate is `(pubkey, at) -> boolean`,
called per lens, and extending it with a lens argument and a richer `_members`
schema is a bounded change, not an architectural impossibility.

**And that model is not wired in anywhere that runs.** On `main` the web
layout could enable signing from an environment variable
(`apps/web/src/routes/+layout.svelte:507`), but only in the reader-scoped
`federation` flavour, never `membership`. On `nostr-relay` that code is gone:
the factory that builds every instance says *"Every write is signed by
`privateKey` and published to the relays; there is no signing mode to pick"*,
the constructor sets `enforce` only from a `signing.enforce` option, and no
caller in `packages/core` or any app passes one. The membership code still
exists in `signing.js` but nothing constructs a sphere that uses it. What actually runs is described
in the next section, and it is weaker than the first analysis assumed.

**The interop work has already started on their side.** `docs/nostr-interop.md`
on `nostr-relay` (draft, 2026-09-08) is titled "Nostr interop — the shared
contract" and names three publishers: Elinor (community shifts), Holons and
LibreSesh. It cites LibreSesh at commit `ca2a206`, which is not in this
repository's history, so it was written against a fork or a squashed view. It
asks LibreSesh for exactly two things: emit `['t', 'group-<holon>']` and a
provenance tag, with an optional holon id per event beside the publish toggle.
It also states, about Holons itself, that it currently violates its own rules 1
and 5 (it parses foreign `d` tags and would re-project a LibreSesh session
under its own key). Open question 3 ("is there appetite?") is answered by the
existence of that document. Phase 1 of the first analysis is not a proposal
any more; it is a conformance table with LibreSesh's row half empty.

Finding 2 (responsiveness) and Finding 3 (shallow feature overlap) were
re-read and hold. Finding 4 (licences) is dropped by instruction.

## Bad idea or just a lot of work

"Integrating LibreSesh into Holons" is three different sentences, and the
answer differs for each.

**Absorb the data model into Holons.** This is a bad idea, not merely a large
one, and the reason is sharper than the first analysis gave. On `nostr-relay`
the local store applies every relay event that has a valid signature and the
right app tag, and resolves conflicts by newest `created_at`, with no check on
who signed it (`packages/holosphere/store/store.js`, `apply()`). The relay is
strfry with NIP-42 authentication explicitly not implemented ("a relay must not
require it", `docs/nostr-onboarding.md`). So a schedule stored as Holons
lenses has this property: anyone who can generate a keypair can move any
session to any room at any time, and every honest client will display the
move. Holons is a coordination tool for a community that has, so far, chosen to
run without a write boundary. An unconference programme is the one artefact in
that community that strangers will be handed a link to. Porting it onto that
substrate removes the integrity guarantee and gives nothing back that the
community does not already have.

**Federate over Nostr.** This is neither bad nor a lot of work. LibreSesh's
`nostr-publishing.md` spec (merged to `dev` in PR #118, 550 lines, not yet built)
already publishes NIP-52 events; the interop draft asks for two extra tags. The
work is the spec as written plus a per-event holon id field. Nothing about who
may edit what changes, because LibreSesh stays the writer and Holons, by its
own rule 5, is a read-only cache of foreign records.

**Put the LibreSesh UI in front of Holons data.** Technically moderate,
strategically premature. See [the porting section](#porting-the-libresesh-ui-onto-holons).

So: one shape is a bad idea, one is cheap and in motion, one is work that
should wait. The first analysis said the same in different words; the
difference is that the case against absorbing is now about integrity, not
about a missing matrix.

## Are LibreSesh's permissions necessary

The Socratic version of the question is: what does the 4×10 matrix actually
buy, and would a trusting room miss it?

Start from what the matrix looks like with no overrides
(`server/src/shared/capabilities.ts`):

| Capability | viewer | user | speaker | admin |
|---|---|---|---|---|
| contribution.create | | ✓ | ✓ | ✓ |
| contribution.delete_own | | ✓ | ✓ | ✓ |
| contribution.moderate | | | | ✓ |
| session.create_open | | ✓ | ✓ | ✓ |
| session.edit_own | | ✓ | ✓ | ✓ |
| session.credit_others | | ✓ | ✓ | ✓ |
| proposal.create | | ✓ | ✓ | ✓ |
| proposal.vote | ✓ | ✓ | ✓ | ✓ |
| session.star | ✓ | ✓ | ✓ | ✓ |
| person.edit_own | | ✓ | ✓ | ✓ |

By default `user` and `speaker` are identical and `admin` adds one capability
plus the settings pages. The matrix is, in practice, three tiers: **read and
react**, **participate**, **run the event**. That is the same shape as Holons'
dormant `member`/`admin` log with a viewer tier added. The matrix's value is
not its granularity, which almost nobody changes. Its value is three things
that are easy to miss because they are not in the table:

1. **A viewer tier exists at all.** Someone can be given the schedule without
   being given the pen. Holons has no equivalent: a key is either in the
   community or not, and today even that is not enforced. For a 25-person
   circle this is irrelevant. For a 300-person unconference where the link is
   on a lanyard it is the whole game.
2. **A server enforces it.** The threat model in `SECURITY.md` is explicit:
   *"a conference schedule that a room full of strangers can edit"*, defended
   by rate limits, bcrypt on the shared password, soft delete with restore, an
   audit log with actor ids, draft visibility rules, and stars that are never
   attributed. Every one of those is a server-side property. None of them
   survives a move to a client-filtered graph: an audit log nobody can be
   stopped from rewriting is not an audit log, and a star count computed on
   the client from per-author records is a list of who starred what.
3. **Damage is undoable.** The trusting-room argument is really "nobody here
   is malicious", and that is usually true. The failure mode at a real event
   is not malice; it is a well-meaning attendee dragging the wrong session, a
   phone in a pocket, a stale tab. Soft delete, restore and the audit trail
   exist for that person, not for an attacker. Trust does not remove the need
   for undo.

The owner's own framing of the model is worth recording because it is the
one a user sees, not the one the code shows. The hierarchy is a dial. At one
end it is completely flat: every participant is an admin and anyone can add,
move or delete anything, the right setting for a small group that trusts each
other. At the other end it is tiered: viewers get a password and can read,
star, register interest and post questions, but cannot touch the programme;
participants edit their own sessions and pitches; organisers do everything
including moderation. Both are the same matrix with different rows switched
on, and the organiser picks one in the event settings.

A second distinction the owner draws should be kept in front of any
integration discussion. Sign-in (email, Telegram group membership, a Nostr
key, an Ethereum wallet) is authentication. What a signed-in person may do is
authorization. LibreSesh can add any of those sign-in methods without touching
the model above, and Holons' identity layer, however good, answers only the
first question. "Who is an organiser here?" is answered by the event's stored
permissions, never by how the person proved who they are. That is why a Nostr
login is a cheap phase-2 item and a shared data model is not.

So the honest answer to "does a small trusting group need the permissions?"
is: no, not the matrix. They need a read-only link, an undo, and a schedule
that does not have a public write endpoint. Those are the parts of LibreSesh
that are cheap to keep and expensive to rebuild. The matrix could be
simplified to three named tiers tomorrow with no loss to anyone, and that is a
legitimate LibreSesh backlog item independent of Holons.

And "does LibreSesh have its own value for bigger events?" is yes, for the
same three reasons in the other direction, and for a fourth that has nothing
to do with Holons: the interface. The organiser's real alternatives are tools
like Pretalx, built for curated conferences with a programme committee, which
fight a programme that is being made by the room in real time. The schedule
grid, pitch board, personal agenda and questions under sessions are the
product; the permission dial and the undo are what let it be handed to a room. The bigger the room, the more the
viewer tier, moderation and the audit trail are the product, and the Gantt
lanes and quest lists in Holons are not. Holons' own calendar has no rooms,
tracks, proposal board or star agenda; the first analysis' Finding 3 still
stands.

## Holons code quality

Measured on `nostr-relay`, `.ts` + `.svelte` + `.js` excluding `node_modules`
and vendored assets under `public/`.

| Package | Lines | Test files | `any` | Largest file |
|---|---:|---:|---:|---|
| `packages/core` | ~53,000 | 113 | 292 | — |
| `apps/web` | ~92,000 (`.ts`+`.svelte`) | 9 | 573 | `Calendar.svelte` 3,388 |
| `apps/kiosk` | ~69,000 | 31 | 84 | `OffersView.svelte` 2,588 |
| `packages/holosphere` | ~19,000 (`.js`) | some, untyped | 46 | `federation.js` 1,858 |

What is good:

- **Layering is real.** `packages/core` imports no UI framework; every
  interface (web, kiosk, telegram, discord, mcp, voice) is a thin adapter over
  it. That claim in the README holds in the source on both branches.
- **`strict: true`** in the base tsconfig and in `apps/web`; a single CI
  workflow runs typecheck, build, test and lint across the workspace.
- **Core is well tested** relative to its size: 113 test files for 53,000
  lines, and the tests read like specifications (governance tally, delegation
  cycles, shift wires).
- **Documentation is unusually honest.** `docs/nostr-interop.md` documents
  Holons' own non-conformance. `SIGNING.md` and `NOSTR-BACKEND.md` say what is
  enforced and what is not. The comment in `tasks/completion.ts` that the
  core trusts a caller-supplied `isAdmin` is a warning, not an oversight.
- **Movement is fast and directional.** GUN is gone; the store is a small
  last-writer-wins log over signed events with a documented tie-break.

What is not:

- **The web app is barely tested.** 9 test files for 92,000 lines, one of
  which is a 642-line `index.test.ts`. The UI is where the 573 `any`s live.
- **God components.** `Calendar.svelte`, `Map.svelte`, `CanvasView.svelte`
  and `TaskModal.svelte` are each over 2,000 lines; the kiosk has five more.
  This is the pattern the first analysis noticed in the responsiveness count:
  behaviour is implemented per component, not as a system.
- **`holosphere` is untyped JavaScript with a hand-maintained `.d.ts`.** It is
  the most security-relevant package and the only one outside `strict`.
- **The kiosk roughly doubled in three weeks** (DockView, DockMap, maplens,
  shifts, lens forms), which is where the test files went. The web app did
  not get the same attention.

Responsiveness was not recounted; the `main` measurement (40 of 206 Svelte
files use a Tailwind breakpoint, 39 hand-write `@media`, 13 branch on viewport
in JS, `user-scalable=no` in `app.html`) is the state of `apps/web` and the
first analysis' reading is fair: a deliberate mobile app shell with
responsiveness done component by component. The kiosk is a large-screen
artefact by design and should not be judged on the same axis.

Overall: a competent, fast-moving codebase with a well-built core and a UI
layer that has grown faster than its tests. Not messy, not clean; typical for
one strong author and a lot of agent-assisted output.

## Holons security and Sybil resistance

The question "is it secure from Sybil attacks" has to be split, because Holons
has no single gate. There are three places a Sybil could hurt, and they differ.

**Writes to the shared record.** On `nostr-relay` there is no write boundary.
`store.apply()` accepts any event with a valid signature and the app's `n`
tag; `wins()` picks the newest `created_at`; the relay does not require
NIP-42. The `trustedAuthors` hook exists but applies only to reverse-sync of
standard Nostr kinds (`reverse-sync.js:95`), not to the canonical kind-30078
records. The membership log and the `enforce` modes are present in
`signing.js` and unused by every app. So a Sybil is not even needed: one fresh
key suffices to rewrite any record in any holon, and the write will replicate
to every client. This is documented on their side as a design stage, not a
bug, but for the purposes of this review it is the fact that decides
everything else.

**Governance.** `governance/tally.ts` weights a vote as one plus the stars
earned as ratee on settled exchanges, and counts *"every known member plus any
voter from outside the list"* in the denominator. Read literally: a non-member
who toggles participation on a proposal quest is counted as both a yes and an
eligible voter. With the write boundary above, that means N fresh keys are N
yes votes. The reputation weighting does not defend against this; it
amplifies it once fake keys rate each other. The tally is a pure function over
records and does exactly what its comment says; the Sybil hole is that the
records it folds are unauthenticated.

**Identity.** Member keys for Telegram users are derived server-side from the
Telegram id and a `NOSTR_DERIVATION_SECRET`; the docs call this out as
custodial: *"the secret holder can sign as any member."* Own keys via nsec
import, passkey or Ethereum are free to mint. Join is *"ensuring the user
profile exists"* (`users/membership.ts`). Telegram accounts cost a phone
number, which is the only Sybil friction in the system, and it applies only on
the bot path.

Two smaller things worth passing on to them:

- `apps/web/src/components/Schedule.svelte:247` renders
  `{@html \`@${participant.username}\`}`. The username comes from a `users`
  record that, per the paragraph above, anyone can write. That is stored XSS
  in the schedule view. The kiosk's `linkify()` escapes correctly and
  `RichDescription.svelte` sanitises; this one was missed.
- `user-scalable=no` in `app.html` disables pinch zoom, an accessibility
  regression unrelated to integration.

Compared with LibreSesh's threat model, which is server-enforced,
rate-limited, audited and explicitly scoped to "public-ish, low-stakes,
high-trust", Holons' current posture is "high-trust, and the trust is the
only mechanism". For a closed community on a private relay that is a
legitimate choice. It is the wrong substrate for the one artefact that will be
shared outside the community.

## Porting the LibreSesh UI onto Holons

The question was whether the UI could simply be lifted onto a different data
model so Holons gets the frontend. Measured on `web/src`:

| | |
|---|---|
| Files | 67 `.tsx`, 32 `.ts` |
| Lines | 25,407 |
| Files that call `fetch` | 2 (`lib/api.ts` and the dev bar) |
| Imports from `@shared/types` | 87 |
| Call sites of `can()` | 14 |
| Largest files | `AdminPage.tsx` 2,687, `SchedulePage.tsx` 1,876, `Calendar.tsx` 1,016 |

The good news is that the coupling is exactly where it should be. All network
access is behind a single 516-line `api` object returning typed DTOs from a
716-line shared types file. Mechanically, "port the UI onto Holons" means
writing a second implementation of that `api` object that reads and writes
holosphere lenses and returns the same DTOs. That is a real, bounded piece of
work, and the React side would not know.

The bad news comes in three layers.

**Framework.** Holons is Svelte 5 on Tailwind 3; LibreSesh is React 19 on
Tailwind 4. "Best of my frontend" cannot mean copying components across. It
means either mounting the React app as an island or iframe inside the
SvelteKit shell (cheap, and it is shape (c) from the first analysis), or
rewriting 25,000 lines in Svelte (not a port). There is no third option.

**The DTOs assume a server.** The `Me` object carries permissions the server
computed; the bundle omits drafts the requester may not see; star and interest
counts are aggregates with attribution stripped; deletes are soft and
restorable; every write lands in an audit row. A holosphere-backed `api`
would have to compute roles on the client from a `_members` log (fine, if
Holons turned that on), reveal every star's author to compute a count (a
privacy regression LibreSesh has a threat-model row against), give up drafts
as a server-side secret, and give up the audit log as evidence. The UI would
render; what it rendered would no longer mean what it means today.

**There is nothing to enforce against.** This is the layer that makes the
first two moot for now. The 14 `can()` sites would produce a correct UI with
grey buttons, and a curl to the relay would bypass all of them. A port today
would give Holons a schedule that looks like LibreSesh and behaves like a
shared whiteboard.

So the answer is: the frontend is portable in the sense that matters (one
seam, typed DTOs, no fetch scattered through components), and that is worth
keeping true. But porting it *now* transfers the pixels and not the product.
The precondition on their side is a write boundary: either the dormant
`enforce: 'membership'` log turned on and extended per lens, or a relay write
policy that checks membership. Once that exists, the port is a
`HolosphereApi` adapter plus an iframe, in that order.

## What to do next

In priority order, and with the effort stated so the owner can decide rather
than infer.

1. **Federate, as specified.** Build `nostr-publishing.md` and add the two
   tags and the optional holon id the interop draft asks for. This is the
   phase-1 work from the first analysis with the counterpart already written.
   Effort: the spec's own estimate, plus a day for the tags. Nothing about
   permissions changes.
2. **Reply to the interop draft.** It is addressed to LibreSesh by name and
   cites a commit that does not exist here. A short note confirming the two
   tags, correcting the commit reference, and pointing at the two security
   items in the previous section is the cheapest possible act of goodwill and
   settles open question 3 for good.
3. **Simplify the LibreSesh matrix to three tiers** if the owner agrees with
   the reading in [the permissions section](#are-libreseshs-permissions-necessary).
   This is a LibreSesh decision on its own merits; it also happens to make the
   two role models line up if a port is ever attempted. Not urgent.
4. **Do not absorb, and do not port yet.** Revisit the port when Holons has a
   write boundary in production. The trigger to watch is `enforce` appearing
   in `packages/core/src/holosphere/factory.ts` or a `writePolicy.plugin` in
   their strfry config.
5. **Sign-in with a Nostr key** stays the phase-2 item from the first
   analysis. It is independent of everything above and useful to LibreSesh
   whether or not Holons is ever the other end.

## Confidence and what was not checked

**Verified by reading source on `nostr-relay` at `9cf8a9a`:** the store
accepts any validly signed event and resolves by newest timestamp with no
author check; the factory picks no signing mode; no app passes `enforce`;
`trustedAuthors` applies only to reverse-sync; NIP-42 is documented as not
implemented; the tally counts members ∪ voters; member keys are custodial;
the unescaped username in `Schedule.svelte`; the interop draft's contents and
its `ca2a206` reference; all counts in the tables.

**Verified on `main` at `ed2644d`:** the `canWrite` implementation; the
`enforce: 'federation'` and `enforce: 'membership'` modes and the `_members`
log semantics; the responsiveness counts (not recounted on `nostr-relay`).

**Verified on LibreSesh `feat/openapi` at `2c5cc5f`:** the capability
defaults; the `api.ts` seam and DTO imports; the threat model; file sizes.

**Inference:** that the write boundary is the deciding factor for every
integration shape is a judgment, argued above. That the matrix collapses to
three tiers *in practice* assumes few events override defaults; the
`event_permissions` table exists precisely so they can, and production data
was not looked at. That a Sybil ring inflates reputation weights follows from
`voteWeightOf` but was not demonstrated end to end.

**Not checked:** whether `relay.holons.io` runs a strfry write-policy plugin
in production (the checked-in `strfry.conf` has none); the `discord-ui`,
`voice-ui` and `mcp-ui` packages; anything about their roadmap beyond what
their docs say; the LibreSesh commit the interop draft cites, which is not in
this repository.
