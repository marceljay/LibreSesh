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
| A hundred addresses guessing one event's password | Failures are counted per event: past 60 in a sliding hour **from at least 10 distinct addresses**, the event stops accepting new sign-ins for 15 minutes. No password is compared while it is stopped, anyone who already holds a role is unaffected, and one audit row records it. The distinct-address requirement is what stops a single address blocking sign-ins for everyone. The organiser sees a notice above the audit log |
| Repeated guesses from one visitor | Per event, per cookie **and** address: five attempts cost nothing, the sixth is refused for 2 minutes, five more cost nothing, the eleventh and beyond for 15 minutes. A correct password clears the count. Keyed on the cookie so that everyone behind one NAT address does not share a single allowance, and capped at 300 failures an hour per address so discarding the cookie buys little. The page says how many attempts are left once it is down to the last two, and counts the wait down: an attacker can count for themselves, and someone mistyping a four-word phrase cannot |
| Guessing an event password | bcrypt (cost 10) on every comparison, so each guess costs real time. How many guesses are possible at all is the two rows above; the token bucket that used to sit here as well was removed with them, because it imposed a second lockout on numbers nobody chose |
| Guessing a link phrase | Same 5-per-15-min rate limit as passwords; stored hashed. Device phrases are single-use and die in 10 minutes; speaker codes are four words (~37 bits) and revocable |
| Casual vandalism of the programme | Soft deletes + restore; `audit` log with actor UIDs, readable by admins at Manage Event → Audit; `hidden` flag for contributions |
| Spam / flooding | Token buckets **per person** on every write class: 10 contributions, 12 sessions and 30 other writes a minute. **Reads are not limited at all** — no GET is metered, including `/bundle`, `/sessions/:id`, `/calendar.ics`, the audit list and the per-event export. A conference is a room of people behind one access point, so a read ceiling high enough never to refuse that room defends against nothing (the limiter is not a denial-of-service defence — see **Out of scope, accepted**), and one low enough to defend would one day refuse a real room. The write buckets keyed on the source address hold 100× the personal ones, because an address is not a person here and a bucket sized like a personal allowance makes attendees throttle each other at the busiest moment. It is a backstop against one address flooding the process, not a second allowance. `auth` and `mint` are the exceptions and stay person-sized per address: they meter a secret, not a workload. Server-enforced max lengths |
| XSS via session or profile text | HTML escaped before markdown parsing; URL scheme allowlist; no `dangerouslySetInnerHTML` on unescaped input |
| Open redirect | Every client navigation is prefixed with a literal `/e/` |
| Reading a schedule you were not given | Viewing requires the viewer password; there is no public event view |
| Reading a draft session | Only organisers, its creator and the people credited on it are sent one — not in the bundle, the stream, the calendar feed or a profile; the session's routes answer 404 to anyone else (ARCHITECTURE §Drafts). No credential grants more than its role did: a draft is withheld from roles that could already read the schedule |
| Leaking one person's agenda | Stars and interest are never broadcast and never attributed in any payload; only aggregate counts are exposed |
| A leaked calendar URL | The token grants only what its owner's role already allows, and only for that one event; revoking the role kills the feed |
| A photographed invite QR or forwarded invite link | It *is* the event password: whoever has it holds that role until the password is changed. Changing it does not evict roles already granted. The panel that draws the code says so, loudest for the two codes that grant writing |
| A forwarded speaker link or photographed speaker QR | It is a standing personal credential: whoever opens it is that speaker, on that device, until the code is revoked — and revoking does not sign out devices already in; changing the person's role does. The profile page says "send it to them and nobody else" beside the link. No expiry, by design (§Codes and links) |
| A leaked `COOKIE_SECRET` | Little on its own — a forged signature still needs a real 131-bit token, and an unknown one just mints an anonymous identity. Kept out of the database's volume so a copied DB and the secret do not leak together |
| Guessing the instance password | The `auth` rate limit on every route that takes it — 5 attempts per identity **and** per address per 15 minutes, a refund on success so ordinary use is never throttled, and an `instance_key_failed` audit row (no event id) for every miss. It must be 16 characters to boot in production, 24 recommended |
| Flooding the identity table | Minting is rate-limited per address (300 per 15 minutes, sized for a shared NAT address). Over it a request carries no identity rather than being refused, so public reads still work and anything needing a role answers `429 too_many_identities`. Rows that never became anybody — no role, no username, no profile, no calendar feed, no link code — are deleted after 30 days |
| A leaked whole-database backup | Never leaves the server unencrypted: AES-256-GCM under a scrypt key (N=2^15) from a passphrase typed at download time, gated by the instance password and the 5-per-15-min auth budget. If one leaks open anyway: identity tokens need `COOKIE_SECRET` as well before they sign anyone in, but `ics_token`s work against the live server as they are, and speaker-code hashes (~37 bits) crack offline — revoke roles and codes |
| A leaked event Nostr signing key | The event's identity on Nostr is that key and nothing else: whoever holds it *is* the event there, for good, and can publish or retract in its name. Stored AES-256-GCM encrypted under a key derived (HKDF) from the at-rest secret — `COOKIE_SECRET` unless `SECRETS_AT_REST_KEY` is set — which lives off the database's volume, so a copied database holds a blob it cannot open. Decrypted only while signing and in the organiser-only export route (`auth` budget, one audit row per export). Rotating the at-rest secret without `SECRETS_AT_REST_KEY_PREVIOUS` for one boot loses every event's key, and with it every way to update or retract what was published; the Publish tab says to keep an exported copy |

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
- **The rate limiter is not a denial-of-service defence, and cannot be made
  into one.** It lives inside the process it would be protecting, and runs
  after the cookie signature is verified and the identity, event and role are
  looked up — so a refused request still costs roughly a sixth of a served one
  (0.70 ms against 4.44 ms for the largest bundle, measured 2026-09-10). What
  it is good at is stopping one client from being expensive on its own: a retry
  loop, a stuck poller, an agent written without backoff. A flood from many
  addresses is the reverse proxy's job and the network's, and no value of these
  numbers changes that. It is why the address-keyed backstop can be set as high
  as it is without giving anything up.

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
| Telegram bind code | Points this event's announcements at whichever group it is typed in | Organiser, Manage → Publish → Telegram | 15 minutes, one use | Expiry; minting another; **Disconnect** | Un-send anything already posted |
| Telegram bot token | Full control of that bot: posting to every group it is in, and its name | The organiser, from BotFather, pasted into Manage → Publish → Telegram | Until replaced or removed | Removing it here; `/revoke` in BotFather | Un-send anything already posted, or evict the bot from a group |

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

