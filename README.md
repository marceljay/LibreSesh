# LibreSesh

A simple, open-source scheduling tool for conferences and unconferences.

Attendees read a live schedule, add notes, links and questions to sessions, and
propose their own sessions in the rooms that allow it. Organisers arrange everything by drag
and drop. Changes reach every open browser in under a second.

Three design pillars:

1. **No accounts.** Your identity is an anonymous browser cookie. You pick a
   display name when you enter an event, and it is unique inside that event
   rather than across the instance — the same person can be "Ada" at one
   event and "A. Lovelace" at another. Access is three shared per-event
   passwords — viewer, attendee, organiser — plus a fourth role, speaker,
   granted by a personal phrase an organiser hands out, never a password.
   Opening the event on your phone too? The menu behind your name mints a
   three-word phrase; type it on the other device and it becomes you — same
   name, role and starred agenda.
2. **One process, one file.** Node + SQLite + Server-Sent Events. Deploys onto a
   1 vCPU VPS and backs up with a single `sqlite3` command.
3. **Mobile-first.** The schedule has to be readable on a phone in a hallway.

![LibreSesh showing LongConf 2026: a week rail above a row of day tabs, filter
chips for rooms and tracks, and the grid below with four room columns, session
blocks carrying their tag colours, and a now-line crossing 12:13 with the
sessions it passes through marked
"now"](assets/app-screenshot-0.2.0.png)

## Tech stack

| Layer     | Choice                                                       |
| --------- | ------------------------------------------------------------ |
| Runtime   | Node.js ≥ 20, TypeScript throughout                          |
| Server    | Express, `better-sqlite3` (WAL, no ORM), plain SQL            |
| Realtime  | Server-Sent Events, one stream per event                     |
| Frontend  | Vite + React 18 + Tailwind, React Router                      |
| Auth      | Signed httpOnly cookie, bcrypt-hashed event passwords         |
| Tests     | Vitest + supertest                                            |

## Layout

```
server/            Express app, DB layer, SSE, auth, rate limiting
  migrations/      numbered .sql files, applied at boot (001 is the whole schema)
  src/shared/      types + timezone helpers, imported by the web app too
web/               Vite React app
scripts/           seed.ts, create-event.ts, decrypt-backup.ts
assets/            brand source SVGs (the app builds from copies under web/)
tests/             Vitest suites
docs/              long-form guides, and example documents the tests exercise
deploy/            Dockerfile, compose, Caddyfile, systemd unit, backup script
design/mockup.jsx  approved UI reference — never imported
ARCHITECTURE.md    how it fits together, and the threat model
CHANGELOG.md       what has shipped
STATUS.md          current work and the backlog
```

## Setup

```sh
npm install
npm run seed       # "DemoConf 2026" — two days, the everyday fixture
npm run dev        # app on :3000, API behind it on :3001
```

`npm run seed:long` builds "LongConf 2026" alongside it — a fortnight from
today, with tracks — which is what exercises the week rail and the Rooms /
Tracks switch.

Open <http://localhost:3000>. The demo passwords are `viewer2026`, `user2026`
and `admin2026`; the instance password defaults to `dev-instance-password`.

### Two kinds of password

LibreSesh has one password that belongs to the **server** and three that belong
to each **event**, and they do different jobs:

- The **instance password** (`INSTANCE_ADMIN_PASSWORD`) is set by whoever
  deploys the instance and is shared by everyone allowed to create events on
  it. It gates exactly two things: creating an event, and cloning one you are
  not already an admin of. It grants nothing *inside* any event — holding it
  does not make you an organiser of anything.
- The **event passwords** — viewer, attendee and organiser — are chosen per
  event and handed out to the people coming. They decide what each person can
  do once they are in. All three must differ from each other: they are the only
  thing telling the roles apart, so two roles sharing one password would grant
  whichever is higher.

The three event password fields are optional when you create one: leave any of
them blank and a four-word phrase is generated for it and shown once, on the
confirmation screen. They are stored hashed, so that screen is the only place
they can ever be read.

In development the Vite dev server owns port 3000 and proxies `/api` to the API
on 3001, so the port you open is the same in dev and in production — where a
single process serves both.

### Native module note

