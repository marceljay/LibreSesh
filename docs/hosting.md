# Hosting LibreSesh on a VPS

Written for someone comfortable with SSH who does not want to become a
sysadmin. It covers the part that comes *before* and *around* a deploy:
choosing and sizing a box, preparing it, hardening it, backing it up and
running it day to day. Everything assumes the Docker Compose path, because
this repo ships the whole production stack in [`deploy/`](../deploy/) — you
install nothing on the server except Docker.

For the reference side — every environment variable, the Compose file itself,
Railway, systemd, and rotating the cookie secret — see
[deploy.md](deploy.md). Where the two overlap, deploy.md is the source of
truth for *what the settings are*; this guide is opinionated about *which
ones to pick and why*.

Last updated: 2026-09-07

---

## 1. What we are actually hosting

```
Caddy (:80, :443, automatic HTTPS)
  └── reverse_proxy app:3000
        └── one Node process (API + SSE + web/dist)
              └── one SQLite file on local disk (WAL mode)
```

Three consequences that drive every decision on this page:

- **There is no database server.** SQLite runs inside the Node process. No port,
  no connection string, no managed-database add-on to buy.
- **Exactly one process may own the DB file.** Never scale the `app` service past
  one replica, and never run two deployments against the same file.
- **The load is idle sockets, not CPU.** Hundreds of concurrent SSE streams are
  cheap; peak write volume at a real conference is a few requests per second.

---

## 2. VPS sizing

### The runtime is tiny; the *build* sets the spec

Running the app needs very little — the README's "1 vCPU / 1 GB is plenty" is
honest. What needs headroom is `docker compose up --build`, which runs
`npm ci`, two `tsc` passes, a Vite build, and possibly a native compile of
`better-sqlite3`. **That will OOM on a 1 GB box.**

So either:

- **Build on the server** (simplest, recommended) → want **2 GB minimum, 4 GB comfortable**, or
- **Build elsewhere** (CI → container registry, or build locally and rsync) → 1 GB is genuinely fine.

Given the price difference is a couple of euros a month, take the headroom and
stop thinking about it.

### Recommended

| Provider | Plan | Spec | ~Price/mo |
| --- | --- | --- | --- |
| **Hetzner** ← best value | CX22 (x86) or CAX11 (ARM) | 2 vCPU / 4 GB / 40 GB | ~€4 |
| Netcup / OVH | entry VPS | 2 vCPU / 4 GB | €3–6 |
| DigitalOcean | Basic Droplet | 1 vCPU / 2 GB / 50 GB | ~$12 |
| Vultr / Linode | equivalent tier | 1 vCPU / 2 GB | ~$12 |

**Pick: Hetzner CX22.** Cheapest per unit of compute, and the 4 GB means the
on-box build never gives trouble — which is the one place a
hosting-unfamiliar failure could realistically bite.

DigitalOcean is ~3× the price for less machine. That buys a nicer panel, Spaces
object storage in the same account, and an ecosystem you may already know. A
defensible trade if you are already there; otherwise Hetzner.

*(Prices are approximate as of 2026 — check current listings.)*

**Do not** take the €2–3 / 512 MB–1 GB tiers. They cannot build, and swap-thrashing
a build for 20 minutes is a worse experience than paying €2 more.

### Non-negotiables when choosing

- **Local NVMe/SSD, not network block storage.** SQLite's WAL needs real local
  `fsync`. Do not put `DATABASE_PATH` on an attached network volume
  (DO Block Storage, Hetzner Volumes, NFS).
- **KVM virtualisation**, not OpenVZ/LXC — you want a real kernel for Docker.
- **Not a platform with ephemeral disk or autoscaling.** Fly / Railway /
  Render-style multi-instance hosting breaks the one-process-owns-the-file rule.
  A boring VPS is the correct tool here.
- **Region near the venue.** Sub-second SSE propagation is a design pillar; an
  EU conference wants an EU box (also the easy GDPR answer).
