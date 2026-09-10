# Security hardening

**Status:** proposed, 2026-09-05. This is **D3** in STATUS.md and **LIB-101**
in Linear; "D3 go" means approving the order in the plan and the two
thresholds. Companion plan:
[`plans/2026-09-05-D3-security-hardening.md`](../plans/2026-09-05-D3-security-hardening.md).
Threat model and the decisions already taken: SECURITY.md.

**What is in D3, in one list:** the instance key behind the `auth` rate limit
(§2), a per-IP mint rate limit (§3), per-IP backoff and the per-event stop on
new sign-ins with its organiser notice (§1), **lockdown** (§4), and hashing
`identities.token` and `ics_token` at rest (§5). Password strength is *not*
in it — see §1d.

The threat model stands — public-ish, low-stakes, high-trust; the host is
trusted; identity is a cookie. This spec does not change it. It closes the gaps
*inside* it that a look at the code on 2026-09-05 turned up, and adds the two
things an incident needs that the app has no answer for today: a way to stop
the bleeding, and a way to notice the bleeding at all.

Five parts, independent of each other:

1. [Brute force at the login page](#1-brute-force-at-the-login page)
2. [Brute force against the instance password](#2-the-instance-password-is-guessable-at-write-speed)
3. [Free identities](#3-a-cookieless-request-mints-a-row)
4. [Lockdown](#4-lockdown)
5. [Tokens at rest](#5-tokens-at-rest)

Out of scope, and why, at the end.

---

## 1. Brute force at the login page

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
  ever done any work at the login page.
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

**a. Per-visitor waits at one event (chosen 2026-09-09).** Failures at event
*E* from one visitor — the cookie, paired with the address — are counted. The
first five cost nothing at all; the sixth is refused for **two minutes**; five
more cost nothing; the eleventh and every failure after it is refused for
**fifteen minutes**. A correct password clears the count outright.

Five free because the common failure is a person mistyping a four-word phrase,
and charging them for that is a worse outcome than the attack being defended
against. Doubling from one second was rejected: between one
second and four there is nothing a person or an attacker would notice.

**Keyed on the cookie, not the address alone.** Behind NAT, every device on
one network presents the same address. Several hundred people signing in at
once must not share five attempts, and one of them mistyping must not delay
the others — that is the ordinary case this would otherwise break.

**This replaces the `auth` token bucket on the login route rather than joining
it.** That bucket allowed five attempts per quarter hour and then imposed three
minutes at the sixth, which would have overridden the numbers above with
numbers nobody chose. The bucket stays on the instance password, where the
caller cannot shed identity as cheaply.

**a2. Per-address cap, whatever cookie is presented.** Keying on the cookie is
free to escape: throw it away, get five more attempts. So one address at one
event also gets **300 failures an hour** before it waits a quarter of an hour.
Sized for a shared address rather than one person — a burst of mistyped
passwords from one network must never reach it — and bounded by the limit on
minting identities (§3), since each discarded cookie needs a new one.

**b. Per-target closure, requiring many addresses.** Failures against *E* from
all sources are counted in a sliding hour. Past **60 an hour**, *and* coming
from at least **10 distinct addresses**, the login for *E* **closes to new
entrants for 15 minutes**: every attempt gets `429 login_closed` with
`Retry-After`, no password is compared (so no bcrypt is spent), and one audit
row `login_closed` is written with the count. Anyone who already holds a role
is unaffected — reads and writes carry on as normal.

**The distinct-address requirement is not optional** (added 2026-09-09).
Without it, one person from a single address can fail sixty times in a script
and stop the event accepting any new sign-in, a quarter of an hour at a time,
for as long as they like. That is a denial of service, and cheaper to mount
than the guessing this defends against. A single address is already handled by
a2, so requiring the failures to come from several addresses costs nothing and
is what a distributed attack looks like.

Residual, accepted: an attacker holding a large IPv6 allocation has plenty of
distinct addresses and can still trip the closure. The organiser is told, it is
in the audit log, and everyone already inside is unaffected.

**c2. Let the organiser clear it (added 2026-09-10).** Both counts are blunt,
and the organiser knows things the server cannot — that the failures were their
own attendees given a password read out wrongly, or a stale invitation.
Changing any password in `PATCH /settings` clears every count for the event,
which is not optional: that is the action the notice recommends, and it is
exactly when everyone holding the old password has just failed. A separate
`POST /login-attempts/reset` (admin, audited) covers the case where the
password was right all along.

**c. Tell the organiser.** Manage Event gets a line — in the Audit tab's header
and as an amber notice on the Settings tab — reading *"N failed password
attempts in the last hour"* whenever N > 10, and *"New sign-ins were stopped at
HH:MM after N attempts"* when they were, with **Rotate the passwords** one
click away. An event with no failures shows nothing.

**d. Chosen passwords — advice, never a refusal (decided 2026-09-09).**
`passwordSchema` keeps `min(6)`. The length of an event's passwords is the
organiser's decision: they know whether a password is read aloud to an
audience, printed on a badge, or guarding an unpublished programme, and the
server does not. So the change is presentational, in three parts:

- The New Event and Settings forms lead with **leave blank and we make one**
  rather than with an empty field. The generated phrases stay the default and
  stay ~37 bits, which is the setting most events will never leave.
- A typed password gets an inline note beside the field, per tier: the admin
  password changes the event and is worth the most length; the viewer and
  attendee passwords are usually shared aloud, and a shorter one is a
  reasonable trade. Wording, not validation.
- The hundred most common passwords, and the event's own name and slug, raise
  a **warning** under the field — *"this is one of the first things an
  attacker tries"* — and the form still submits.

**No forced rotation, ever.** No migration touches an existing hash, no
existing event is nagged, and no live instance is required to change a
password it is already running on. Whatever an organiser chose stays working
until they choose otherwise.

The consequence, stated plainly: with the floor left at 6 characters, the
per-target closure in **b** and the notice in **c** are the whole defence
against a distributed guesser. That raises rather than lowers the case for
the 60-an-hour threshold being firm, and makes **c** the feature that matters
most in this section — an organiser who chose a weak password finds out that
it is being hammered.

### What this does not do

It does not stop a patient attacker with many addresses and a weak password —
it makes them slow and visible, and it gets the organiser to a rotation before
they finish. Since **d** no longer refuses a weak password, that is the whole
of the answer to "summer2026": new sign-ins stop for a quarter of an hour at a
time and the organiser is told. A captcha or an edge proxy would raise the cost further
and are out of scope (below). Against generated phrases none of it is needed.

---

## 2. The instance password is guessable at write speed

### Today

Four routes check `X-Instance-Key`. `POST /backup` sits behind the `auth`
rate limit (5 per 15 min). The other three — `POST /events`, `POST /events/import`,
`POST /events/:slug/clone` — sit behind **`write`: 30 a minute per IP**. That
is 43,000 guesses a day per address at the highest-value secret on the box,
which login pages every event's creation and the encrypted backup of everything. It
is compared in constant time, which was never the point.

### Design

One `requireInstanceKey(ctx)` middleware, used by all four routes, that
consumes from the `auth` rate limit on both keys, checks the header, **refunds on
success** (the way the login page does, so an organiser making three events in a row
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
unbounded `INSERT`, and it is also why the identity bucket at the login page is
decorative.

### Design

A per-IP rate limit on **minting**, not on requests: `mint: { capacity: 300,
windowMs: 15 * 60_000 }`. Over it, the request proceeds anonymous — `req.identity`
is a sentinel with `id: 0` that holds no roles and cannot be granted one — and
any route that needs a real identity answers `429 too_many_identities`. Reads
of public things (`/api/me`, the landing page's event list) still work.

300 in 15 minutes is set by the shared-address case: behind NAT, every device
on one network presents the same address, and 300 first-time visitors in a
quarter hour is an ordinary morning for one event. A hostile at 300 rows per 15 minutes fills 29,000 rows a day, which
is a nuisance rather than a problem; the `sweep` that already drops idle
buckets is joined by a nightly job that deletes identities with no roles, no
names and no `last_seen_at` in 30 days.

---

## 4. Lockdown — deferred 2026-09-09

**Designed, not being built.** D3 was approved without it; the rest of this
section stands as the design for when it is picked up.

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
- Reads, calendar feeds, SSE, the login page (entering to *read*) and device linking
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

### Blocked, found 2026-09-10 while starting the work

**This section cannot be built as written.** Hashing on lookup is only half
the story: two routes *hand the stored value back out*, and a hash cannot be
handed to a browser.

- **Redeeming a device phrase or a speaker code** ends in
  `setIdentityCookie(res, identity.token, …)` (`routes/me.ts`): the second
  device is given the identity's stored token as its cookie. Hash the column
  and there is nothing to give it. Minting a fresh one instead would sign the
  *first* device out, which contradicts the feature — one speaker code is
  meant to work on a phone and a laptop at once.
- **Asking for the calendar link a second time** returns
  `req.identity.ics_token` unchanged (`routes/agenda.ts`), so the same URL
  keeps working. Hash the column and the second call hands back a hash that
  no feed will accept.

**What this means.** Several devices sharing one identity requires the server
to be able to produce a credential for a new device, and hashing removes the
only stored copy. The way out is a credential *per device* — which is
**D4** (LIB-103): each device row holds the hash of its own token, a new
device gets a new one, and no existing device is disturbed. Hashing then falls
out naturally, because nothing ever needs the stored value back.

**Revised order.** `identities.token` hashing moves behind D4 rather than
ahead of it. `ics_token` can be hashed on its own, but only alongside a
decision on LIB-187 (the calendar link cannot be revoked today): the honest
version is that asking for the link again *mints a new one and invalidates the
old*, which is the revoke that issue asks for, and makes the second-call
problem disappear.

The rest of this section — what hashing does and does not protect — still
stands.

It does not protect anyone from the running server (SECURITY.md,
*The running server can act as any user*) and the backup still needs
encrypting for the names in it and the speaker-code hashes. What it changes is
the sentence on the Backup tab: *the file alone cannot sign anyone in*.

Speaker codes (four words, ~37 bits, SHA-256) are the remaining hash that
gives way offline. Either six words or scrypt at rest closes it; the trade is
a longer phrase to read aloud. Optional; codes are revocable and
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