`better-sqlite3` is a native addon. This repo sets `ignore-scripts=true` in
`.npmrc`, so `npm install` will not build it. If `require('better-sqlite3')`
fails with "Could not locate the bindings file", build it once:

```sh
npm run rebuild:native
```

In Docker the build stage passes `--ignore-scripts=false`, so this is handled.

## Commands

| Command                 | What it does                                        |
| ----------------------- | --------------------------------------------------- |
| `npm run dev`           | API + Vite dev server together                      |
| `npm run dev:demo`      | The same, with a role picker on the seeded demo events   |
| `npm run build`         | Compiles the server and builds `web/dist`           |
| `npm start`             | Runs the built server (serves `web/dist` too)       |
| `npm run seed`          | Recreates the two-day demo event                    |
| `npm run seed:long`     | A fortnight-long demo event, with tracks            |
| `npm run create-event`  | Interactive CLI to create a real event              |
| `npm run decrypt-backup`| Opens an encrypted `.lsbk` backup                   |
| `npm test`              | Vitest suite                                        |
| `npm run test:watch`    | The suite in watch mode                             |
| `npm run lint`          | ESLint + both TypeScript projects                   |
| `npm run typecheck`     | Just the TypeScript projects                        |
| `npm run rebuild:native`| Rebuilds `better-sqlite3` against the local Node     |

## Roles

Each event has three shared passwords — the password you type at the gate is
what grants your role, and switching means signing out and entering a
different one. The fourth role, **speaker**, has no password: an organiser
mints a personal four-word phrase from a speaker's profile page, and typing it
at any gate signs that device in as the speaker, on as many devices as they
like, until the phrase is revoked. An event renames its middle role freely
("attendee", "participant", "member"); the tables below use the default.

**Most of what a role may do is per-event policy**, set from Manage Event →
Permissions. These ticks are the defaults, not the rules — an organiser can
move any of them, except the organiser column, which is locked on so that an
event nobody can moderate cannot be created by accident.

| Capability                                        | viewer | attendee | speaker | organiser |
| ------------------------------------------------- | :----: | :------: | :-----: | :-------: |
| Star sessions, build a personal agenda             |   ✓    |    ✓     |    ✓    |     ✓     |
| Edit your own speaker profile                      |   ✓    |    ✓     |    ✓    |     ✓     |
| Register interest in a pitch                       |   ✓    |    ✓     |    ✓    |     ✓     |
| Add notes, links and questions                     |        |    ✓     |    ✓    |     ✓     |
| Delete your own contributions                      |        |    ✓     |    ✓    |     ✓     |
| Create sessions in rooms that allow booking        |        |    ✓     |    ✓    |     ✓     |
| Edit and delete your own sessions                  |        |    ✓     |    ✓    |     ✓     |
| Pitch a session to the proposal board              |        |    ✓     |    ✓    |     ✓     |
| Hide anyone's contribution                         |        |          |         |     ✓     |

The rest is structural and not configurable, because it is how an event is
administered at all:

| Capability                                        | viewer | attendee | speaker | organiser |
| ------------------------------------------------- | :----: | :------: | :-----: | :-------: |
| Read the schedule; export or subscribe to it       |   ✓    |    ✓     |    ✓    |     ✓     |
| Set your display name for this event               |   ✓    |    ✓     |    ✓    |     ✓     |
| Rewrite the words of a session you speak at        |        |          |    ✓    |     ✓     |
| Official sessions — create, edit, move anywhere    |        |          |         |     ✓     |
| Book against a session everyone should be at       |        |          |    ✓    |     ✓     |
| Rooms, tags, tracks, people, merging duplicates    |        |          |         |     ✓     |
| Place a pitch on the grid                          |        |          |         |     ✓     |
| Restore deleted items from the trash               |        |          |         |     ✓     |
| Passwords, settings, permissions, archive          |        |          |         |     ✓     |

Viewing an event requires the viewer password — schedules are never public.
Display names are unique within an event, so nobody can take an organiser's.

**Filtering.** The **Filter** button beside the search box narrows the grid:
free text, "now / next", your starred agenda, and a chip per room, track and
tag. Tracks include an **Unassigned** chip — the sessions nobody has put on a
strand yet, which is the pile an organiser goes looking for while a programme
is still being built, and which appears only while some session has no track.
Chips of the same kind are an *or*: two rooms means either room. Every filter
lives in the query string, so a narrowed view is a link that opens the same way
for whoever you send it to.