- **Ubuntu 24.04 LTS or Debian 12**, matching the `node:22-bookworm-slim` base so
  `better-sqlite3`'s prebuilt binaries apply. ARM (Ampere/Graviton) is fine —
  arm64 prebuilds exist.
- **Disk: 20–40 GB.** The DB is megabytes, but Docker images and layers are
  1–2 GB, and `backup.sh` keeps 14 daily snapshots.

---

## 3. Before you touch the server

1. **Generate an SSH key** if you do not have one (`ssh-keygen -t ed25519`) and
   paste the *public* key into the provider's create-server form. Both Hetzner
   and DO then disable password login automatically — this is the single
   biggest security win, and it is free.
2. **Point DNS at the server.** Create an `A` record for e.g.
   `schedule.example.org` → the server's IPv4. Do this *first*: Caddy requests
   the TLS certificate on first boot and needs the name to already resolve.
3. **Generate the two secrets** locally and keep them somewhere safe:

   ```sh
   openssl rand -hex 32   # COOKIE_SECRET
   openssl rand -hex 24   # INSTANCE_ADMIN_PASSWORD
   ```

---

## 4. Deploy

Create the server with the **Docker** app/marketplace image (Ubuntu 24.04 with
Docker preinstalled). Then:

```sh
ssh root@<server-ip>

git clone <your-repo-url> /srv/libresesh
cd /srv/libresesh/deploy

cp libresesh.env.example .env
nano .env
```

In `.env`, only three values matter for the Compose path:

```ini
COOKIE_SECRET=<the openssl output>
INSTANCE_ADMIN_PASSWORD=<the other openssl output>
SITE_ADDRESS=https://schedule.example.org
```

`PORT`, `DATABASE_PATH`, `SERVE_STATIC`, `TRUST_PROXY` and `NODE_ENV` are set by
`docker-compose.yml` itself — the values in `.env` for those are only used by the
systemd path, and are ignored here. `SITE_ADDRESS` **must** be the real
`https://` domain or Caddy will not request a certificate.

Then:

```sh
docker compose up -d --build
```

First build takes several minutes. Watch it with `docker compose logs -f`.

Open `https://schedule.example.org` — Caddy will have obtained a Let's Encrypt
certificate automatically. Then visit `/new` and use `INSTANCE_ADMIN_PASSWORD` to
create the real event, which is where you set its viewer / user / admin
passwords.

> **Never reuse the demo passwords** (`viewer2026` / `user2026` / `admin2026`)
> for a real event. Access control in LibreSesh is entirely shared per-event
> passwords — those passwords *are* the security model.

The database lives at `/srv/libresesh/deploy/data/app.db` on the host, bind-mounted
to `/data` in the container, so it survives image rebuilds.

---

## 5. Hardening — the short honest list

Three things. None require learning `iptables`.

1. **SSH keys only.** Done at create time (§3). Confirm you can log in with the
   key, and confirm `PasswordAuthentication no` in `/etc/ssh/sshd_config`.
2. **Use the provider's cloud firewall, not `ufw`.** Allow **22, 80, 443** and
   nothing else. Port 3000 stays internal. Use the *cloud* firewall specifically
   because Docker writes its own iptables rules and will happily punch straight
   through `ufw` — a classic surprise. The provider firewall sits outside the
   machine and cannot be bypassed this way.
3. **Automatic security updates.** Already on by default on Ubuntu 24.04; verify
   with `systemctl status unattended-upgrades`. Install with
   `apt install unattended-upgrades` if missing.

**Skip fail2ban.** With password auth off it defends against nothing.

What actually matters more than OS hardening for this app: strong `COOKIE_SECRET`
and `INSTANCE_ADMIN_PASSWORD`, and not sharing the admin event password more
widely than the people who need it.

---

## 6. Backups

`deploy/backup.sh` uses `VACUUM INTO`, which is safe against a live WAL database.
A provider snapshot of a running SQLite file is **not** a reliable backup — use
this instead.

The script runs on the **host**, against the bind-mounted DB path, so install the
SQLite CLI once (the container does not ship it):

