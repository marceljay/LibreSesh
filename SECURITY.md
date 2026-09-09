# Security

The threat model, the risks accepted on purpose, and every credential the app
hands out — what each one grants, how long it lives, and what revoking it does
and does not do. Design and data model are in [ARCHITECTURE.md](ARCHITECTURE.md);
read **§What a cookie is, exactly** there first, because every credential
below is a way of setting that cookie.

## Threat model

This is a **public-ish, low-stakes, high-trust** system: a conference schedule
that a room full of strangers can edit. The assets worth protecting are the
integrity of the programme and the privacy of who is attending what. It is
explicitly *not* built to withstand a targeted attacker with time.

**In scope:**

| Threat | Mitigation |
| --- | --- |
| A hundred addresses guessing one event's password | Failures are counted per event as well as per address: past 60 in a sliding hour the event stops letting *new* people in for 15 minutes, no password is checked while it is shut (so no bcrypt is spent on the attacker), everyone already holding a role is unaffected, and one audit row records it. The organiser sees a notice above the audit log |
| Repeated guesses from one address | Doubling backoff per address per event, from 1 second to 15 minutes; a correct password clears it. A typo costs a second |
| Guessing an event password | bcrypt (cost 10); 5 attempts per 15 min per identity **and** per IP, `Retry-After` on the 6th |
| Guessing a link phrase | Same 5-per-15-min rate limit as passwords; stored hashed. Device phrases are single-use and die in 10 minutes; speaker codes are four words (~37 bits) and revocable |
| Casual vandalism of the programme | Soft deletes + restore; `audit` log with actor UIDs, readable by admins at Manage Event → Audit; `hidden` flag for contributions |
| Spam / flooding | Token buckets per identity and per IP on every write class; server-enforced max lengths |
| XSS via session or profile text | HTML escaped before markdown parsing; URL scheme allowlist; no `dangerouslySetInnerHTML` on unescaped input |
| Open redirect | Every client navigation is prefixed with a literal `/e/` |
| Reading a schedule you were not given | Viewing requires the viewer password; there is no public event view |
| Leaking one person's agenda | Stars and interest are never broadcast and never attributed in any payload; only aggregate counts are exposed |
| A leaked calendar URL | The token grants only what its owner's role already allows, and only for that one event; revoking the role kills the feed |
| A photographed invite QR or forwarded invite link | It *is* the event password: whoever has it holds that role until the password is changed. Changing it does not evict roles already granted. The panel that draws the code says so, loudest for the two codes that grant writing |
| A forwarded speaker link or photographed speaker QR | It is a standing personal credential: whoever opens it is that speaker, on that device, until the code is revoked — and revoking does not sign out devices already in; changing the person's role does. The profile page says "send it to them and nobody else" beside the link. No expiry, by design (§Codes and links) |
| A leaked `COOKIE_SECRET` | Little on its own — a forged signature still needs a real 131-bit token, and an unknown one just mints an anonymous identity. Kept out of the database's volume so a copied DB and the secret do not leak together |
| Guessing the instance password | The `auth` rate limit on every route that takes it — 5 attempts per identity **and** per address per 15 minutes, a refund on success so ordinary use is never throttled, and an `instance_key_failed` audit row (no event id) for every miss. It must be 16 characters to boot in production, 24 recommended |
| Flooding the identity table | Minting is rate-limited per address (300 per 15 minutes, set by the NAT case). Over it a request carries no identity rather than being refused, so public reads still work and anything needing a role answers `429 too_many_identities`. Rows that never became anybody — no role, no username, no profile, no calendar feed, no link code — are deleted after 30 days |
| A leaked whole-database backup | Never leaves the server unencrypted: AES-256-GCM under a scrypt key (N=2^15) from a passphrase typed at download time, gated by the instance password and the 5-per-15-min auth budget. If one leaks open anyway: identity tokens need `COOKIE_SECRET` as well before they sign anyone in, but `ics_token`s work against the live server as they are, and speaker-code hashes (~37 bits) crack offline — revoke roles and codes |