**Breaks.** An official session can be marked a *break* — lunch, dinner,
coffee. It leaves the room columns and is drawn greyed out across the whole
schedule, so nobody puts a session over it by accident. It blocks nothing:
running a session through lunch is allowed, and a break never counts as
double-booking the room it names. The room still records where it is. A
conference dinner can be both a break and something everyone should be at.

**Holding the floor.** An organiser can mark an official session *everyone
should be at this* — a keynote, a closing plenary. While it runs, attendees
cannot add a session anywhere in the event, not even in a room that allows
booking, and the schedule shades the hour. It is per session rather than a
switch on the event, because most of what an official session is at a real
unconference is registration, coffee and a track that runs all afternoon: a
rule keyed on "an official session is happening" would close the grid for the
whole event. Speakers and organisers can still place sessions against it, and
the grid badges those as **competing**. Sessions booked before the mark went on
stay exactly where they are.

## Managing an event

**Manage Event** — the link beside your name, organisers only — is seven tabs:

| Tab | What it holds |
| --- | --- |
| Programme | Rooms, tracks and tags |
| People | Everyone who has joined, plus speaker and host profiles: who holds each, at what role, and whether their code is still unused |
| Permissions | Which roles may do what at this event |
| Settings | Name, address, dates, day bounds, passwords, audit retention, duplicate, archive |
| Trash | Deleted sessions and contributions, with restore |
| Backup | The event as JSON, and the encrypted whole-instance download |
| Audit | Who created, edited, deleted or restored what, by name and UID |

The open tab lives in the URL as `?tab=`, so a link lands a co-organiser on the
same one.

The **audit log** records every write, plus failed password and device-phrase
attempts, and nobody can edit it — organisers included. It keeps the newest
1000 entries per event by default; past that the oldest are dropped as new ones
arrive. Settings changes the number, and 0 keeps everything. That is a real
trade rather than a detail: a low cap means someone making a great many edits
can push an earlier action off the end.

### Renaming an event

An event's address is its slug — `/e/valley-2026` — and Settings can change it
after the fact, for the typo, the rebrand, or the slug picked before the event
had a name. **The old address goes on working.** Every slug an event has ever
had keeps resolving to it, so the invite link on a badge, a QR code taped to a
door, a subscribed calendar feed and any script written against the old name
all still answer; the app moves the address bar to the current slug when it
notices. Nobody is signed out and nothing is re-entered either — a role is held
against the event, not against its name, so organisers stay organisers and
starred agendas stay starred. Open browsers follow the rename without a reload.

A slug that still redirects cannot be claimed by a new event, a duplicate or a
JSON import, so an old link can never be quietly re-pointed at somebody else's
event. Renames appear in the audit log under their own word, *renamed*.

### Importing a schedule from JSON

`POST /api/events/import` builds a whole event — rooms, tracks, tags and a full
grid of sessions — from one JSON document. It is guarded by the instance
password, like creating an event by hand, because it makes an event rather than
editing one.

**[`/import`](/import)** is that route with a screen in front of it: paste the
document, check it, import. Everything below is the same thing from a terminal.

```bash
# Rehearse first: this validates everything and writes nothing.
curl -X POST 'https://your-host/api/events/import?dryRun=1' \
  -H "X-Instance-Key: $INSTANCE_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' --data @schedule.json

# Then drop the ?dryRun=1 to keep it.
```

The document is written the way a schedule is printed — room names and
wall-clock times, no ids — so it can be typed by hand or transcribed from a
photo of a programme:

```json
{
  "event": {
    "name": "Photo Conf",
    "slug": "photoconf",
    "timezone": "Europe/Berlin",
    "startDate": "2026-06-01",
    "endDate": "2026-06-02"
  },
  "rooms": [{ "name": "Main hall", "capacity": 200 }, { "name": "Side room" }],
  "tracks": [{ "name": "Design" }],
  "sessions": [
    {
      "room": "Main hall",
      "track": "Design",
      "title": "Opening keynote",
      "speaker": "Ada Lovelace",
      "date": "2026-06-01",
      "start": "09:00",
      "end": "10:00"
    }
  ]
}
```

