# Account recovery: merging two identities and linking the device that is left

**Written 2026-09-09** from a conversation about a real case: a person lost
the device that held their identity, re-entered the event on another device,
became a second person there, and the organiser's merge could not give them
back their old username without signing them out. Status: agreed in
principle, not built. Open items live in
`_planning/profile-and-identity-todo.md`.

## Where this sits among the security work

Four pieces cover the life of a sign-in. They are separate branches and can
land in any order, but each names what the others leave out.

| Piece | Question it answers | Where |
| --- | --- | --- |
| D3 · Security hardening | Can a stranger guess their way in, or flood the identity table? | `D3-security-hardening.md` |
| Account notices | Does the person find out when a device joins their account or their profile moves? | STATUS backlog, top |
| D4 · Per-device sign-in | Can the person, or an organiser, see each device and sign one out on its own? | STATUS, decided 2026-09-09 |
| **This spec** | When the device is gone and a second account already exists, can the two be made one again? | — |

Notices *detect*, D4 *sees and revokes*, this *recovers*. D3 hashes tokens at
rest, which changes one detail here (§Design, step 1).

## The model, precisely

- A **device** is a browser. It holds one cookie, `cid`, whose value is one
  22-character random token, signed so it cannot be edited.
- The **identity** is the row that token names. Two devices holding the same
  token are one identity. There is no account above it and no second factor.
- An identity holds one **username** per event (`event_identities`, unique
  within the event) and an instance-level display name that is only the
  default the login page offers at the next event.
- A **profile** (`people`) is what sessions credit and the People tab lists.
  It points at one identity, or at none while it is an organiser-typed shell.
- **Linking** a device is a voucher: the signed-in device mints a three-word
  phrase (hashed, ten minutes, one use); the new device types it at the login page;
  the server sets that browser's cookie to the identity's token. A speaker
  code is the same voucher minted by an organiser against a profile, with no
  expiry. Nothing is ever copied from one browser to another.

Losing a device does not lose the identity. The row, its token, its username,
its profile and its history are all still on the server. What is lost is the
only browser that could present the token, and with it the only place a
voucher could be minted from.

## Use cases

**1. Lost device (the reported case).** Ada enters on a laptop: identity A,
`@ada`, a profile with sessions. The laptop is lost. She opens the event on
her phone; no cookie, so the server mints identity B; `@ada` is taken, so she
is `@ada2` with a second profile. Today's merge either signs the phone out
(fold `@ada2` into `@ada`, A wins, B is signed out and B is the only device
she has) or keeps the phone in but leaves `@ada` held by A, so a rename back
is refused as taken. Wanted: one merge, after which the phone is A, the
username is `@ada`, and nothing is lost.

**2. Stolen device.** As 1, but the laptop is in someone else's hands and its
cookie still works. The merge must not merely re-issue A's token to the
phone; it must also stop the laptop. Wanted: the merge rotates A's token, so
the laptop becomes a stranger at its next request.

**3. Accidental duplicate, both devices live.** A private window, cleared
site data, or a second browser on the same machine mints B while A is still
in use. Wanted: the same merge, without signing A's devices out, since none
of them is lost. This is why token rotation is a choice on the dialog, not
always on.

**4. The organiser picks wrong.** Two different people are merged. Today
the loser's work moves and the loser's device is signed out, which is
recoverable by re-entering. With absorption the loser's device becomes A and
can act as A. Wanted: an audit row naming both identities, a notice to the
person (account notices), and an undo that clears the absorption and rotates
A's token so the wrongly adopted device is out.

**5. Identity B exists at other events.** B is instance-wide. Absorbing it
into A would move B's work, usernames and roles at every event B entered, and
the organiser of this event has no standing there. Decided: absorption
happens only when B holds no role and no username in any other event, which
is nearly always true of an identity minted at this login page minutes ago.
Otherwise the merge behaves as today and the dialog says why.

**6. The lost device comes back.** If the token was not rotated, the laptop
still holds A and works as A beside the phone, as if it had been linked in
time. If it was rotated, the laptop is a stranger and Ada links it from her
phone with a phrase. A's other events are untouched in both cases, because A
was never changed; only B was.

