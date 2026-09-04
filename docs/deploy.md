# Deployment

One Node process behind a reverse proxy, one SQLite file. That is the
whole topology.

```
Caddy (:443, automatic HTTPS)
  └── reverse_proxy localhost:3000
        └── Node process (API + SSE + web/dist)
              └── $DATABASE_PATH  (one SQLite file, WAL mode)
```

SQLite runs **inside** the Node process — there is no database server, port
or connection string. Exactly one app process may own the file; never run
two instances against the same one.

A 1 vCPU / 1 GB VPS is plenty. Hundreds of concurrent SSE clients are idle
sockets, and peak write volume at a conference is a few requests a second.
Add swap as a safety net and keep a few GB of disk free.

Files that actually deploy the app live in [`deploy/`](../deploy/).

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `DATABASE_PATH` | `data/app.db` | `-wal`/`-shm` sidecars sit next to it |
| `COOKIE_SECRET` | generated once | **Required in production.** Elsewhere a generated one is kept in `.cookie-secret` beside the database, so restarts do not sign everyone out. Changing it logs everyone out |
| `INSTANCE_ADMIN_PASSWORD` | dev placeholder | **Required in production**; gates event creation |
| `TRUST_PROXY` | off | Set `1` behind Caddy so rate limits see real IPs |
| `SERVE_STATIC` | on in production | Serves `web/dist` from the API process |
| `DEMO_MODE` | off | Set `1` and the gate becomes a role picker **on the seeded demo events only** — every other event on the instance keeps its passwords |
| `DEMO_EVENT_SLUGS` | the seeded two | Comma-separated; which slugs `DEMO_MODE` opens up. Only needed if you seed your own fixture |
| `SEED_DEMO_EVENT` | on | Creates DemoConf at boot if absent — plus LongConf when `DEMO_MODE=1`; set `0` on a real conference instance |
| `ALLOW_EPHEMERAL_DB` | off in prod | Permits a database directory that is not a mounted volume — a disposable instance only |

## Docker Compose (also the local prod simulation)

```sh
cd deploy
cp libresesh.env.example .env    # set COOKIE_SECRET, INSTANCE_ADMIN_PASSWORD, SITE_ADDRESS
docker compose up --build
```

The DB lives in `deploy/data/`, mounted into the container, so it survives
rebuilds. On the VPS the only change is `SITE_ADDRESS`.

## Railway (or another PaaS)

`railway.json` pins the build to `deploy/Dockerfile`. That matters: a plain
`npm ci` honours this repo's `.npmrc` (`ignore-scripts=true`), skips
`better-sqlite3`'s install step, and the app dies at boot with
`Could not locate the bindings file`. The Dockerfile already runs
`npm ci --ignore-scripts=false` for exactly that reason.

Two things **cannot** live in `railway.json` — it carries build and deploy
settings only, while both of these are service-level resources the platform
owns:

1. **A volume mounted at `/data`.** Without it the database sits in the
   container's own filesystem and is destroyed on the next deploy, with
   nothing looking wrong until the schedule disappears.
2. **The environment variables.** `deploy/railway.env.example` lists them
   with what each one is for.

You do not have to get either right in advance. A production instance runs
a preflight check at boot and refuses to start with every problem listed at
once and a fix beside each — one round of corrections rather than one per
redeploy.

## systemd

```sh
sudo useradd --system --home /srv/libresesh libresesh
sudo rsync -a --exclude node_modules ./ /srv/libresesh/
cd /srv/libresesh && sudo -u libresesh npm ci --ignore-scripts=false && sudo -u libresesh npm run build

sudo cp deploy/libresesh.service /etc/systemd/system/
sudo cp deploy/libresesh.env.example /etc/libresesh.env   # then edit it
sudo systemctl enable --now libresesh
```

Install Caddy from its own package and point it at `localhost:3000`. Keep
the proxy's read/write timeouts above the 25-second SSE heartbeat (≥ 120s)
or streams get cut.

## Backups

Two of them are reachable from the browser, in **Manage Event → Backup**,
for organisers with no shell on the box (and **Manage Event → Audit** shows
who changed what, which is the other half of recovering from a bad
afternoon):

- **Export this event** — the programme as JSON: rooms, tracks, tags,
  people, sessions, pitches and contributions, with star and interest
  counts. No passwords, no identity tokens, no speaker codes, so it is safe
  to email to a co-organiser. Any admin of that event can take one. Four
  checkboxes choose what goes in — sessions, people, pitches, contributions
  — and the event's settings, rooms, tracks, tags, formats and breaks are
  always in it; from the command line that is `?include=sessions,people` on
  `GET /api/e/<slug>/export.json` (absent means everything). A part left out
  is absent from the file, not empty. The file imports back as a new event
  through **Import a schedule** — see
  [schedule-import.md §Importing an export](schedule-import.md#importing-an-export).
- **Back up the whole instance** — the entire database, AES-256-GCM under a
  passphrase typed at download time, gated by the instance password. Open
  one with `npm run decrypt-backup -- backup.lsbk restored.db` on the
  server; the framing is ours, so `openssl` alone will not do it. **Treat
  the file as a credential**: it carries every identity token in clear and
  the hashes of every device and speaker code, so whoever holds it can
  become anyone here.

Neither replaces a scheduled backup on the host, which is the one that
runs when nobody remembers to click anything. `VACUUM INTO` is safe
against a live WAL database:

```sh
sqlite3 "$DATABASE_PATH" "VACUUM INTO '/backups/app-$(date +%F).db'"
```

`deploy/backup.sh` wraps that with 14-day retention — run it nightly from
cron:

```
0 3 * * *  /srv/libresesh/deploy/backup.sh >> /var/log/libresesh-backup.log 2>&1
```

For continuous replication instead of nightly snapshots, add
[Litestream](https://litestream.io) — one extra binary streaming the WAL to
S3-compatible storage, no code changes.

## The cookie secret, and rotating it

`COOKIE_SECRET` is set once and kept. It signs the identity cookie, so it
is the one variable whose *change* costs more than its absence:

- **Changing it signs out every visitor at once** — their cookies stop
  verifying and they come back as strangers.
- **Worse, their names do not come back with them.** A display name is
  held, uniquely per event, by the identity that claimed it. After a
  rotation people are told "someone at this event is already called Ada",
  which is true and useless: the someone is their own former self. The gate
  offers "Enter as *Ada 2*", and an organiser can free the originals with
  `sqlite3 "$DATABASE_PATH" "DELETE FROM event_identities WHERE event_id = <id>;"`,
  which is a blunt instrument — it frees every name in that event.

Leaking it is the milder half. On its own a leaked secret buys almost
nothing: a forged signature still has to carry a token that exists in
`identities`, and those are 22 random characters. It matters **in
combination** with a copy of the database, where the tokens live — so keep
the secret out of the volume that holds the database and its backups. That
is why production takes it from the environment rather than a file: the
dev fallback deliberately puts both halves in one place,