Rooms, tracks and tags are declared once and referred to by name — a session
naming one that was not declared is refused rather than invented — and room
order is column order. Everything lands in one transaction, so a document that
fails on its last row leaves nothing behind. Contradictions are refused naming
the row that caused them; a session outside the visible hours or double-booked
against another is imported and named in `warnings` instead.

**[docs/schedule-import.md](docs/schedule-import.md)** is the full field
reference, the error and warning catalogue, and the photo-to-document workflow.
[`docs/examples/schedule-import.example.json`](docs/examples/schedule-import.example.json)
is a template to copy; the test suite dry-runs it, so it cannot go stale.

An event's own `export.json` is *not* an import document: it is a record of
ids, and this is a description of a schedule. There is still no route that
reads an export back.

## Configuration

| Variable                  | Default          | Notes                                              |
| ------------------------- | ---------------- | -------------------------------------------------- |
| `PORT`                    | `3000`           |                                                    |
| `DATABASE_PATH`           | `data/app.db`    | `-wal`/`-shm` sidecars sit next to it              |
| `COOKIE_SECRET`           | generated once   | **Required in production.** Elsewhere a generated one is kept in `.cookie-secret` beside the database, so restarts do not sign everyone out. Changing it logs everyone out |
| `INSTANCE_ADMIN_PASSWORD` | dev placeholder  | **Required in production**; gates event creation   |
| `TRUST_PROXY`             | off              | Set `1` behind Caddy so rate limits see real IPs   |
| `SERVE_STATIC`            | on in production | Serves `web/dist` from the API process             |
| `DEMO_MODE`               | off              | Set `1` and the gate becomes a role picker **on the seeded demo events only** — every other event on the instance keeps its passwords |
| `DEMO_EVENT_SLUGS`        | the seeded two   | Comma-separated; which slugs `DEMO_MODE` opens up. Only needed if you seed your own fixture |
| `SEED_DEMO_EVENT`         | on               | Creates DemoConf at boot if absent — plus LongConf when `DEMO_MODE=1`; set `0` on a real conference instance |
| `ALLOW_EPHEMERAL_DB`      | off in prod      | Permits a database directory that is not a mounted volume — a disposable instance only |

## Deployment

```
Caddy (:443, automatic HTTPS)
  └── reverse_proxy localhost:3000
        └── Node process (API + SSE + web/dist)
              └── $DATABASE_PATH  (one SQLite file, WAL mode)
```

SQLite runs **inside** the Node process — there is no database server, port or
connection string. Exactly one app process may own the file; never run two
instances against the same one.

A 1 vCPU / 1 GB VPS is plenty. Hundreds of concurrent SSE clients are idle
sockets, and peak write volume at a conference is a few requests a second. Add
swap as a safety net and keep a few GB of disk free.

### Docker Compose (also the local prod simulation)

```sh
cd deploy
cp libresesh.env.example .env    # set COOKIE_SECRET, INSTANCE_ADMIN_PASSWORD, SITE_ADDRESS
docker compose up --build
```

The DB lives in `deploy/data/`, mounted into the container, so it survives
rebuilds. On the VPS the only change is `SITE_ADDRESS`.

### Railway (or another PaaS)

`railway.json` pins the build to `deploy/Dockerfile`. That matters: a plain
`npm ci` honours this repo's `.npmrc` (`ignore-scripts=true`), skips
`better-sqlite3`'s install step, and the app dies at boot with
`Could not locate the bindings file`. The Dockerfile already runs
`npm ci --ignore-scripts=false` for exactly that reason.

Two things **cannot** live in `railway.json` — it carries build and deploy
settings only, while both of these are service-level resources the platform
owns:

1. **A volume mounted at `/data`.** Without it the database sits in the
   container's own filesystem and is destroyed on the next deploy, with nothing
   looking wrong until the schedule disappears.
2. **The environment variables.** `deploy/railway.env.example` lists them with
   what each one is for.

You do not have to get either right in advance. A production instance runs a
preflight check at boot and refuses to start with every problem listed at once
and a fix beside each — one round of corrections rather than one per redeploy.

### systemd

