# Spec: "OpenGrid" — a lightweight (un)conference scheduler

Version: 1.0 (draft for implementation)
Target: executable by an AI coding agent (e.g. Claude Opus) in a fresh local repository.
Inspiration: pretalx, radically simplified.

---

## 1. Overview

A single-server web app for scheduling conference and unconference sessions.
Attendees view a live schedule, contribute notes/links/questions to sessions,
and add their own sessions to open tracks. Organizers manage rooms, tags, and
official sessions in a drag-and-drop calendar. All changes propagate to open
clients in near-realtime.

Design pillars:

1. **No accounts.** Identity = anonymous browser cookie with a renamable
   display name. Rights = shared per-event passwords (viewer / user / admin).
2. **One process, one file DB.** Node + SQLite + SSE. Trivial to deploy and
   back up on a small VPS.
3. **Mobile-first, clean, fast.** Schedule readable on a phone in a hallway.

### Non-goals for v1

- No email, no personal accounts, no OAuth.
- No offline editing / CRDT sync. Server is the source of truth;
  last-write-wins with an optimistic-concurrency warning on stale edits.
- No call-for-papers/review workflow (pretalx's core) — sessions are entered
  directly.
- No file uploads. Links only.
- No i18n in v1 (English UI; content is free text).

---

## 2. Tech stack (fixed decisions)

- **Runtime:** Node.js >= 20, TypeScript everywhere.
- **Server:** Express (or Hono if preferred — pick one and stay consistent),
  `better-sqlite3` (synchronous, WAL mode), no ORM. Plain SQL in a small
  `db.ts` layer with typed row mappers.
- **Realtime:** Server-Sent Events (SSE), one stream per event. No WebSockets.
- **Frontend:** Vite + React 18 + TypeScript + Tailwind CSS. No heavy UI kit;
  small hand-rolled components. React Router for routing.
- **Auth/session:** signed httpOnly cookie holding a random identity token.
  Password hashing with `bcrypt` (cost 10 is fine at this scale).
- **Rate limiting:** in-memory token buckets keyed by identity token AND by IP
  (both must pass). No Redis.
- **Build/deploy:** `npm run build` produces frontend static files served by
  the Node process. Single systemd unit behind Caddy (HTTPS) on a VPS.
- **Tests:** Vitest. Unit tests for auth, permissions, overlap validation,
  rate limiter; a handful of API integration tests against a temp DB.

Repository layout:

```
/server        Express app, db, sse, auth, rate limiting
  /migrations  numbered .sql files, applied at boot
/web           Vite React app
/scripts       seed.ts, create-event.ts
/deploy        Dockerfile, docker-compose.yml, Caddyfile, systemd unit
/design        mockup.jsx (approved UI reference — see §7.7), never imported
SPEC.md        this file
```

---

## 3. Identity, roles, auth

### 3.1 Identity (who you are)

- First request: server sets signed httpOnly cookie `cid` = 22-char random
  token (base62). Row created in `identities` with display name
  `anon_<5 random lowercase alphanumerics>` (e.g. `anon_x7k2f`).
- `PATCH /api/me { displayName }` renames (1–40 chars, trimmed, not only
  whitespace). Rename allowed for any role including viewer.
- Identity is **global across events**; roles are **per event**.
- `GET /api/me` → `{ id, displayName, roles: { [eventSlug]: role } }`.

### 3.2 Roles (what you may do)

Per event, three shared passwords stored as bcrypt hashes on the event row.

| Capability                                                     | viewer | user | admin |
| -------------------------------------------------------------- | ------ | ---- | ----- |
| View schedule, sessions, contributions                         | ✓      | ✓    | ✓     |
| Rename own identity                                            | ✓      | ✓    | ✓     |
| Add notes / links / questions                                  |        | ✓    | ✓     |
| Delete own contributions                                       |        | ✓    | ✓     |
| Create sessions in open-track rooms (type `open`)              |        | ✓    | ✓     |
| Edit/move/delete **own** open sessions                         |        | ✓    | ✓     |
| CRUD any session (incl. `official`), drag anywhere             |        |      | ✓     |
| CRUD rooms, tags                                               |        |      | ✓     |
| Hide/delete any contribution                                   |        |      | ✓     |
| Change the three event passwords, edit event settings, archive |        |      | ✓     |

- `POST /api/e/:slug/auth { password }` → server checks against the three
  hashes in order admin, user, viewer; on match, upserts
  `roles(identity_id, event_id, role)` and returns `{ role }`. Failure → 403.
  Rate limited hard (see §8).
- `POST /api/e/:slug/logout` deletes the role row (identity keeps its name).
- **Viewing requires the viewer password** (an event's schedule is not
  public). The event landing page is a password prompt until a role exists.
- Entering a higher password upgrades the stored role; entering a lower one
  downgrades (explicit, simple).

### 3.3 Instance admin (who creates events)

- Env var `INSTANCE_ADMIN_PASSWORD` gates `POST /api/events` (create) and the
  `/new` page. Creating an event requires: name, slug (unique,
  `[a-z0-9-]{3,40}`), timezone (IANA), start date, end date, and the three
  role passwords (min 6 chars each).
- **Clone:** `POST /api/events/:slug/clone { newSlug, newName, dates }`
  copies rooms and tags (never sessions/contributions), prompts for fresh
  passwords. Available to that event's admin + instance password.
- **Archive:** boolean on event; archived events are read-only for everyone
  (all writes 409), still viewable with viewer password.

---

## 4. Data model (SQLite)

All timestamps stored as UTC ISO-8601 strings. All user-visible times are
rendered in the event's timezone. Soft deletes via `deleted_at`.

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,             -- IANA, e.g. 'Europe/Berlin'
  start_date TEXT NOT NULL,           -- 'YYYY-MM-DD'
  end_date TEXT NOT NULL,
  day_start_min INTEGER NOT NULL DEFAULT 480,   -- calendar viewport, 08:00
  day_end_min INTEGER NOT NULL DEFAULT 1320,    -- 22:00
  viewer_pw_hash TEXT NOT NULL,
  user_pw_hash TEXT NOT NULL,
  admin_pw_hash TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE identities (
  id INTEGER PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,         -- value inside signed cookie
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE roles (
  identity_id INTEGER NOT NULL REFERENCES identities(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  role TEXT NOT NULL CHECK (role IN ('viewer','user','admin')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (identity_id, event_id)
);

CREATE TABLE rooms (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  capacity INTEGER,
  open_track INTEGER NOT NULL DEFAULT 0,  -- users may schedule here
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280', -- hex, used for chips/blocks
  deleted_at TEXT,
  UNIQUE (event_id, name)
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  type TEXT NOT NULL CHECK (type IN ('official','open')),
  title TEXT NOT NULL,                -- 1..120 chars
  description TEXT NOT NULL DEFAULT '',  -- markdown, <= 5000 chars
  speaker TEXT NOT NULL DEFAULT '',   -- free text, <= 120 chars
  starts_at TEXT NOT NULL,            -- UTC ISO, minute % 5 == 0 (event TZ)
  ends_at TEXT NOT NULL,              -- > starts_at, duration >= 5 min
  created_by INTEGER NOT NULL REFERENCES identities(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_sessions_event_time ON sessions(event_id, starts_at);

CREATE TABLE session_tags (
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  tag_id INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (session_id, tag_id)
);

CREATE TABLE contributions (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK (kind IN ('note','link','question')),
  body TEXT NOT NULL,                 -- 1..2000 chars; for links: label
  url TEXT,                           -- required iff kind='link'; http(s) only
  created_by INTEGER NOT NULL REFERENCES identities(id),
  created_at TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,  -- admin moderation
  deleted_at TEXT
);
```

Migrations: numbered SQL files applied in order at boot, tracked in a
`migrations` table.

---

## 5. HTTP API

All endpoints JSON, prefixed `/api`. Middleware order: cookie/identity →
rate limit → role check → handler. Errors:
`{ error: { code, message } }` with proper status (400 validation,
401 no viewer role, 403 insufficient role, 404, 409 conflict/stale/archived,
429 rate limited).

Every mutating response includes the fresh entity (with `updatedAt`).
Session/room/tag payloads include creator display names resolved server-side.

```
GET    /api/me                          -> identity + roles
PATCH  /api/me                          -> rename

POST   /api/events                      (instance password header X-Instance-Key)
POST   /api/events/:slug/clone          (event admin or instance key)
GET    /api/events                      -> public list: slug, name, dates (no schedule data)

POST   /api/e/:slug/auth                { password } -> { role }
POST   /api/e/:slug/logout

GET    /api/e/:slug/bundle              (viewer+) -> { event, rooms, tags, sessions, contributionsCounts }
GET    /api/e/:slug/sessions/:id        (viewer+) -> session + contributions (visible ones)

POST   /api/e/:slug/rooms               (admin)
PATCH  /api/e/:slug/rooms/:id           (admin)
DELETE /api/e/:slug/rooms/:id           (admin; 409 if it has non-deleted sessions)

POST   /api/e/:slug/tags                (admin)
PATCH  /api/e/:slug/tags/:id            (admin)
DELETE /api/e/:slug/tags/:id            (admin; removes session_tags rows)

POST   /api/e/:slug/sessions            (user+ ; see permission matrix)
PATCH  /api/e/:slug/sessions/:id        (owner-or-admin; body may include expectedUpdatedAt)
DELETE /api/e/:slug/sessions/:id        (owner-or-admin; soft delete)

POST   /api/e/:slug/sessions/:id/contributions   (user+)
DELETE /api/e/:slug/contributions/:id            (owner-or-admin; soft delete)
PATCH  /api/e/:slug/contributions/:id/hidden     (admin) { hidden: bool }

PATCH  /api/e/:slug/settings            (admin) name, dates, viewport, passwords, archived
GET    /api/e/:slug/stream              (viewer+) SSE
```

### 5.1 Session write rules (server-enforced)

- `user` role: may only create `type='open'` sessions, only in rooms with
  `open_track=1`, only within the event's date range and day viewport.
  May PATCH/DELETE only sessions where `created_by = self` and
  `type='open'`; moving them is restricted to open-track rooms.
- `admin`: anything, any type, any room.
- Times must snap to 5 minutes in the event timezone; duration 5–480 min.
- **Overlap policy:** for `user` writes, reject with 409 if the session would
  overlap a non-deleted session in the same room. For `admin` writes, allow
  overlaps (client shows a warning badge on overlapping blocks).
- **Stale edit protection:** if `expectedUpdatedAt` is sent and doesn't match
  the row, return 409 `{ code: 'stale' }`; client offers "overwrite / reload".

---

## 6. Realtime (SSE)

- `GET /api/e/:slug/stream` requires viewer+. Standard SSE with
  `retry: 3000` and a `: ping` comment every 25s.
- Event format: `event: change`, `data: { type, entity }` where `type` ∈
  `session.created|updated|deleted`, `contribution.created|deleted|hidden`,
  `room.*`, `tag.*`, `event.updated`. Payload carries the full fresh entity
  (or `{ id }` for deletes).
- Client keeps the bundle in memory and applies patches by id; on SSE
  reconnect it refetches the bundle (cheap; whole event fits in one JSON).
- Broadcasting: in-process pub/sub (a Map of slug → Set of open responses).
  Single process, so no external broker needed.

---

## 7. Frontend

### 7.1 Routes

```
/                      Event list (name, dates) + "enter" -> password gate
/new                   Create event (instance password)
/e/:slug               Schedule (calendar view; ?day= &view=cal|list &room= &tag= &q=)
/e/:slug/s/:id         Session detail (deep-linkable; renders as sheet over schedule)
/e/:slug/admin         Rooms, tags, passwords, event settings (admin)
```

Filters live in the query string so filtered views are shareable.

### 7.2 Schedule views

**Calendar (default on ≥ small screens, available on mobile):**

- Day tabs (one per event day). Time gutter on the left; room columns
  side-by-side, horizontally scrollable on mobile with sticky room headers
  and sticky time gutter.
- Vertical scale: 1 minute = 1.6 px (≈ 48px per half hour); blocks snap to
  5-minute grid. Session block shows title, speaker, time range, tag color
  strip; `open` sessions get a dashed border + "open" chip to distinguish
  from official ones.
- **Now line:** a horizontal marker across all columns at the current time
  (only when viewing today's tab), updating every 30s. A floating **"Now"**
  button (visible when now is off-screen or another day is selected) switches
  to today and scrolls the line to center.
- **Drag (admin, and owners of open sessions):** pointer-based drag moves a
  block vertically (time, 5-min snap) and horizontally (room). Drag handle =
  whole block after a 250ms hold on touch; immediate on mouse. Bottom-edge
  drag resizes duration. On drop → PATCH; on 409 → snap back + toast.
  Everyone else: blocks are tap-to-open only.
- Overlapping sessions in one room render side-by-side at half width.

**List (default on mobile):**

- Chronological agenda for the selected day, grouped by start time; each row:
  time, title, room, speaker, tag chips, contribution count. "Now" scrolls to
  the current time group and highlights in-progress sessions.

### 7.3 Filters

Chip bar above the schedule: room multi-select, tag multi-select, free-text
search (matches title + speaker + description), and a "happening now/next"
quick filter. Filters combine with AND (multi-selects OR within themselves).
Active filters dim non-matching blocks in calendar view and hide non-matching
rows in list view. "Clear all" chip when any filter active.

### 7.4 Session detail (bottom sheet on mobile, side panel on desktop)

- Header: title, official/open badge, time (event TZ), room, speaker, tags.
- Description rendered as sanitized markdown (links open in new tab,
  `rel="noopener noreferrer"`; strip raw HTML).
- Contributions grouped by kind: Questions, Notes, Links — each item shows
  author display name + relative time; delete button on own items (admin: on
  all, plus hide toggle).
- Add form (user+): kind selector, text area, URL field when kind=link.
- Edit / move / delete buttons when permitted (owner-or-admin rules).

### 7.5 Identity & role UI

- Persistent header chip: display name + role badge for current event.
  Tapping opens a small panel: rename field, current role, password input to
  change role, sign out of event.
- First visit to an event: full-screen password gate ("This schedule needs
  the event password") with the rename field tucked below.

### 7.6 Look & feel

Clean, quiet, "Claude-app-like": generous whitespace, one accent color used
sparingly (now-line, primary buttons), tag colors as thin strips/chips rather
than full-block fills, system font stack or Inter, rounded-lg cards, subtle
borders instead of shadows, dark-mode friendly tokens (dark mode itself is a
stretch goal). Mobile-first: every screen must work at 360px wide. Respect
`prefers-reduced-motion`. Focus rings visible.

### 7.7 Design reference: `_planning/design/mockup.jsx`

`_planning/design/mockup.jsx` is a static, clickable mockup **approved by the owner**.
Treat it as the authoritative visual and interaction reference. Replicate:

- Layout and component breakdown: sticky header (event identity, name/role
  chip), toolbar (day tabs, Grid/List toggle, Now button, Arrange toggle,
  Add session), horizontally scrolling filter chip bar, calendar grid with
  time gutter + room columns, list view grouped by start time, bottom-sheet
  detail (side panel on ≥ sm screens), modals for session edit and
  identity/role.
- Visual language: stone/neutral Tailwind palette on `stone-100` background,
  white cards with `border-stone-200` and small shadows, rounded-lg/xl,
  highlighter yellow `#FFD84D` reserved for the now-line, the Now button and
  "now" badges; open sessions distinguished by dashed emerald borders +
  emerald "open" chips and a tinted open-track column; tag colors as thin
  strips on calendar blocks and filled chips elsewhere; dark ink
  (`stone-900`) primary buttons.
- Copy tone: plain, sentence case, instructional ("This schedule needs the
  event password", "Post as anon_x7k2f", "Drag sessions you may edit ·
  snaps to 5 min").

Do **NOT** copy from the mockup: its hardcoded `ROOMS`/`TAGS`/session
constants, client-side password map, single-component `useState` data layer,
fixed column-width drag math, or missing persistence/routing. Those are
mockup shortcuts superseded by §3–§7. **Where the mockup and this spec
conflict, the spec wins** (e.g. the spec requires touch-hold drag start,
resize handles, PATCH-on-drop with 409 snap-back, deep-linkable session
routes, and filters in the URL — none of which the mockup implements).

---

## 8. Rate limiting & abuse controls

In-memory token buckets, keyed by identity token and by IP (a request must
pass both). Buckets: capacity/refill per minute unless noted.

| Scope                                  | Limit                                          |
| -------------------------------------- | ---------------------------------------------- |
| `POST /auth` (per identity AND per IP) | 5 attempts / 15 min, then 429 with Retry-After |
| Writes: contributions                  | 10 / min                                       |
| Writes: sessions (create+edit)         | 12 / min (drag emits at most 1 PATCH per drop) |
| Writes: everything else                | 30 / min                                       |
| Reads                                  | 300 / min                                      |

Additional controls: max lengths enforced server-side (see schema), URL
scheme allowlist (`http`, `https`), soft deletes everywhere so an admin can
undo vandalism, `hidden` flag for contributions, archived events read-only.
Log all writes with identity id to an append-only `audit` table
(id, identity_id, event_id, action, entity, entity_id, at) for post-hoc
cleanup.

---

## 9. Seed & scripts

- `scripts/create-event.ts` — interactive CLI: creates an event + passwords.
- `scripts/seed.ts` — creates a demo event "DemoConf 2026" (2 days, 4 rooms,
  one flagged open-track, 6 tags, ~25 official sessions, ~6 open sessions,
  ~30 contributions across several identities). Used by tests and for local
  dev (`npm run seed`).

---

## 10. Deployment & operations

### 10.1 Architecture

```
Caddy (:443, automatic HTTPS via Let's Encrypt)
  └── reverse_proxy localhost:3000
        └── Node process (API + SSE + serves web/dist)
              └── $DATABASE_PATH (single SQLite file, WAL mode)
```

SQLite runs **inside** the Node process (`better-sqlite3` is a native
addon); there is no separate database server, port, or connection string.
Exactly one app process owns the DB file — never run two instances against
the same file. `-wal`/`-shm` sidecar files next to the DB are normal.

### 10.2 Sizing

A 1 vCPU / 1 GB RAM VPS is sufficient with large headroom (hundreds of
concurrent SSE clients are idle sockets; write volume at a conference is a
few requests/second at peak). Enable swap as a safety net; keep a few GB of
free disk.

### 10.3 Build & config

- `npm run build` → frontend static files in `web/dist`, served by Express
  with cache headers and SPA fallback to `index.html`; server TS compiled to
  `server/dist`.
- Env: `PORT`, `DATABASE_PATH`, `COOKIE_SECRET`, `INSTANCE_ADMIN_PASSWORD`,
  `TRUST_PROXY=1` (behind Caddy; use `X-Forwarded-For` for IP rate limits).

### 10.4 Two supported run modes (implement files for both)

**A. systemd-native:** `deploy/opengrid.service` (`Restart=always`,
`WorkingDirectory`, env file) + Caddy installed from its package.

**B. Docker Compose (also the local prod-simulation):**
`deploy/Dockerfile` — multi-stage build on `node:20-slim` (Debian base, NOT
Alpine: better-sqlite3 ships glibc prebuilds; musl forces a native compile).
`deploy/docker-compose.yml` — two services: `app` (volume `./data:/data`,
`DATABASE_PATH=/data/app.db`) and `caddy` (ports 80/443, mounts Caddyfile +
cert volumes). The DB must live on a mounted volume so it survives rebuilds.
Compose file must work locally with `docker compose up` and unchanged on the
VPS apart from the domain in the Caddyfile.

Local day-to-day development stays outside Docker: `npm run dev` runs the
API with the Vite dev server proxying `/api`.

### 10.5 Caddy & SSE

`deploy/Caddyfile`: reverse proxy with automatic HTTPS; no special SSE
config needed, but keep proxy idle/read timeouts above the 25s heartbeat
(e.g. ≥ 120s) so streams aren't cut.

### 10.6 Backups

- README documents a nightly cron:
  `sqlite3 $DATABASE_PATH "VACUUM INTO '/backups/app-$(date +%F).db'"`
  (safe against a live WAL database), plus retention (e.g. keep 14).
- README also notes Litestream as an optional continuous-replication
  upgrade (single extra binary streaming the WAL to S3-compatible storage;
  no code changes).

---

## 11. Milestones & acceptance criteria

Implement in order; each milestone ends with passing tests + a manual check.

**M1 — Scaffold & DB.** Repo layout, TS configs, migrations runner, schema,
seed script. ✓ `npm run seed && npm run dev` boots server + web.

**M2 — Identity & auth.** Cookie identity, rename, per-event auth, role
middleware, auth rate limit. ✓ Unit tests: role matrix, wrong password 403,
6th attempt 429.

**M3 — Rooms, tags, sessions CRUD (API).** Validation, permission rules,
overlap policy, stale-edit 409, soft deletes. ✓ Integration tests cover the
permission matrix in §3.2 and §5.1.

**M4 — Bundle + SSE.** Bundle endpoint, stream, broadcast on every write.
✓ Two browser tabs: edit in one appears in the other < 1s.

**M5 — Schedule UI.** Calendar + list views, day tabs, now line, "Now"
button, session blocks, deep-linked detail sheet. ✓ Works at 360px width.

**M6 — Contributions UI.** Detail sheet forms, grouped display, delete/hide.

**M7 — Editing UI.** Create/edit modals (admin + open-track users), drag to
move/resize with snapping, conflict toasts, event admin page (rooms, tags,
passwords, archive), event create/clone pages.

**M8 — Filters & polish.** Filter chips wired to URL, search, empty states,
error toasts, reduced-motion, keyboard focus pass, remaining rate limits,
audit log.

**M9 — Deploy.** Production build serving, Caddyfile + systemd examples,
README with VPS runbook and backup cron.

---

## 12. Deferred (explicitly out of v1, don't build)

Dark mode toggle, iCal export, personal "my agenda" starring, session voting,
QR codes per room, email anything, multi-language, image uploads, WebSocket
upgrade, per-user accounts.