```sh
apt install -y sqlite3
```

Add to root's crontab (`crontab -e`) — note `DATABASE_PATH` is overridden to the
Compose bind-mount location, since the script's default is the systemd path:

```cron
0 3 * * *  DATABASE_PATH=/srv/libresesh/deploy/data/app.db BACKUP_DIR=/srv/libresesh/backups /srv/libresesh/deploy/backup.sh >> /var/log/libresesh-backup.log 2>&1
```

It keeps 14 days and prunes older files.

**Get a copy off the box.** A backup on the same disk as the thing it backs up is
not a backup. Simplest options:

- `rsync` the `backups/` dir to your laptop after each conference day, or
- push to S3-compatible object storage (Hetzner Object Storage, DO Spaces), or
- add [Litestream](https://litestream.io) for continuous WAL replication — one
  extra binary, no code changes.

Before a real event, **test a restore once**: copy a `.db` snapshot somewhere,
point a local instance at it, confirm the schedule loads.

**From the browser, when there is no shell.** Manage Event → Backup offers a
per-event JSON export (safe to share — no secrets in it) and an encrypted copy
of the whole database, gated by `INSTANCE_ADMIN_PASSWORD` plus a passphrase
typed at download time. Open the latter with
`npm run decrypt-backup -- backup.lsbk restored.db` on a machine with the repo.
That file carries live identity tokens and code hashes, so it belongs wherever
you keep the instance password — not in a shared drive. It is a supplement to
the cron job above, not a replacement: it only exists when someone clicks.

---

## 7. Day-2 operations

```sh
cd /srv/libresesh/deploy

docker compose logs -f app          # tail app logs
docker compose ps                   # health status (there is a HEALTHCHECK)
docker compose restart app          # restart just the app
docker compose down && docker compose up -d --build   # deploy new code
docker compose pull && docker compose up -d           # update the Caddy image
```

To deploy an update: `git pull` in `/srv/libresesh`, then rebuild as above.
Expect a few seconds of downtime — fine for this app, but avoid doing it in the
middle of a session changeover.

**Disk check before an event:** `df -h` and `docker system prune -f` if image
layers have accumulated.

---

## 8. Gotchas specific to this app

- **Never run two app processes against one DB file.** No `--scale`, no second
  compose stack pointed at the same `data/` dir. SQLite will not save you.
- **SSE needs long proxy timeouts.** Already handled — `deploy/Caddyfile` sets
  `read_timeout`/`write_timeout` to 300s and `flush_interval -1`, well above the
  25s heartbeat. If you ever swap Caddy for nginx, you must replicate both, plus
  `proxy_buffering off`, or streams get cut and the live schedule silently stops
  updating.
- **File descriptor limits, systemd path only.** `deploy/libresesh.service` sets
  no `LimitNOFILE`, so systemd's 1024 soft limit caps you near ~1000 concurrent
  SSE streams. Add `LimitNOFILE=65535` under `[Service]` if you go that route.
  Docker's default (1048576) is already fine, so the Compose path is unaffected.
- **Add 1–2 GB of swap** as a safety net, especially on a 2 GB box that builds:

  ```sh
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ```

- **Changing `COOKIE_SECRET` logs every attendee out**, and leaves their display
  names held by the identities they just lost, so they cannot even re-enter as
  themselves. Set it once, never rotate it mid-event. Store it in the
  environment file only — not on the volume with the database, which is where
  the identity tokens this secret signs actually live. On its own a leaked
  secret is close to harmless; leaked *with* a copy of the database it turns
  those tokens into working cookies.
- **`TRUST_PROXY=1` is required behind Caddy** or rate limiting sees the proxy's
  IP for everyone and throttles the whole venue as one client. Compose sets it.

---

## 9. Alternative: systemd instead of Docker

Slightly leaner, meaningfully more setup — you install Node 22, build toolchain,
Caddy, and manage the unit yourself. Steps are in the README's *systemd* section.
Only worth it if you specifically do not want Docker on the box. If you take it,
remember the `LimitNOFILE` note in §8 and install Caddy from its own apt repo.

---

## 10. Alternative: Railway (or another PaaS)

Works, with one trap: **the repo's `.npmrc` sets `ignore-scripts=true`** (supply-chain
hardening). A PaaS that auto-detects a Node app runs a plain `npm ci`, which honours
that file, skips `better-sqlite3`'s `install` script, and so never downloads or builds
the native addon. The app then dies at boot with `Could not locate the bindings file`.
Nothing is wrong with the code, and nothing stale is in `node_modules` — the binding
was simply never produced.