```sh
sudo useradd --system --home /srv/libresesh libresesh
sudo rsync -a --exclude node_modules ./ /srv/libresesh/
cd /srv/libresesh && sudo -u libresesh npm ci --ignore-scripts=false && sudo -u libresesh npm run build

sudo cp deploy/libresesh.service /etc/systemd/system/
sudo cp deploy/libresesh.env.example /etc/libresesh.env   # then edit it
sudo systemctl enable --now libresesh
```

Install Caddy from its own package and point it at `localhost:3000`. Keep the
proxy's read/write timeouts above the 25-second SSE heartbeat (≥ 120s) or
streams get cut.

### Backups

Two of them are reachable from the browser, in **Manage Event → Backup**, for
organisers with no shell on the box (and **Manage Event → Audit** shows who
changed what, which is the other half of recovering from a bad afternoon):

- **Export this event** — the programme as JSON: rooms, tracks, tags, people,
  sessions, pitches and contributions, with star and interest counts. No
  passwords, no identity tokens, no speaker codes, so it is safe to email to a
  co-organiser. Any admin of that event can take one.
- **Back up the whole instance** — the entire database, AES-256-GCM under a
  passphrase typed at download time, gated by the instance password. Open one
  with `npm run decrypt-backup -- backup.lsbk restored.db` on the server; the
  framing is ours, so `openssl` alone will not do it. **Treat the file as a
  credential**: it carries every identity token in clear and the hashes of
  every device and speaker code, so whoever holds it can become anyone here.

Neither replaces a scheduled backup on the host, which is the one that runs
when nobody remembers to click anything. `VACUUM INTO` is safe against a live
WAL database:

```sh
sqlite3 "$DATABASE_PATH" "VACUUM INTO '/backups/app-$(date +%F).db'"
```

`deploy/backup.sh` wraps that with 14-day retention — run it nightly from cron:

```
0 3 * * *  /srv/libresesh/deploy/backup.sh >> /var/log/libresesh-backup.log 2>&1
```

For continuous replication instead of nightly snapshots, add
[Litestream](https://litestream.io) — one extra binary streaming the WAL to
S3-compatible storage, no code changes.

### The cookie secret, and rotating it

`COOKIE_SECRET` is set once and kept. It signs the identity cookie, so it is
the one variable whose *change* costs more than its absence:

- **Changing it signs out every visitor at once** — their cookies stop
  verifying and they come back as strangers.
- **Worse, their names do not come back with them.** A display name is held,
  uniquely per event, by the identity that claimed it. After a rotation people
  are told "someone at this event is already called Ada", which is true and
  useless: the someone is their own former self. The gate offers "Enter as
  *Ada 2*", and an organiser can free the originals with
  `sqlite3 "$DATABASE_PATH" "DELETE FROM event_identities WHERE event_id = <id>;"`,
  which is a blunt instrument — it frees every name in that event.

Leaking it is the milder half. On its own a leaked secret buys almost nothing:
a forged signature still has to carry a token that exists in `identities`, and
those are 22 random characters. It matters **in combination** with a copy of
the database, where the tokens live — so keep the secret out of the volume that
holds the database and its backups. That is why production takes it from the
environment rather than a file: the dev fallback deliberately puts both halves
in one place, and a dev database is worth nothing.

If you do have to rotate — the secret was committed, pasted into a chat, or
sent to the wrong person — do it between events rather than during one, and
expect the sign-out. Nothing else about the instance is affected: roles,
schedules, profiles and the audit log are untouched.

### Upgrades

Upgrading in place is safe by design: before applying any pending migration to
an established database the server snapshots it (`app.db.backup-<stamp>` next
to the file), and it refuses to start an **older** build against a database a
newer one has migrated, naming the migration in the error. Roll back by
restoring the pre-migration backup alongside the older build. Backup files
accumulate one per upgrade — prune them when you prune your nightly ones.

## Architecture and security

[ARCHITECTURE.md](ARCHITECTURE.md) covers how the pieces fit together and the
threat model — what this defends against, and what it deliberately does not.
Start with **§What a cookie is, exactly** if you are touching anything to do
with identity, sign-in or `COOKIE_SECRET`: it is the concept the rest hangs
off, and the one most easily got wrong.

## Roadmap

Current work and the backlog live in [STATUS.md](STATUS.md); shipped work is in
[CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).
