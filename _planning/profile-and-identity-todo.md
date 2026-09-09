# Profile and identity: data-model issues and improvements

Open items about people, identities, usernames, devices and merging. Split
out of `STATUS.md` on 2026-09-09 at the user's request (the note on the
gate item below); STATUS.md keeps one pointer line. Items here are still a
queue: finished work goes to CHANGELOG.md and leaves this file.

## Where the names live — read first

- A **username** is `event_identities.display_name`, keyed on the
  *identity* (the cookie), unique per event. It is not a column on
  `people`.
- A **full name** is `people.name`, on the profile row.
- A both-claimed merge (`server/src/mergePeople.ts`) keeps the survivor
  profile's identity, re-keys the loser identity's work onto it
  (`server/src/mergeIdentityWork.ts`) and deletes the loser identity's
  role — that is the "their device is signed out" in the confirm step.
  The loser's `event_identities` row is kept on purpose, so audit rows keep
  their label and the name is not freed for a stranger.

## Open

- **A lost account cannot be merged back under its old username.**
  Reported 2026-09-09. Scenario: a person held `@username` (identity A,
  device lost), re-enters as `@username2` (identity B, the device they now
  use), and an organiser merges the two.
  - Merge `@username2` *into* `@username`: identity A survives, identity B
    is signed out, and the person's live device lands on the gate with no
    role. The old identity's cookie is on the lost device, so they have no
    way back in; a speaker code would adopt the device into identity A but
    also raises them to speaker, which is wrong for an attendee.
  - Merge `@username` *into* `@username2`, the only usable direction: the
    person keeps access but is `@username2`, and `@username` stays held by
    the signed-out identity A, so `PATCH /me` refuses the rename with
    *Someone at this event is already called "username"*
    (`claimEventName`, `server/src/eventIdentity.ts:32`). The old username
    is not "edit it later" — it is unreachable.
  - **Proposed fix, buildable now.** In the both-claimed confirm step of
    `MergeModal`, add *Keep the name they used before* (username, and the
    full name with it), default off. Server: `mergePersonSchema` takes
    `keepLoserNames?: boolean`; inside the merge transaction the two
    `event_identities.display_name` values are **swapped** (a swap keeps
    both rows, both labels and the unique index intact — the lost identity
    now carries `@username2`, which is what it would show as anyway if it
    ever came back), and `people.name` is copied from the loser when the
    flag is set. The audit `merge` row records the flag. Tests in
    `tests/mergePeople.test.ts`: both directions, the rename afterwards
    succeeding, and the swap leaving the unique index whole.
  - **After D4** (per-device tokens) the direction problem itself goes
    away: the loser identity's devices can be adopted by the surviving
    identity instead of signed out, so either direction keeps the person
    in. The name choice is still wanted then.
  - **Open policy question:** should a name held by an identity with no
    role in the event be claimable at all (by rename or at the gate), with
    the old row suffixed to keep its audit label? Today it is reserved
    forever; that protects against impersonation but is also what makes
    this scenario a dead end without organiser help.

- **The gate doesn't suggest device linking to a merged-out device.** After
  a both-claimed merge the losing device is signed out; when it next hits
  the gate, nothing says "if this is you, link this device instead of
  re-entering". A person who re-enters recreates the two-identity split
  the organiser just merged away. Wants one line on the gate (likely only
  when the arriving identity holds no role but does hold an event name
  here — exactly the signed-out shape). Scenario documented in
  ARCHITECTURE §Merging two people. (Moved from STATUS.md 2026-09-09.)
