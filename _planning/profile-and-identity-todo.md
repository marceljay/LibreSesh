# Profile and identity: data-model issues and improvements

Open items about people, identities, usernames, devices and merging. Split
out of `STATUS.md` on 2026-09-09 at the user's request (the note on the
login page item below); STATUS.md keeps one pointer line. Items here are still a
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
  Reported 2026-09-09; the analysis and the agreed design are in
  `_planning/specs/account-recovery-merge-and-link.md`. Short form: in a
  both-claimed merge the losing identity is absorbed into the survivor when
  it exists at no other event, its device is redirected to the survivor's
  token on its next request, and the survivor's token is rotated by default
  so a lost or stolen device is out. The earlier idea of swapping the two
  usernames is withdrawn: absorption keeps the old username without a swap.
  Waits on: nothing. Builds cleanly before D4 and is simplified by it.

- **Blocked cookies loop at the login page.** Noticed 2026-09-09. A browser that
  refuses the `cid` cookie is minted a new identity on every request, so it
  passes the login page and lands back on it, forever, and every attempt leaves a
  row (D3 §3 bounds the rows, not the loop). Nothing detects the case: the
  cookie is httpOnly, so the page cannot look for it. Wanted: the login page
  fetches `/api/me` twice before offering a name and compares the UID; two
  different UIDs mean cookies are blocked, and the login page says so instead of
  asking for a name. First-party `SameSite=Lax` cookies survive every
  browser's third-party blocking, so this is the all-cookies-off setting
  and private windows that drop the cookie on close — the latter is the
  usual origin of the duplicate the spec above merges.

- **The login page doesn't suggest device linking to a merged-out device.** After
  a both-claimed merge the losing device is signed out; when it next hits
  the login page, nothing says "if this is you, link this device instead of
  re-entering". A person who re-enters recreates the two-identity split
  the organiser just merged away. Wants one line on the login page (likely only
  when the arriving identity holds no role but does hold an event name
  here — exactly the signed-out shape). Scenario documented in
  ARCHITECTURE §Merging two people. (Moved from STATUS.md 2026-09-09.)
