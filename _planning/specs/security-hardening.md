# Security hardening

**Status:** proposed, 2026-09-05. Companion plan:
[`plans/2026-09-05-security-hardening.md`](../plans/2026-09-05-security-hardening.md).
Threat model and the decisions already taken: ARCHITECTURE.md §Security.

The threat model stands — public-ish, low-stakes, high-trust; the host is
trusted; identity is a cookie. This spec does not change it. It closes the gaps
*inside* it that a look at the code on 2026-09-05 turned up, and adds the two
things an incident needs that the app has no answer for today: a way to stop
the bleeding, and a way to notice the bleeding at all.

Five parts, independent of each other:

1. [Brute force at the gate](#1-brute-force-at-the-gate)
2. [Brute force against the instance password](#2-the-instance-password-is-guessable-at-write-speed)
3. [Free identities](#3-a-cookieless-request-mints-a-row)
4. [Lockdown](#4-lockdown)
5. [Tokens at rest](#5-tokens-at-rest)

Out of scope, and why, at the end.

---

## 1. Brute force at the gate

### Today

`POST /e/:slug/auth` (`routes/eventAuth.ts`) consumes one token from two
buckets — `auth:id:<identity>` and `auth:ip:<ip>`, each 5 per 15 minutes — and
refunds both on success. The 6th failure in a window is a `429` with
`Retry-After`. Every failure is an `auth_failed` audit row. Passwords are
bcrypt (cost 10).

So the question "could there be a server-side check that adds a delay for the
same IP?" is already answered yes: one IP gets 5 guesses per 15 minutes, 480 a
day. **That is enough against one attacker from one address**, and it is why a
generated four-word phrase (~37 bits, ~1.4 × 10¹¹ possibilities) is safe by a
margin of centuries.

### The three gaps

- **The identity bucket is free.** A request with no cookie is minted a fresh
  identity (§3), so an attacker simply never sends one. Only the IP bucket has
  ever done any work at the gate.
- **Nothing counts attempts per *target*.** 100 addresses — a cheap proxy list
  — get 48,000 guesses a day against one event's password, and nothing adds
  them up or notices. Against a generated phrase that is still nothing. Against
  a **chosen** password it is the whole game: the minimum is 6 characters, and
  "hunter2", "welcome1" and the event's own name fall in an afternoon.
- **The organiser cannot tell it is happening.** `auth_failed` rows are in the
  audit log, but nothing surfaces "600 failures in the last hour" anywhere.

The honest summary: the limiter is fine, the password policy is what is weak,
and an attack is invisible.

### Design

**No tarpits.** "Add a delay" as a `sleep` before answering is worse than a
`429` on this server: a held connection costs the single Node process memory
and a slot, the attacker runs requests in parallel so the delay does not bound
throughput, and legitimate users wait for nothing. Keep refusing fast with
`Retry-After`; make the refusals smarter.

**a. Per-IP backoff, per target.** Failures against event *E* from IP *A* are
counted; after the *k*-th failure the next attempt from *A* at *E* is refused
until `min(2^k, 900)` seconds have passed. 1 s, 2 s, 4 s … 15 minutes. A success
resets the count. This replaces nothing — the 5/15-minute bucket stays — it
makes the *first* failures cheap (a typo at a door costs a second, not a
lockout) and sustained failure expensive, and it is keyed on the pair, so an
attacker cannot spend one event's patience on another.

**b. Per-target closure.** Failures against *E* from *all* sources are counted
in a sliding hour. Past a threshold — **60 an hour** is the proposal; a room of
300 entering at 09:00 produces successes, which do not count, and a handful of
typos — the gate for *E* **closes to new entrants for 15 minutes**: every
attempt gets `429 gate_closed` with `Retry-After`, no password is checked (so
no bcrypt is spent), and one audit row `gate_closed` is written with the count.
Everyone already holding a role is unaffected — the schedule stays up; only
the door shuts. This is what stops the 100-address attacker, and its cost is
bounded: the worst a hostile can do is keep the door shut for a quarter hour
at a time, which is loud (see c) and recoverable.

**c. Tell the organiser.** Manage Event gets a line — in the Audit tab's header
and as an amber notice on the Settings tab — reading *"N failed password
attempts in the last hour"* whenever N > 10, and *"The door was closed at
HH:MM after N attempts"* when it was, with **Rotate the passwords** one click
away. A quiet event shows nothing.

**d. Chosen passwords.** `passwordSchema` goes from `min(6)` to **`min(10)`**,
plus a denylist of the hundred most common passwords and the event's own name
and slug (case-insensitive, whitespace-stripped). The generated phrases stay
the default and stay ~37 bits; the New Event and Settings forms lead with
"leave blank and we make one" rather than with an empty field. This is the
change that matters most and costs least: the limiter buys time, the password
is what has to survive it.

### What this does not do

It does not stop a patient attacker with many addresses and a weak password —
it makes them slow and visible, and it gets the organiser to a rotation before
they finish. A captcha or an edge proxy would raise the cost further and are
out of scope (below). Against generated phrases none of it is needed; it is
here because people type "summer2026".

---

## 2. The instance password is guessable at write speed

### Today

Four routes check `X-Instance-Key`. `POST /backup` sits behind the `auth`
budget (5 per 15 min). The other three — `POST /events`, `POST /events/import`,
`POST /events/:slug/clone` — sit behind **`write`: 30 a minute per IP**. That
is 43,000 guesses a day per address at the highest-value secret on the box,
which gates every event's creation and the encrypted backup of everything. It
is compared in constant time, which was never the point.

### Design

One `requireInstanceKey(ctx)` middleware, used by all four routes, that
consumes from the `auth` budget on both keys, checks the header, **refunds on
success** (the way the gate does, so an organiser making three events in a row
is not locked out), and on failure writes an audit row `instance_key_failed`
with `eventId: null` (an instance-level row — see the STATUS entry about those
having no screen; this makes it more urgent). The per-target closure of §1
applies to the instance key as its own target with the same threshold.

`INSTANCE_ADMIN_PASSWORD` gets a preflight check for length: **16 characters
minimum**, warn below 24. It is typed rarely and never spoken aloud, so there
is no reason for it to be short.

---

## 3. A cookieless request mints a row

### Today

`identityMiddleware` inserts an `identities` row for every request that
arrives without a valid `cid` — before any rate limit runs, since the limits
are keyed on the identity it is about to create. One `curl` loop is an
unbounded `INSERT`, and it is also why the identity bucket at the gate is
decorative.

### Design

A per-IP budget on **minting**, not on requests: `mint: { capacity: 300,
windowMs: 15 * 60_000 }`. Over it, the request proceeds anonymous — `req.identity`
is a sentinel with `id: 0` that holds no roles and cannot be granted one — and
any route that needs a real identity answers `429 too_many_identities`. Reads
of public things (`/api/me`, the landing page's event list) still work.

300 in 15 minutes is set by the NAT case: a venue's whole wifi is one address,
and 300 first-ever visits in the quarter hour before a keynote is a real
morning. A hostile at 300 rows per 15 minutes fills 29,000 rows a day, which
is a nuisance rather than a problem; the `sweep` that already drops idle
buckets is joined by a nightly job that deletes identities with no roles, no
names and no `last_seen_at` in 30 days.

---

## 4. Lockdown

The brainstorm of 2026-09-05, condensed. A compromise here is a leaked
password (admin or attendee), a stolen admin cookie, or the instance password.
Recovery is a procedure with a freeze at its core, and the app has the freeze
already — `archived` blocks every write route via `requireWritable` — with
one hole: `PATCH /settings` is deliberately outside it so an admin can
un-archive, which means anyone holding the admin password can undo it.

### Principle

**Locking is cheap and any admin may do it; unlocking is privileged and takes
the instance password.** A false freeze costs a read-only hour. A false
unfreeze is the attack.

### Data

`events.lockdown_at TEXT NULL`, `lockdown_reason TEXT NOT NULL DEFAULT ''`,
`lockdown_by INTEGER NULL` (identity). Migration 018 (or 019 if §5 lands
first).

### Behaviour while locked

- `requireWritable` refuses with `409 locked` (distinct from `archived`, so the
  UI can say *frozen by the organisers*).
- `PATCH /settings` refuses **everything** unless the request carries a valid
  `X-Instance-Key` (via §2's middleware) — that is the only way out.
- `pruneAudit` skips the event; Empty Trash is refused; both so evidence
  survives the incident.
- Reads, calendar feeds, SSE, the gate (entering to *read*) and device linking
  all keep working. Stars are frozen too — "read-only means read-only" is the
  rule a banner can state.
- Entering and leaving lockdown are audit rows (`lockdown`, `lockdown_lifted`)
  with the reason.

### Instance-wide, without the web

If the instance password is what leaked, the browser is not a trust root.
Two switches the host can throw from a shell: `LOCKDOWN=1` in the environment,
and a `.lockdown` file beside the database (checked with a `stat` per request,
cached for a second). Either locks every event; only the host can clear them.

### Evict

**Evict everyone** (admin, Security section) deletes every `roles` row for
the event. Identities and `event_identities` stay, so people keep their
names and re-enter with the rotated passwords; a stolen cookie comes back as
a role-less stranger. Offered beside **Rotate the passwords**, which today
deliberately does not evict.

### UI

A red band on every page of a locked event. Manage Event → **Security**
(a section on Settings, or its own tab once it has three things in it):
**Freeze this event** with a reason; the procedure as a checklist — freeze,
evict, rotate, review the audit log, restore from Trash, lift; **Lift the
freeze** takes the instance password inline, the way Backup does.

### Not a super-admin role

A role is a cookie with a flag on it — a bearer token that lives in browsers
and backups, the thing §5 exists to shrink. The per-action instance key is
stronger by construction: never at rest in a session, and the audit row still
names the identity that presented it. Retyping a password twice a year is the
right price.

### Not automatic

No auto-freeze on anomalies (N deletes a minute). A real reshuffle looks the
same and would freeze the schedule at the worst moment. The alert of §1c is
the safe form of the idea.

---

## 5. Tokens at rest

Queued in STATUS on 2026-09-05; restated here so the plan is in one place.

`identities.token` and `ics_token` are stored in clear, so any copy of the
database — a backup, a snapshot, a screenshot — is a sign-in credential for
everyone. Both are random (~131 bits), so a plain **SHA-256 at rest** is
enough: the cookie and the feed URL keep carrying the plaintext, the server
hashes on lookup. A deterministic hash means a migration can rewrite the
columns in place, every existing cookie keeps working and every old backup
still restores.

It does not protect anyone from the running server (ARCHITECTURE §Security,
*The running server can act as any user*) and the backup still needs
encrypting for the names in it and the speaker-code hashes. What it changes is
the sentence on the Backup tab: *the file alone cannot sign anyone in*.

Speaker codes (four words, ~37 bits, SHA-256) are the remaining hash that
gives way offline. Either six words or scrypt at rest closes it; the trade is
a longer phrase to read out at a door. Optional; codes are revocable and
event-scoped.

---

## Out of scope

- **Captcha, Cloudflare, an edge WAF.** They raise the cost of a distributed
  attack further and are the right answer for a deployment that needs it. The
  app cannot assume them, so this spec makes the app hold up without them; a
  `TRUST_PROXY` deployment behind an edge gets both.
- **Per-user accounts and passkeys.** Decided against in ARCHITECTURE
  §Security; the reasoning is there.
- **Revoking a shared password per person.** Accepted in the threat model;
  Evict + Rotate is the recovery, not prevention.
- **A distributed limiter.** There is one process. Rate state stays in
  memory and resets on restart, which an attacker can neither cause nor
  predict.
