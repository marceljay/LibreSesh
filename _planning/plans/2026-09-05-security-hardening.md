# Plan: security hardening

**Spec:** [`specs/security-hardening.md`](../specs/security-hardening.md).
**Decision needed:** the order below, and the two thresholds (60 failures an
hour closes a gate; 300 identities per address per quarter hour). Everything
else is settled by the spec.

Five phases, cheapest and most valuable first. Each is its own branch and PR
off `dev`; none depends on another, so they can land in any order — but the
first is a morning and closes the worst gap, so it should go first.

## Phase 1 — the instance key and free identities (½ day)

Closes §2 and §3. No migration, no UI.

- `server/src/auth.ts`: `requireInstanceKey(ctx)` — `auth` budget on identity
  and IP, header check, refund on success, `instance_key_failed` audit row
  (`eventId: null`) on failure. Replace the four inline `hasInstanceKey` checks
  in `routes/events.ts` (×2), `routes/import.ts`, `routes/backup.ts`.
- `server/src/preflight.ts`: `INSTANCE_ADMIN_PASSWORD` under 16 characters is a
  problem, under 24 a warning.
- `server/src/identity.ts` + `ratelimit.ts`: `mint` budget per IP; the anonymous
  sentinel; `429 too_many_identities` from `requireRole` and the gate when the
  identity is the sentinel. `scripts/` or a boot-time job: delete identities
  with no roles, no `event_identities`, no `ics_token` and `last_seen_at` older
  than 30 days.
- Tests: `instanceKey.test.ts` (6th wrong key is 429; a right one refunds; the
  audit row lands); `identityMint.test.ts` (301st cookieless request from one
  IP is anonymous; a cookie-holder is unaffected; the sweep deletes only the
  idle and roleless).
- Docs: `deploy.md` env table (password length), ARCHITECTURE threat table
  rows for the instance key and minting.

## Phase 2 — the gate (1 day)

Closes §1. No migration; one new limiter, one notice.

- `server/src/ratelimit.ts`: `Backoff` — `failures` map keyed `auth:<event>:<ip>`
  with count and `notBefore`; `Tally` — per-target sliding-hour counter with
  `closedUntil`. Both swept with the buckets.
- `routes/eventAuth.ts`: check closure first (no bcrypt spent), then backoff,
  then the buckets; on failure bump both; on success reset the backoff and
  refund. `gate_closed` audit row when the tally trips.
- `passwordSchema`: `min(10)` + denylist (`server/src/passwordDenylist.ts`, the
  hundred most common, plus the event's name and slug checked in the route,
  since the schema does not know the event). Applies to `createEventSchema`,
  `settingsSchema`, `eventImportSchema`. Existing passwords are untouched — a
  rotation is the moment they are re-checked.
- `web/`: New Event and Settings lead with the generated phrase ("leave blank
  and we make one" above the field, not below); the error for a denylisted
  password names the rule. Manage Event → Audit header and Settings notice:
  *N failed attempts in the last hour*, and the closure line, from a new
  `GET /e/:slug/gate-health` (admin) that reads the audit rows.
- Tests: `gateBackoff.test.ts` (2nd failure waits 2 s, 5th waits 16 s, success
  resets, another IP is unaffected); `gateClosure.test.ts` (61st failure in an
  hour from 61 IPs closes the gate for everyone new, a role-holder still
  writes, it reopens after 15 min, one audit row); `passwordPolicy.test.ts`.
- Docs: `managing.md` (choosing passwords; what the notice means),
  `schedule-import.md` (password rule), ARCHITECTURE threat row.

## Phase 3 — lockdown, first cut (1 day)

Closes §4 except the instance-wide switch and Evict.

- Migration `018_lockdown.sql`: three columns.
- `auth.ts`: `requireWritable` refuses `409 locked`; `routes/settings.ts`
  `PATCH` refuses while locked unless `requireInstanceKey` passes; `audit.ts`
  `pruneAudit` skips a locked event; `routes/trash.ts` (or wherever Empty
  Trash lives) refuses.
- `POST /e/:slug/lockdown` (admin, reason) and `DELETE /e/:slug/lockdown`
  (instance key). Audit rows.
- `web/`: the red band (`EventShell`, above the header); Settings → Security
  section with Freeze / Lift and the checklist as static text for now.
- Tests: `lockdown.test.ts` (an admin freezes; an admin cannot lift; the key
  lifts; every write class is 409 while locked; reads and the feed work; prune
  is skipped; the settings PATCH is refused even for `archived: false`).
- Docs: ARCHITECTURE §Security gets a *Lockdown* subsection; `managing.md`
  gets *If something goes wrong*.

## Phase 4 — tokens at rest (1 day)

Closes §5 first paragraph.

- Migration `019_hashed_tokens.sql`: `UPDATE identities SET token =
  hex(sha256(token))` is not available in SQLite — do it in the runner, in a
  transaction, in JS.
- `identity.ts`: hash on insert and on lookup; `routes/agenda.ts` the same for
  `ics_token`; `newIdentityToken` unchanged (the cookie still carries the
  plaintext).
- `tests/helpers.ts` reads tokens from the DB in places — those become "mint
  through the middleware and keep the cookie". `export.test.ts` "no secret
  material" keeps passing; add "a token copied from the DB does not sign in".
- Backup warning shrinks to what remains; threat-model row updated.

## Phase 5 — lockdown, second cut (½ day)

- `LOCKDOWN=1` and the `.lockdown` file beside the database, checked in
  `requireWritable` (cached one second).
- **Evict everyone**: `DELETE FROM roles WHERE event_id = ?`, admin, confirmed,
  audit row; beside **Rotate the passwords** in the Security section, with the
  checklist's steps now buttons.
- Optional: speaker codes to six words or scrypt.

## Order and branches

`sec/instance-key-and-minting` → `sec/gate` → `sec/lockdown` →
`sec/tokens-at-rest` → `sec/lockdown-2`. Phase 4's migration number moves
if Phase 3 lands first; nothing else interacts.

## Acceptance, whole plan

- An attacker with one address gets fewer than 500 guesses a day at any
  password on the box, including the instance password.
- An attacker with a hundred addresses closes a gate for a quarter hour and
  is named in the audit log and on the organiser's screen before they finish.
- A chosen password shorter than ten characters, or on the list, is refused.
- An admin can freeze an event in two clicks; the admin password cannot
  unfreeze it; the host can freeze everything from a shell.
- A copy of the database signs nobody in.