## What a connected Telegram group sees

Connecting a group is a **publication decision**, and the only one an organiser
can make that puts event content somewhere this app cannot reach. Manage Event
says so in front of the control rather than in a tooltip.

What leaves: session titles, speaker display names, room names and times, as
plain messages, to everyone who can see that group — and onward to anyone they
forward it to. What does not: drafts (never, under any trigger), deleted
sessions, archived events, and every contribution, note, question, star and
pitch interest. The links in the messages still land on the password gate; the
message bodies do not.

**Livestream links are the exception, and are off until switched on.** A
session link in a message is a URL to the gate: following it asks for the event
password. A stream address is not — it is frequently the one unguessable thing
standing between a stranger and the room, and posting it into a group publishes
it to everyone there and to anyone the message is forwarded to. So carrying
them is its own setting (migration 024), off for every event including one
already announcing, and the panel says what it costs in front of the control.
Turning it off stops the next message and does nothing about the last one.

A posted message is **not recallable by this app** — Disconnect stops the next
one and changes nothing about the last one. `/revoke` in BotFather is the only
real kill switch for a bot.

### The bot token is the first plaintext credential in the database

An event brings its own bot (migration 023), because an organiser running their
own event should not have to ask whoever deploys the instance for permission,
and because the group should see the conference's name rather than the host's.
`TELEGRAM_BOT_TOKEN` remains as a fallback for a single-tenant instance.

That makes `events.telegram_bot_token` a **credential at rest, in plaintext** —
and it is the only one here. Every other secret in this database is hashed
(event passwords, link codes) or minted by us (`identities.token`). A bot token
has to be replayed to Telegram on every call, so it cannot be hashed.

What follows, and is accepted rather than solved:

- It is in **every backup**, and readable by anyone who can read the database
  file. Treat a leaked backup as a leak of every event's bot.
- It grants posting as that bot to **every group the bot is in** — which, for
  an organiser's own bot, is usually only theirs.
- It is **never returned to a client**: the settings endpoint answers with the
  last four characters and nothing more, so even the organiser who saved it
  cannot read it back.
- It is **never written to an export**, so a cloned event does not inherit
  somebody's bot.
- Changing it **clears the group binding**, because the new bot is not a member
  of the old group and would fail silently every minute otherwise.

Encrypting it at rest is filed and not done.

The bot runs with Telegram's default privacy mode, so it receives only messages
addressed to it — commands and replies — and not the group's conversation.

## Things that will bite you

- **`.npmrc` sets `ignore-scripts=true`.** `better-sqlite3` will not build on
  `npm install`. Use `npm run rebuild:native`, or `--ignore-scripts=false` in
  Docker. This is a supply-chain defence; do not remove it to "fix" the build.
- **`COOKIE_SECRET` must be set and stable in production.** Elsewhere an
  unconfigured one is generated once and kept in `.cookie-secret` beside the
  database, because a key that changes per boot invalidates every identity —
  and the failure is worse than it sounds: the visitor comes back a stranger
  *and* cannot reclaim their own display name, which the identity they lost
  still holds. If neither reading nor writing that file works, the boot log
  says the next restart will sign everyone out.
- **Rotating the at-rest secret needs its predecessor for one boot.** The
  Nostr signing keys are encrypted under a key derived from `COOKIE_SECRET`,
  or from `SECRETS_AT_REST_KEY` when set. Change whichever is in use with the
  old value in `SECRETS_AT_REST_KEY_PREVIOUS`, boot once, read the count in
  the log, then drop it. Without that step the keys are gone: nothing already
  on the relays can be updated or retracted, and the events start over under
  new identities. `POST /e/:slug/nostr/export-key` hands the organiser the
  `nsec` for exactly this case; `POST …/import-key` takes it back.
- **`TRUST_PROXY=1` behind a reverse proxy**, or every request appears to come
  from the proxy and the per-IP rate limit becomes a single shared bucket.
- **The instance password is required for event creation** and the whole-database
  backup, and is compared in constant time. It is not a user account; it is a
  deploy-level secret. Every path that makes an event asks for it — by hand,
  by import — without exception: the per-event copy route that let an
  event's organiser create a second event on the organiser password alone is
  gone, and an organiser who wants to run an event again exports it and
  imports the file, which asks like any other creation.
- **A whole-database backup is a credential, not a document.** It is the file
  the point above calls the room key, so the download encrypts it and the UI
  says so in as many words. The per-event JSON export is the opposite by
  construction — `exportEvent` builds a shape that has nowhere to put a hash or
  a token, rather than filtering secrets out of DTOs, so a new secret column
  cannot leak into it by being added. That asymmetry is deliberate: one file is
  for sharing, the other is for a safe.
- **Rate limits are in-process memory.** They reset on restart and do not span
  instances — which is fine, because there is only ever one instance.