Don't fix this with a buildpack override that runs `node-gyp` (`npm run rebuild:native`).
That compiles from source, needs python3/make/g++ in the builder, and is slower than it
needs to be. `deploy/Dockerfile` already solves this properly, so point the platform at
it instead. `railway.json` in the repo root does that:

```json
{
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "deploy/Dockerfile" }
}
```

The build context stays the repo root, so the Dockerfile's `COPY` paths work unchanged.

Then, in the platform dashboard:

- **Attach a volume mounted at `/data`.** Without it the SQLite file lives in the
  container's ephemeral layer and *every event is wiped on each redeploy*. This is the
  single most important step — see §1 and §6. It bit us for real on 2026-08-30: the
  volume was never attached, the app came up looking perfectly healthy, and a rebuild
  took the event with it. The server now refuses to boot in production when its
  database directory is not a mount point, so the same mistake fails loudly at deploy
  time instead of quietly at rebuild time. Confirm the volume is attached *before*
  putting anything real in — a `Refusing to start:` line in the deploy log means it
  is not.
- **Set the env vars.** `NODE_ENV=production` makes `COOKIE_SECRET` and
  `INSTANCE_ADMIN_PASSWORD` mandatory (`server/src/config.ts`); the app refuses to start
  without them. Set `TRUST_PROXY=1` — the platform terminates TLS in front of you, and
  without it rate limiting sees one client IP for everyone (§11).
- **Leave `PORT` alone.** The platform injects it and the app reads it; the Dockerfile's
  `ENV PORT=3000` is only a local default. The server already binds `0.0.0.0`.
- `DATABASE_PATH=/data/app.db` and `SERVE_STATIC=1` are set in the Dockerfile already.
- **The commit on the About page fills itself in.** The image is built without
  `.git`, and Railway forwards only the variables set on the service to the build,
  not its own `RAILWAY_GIT_COMMIT_SHA` — so the bundle cannot stamp itself. The
  server reads that variable from its runtime environment instead and the page
  takes it from there. Nothing to set. Optionally, a reference variable
  `BUILD_COMMIT=${{RAILWAY_GIT_COMMIT_SHA}}` on the service stamps the bundle at
  build time as well. On any other PaaS, set `BUILD_COMMIT` to whatever commit
  variable that platform injects.

No Caddy, no `SITE_ADDRESS` — the platform handles TLS and routing. Everything in §6
(backups) still applies and is now *more* urgent, since you no longer control the host:
run `deploy/backup.sh` against the volume on a schedule, and pull copies off-platform.

---

## 11. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| No HTTPS / cert errors | DNS not pointing at the box yet, or `SITE_ADDRESS` is not the real `https://` domain. Caddy retries — check `docker compose logs caddy`. |
| Build killed / exits ~137 | Out of memory. Add swap (§8) or use a bigger box. |
| Schedule stops updating live | SSE stream cut by a proxy timeout — check any proxy in front of Caddy (Cloudflare "proxied" mode can also buffer). |
| `Could not locate the bindings file` | `better-sqlite3` not built. In Docker this is handled; locally run `npm run rebuild:native`. On a PaaS it means the build bypassed `deploy/Dockerfile` and the repo `.npmrc` skipped the install script — see §10. |
| Rate limiting hits everyone at once | `TRUST_PROXY` not set. |
| DB looks reverted / writes vanish | Two processes on one DB file. Check for a stray container or systemd unit. |