**7. Speaker with a code (existing path, kept).** An organiser can already
make any device become a profile's identity by minting a speaker code. That is
this recovery by another door, with a side effect: the person is raised to
speaker. The merge path has no role side effect.

## Design

Applies to the both-claimed merge only (`mergePeople`, the branch that today
calls `rekeyIdentityWork`). Survivor is A, the profile the organiser is on;
loser is B.

1. **Eligibility.** B is absorbable when it has no `roles` row and no
   `event_identities` row in any event other than this one. If not, fall
   back to today's behaviour and tell the organiser.
2. **Rotate A's token** when the dialog's *Sign the old devices out* is on
   (default on). Once D3 hashes tokens at rest the server no longer knows A's
   plaintext token, so re-issuing it is impossible and rotation is the only
   way to hand A to the phone; at that point the checkbox decides only
   whether the *old* token keeps working, which under hashing it cannot.
   Note this when D3 §5 lands: the switch becomes meaningless and goes.
3. **Absorb.** `identities.merged_into = A` on B. Flatten chains at write
   time: any row already pointing at B is repointed to A, and if A is itself
   absorbed the merge is refused (A must be a live identity).
4. **Redirect.** `identityMiddleware`: a valid token whose row has
   `merged_into` set resolves to the target row, and the response sets the
   cookie to the target's current token. Then B's token is invalidated
   (nulled or marked exchanged) so the redirect works once; a browser
   presenting B afterwards is a stranger. The event stream request goes
   through the same middleware, so it redirects too.
5. **Names.** B's `event_identities` row in this event is deleted; A keeps
   `@ada`. Audit rows B wrote stay attributed to B's row and are labelled
   through the redirect, so they read as `@ada`. The merge writes two audit
   rows: the existing `merge` on the person, and a new `identity.absorb`
   naming B's UID and A's UID, plus `identity.rotate` when rotated.
6. **Work.** `rekeyIdentityWork` runs as today for this event. Nothing runs
   for other events, by eligibility.
7. **Undo.** An organiser action on A's profile: clear `merged_into` on B,
   restore B's username row from the audit row, rotate A's token. Available
   until B is reused; not a full reversal of moved stars and notes, and says
   so. Small, and worth having because use case 4 is a takeover otherwise.
8. **Notices.** When account notices exist: A's inbox gets *a device joined
   this account by merge*, with the organiser's name.

**After D4.** Step 3 becomes "move B's device rows to A"; step 2 becomes
"sign out A's other devices", which no longer touches the phone. Steps 4
and 5 stay. The spec does not wait for D4.

## What this does not do

- It is not a revocation tool on its own. Without rotation a stolen device
  keeps working; the dialog says so.
- It never touches other events, other instances, or the cookie secret.
- It does not merge two identities that are both live at other events; that
  stays a manual matter for the instance owner.

## Dialog

Confirm step, both-claimed case, when B is absorbable:

> Everything `@ada2` did in this event moves to `@ada`, and the device that
> is `@ada2` becomes `@ada` — it stays signed in.
> ☑ Sign the old devices out (choose this if the device that was `@ada`
> is lost or stolen; every device that was `@ada` will need to link again)

When B is not absorbable: today's sentence, plus *`@ada2` is also present at
other events, so its device cannot be moved here; it will be signed out of
this event.*

## Tests

- Eligibility: B at another event falls back; B here only absorbs.
- Redirect: a request with B's token answers as A and sets A's token;
  a second request with B's token is a stranger.
- Rotation on: the old A token is a stranger; off: it still works.
- Chain flattening and refusal to absorb into an absorbed identity.
- Audit labels for B's old rows read as A's username.
- Undo restores B's name row and rotates A.
- Merge parity: the claim-approval path, which shares `mergePeople`, is
  unchanged (claims involve an unclaimed shell, never two identities).

## Documents to change in the same commit

`SECURITY.md` (what a merge grants and revokes; the stolen-device line),
`ARCHITECTURE.md` §Merging two people and §What a cookie is, exactly (the
redirect), `docs/managing.md` (the dialog), CHANGELOG.
