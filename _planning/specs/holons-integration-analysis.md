# Holons integration — analysis

**Status:** analysis only, 2026-09-16. No decision taken, no D-number assigned,
no branch. Written to be reviewed by a second agent before anything is decided.

**Question asked:** how would integrating LibreSesh into a Holons architecture
work; is it sensible; how is the Holons UI built and is it responsive; does
their data model allow the fine-grained permissions LibreSesh offers.

**Answer in one line:** federate over Nostr, do not merge codebases — the fit
is real but narrow, and Holons has no permission model comparable to ours, on a
storage layer that structurally cannot host one.

## Contents

- [How to reproduce this analysis](#how-to-reproduce-this-analysis)
- [What Holons actually is](#what-holons-actually-is)
- [Finding 1: permissions are binary at holon granularity](#finding-1-permissions-are-binary-at-holon-granularity)
- [Finding 2: the UI is mobile-aware but unevenly responsive](#finding-2-the-ui-is-mobile-aware-but-unevenly-responsive)
- [Finding 3: the feature overlap is shallower than it looks](#finding-3-the-feature-overlap-is-shallower-than-it-looks)
- [Finding 4: licences point in opposite directions](#finding-4-licences-point-in-opposite-directions)
- [Three integration shapes, and which to pick](#three-integration-shapes-and-which-to-pick)
- [Recommendation](#recommendation)
- [Open questions for the reviewer](#open-questions-for-the-reviewer)
- [Confidence and what is inference](#confidence-and-what-is-inference)

## How to reproduce this analysis

Everything below was read from source, not from the README. To re-check it:

```sh
git clone --depth 1 https://github.com/liminalvillage/holons.git
```

Analysed at Holons **`ed2644d5c51d8b1b6a0b49ec14cb31b54f54677b`**, dated
2026-08-30. `main` and `dev` were the same commit at the time of writing.

Caveat the reviewer should check first: active work is happening **off main**.
`git ls-remote --heads` showed ten branches, including `remove-gun`
(tip `2974050`, 2026-09-07) and `nostr-relay` (`9cf8a9a`) — both newer than
`main`. If `remove-gun` has landed since, re-verify Finding 1 against it.
See [Open questions](#open-questions-for-the-reviewer).

LibreSesh line numbers below are on `feat/openapi` at `2c5cc5f`.

## What Holons actually is

A pnpm monorepo: one UI-agnostic domain core with several interfaces over it
(`web`, `telegram`, `discord`, `voice`, `text`, `ai`, `mcp`) plus three apps
(`web`, `kiosk`, `wequest`). The layering claim in the README holds up in the
code — `packages/core` imports no UI framework.

Measured (files / lines, `.ts` + `.svelte`, excluding `node_modules`):

| Package | Files | Lines |
|---|---:|---:|
| `packages/core` | 198 | 27,580 |
| `apps/web` | 316 | 92,182 |
| `apps/kiosk` | 95 | 32,354 |
| `packages/telegram-ui` | 14 | 15,064 |
| `apps/wequest` | 37 | 6,384 |
| `packages/holosphere` | 2 | 934 |

`packages/core/src` holds 27 domains, including `auth`, `users`, `identity`,
`roles`, `calendar`, `scheduler`, `governance`, `federation`, `rea`, `dna`.

Side-by-side with us:

| | Holons | LibreSesh |
|---|---|---|
| Web UI | SvelteKit 2 / Svelte 5, Tailwind **3**, Netlify adapter, service worker (PWA) | React 19, Vite, Tailwind **4**, base-ui |
| Store | GUN graph ("Holosphere") — P2P, local-first, schemaless | SQLite, 25 tables, 22 migrations |
| Identity | Nostr keypair; providers Telegram / passkey / Nostr / Ethereum; NIP-98 for HTTP auth | Signed cookie, per-event identity, device-link codes |
| Authorization | `canWrite(holonId, lens, actingAs) -> {canWrite, reason, accessType}` | 4 roles x 10 capabilities, per-event matrix |
| Licence | AGPL-3.0-or-later (dual, commercial option) | MIT |

Identity is worth noting as the bright spot: `packages/core/src/auth/index.ts`
defines one signing identity model (a Nostr keypair) with four ways to obtain
one, and `nip98.ts` implements NIP-98 HTTP auth. That is the seam this analysis
recommends building on.

## Finding 1: permissions are binary at holon granularity

**This is the blocker, and it is not close.**

The whole of Holons authorization is `packages/core/src/holosphere/identity.ts:31`,
`canWriteToHolon`, which delegates to `holosphere.canWrite()` and — if that
method is absent — falls back to checking whether the bound private key equals
the holon id:

```ts
// Fallback: owner check — the bound private key owns the holon.
if (hs.client?.publicKey === holonId) {
  return true;
}
return false;
```

The declared return shape (`packages/holosphere/holosphere.d.ts:263`) is
`{ canWrite: boolean; reason: string; accessType: string }`. One boolean. There
is no capability, no role argument, no per-record grant.

Three things in the repo look like a permission system and are not:

1. **`packages/core/src/roles/` is a duty roster.** `Role { id, title,
   description, participants, weekSchedule }` with `WeekSchedule { weekKey,
   assignments }` and `DayAssignment { dayOfWeek, date, users }`
   (`roles/types.ts`). It answers "who does the dishes on Tuesday". Nothing
   consults it before a write.
2. **Membership is "a profile exists".** `users/membership.ts` says so in its
   own header: *"Join is implemented as ensuring the user profile exists —
   there is no separate membership record in the holosphere model."*
   `leaveHolon` deletes the profile from the `users` lens. There is no role
   field to gate on.
3. **The one real check in core trusts its caller.**
   `packages/core/src/tasks/completion.ts:21` takes `isAdmin?: boolean` as a
   caller-supplied option and at line 45 does
   `options.isAdmin === true || isInitiator(...) || isParticipant(...)`. Its
   own doc comment is explicit that core does not own the decision: *"Set true
   to bypass initiator/participant check (e.g. when caller has resolved
   holon-admin rights **elsewhere**)."* The core believes whatever the UI
   passes it.

Against that, LibreSesh:

- `server/src/shared/capabilities.ts` — 10 capabilities, each with role
  defaults (`proposal.vote` includes `viewer`; `contribution.moderate` is
  `admin` only).
- `server/src/permissions.ts:36` `getPermissions()` — defaults, then this
  event's stored overrides from `event_permissions`, then admin force-enabled
  on every capability so an organiser cannot produce an event nobody can
  moderate and nobody can repair.
- `can()` is in `shared/`, evaluated on both client and server, so the UI and
  the API cannot disagree about what a role may do.

**Why this cannot be ported onto Holosphere.** A capability matrix needs a
trusted evaluator: something that holds the matrix and refuses the write. In
LibreSesh the SQLite server is that evaluator. GUN is an eventually-consistent
CRDT graph — whoever holds a writable key writes, and conflicting writes merge
rather than get rejected. There is nowhere to stand. Port the model and it
collapses to one bit: can write to this holon, or cannot. For an unconference
that is fatal, because the entire point is that an attendee may star and pitch
but may not reschedule a room.

Note this is an argument about *architecture*, not about GUN specifically. A
GUN-to-Nostr swap (the `remove-gun` / `nostr-relay` branches) does not fix it:
relays do not evaluate capability matrices either.

**Privacy has the same shape.** A LibreSesh event sits behind a viewer
password. Holosphere's `password` parameter on `get`/`put`/`getAll` is
shared-secret encryption of a lens, not per-role access — everyone who can read
anything reads everything.

## Finding 2: the UI is mobile-aware but unevenly responsive

SvelteKit 2 + Svelte 5, Tailwind 3, `@sveltejs/adapter-netlify`, plus
`apps/web/src/service-worker.ts`. Measured on `apps/web/src`:

- 206 `.svelte` files total; **40** use a Tailwind breakpoint (`sm:`/`md:`/`lg:`/`xl:`).
- **39** files carry a hand-written `@media` block.
- **13** files do viewport logic in JS (`isMobile`, `innerWidth`, `matchMedia`)
  — per-component, not systemic.
- `Calendar.svelte` is **3,359 lines** with **12** breakpoint usages and one
  `@media`.
- Only 2 hardcoded wide pixel widths, so it is not aggressively desktop-pinned.
- `app.html` ships `width=device-width, initial-scale=1.0, maximum-scale=1.0,
  user-scalable=no, viewport-fit=cover`.

Read: a deliberate mobile app-shell / PWA posture, with responsiveness
implemented per component rather than as a system. `user-scalable=no` disables
pinch-zoom, which is an accessibility problem worth raising with them
independently of any integration. Several surfaces (kiosk, `CanvasView`,
`Map`, `Orbits`) are large-screen artifacts by design.

Practical consequence: a LibreSesh schedule grid embedded in that dashboard
would **not** inherit responsiveness from the host. It would carry its own, as
it does today.

Second practical consequence: **Tailwind 3 vs Tailwind 4** is a different
config format and a different engine. Merging into one build is a migration,
not a version bump.

## Finding 3: the feature overlap is shallower than it looks

The route list suggests collision — `apps/web/src/routes/[id]/` contains
`calendar`, `schedule`, `events`, `roles` — and core has `calendar/`
(`ical.ts`, `rsvp.ts`) and `scheduler/` (`recurring.ts`,
`quest-reminders.ts`).

It reads differently in the source. `apps/web/src/components/Calendar.svelte`
does **Gantt-style multi-day span lanes** — `assignSpanLanes()` at line 707 is
a greedy assignment by end date, so a span keeps a persistent row across days.
That is "what is happening this month in our group". LibreSesh does **rooms x
time-slot grids** with overlap packing (`web/src/lib/laneLayout.ts`,
`timeBox.ts`), pitches, tracks, track windows and stars.

Holons has no room concept, no track concept, no proposal board. `core/calendar`
is iCal generation plus RSVP tallying, and `core/scheduler` is recurring
reminders.

This is an argument **for** integration rather than against: LibreSesh is
precisely the thing the Holons calendar does not do. It is also why absorbing
LibreSesh into `core/calendar` would be a rewrite, not a merge.

## Finding 4: licences point in opposite directions

Holons is **AGPL-3.0-or-later** throughout — root `package.json`,
`@holons/core/package.json`, and SPDX headers on individual source files —
dual-licensed with a commercial option (`LICENSE-COMMERCIAL.md`,
`LICENSING.md`, `CLA.md`).

LibreSesh is **MIT** (`package.json`).

- Importing `@holons/core` into LibreSesh forces LibreSesh to AGPL.
- Contributing LibreSesh code into the Holons monorepo is permitted (MIT is
  compatible into AGPL) but the result is AGPL-encumbered for downstream, and
  their CLA applies.

This is a governance decision, not a technical one, and on its own it rules out
one of the three shapes below. **It should be settled before any code is
written.**

## Three integration shapes, and which to pick

**(a) Absorb — port the LibreSesh model into `@holons/core` as a lens.**
Cost: months. Rewrites SQLite-backed logic onto a CRDT graph, drops the
capability matrix (Finding 1) and the viewer password, relicenses to AGPL
(Finding 4), and lands on a calendar that does less than the one we have
(Finding 3). Not recommended.

**(b) Federate — LibreSesh stays its own app and exchanges data over Nostr.**
Cost: the work already specified. No shared code, no AGPL exposure, no
permission model compromised. Recommended.

**(c) Embed — run LibreSesh as an app tile inside the Holons dashboard, SSO'd
by the Nostr key.** Cost: moderate, and only worth it after (b). Visual
integration without architectural integration.

## Recommendation

**Federate. Do not merge codebases.**

The seam already exists on both sides. Holons authenticates with Nostr
keypairs and NIP-98 (`packages/core/src/auth/index.ts`), and its
`HoloSphereConfig` already accepts `backend: 'nostr'`, where per its own
comment *"the relay(s) are the wire and Gun runs peerless as the local-first
cache"*. On our side there is a 550-line `nostr-publishing.md` spec — NIP-52
calendar events, write-only, own key, encrypted at rest — designed 2026-09-16
and not yet built.

**Note for the reviewer:** that spec is *not* on `feat/openapi`. It lives on
branch `docs/nostr-spec` (`ae7f6c0`), also checked out at
`.claude/worktrees/nostr-spec/_planning/specs/nostr-publishing.md`, alongside
`announcements.md`, which it depends on. Read it there before assessing the
phases below.

- **Phase 1 — publish.** Ship `nostr-publishing.md` unchanged. LibreSesh emits
  NIP-52 calendar events. A Holons holon subscribes to the event's pubkey and
  its calendar lens fills in. Zero shared code, zero AGPL exposure, no
  permission model touched; LibreSesh stays authoritative over who may do what.
- **Phase 2 — sign in with a Nostr key.** Already flagged as a follow-up in
  that spec. A Holons user's existing `npub` becomes their LibreSesh identity;
  `holonIdForIdentity()` and our `event_identities` agree on the same pubkey.
  Device-link codes stay for people without keys.
- **Phase 3 — embed, only if wanted.** LibreSesh as an iframe or app tile in
  the Holons dashboard, SSO'd by the Phase-2 key.

The honest framing: Holons is a federation and identity substrate with a thin
coordination layer on top; LibreSesh is a deep, permission-heavy application.
Use Holons for what it is good at — identity and cross-group distribution — and
keep authorization where there is a server to enforce it.

## Open questions for the reviewer

1. **Is `remove-gun` the real future?** Tip `2974050` (2026-09-07) is newer
   than `main`. If GUN is being replaced, re-verify Finding 1 against that
   branch. The architectural argument should survive — relays do not evaluate
   permissions either — but the mechanism described would be stale.
2. **Does `holosphere.canWrite()` do more than the type says?** `holosphere`
   is a vendored `.d.ts` (`packages/holosphere/holosphere.d.ts`, 507 lines)
   with no implementation in this repo. `accessType: string` hints at more
   than a boolean. If the real implementation supports per-lens grants, the
   severity of Finding 1 drops from "blocker" to "gap" and shape (c) gets more
   attractive. **This is the single highest-value thing to check.**
3. **Is there an appetite on their side?** This analysis is one-directional —
   nobody from Holons has been asked. Phase 1 needs nothing from them; Phase 2
   needs agreement on identity.
4. **Does Phase 1 leak?** LibreSesh events are viewer-password gated.
   Publishing NIP-52 events is effectively permanent and public. The existing
   spec has a "selective publishing" section; confirm it is sufficient before
   pointing it at a federation partner rather than at the open relay set.
5. **Licence call.** Does the project accept AGPL if shape (c) is ever taken?
   If no, that is a durable constraint worth recording.

## Confidence and what is inference

**Verified by reading source** — all line counts and file:line references;
that `roles/` is a roster and not access control; that membership is profile
existence; that `tasks/completion.ts` trusts a caller-supplied `isAdmin`; the
`canWrite` signature; the responsive measurements; the licences; the
Calendar.svelte lane algorithm.

**Inference, argued but not proven** — that a capability matrix cannot be
enforced on a CRDT graph without a trusted evaluator. Sound in general, but it
assumes no gatekeeper is introduced. A Holons deployment with an authoritative
relay that validates writes would weaken it. Hence open question 2.

**Not checked** — the runtime `holosphere` package (not in this repo); the
`discord-ui` and `voice-ui` packages; whether their federation layer has
access controls of its own beyond `canWrite`; anything about their roadmap or
intentions.
