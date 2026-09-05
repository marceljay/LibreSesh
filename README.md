# LibreSesh

A simple, open-source scheduling tool for conferences and unconferences.

Attendees read a live schedule, add notes, links and questions to sessions,
and propose their own sessions in the rooms that allow it. Organisers build
the programme — rooms, tracks, official sessions, pitches placed on the
grid — from Manage Event and from the schedule itself. Changes reach every
open browser in under a second.

Three design pillars:

1. **No accounts.** A display name and a browser cookie. Access is three
   shared per-event passwords (viewer, attendee, organiser) plus a personal
   speaker phrase. Details: [docs/identity.md](docs/identity.md).
2. **One process, one file.** Node, SQLite and Server-Sent Events. No
   database server, no broker.
3. **Mobile-first.** The schedule has to be readable on a phone in a hallway.

![LibreSesh showing LongConf 2026: a week rail above a row of day tabs, filter
chips for rooms and tracks, and the grid below with four room columns, session
blocks carrying their tag colours, and a now-line crossing 12:13 with the
sessions it passes through marked
"now"](assets/app-screenshot-0.2.0.png)

## Contents

- [Setup](#setup)
- [Commands](#commands)
- [Roles](#roles)
- [Tech stack](#tech-stack)
- [Layout](#layout)
- [Docs](#docs)
- [Deploy](#deploy)
- [License](#license)

## Setup

```sh
npm install
npm run seed       # "DemoConf 2026" — two days, the everyday fixture
npm run dev        # app on :3000, API behind it on :3001
```

`npm run seed:long` adds "LongConf 2026" — a fortnight from today, with
tracks — which exercises the week rail and the Rooms / Tracks switch.

Open <http://localhost:3000>. Demo passwords: `viewer2026`, `user2026`,
`admin2026`. The instance password defaults to `dev-instance-password`.

The Vite dev server owns port 3000 and proxies `/api` to the API on 3001,
so the port you open is the same in dev and in production.

`npm run dev` reads a `.env` beside this file if one is there (gitignored, and
optional — a fresh clone boots without it). The one variable worth putting in
it is `COOKIE_SECRET`. Without it the secret is generated once and kept in
`data/.cookie-secret`, which is per checkout — so a second checkout, such as a
git worktree with its own `data/`, signs with a different key. Browser cookies
ignore the port, so both dev servers share one `localhost` cookie jar: whichever
you opened last mints a new identity and overwrites the cookie, and the other
sends you back through the gate. Give every checkout the same `COOKIE_SECRET`
(and point them at one database) and the switch costs nothing. See
**§What a cookie is, exactly** in [ARCHITECTURE.md](ARCHITECTURE.md).

### Native module note

`better-sqlite3` is a native addon. This repo sets `ignore-scripts=true` in
`.npmrc`, so `npm install` will not build it. If `require('better-sqlite3')`
fails with "Could not locate the bindings file":

```sh
npm run rebuild:native
```

In Docker the build stage passes `--ignore-scripts=false`, so this is handled.

## Commands

| Command                  | What it does                                      |
| ------------------------ | ------------------------------------------------- |
| `npm run dev`            | API + Vite dev server together                    |
| `npm run dev:demo`       | The same, with a role picker on the seeded demos  |
| `npm run build`          | Compiles the server and builds `web/dist`         |
| `npm start`              | Runs the built server (serves `web/dist` too)     |
| `npm run seed`           | Recreates the two-day demo event                  |
| `npm run seed:long`      | A fortnight-long demo event, with tracks          |
| `npm run create-event`   | Interactive CLI to create a real event            |
| `npm run decrypt-backup` | Opens an encrypted `.lsbk` backup                 |
| `npm test`               | Vitest suite                                      |
| `npm run test:watch`     | The suite in watch mode                           |
| `npm run lint`           | ESLint + both TypeScript projects                 |
| `npm run typecheck`      | Just the TypeScript projects                      |
| `npm run rebuild:native` | Rebuilds `better-sqlite3` against the local Node  |

## Roles

The password typed at the gate is the role. Switching means signing out and
entering a different one. **Speaker** has no shared password: an organiser
mints a personal four-word phrase from that speaker's profile.

Most capabilities are per-event policy (Manage Event → Permissions). The
organiser column is locked on so an event nobody can moderate cannot be
created by accident. Schedules are never public — viewing needs the viewer
password. Display names are unique within an event.

| | viewer | attendee | speaker | organiser |
| --- | :---: | :---: | :---: | :---: |
| Read the schedule; star sessions; set your name | ✓ | ✓ | ✓ | ✓ |
| Notes, links, questions; book rooms that allow it; pitch | | ✓ | ✓ | ✓ |
| Rewrite a session you speak at | | | ✓ | ✓ |
| Official sessions, rooms, people, permissions, archive | | | | ✓ |

Full matrices, filtering, breaks and plenary ("holding the floor"):
[docs/using.md](docs/using.md). How identity, passwords and device-linking
work: [docs/identity.md](docs/identity.md). The organiser console:
[docs/managing.md](docs/managing.md).

## Tech stack

| Layer    | Choice                                                |
| -------- | ----------------------------------------------------- |
| Runtime  | Node.js ≥ 20, TypeScript throughout                   |
| Server   | Express, `better-sqlite3` (WAL, no ORM), plain SQL    |
| Realtime | Server-Sent Events, one stream per event              |
| Frontend | Vite + React 18 + Tailwind, React Router              |
| Auth     | Signed httpOnly cookie, bcrypt-hashed event passwords |
| Tests    | Vitest + supertest                                    |

## Layout

```
server/            Express app, DB layer, SSE, auth, rate limiting
  migrations/      numbered .sql files, applied at boot
  src/shared/      types + timezone helpers, imported by the web app too
web/               Vite React app
scripts/           seed.ts, create-event.ts, decrypt-backup.ts
assets/            brand source SVGs
tests/             Vitest suites
docs/              guides (identity, using, managing, deploy, import)
deploy/            Dockerfile, compose, Caddyfile, systemd unit, backup script
design/mockup.jsx  approved UI reference — never imported
ARCHITECTURE.md    how it fits together, and the threat model
CHANGELOG.md       what has shipped
STATUS.md          current work and the backlog
```

## Docs

| Doc | What it is |
| --- | --- |
| [docs/identity.md](docs/identity.md) | Cookies, display names, instance vs event passwords, speakers, second device |
| [docs/using.md](docs/using.md) | Role tables, filtering, breaks, holding the floor |
| [docs/managing.md](docs/managing.md) | Manage Event tabs, renaming, audit, JSON import |
| [docs/schedule-import.md](docs/schedule-import.md) | Import field reference (already in the repo) |
| [docs/deploy.md](docs/deploy.md) | Config, Docker, Railway, systemd, backups, upgrades |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Internals and threat model |
| [STATUS.md](STATUS.md) / [CHANGELOG.md](CHANGELOG.md) | Backlog and shipped work |

## Deploy

Production is one Node process behind Caddy (or another reverse proxy),
writing one SQLite file. Never run two app replicas against the same
database.

```sh
cd deploy
cp libresesh.env.example .env    # COOKIE_SECRET, INSTANCE_ADMIN_PASSWORD, SITE_ADDRESS
docker compose up --build
```

`COOKIE_SECRET` and `INSTANCE_ADMIN_PASSWORD` are required in production.
The rest — Railway volumes, systemd, backups, rotating the cookie secret,
upgrades — is in [docs/deploy.md](docs/deploy.md).

How the pieces fit, and the threat model:
[ARCHITECTURE.md](ARCHITECTURE.md). Start with **§What a cookie is, exactly**
if you are touching identity or `COOKIE_SECRET`.

## License

MIT — see [LICENSE](LICENSE).