**Out of scope, accepted:**

- **Shared passwords cannot be revoked per person.** Anyone who learns the admin
  password is an admin until it is changed. Rotating it (admin settings) is the
  only remedy, and it does not evict existing role grants — those are rows in
  `roles`, deliberately, so a rotation does not sign the whole room out mid-event.
- **Identity is a cookie, not a person.** Clearing cookies makes you a new
  attendee. A phrase carries one identity onto another device, but that is
  continuity, not authentication: whoever redeems a live phrase becomes that
  person, role included. For a device phrase the window is ten minutes and one
  use. For a speaker code, and the link that carries it, there is no window:
  it works for anyone, from anywhere, until an organiser revokes it, and the
  devices it already let in stay in. Impersonation by display name is trivial
  and not defended against. Do not build anything that treats a display name
  as an identity.
- **Devices are not told apart.** Every device that redeems a phrase receives
  the *same* token, so the server cannot say how many devices hold an identity,
  which of them arrived through a speaker code, or sign one of them out on its
  own. That is what makes linking zero-migration (ARCHITECTURE §One person,
  many devices); its price is that the only eviction is changing the role,
  which evicts them all. A per-device token would fix it and is the natural
  next step if a signed-in-devices view is ever wanted; see STATUS.md.
- **The database file is the room key.** `identities.token` and `ics_token`
  are stored in clear, so anyone who can read the SQLite file can become any
  attendee (link phrases are hashed only because they transit screens and
  shoulders, not because the DB is distrusted). Accepted deliberately: the
  instance host is trusted, full stop. If that ever stops being true, hash the
  tokens at rest (they are random, so a plain SHA-256 lookup works) rather
  than bolting auth onto the trust boundary.
- **The running server can act as any user, and nothing done in the browser
  changes that.** Considered and declined (2026-09-05). Hashing the token
  client-side before sending it only makes the hash the bearer credential: the
  server still sees, and can replay, whatever the client presents, so it buys
  nothing against the host — and the token is random and instance-specific, so
  there is no reused secret to shield. What *would* work is asymmetric
  challenge–response — a per-device private key, i.e. WebAuthn/passkeys — and
  it buys exactly one thing: the host cannot act as you **while you are away**.
  It cannot stop a host that serves the JavaScript from acting as you while you
  are on the page, so "the owner can't eavesdrop" is not on offer to any web
  app. Against that one gain: a key prompt at the login page (the highest-stakes
  screen, on a phone, at a door), per-device enrolment instead of link phrases,
  a calendar feed that cannot sign and stays a bearer token regardless, and
  giving up the `httpOnly` cookie for a key XSS can reach. Not worth it for a
  schedule. If a deployment ever needs it, the identity model — one row, many
  devices — can carry a public key per device without redesign. The cheaper
  layer that *does* pay for itself is hashing tokens at rest (previous point),
  which makes a copy of the database useless as a credential; do that first.
- **No CSRF tokens.** Cookies are `SameSite=Lax`, which covers the cross-site
  form-post case for the state-changing verbs used here. Any future `GET` that
  mutates state would break that assumption.
- **A determined attacker with a valid password can ruin the schedule.** The
  audit log and restore endpoints are the recovery path, not prevention.

## Codes and links

Everything the app lets one person hand to another, in one table. Each row is
a way of getting a role or an identity onto a device; the mechanics of each
are in ARCHITECTURE (§Invite QR codes, §One person, many devices, and the
calendar section).

| | Grants | Made by | Lives | Revoked by | Revoking does **not** |
| --- | --- | --- | --- | --- | --- |
| Event password (viewer / attendee / organiser) | That role, to anyone who types it and picks a name | Whoever creates the event; changed in Settings | Until changed | Changing it | Evict anyone who already holds the role |
| Invite QR / link `/e/:slug#k=<password>&r=<role>` | The same as typing that password | Organiser, Manage → Settings → Invite by QR | As long as the password it carries | Changing the password | Evict anyone who already entered with it |
| Device phrase (three words) | The minting identity itself — name, role, stars, authorship | Anyone, from the menu behind their name | 10 minutes, one use | Minting another; expiry | Undo an adoption already made |
| Speaker code (four words) | The person's identity, with the speaker role | Organiser, from the person's profile page | Until revoked, any number of uses | Revoke or regenerate on the profile page | Sign out devices already in — change the role for that |
| Speaker link / QR `/e/:slug#c=<phrase>` | The same as typing that code, with nothing to type | Shown beside the code when it is minted | As long as the code | Revoking the code | Anything the code's revocation does not |
| Calendar feed URL | Read access to one event's schedule, as the owner's role allows | The owner, from the calendar dialog | Until the role is removed | Removing the role | Stay working for a role the owner still holds |

Four rules apply across the rows:

- **Secrets ride in the fragment, never the query.** A browser does not send
  what follows `#`, so a password or code in a link reaches no access log, no
  `Referer` header and nothing a reverse proxy writes down. It is lifted out of
  the address bar with `history.replaceState` before the page draws, so a
  person who opens the link and then copies "the page" from their address bar
  is sharing a page that asks for the secret, not one that hands it out. The
  *message* they were sent still holds it, for as long as messages last.
- **Link previews are safe; link rewriters are not.** A messenger fetching a
  preview sends the URL without its fragment, so a preview never carries the
  code. Corporate mail systems that rewrite links for scanning can drop the
  fragment altogether; the recipient then lands on the ordinary login page with no
  error, because to the app no link arrived. The four words in the same
  message are the fallback, which is why the code is always shown beside the
  link rather than replaced by it.
- **A device that is already somebody is asked before it is switched.**
  Redeeming a phrase swaps the identity cookie. A speaker link opened on a
  device that already holds a role in that event — the organiser checking
  their own link is the usual case — shows a prompt to switch or stay rather
  than silently signing them out. A device with no role there is let straight
  in.
- **The audit log sees redemptions, not devices.** A redeemed phrase is one
  `link_redeem` row attributed to the adopted identity, with the abandoned
  identity as its entity. It does not distinguish a typed code from an opened
  link, carries no event id (STATUS.md), and records neither address nor
  browser. So "has my code leaked?" is answered today only by the *code used*
  badge on the profile page and by what the organiser knows about the speaker.

## Things that will bite you

- **`.npmrc` sets `ignore-scripts=true`.** `better-sqlite3` will not build on
  `npm install`. Use `npm run rebuild:native`, or `--ignore-scripts=false` in
  Docker. This is a supply-chain login page; do not remove it to "fix" the build.
- **`COOKIE_SECRET` must be set and stable in production.** Elsewhere an
  unconfigured one is generated once and kept in `.cookie-secret` beside the
  database, because a key that changes per boot invalidates every identity —
  and the failure is worse than it sounds: the visitor comes back a stranger
  *and* cannot reclaim their own display name, which the identity they lost
  still holds. If neither reading nor writing that file works, the boot log
  says the next restart will sign everyone out.
- **`TRUST_PROXY=1` behind a reverse proxy**, or every request appears to come
  from the proxy and the per-IP rate limit becomes a single shared bucket.
- **The instance password login pages event creation** and the whole-database
  backup, and is compared in constant time. It is not a user account; it is a
  deploy-level secret.
- **A whole-database backup is a credential, not a document.** It is the file
  the point above calls the room key, so the download encrypts it and the UI
  says so in as many words. The per-event JSON export is the opposite by
  construction — `exportEvent` builds a shape that has nowhere to put a hash or
  a token, rather than filtering secrets out of DTOs, so a new secret column
  cannot leak into it by being added. That asymmetry is deliberate: one file is
  for sharing, the other is for a safe.
- **Rate limits are in-process memory.** They reset on restart and do not span
  instances — which is fine, because there is only ever one instance.
