# Nostr Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an event's programme to Nostr as NIP-52 calendar events kept in sync with the database, plus kind-1 notes from the shared announcer, under a per-event signing key encrypted at rest.

**Architecture:** Every write that changes a session marks a row in a publish-queue table; a 10-second loop builds the current version of each dirty row, signs it with the event's key and publishes it to the event's relays, tracking acceptance per relay. Kind-1 notes are a transport of the announcer defined in `_planning/specs/announcements.md`. The signing key is stored AES-256-GCM encrypted under a key derived from an at-rest secret that defaults to `COOKIE_SECRET`.

**Tech Stack:** Node 22 (global `WebSocket`), Express, better-sqlite3, zod, vitest + supertest, React; `nostr-tools` 2.x (`nostr-tools/pure`, `nostr-tools/pool`, `nostr-tools/nip19`).

**Spec:** `_planning/specs/nostr-publishing.md` (commit ae7f6c0). Where this plan and the spec disagree, the spec wins; fix the plan.

**Tickets:** LIB-214 (announcer), LIB-215 (keys and schema), LIB-216 (calendar sync), LIB-217 (notes), LIB-218 (Publish tab), LIB-219 (forms and badge), LIB-220 (manual verification), LIB-221 (D6, default relays). One task group per ticket below. Each ticket is one branch off `dev`, one PR, atomic commits inside it.

## Global Constraints

- Migration file: next free number in `server/migrations/` (`022_session_drafts.sql` is the latest on `dev`; the Telegram branch takes the one after it). One migration for the whole feature.
- Blob format for encrypted columns: `v1.<keyid>.<base64>`; `keyid` = first eight hex digits of SHA-256 of the secret; HKDF-SHA256 info string `libresesh/<purpose>/v1`; AES-256-GCM; 12-byte nonce; nonce, ciphertext and tag concatenated in that order.
- Purpose string for the Nostr key: `nostr-seckey`.
- `d` tag for a session: `e<eventId>-s<sessionId>`. Calendar `d`: `programme`.
- Default triggers: `["placed","up_next","digest"]`. Relay URLs: `wss://` only in production (`ws://` allowed otherwise), at most 10 per event.
- Debounce: publish a dirty row when `touched_at` is at least 15 s old or `dirty_since` at least 60 s old. Backoff: `next_try = now + min(60 s · 2^tries, 1 h)`.
- `PUBLIC_URL` unset: no site links anywhere in published data.
- Never in any response, export, import, clone or log: `nostr_seckey`, `nostr_pubkey` (hex is fine as `npub` on the status route only). `nostr_enabled`, `nostr_relays`, `nostr_triggers` do not travel in exports either.
- Copy rules: no coined names, never the word "watermark"; every user-facing string in the spec is used verbatim.
- Commit messages: 50/72, conventional prefix, body opens with its own sentence; no session links.
- Run lint (`npm run lint`) and the suite (`npm test`) one at a time, never in parallel.
- UI work gets a headless-Chromium pass before commit (see memory: jsdom alone shipped broken forms).

## File Structure

| File | Responsibility |
| --- | --- |
| `server/src/secretsAtRest.ts` | `encryptAtRest`, `decryptAtRest`, `needsReencrypt`, `rotateAtRest`. No Nostr knowledge. |
| `server/src/config.ts` | `atRestSecret`, `atRestSecretPrevious`, `publicUrl`, `nostrDefaultRelays`. |
| `server/migrations/0NN_nostr.sql` | Event, session and proposal columns; `nostr_published`. |
| `server/src/nostr/keys.ts` | Key generation, `nsec`/`npub` encoding, `openEventKey`. |
| `server/src/nostr/build.ts` | Pure builders: session → 31923, event → 31924 and kind 0, deletion → kind 5, `naddr`. |
| `server/src/nostr/queue.ts` | `markDirty`, `syncTick`, `sweep`, `startNostrSync`, the `Pool` interface. |
| `server/src/nostr/notes.ts` | The announcer transport and the note renderer. |
| `server/src/routes/nostr.ts` | `/e/:slug/nostr/*` routes. |
| `server/src/validation.ts` | zod schemas for the new bodies (they feed `/openapi.json`). |
| `web/src/pages/AdminPublish.tsx` | The Publish tab: Nostr section (and the Telegram section moved in). |
| `web/src/lib/api.ts`, `web/src/lib/adminSearch.ts` | API wrappers; tab and search entries. |
| `web/src/components/SessionModal.tsx`, `ProposalModal.tsx`, `SessionDetail.tsx` | Notice and opt-out checkbox; the badge. |
| `tests/secretsAtRest.test.ts`, `tests/nostrBuild.test.ts`, `tests/nostrQueue.test.ts`, `tests/nostrRoutes.test.ts`, `tests/nostrNotes.test.ts` | One test file per module. |

---

## Ticket LIB-215 · Keys and schema

### Task 1: Encryption at rest and configuration

**Files:**
- Create: `server/src/secretsAtRest.ts`
- Modify: `server/src/config.ts` (the `Config` interface at lines 6–41 and `loadConfig` at 137–156)
- Modify: `deploy/*.env.example`
- Test: `tests/secretsAtRest.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AtRestKeys { current: string; previous?: string }
  export function encryptAtRest(plain: Uint8Array, purpose: string, secret: string): string;
  export function decryptAtRest(blob: string, purpose: string, keys: AtRestKeys): Uint8Array;
  export function needsReencrypt(blob: string, keys: AtRestKeys): boolean;
  export function rotateAtRest(db: Db, keys: AtRestKeys, columns: { table: string; column: string; purpose: string }[]): number;
  ```
  and on `Config`: `atRestSecret: string; atRestSecretPrevious?: string; publicUrl?: string; nostrDefaultRelays: string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/secretsAtRest.test.ts
import { describe, expect, it } from 'vitest';
import { decryptAtRest, encryptAtRest, needsReencrypt } from '../server/src/secretsAtRest.js';

const plain = new TextEncoder().encode('hello');

describe('secretsAtRest', () => {
  it('round-trips under the current secret', () => {
    const blob = encryptAtRest(plain, 'test', 'secret-a');
    expect(blob.startsWith('v1.')).toBe(true);
    expect(decryptAtRest(blob, 'test', { current: 'secret-a' })).toEqual(plain);
  });
  it('fails with the wrong purpose', () => {
    const blob = encryptAtRest(plain, 'test', 'secret-a');
    expect(() => decryptAtRest(blob, 'other', { current: 'secret-a' })).toThrow();
  });
  it('fails with an unknown secret and names the keyid', () => {
    const blob = encryptAtRest(plain, 'test', 'secret-a');
    expect(() => decryptAtRest(blob, 'test', { current: 'secret-b' })).toThrow(/keyid/);
  });
  it('opens under the previous secret and reports the need to re-encrypt', () => {
    const blob = encryptAtRest(plain, 'test', 'secret-a');
    const keys = { current: 'secret-b', previous: 'secret-a' };
    expect(decryptAtRest(blob, 'test', keys)).toEqual(plain);
    expect(needsReencrypt(blob, keys)).toBe(true);
    expect(needsReencrypt(encryptAtRest(plain, 'test', 'secret-b'), keys)).toBe(false);
  });
  it('uses a fresh nonce each time', () => {
    expect(encryptAtRest(plain, 'test', 's')).not.toEqual(encryptAtRest(plain, 'test', 's'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/secretsAtRest.test.ts`
Expected: FAIL, cannot find module `secretsAtRest.js`.

- [ ] **Step 3: Implement the module**

```ts
// server/src/secretsAtRest.ts
/**
 * Column-level encryption for secrets the server must read back in clear
 * (a Nostr signing key, a bot token). The blob names the secret that made
 * it, so boot can re-encrypt after a rotation without trying every key.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { Db } from './db.js';

export interface AtRestKeys {
  current: string;
  previous?: string;
}

const NONCE = 12;
const TAG = 16;

export const keyId = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex').slice(0, 8);

const derive = (secret: string, purpose: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, '', `libresesh/${purpose}/v1`, 32));

export function encryptAtRest(plain: Uint8Array, purpose: string, secret: string): string {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', derive(secret, purpose), nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return `v1.${keyId(secret)}.${Buffer.concat([nonce, body]).toString('base64')}`;
}

function secretFor(id: string, keys: AtRestKeys): string {
  if (id === keyId(keys.current)) return keys.current;
  if (keys.previous && id === keyId(keys.previous)) return keys.previous;
  throw new Error(`secretsAtRest: no secret for keyid ${id}`);
}

export function decryptAtRest(blob: string, purpose: string, keys: AtRestKeys): Uint8Array {
  const [version, id, b64] = blob.split('.');
  if (version !== 'v1' || !id || !b64) throw new Error('secretsAtRest: malformed blob');
  const raw = Buffer.from(b64, 'base64');
  const nonce = raw.subarray(0, NONCE);
  const tag = raw.subarray(raw.length - TAG);
  const ciphertext = raw.subarray(NONCE, raw.length - TAG);
  const decipher = createDecipheriv('aes-256-gcm', derive(secretFor(id, keys), purpose), nonce);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export function needsReencrypt(blob: string, keys: AtRestKeys): boolean {
  return blob.split('.')[1] !== keyId(keys.current);
}

/** Re-encrypt every blob made under `keys.previous`. Returns the count. */
export function rotateAtRest(
  db: Db,
  keys: AtRestKeys,
  columns: { table: string; column: string; purpose: string }[],
): number {
  if (!keys.previous) return 0;
  let n = 0;
  for (const { table, column, purpose } of columns) {
    const rows = db
      .prepare(`SELECT rowid AS id, ${column} AS blob FROM ${table} WHERE ${column} IS NOT NULL`)
      .all() as { id: number; blob: string }[];
    for (const row of rows) {
      if (!needsReencrypt(row.blob, keys)) continue;
      const plain = decryptAtRest(row.blob, purpose, keys);
      db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`).run(
        encryptAtRest(plain, purpose, keys.current),
        row.id,
      );
      n += 1;
    }
  }
  return n;
}
```

- [ ] **Step 4: Add the config fields**

In `server/src/config.ts`, add to `Config`:

```ts
  /** Encrypts secrets stored in the database. Defaults to the cookie secret. */
  atRestSecret: string;
  /** Set to the old value for one boot after rotating `atRestSecret`. */
  atRestSecretPrevious?: string;
  /** Origin every published link is built from; unset means no links leave. */
  publicUrl?: string;
  /** Relay list a newly enabled event starts with (D6). */
  nostrDefaultRelays: string[];
```

and in `loadConfig`, after the cookie secret is resolved:

```ts
    atRestSecret: process.env.SECRETS_AT_REST_KEY || cookie.secret,
    atRestSecretPrevious: process.env.SECRETS_AT_REST_KEY_PREVIOUS || undefined,
    publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, '') || undefined,
    nostrDefaultRelays: (process.env.NOSTR_DEFAULT_RELAYS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean),
```

Add the four variables, commented, to every `deploy/*.env.example`. Default relays: leave empty until LIB-221 (D6) is decided; the enable route then seeds an empty list and the tab asks for relays.

- [ ] **Step 5: Run tests, lint**

Run: `npx vitest run tests/secretsAtRest.test.ts` → PASS (5 tests). Then `npm run lint`.

- [ ] **Step 6: Commit**

```
feat(server): encrypt secrets at rest with a rotatable key

Adds a column-level encryption helper the Nostr signing key and the
Telegram bot token will both use. The blob carries the id of the secret
that made it, so a rotation with SECRETS_AT_REST_KEY_PREVIOUS set can
re-encrypt on boot instead of losing every stored secret.
```

### Task 2: Migration, key helpers, and the enable/disable/import/export routes

**Files:**
- Create: `server/migrations/0NN_nostr.sql`, `server/src/nostr/keys.ts`, `server/src/routes/nostr.ts`
- Modify: `server/src/db.ts:11-36` (`EventRow`), `server/src/db.ts:110-138` (`SessionRow`), `server/src/validation.ts`, `server/src/app.ts:70-93`, `server/src/index.ts` (boot rotation), `server/src/exportEvent.ts:47-67`, `server/src/importEvent.ts`, `SECURITY.md`, `docs/schema.md`
- Test: `tests/nostrRoutes.test.ts`

**Interfaces:**
- Consumes: `encryptAtRest`, `decryptAtRest`, `Config.atRestSecret*` from Task 1; `requireRole(ctx.db, 'admin')` (`server/src/auth.ts:201`); `limit(ctx.limiter, 'auth')` (`server/src/ratelimit.ts:383`); `audit(db, { identityId, eventId, action, entity, entityId })` (`server/src/audit.ts:33`).
- Produces:
  ```ts
  // keys.ts
  export interface NostrKeys { pubkey: string; seckey: Uint8Array }
  export function generateKeys(): NostrKeys;
  export function keysFromNsec(nsec: string): NostrKeys;      // throws on anything but a valid nsec
  export function toNpub(pubkeyHex: string): string;
  export function toNsec(seckey: Uint8Array): string;
  export function encryptEventKey(seckey: Uint8Array, cfg: Config): string;
  export function openEventKey(event: EventRow, cfg: Config): Uint8Array | null; // null when no key or it does not decrypt
  ```
  Routes: `GET /e/:slug/nostr`, `POST …/nostr/enable`, `POST …/nostr/disable`, `POST …/nostr/import-key`, `POST …/nostr/export-key`, `PATCH …/nostr`. (`retract`, `resync`, `test` come in Task 4 once the queue exists.)

- [ ] **Step 1: Migration**

```sql
-- server/migrations/0NN_nostr.sql
-- Nostr publishing (_planning/specs/nostr-publishing.md). The event's
-- signing key is a Nostr identity: lose it and nothing already published
-- can be updated or retracted, so it is stored encrypted at rest, never
-- exported, and the Publish tab offers an export. nostr_published is the
-- publish queue: a write marks a row, a loop publishes it, and acceptance
-- is tracked per relay so a refusing relay keeps its rows pending without
-- blocking the others.
ALTER TABLE events ADD COLUMN nostr_enabled  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN nostr_pubkey   TEXT;             -- hex
ALTER TABLE events ADD COLUMN nostr_seckey   TEXT;             -- encrypted blob
ALTER TABLE events ADD COLUMN nostr_relays   TEXT;             -- JSON array
ALTER TABLE events ADD COLUMN nostr_triggers TEXT NOT NULL
  DEFAULT '["placed","up_next","digest"]';
ALTER TABLE sessions  ADD COLUMN nostr_optout INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN nostr_optout INTEGER NOT NULL DEFAULT 0;

CREATE TABLE nostr_published (
  event_id      INTEGER NOT NULL REFERENCES events(id),
  entity        TEXT NOT NULL CHECK (entity IN ('session','calendar','profile')),
  entity_id     INTEGER NOT NULL,
  d_tag         TEXT NOT NULL,
  last_event_id TEXT,
  published_at  TEXT,
  dirty_since   TEXT,
  touched_at    TEXT,
  pending       TEXT NOT NULL DEFAULT '[]',
  deleted       INTEGER NOT NULL DEFAULT 0,
  tries         INTEGER NOT NULL DEFAULT 0,
  next_try      TEXT,
  last_error    TEXT,
  PRIMARY KEY (event_id, entity, entity_id)
);
CREATE INDEX nostr_published_due ON nostr_published (event_id, dirty_since, next_try);
```

Add the columns to `EventRow` (`nostr_enabled: number; nostr_pubkey: string | null; nostr_seckey: string | null; nostr_relays: string | null; nostr_triggers: string`) and `nostr_optout: number` to `SessionRow` and the proposal row type. Add a `NostrPublishedRow` interface in `db.ts` mirroring the table (`pending: string`, `deleted: number`, timestamps `string | null`).

- [ ] **Step 2: Install nostr-tools**

Run: `npm install nostr-tools@^2` (one commit for the dependency, `chore(deps): add nostr-tools`; the `release` skill's fetch-first rule applies to any bump, not to an addition).

- [ ] **Step 3: Write the failing route tests**

```ts
// tests/nostrRoutes.test.ts
import { describe, expect, it } from 'vitest';
import { actorWithRole, agentFor, makeHarness, seedEvent } from './helpers.js';

async function enabledEvent() {
  const h = makeHarness({ nostrDefaultRelays: ['wss://relay.test'] });
  const eventId = seedEvent(h.db, { slug: 'conf' });
  const admin = await actorWithRole(h, 'conf', 'admin');
  const enable = await admin.post('/api/e/conf/nostr/enable').send({ acknowledged: true });
  expect(enable.status).toBe(200);
  return { h, eventId, admin };
}

describe('nostr routes', () => {
  it('refuses enable without acknowledgement', async () => {
    const h = makeHarness();
    seedEvent(h.db, { slug: 'conf' });
    const admin = await actorWithRole(h, 'conf', 'admin');
    expect((await admin.post('/api/e/conf/nostr/enable').send({})).status).toBe(400);
    h.close();
  });

  it('enable generates a key once and reuses it after disable', async () => {
    const { h, admin } = await enabledEvent();
    const first = (await admin.get('/api/e/conf/nostr')).body.npub as string;
    expect(first.startsWith('npub1')).toBe(true);
    await admin.post('/api/e/conf/nostr/disable');
    await admin.post('/api/e/conf/nostr/enable').send({ acknowledged: true });
    expect((await admin.get('/api/e/conf/nostr')).body.npub).toBe(first);
    h.close();
  });

  it('import replaces the key and export returns it', async () => {
    const { h, admin } = await enabledEvent();
    const nsec = 'nsec1' + '…'; // generate one in the test with keys.ts: toNsec(generateKeys().seckey)
    const res = await admin.post('/api/e/conf/nostr/import-key').send({ nsec });
    expect(res.status).toBe(204);
    const out = await admin.post('/api/e/conf/nostr/export-key');
    expect(out.body.nsec).toBe(nsec);
    const audit = h.db.prepare(`SELECT action FROM audit ORDER BY id`).all() as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['nostr_key_imported', 'nostr_key_exported']));
    h.close();
  });

  it('never serialises the key columns', async () => {
    const { h, admin } = await enabledEvent();
    const status = JSON.stringify((await admin.get('/api/e/conf/nostr')).body);
    const event = JSON.stringify((await admin.get('/api/e/conf')).body);
    const exported = JSON.stringify((await admin.get('/api/e/conf/export')).body);
    for (const text of [status, event, exported]) {
      expect(text).not.toMatch(/nostr_seckey|nostr_pubkey|nsec1|"v1\./);
    }
    expect(exported).not.toMatch(/nostrEnabled|nostrRelays|nostrTriggers/);
    h.close();
  });

  it('export-key is admin-only and rate limited', async () => {
    const { h } = await enabledEvent();
    const user = await actorWithRole(h, 'conf', 'user');
    expect((await user.post('/api/e/conf/nostr/export-key')).status).toBe(403);
    h.close();
  });

  it('validates relays', async () => {
    const { h, admin } = await enabledEvent();
    expect((await admin.patch('/api/e/conf/nostr').send({ relays: ['http://x'] })).status).toBe(400);
    expect((await admin.patch('/api/e/conf/nostr').send({ relays: Array(11).fill('wss://r.test') })).status).toBe(400);
    expect((await admin.patch('/api/e/conf/nostr').send({ relays: ['wss://a.test'] })).status).toBe(200);
    h.close();
  });
});
```

Adjust the export path and the `user` role name to what `tests/sessionDrafts.test.ts` and `actorWithRole` use. Replace the placeholder `nsec` with a real one from `toNsec(generateKeys().seckey)`.

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run tests/nostrRoutes.test.ts` → FAIL with 404s.

- [ ] **Step 5: keys.ts**

```ts
// server/src/nostr/keys.ts
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import type { Config } from '../config.js';
import type { EventRow } from '../db.js';
import { decryptAtRest, encryptAtRest } from '../secretsAtRest.js';

export const PURPOSE = 'nostr-seckey';

export interface NostrKeys {
  pubkey: string;
  seckey: Uint8Array;
}

export function generateKeys(): NostrKeys {
  const seckey = generateSecretKey();
  return { pubkey: getPublicKey(seckey), seckey };
}

export function keysFromNsec(nsec: string): NostrKeys {
  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== 'nsec') throw new Error('not an nsec');
  return { pubkey: getPublicKey(decoded.data), seckey: decoded.data };
}

export const toNpub = (pubkeyHex: string): string => nip19.npubEncode(pubkeyHex);
export const toNsec = (seckey: Uint8Array): string => nip19.nsecEncode(seckey);

export const atRestKeys = (cfg: Config) => ({
  current: cfg.atRestSecret,
  previous: cfg.atRestSecretPrevious,
});

export const encryptEventKey = (seckey: Uint8Array, cfg: Config): string =>
  encryptAtRest(seckey, PURPOSE, cfg.atRestSecret);

/** null when the event has no key or the at-rest secret cannot open it. */
export function openEventKey(event: EventRow, cfg: Config): Uint8Array | null {
  if (!event.nostr_seckey) return null;
  try {
    return decryptAtRest(event.nostr_seckey, PURPOSE, atRestKeys(cfg));
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Validation schemas**

In `server/src/validation.ts`, next to `proposalPatchSchema`:

```ts
const relayUrl = (isProd: boolean) =>
  z.string().url().refine((u) => u.startsWith('wss://') || (!isProd && u.startsWith('ws://')), {
    message: 'relay URLs must be wss://',
  });
export const nostrEnableSchema = z.object({ acknowledged: z.literal(true) });
export const nostrImportSchema = z.object({ nsec: z.string().regex(/^nsec1[02-9ac-hj-np-z]{58}$/) });
export const nostrTriggers = ['up_next', 'digest', 'added', 'changed', 'pitched', 'placed'] as const;
export const nostrPatchSchema = (isProd: boolean) =>
  z.object({
    relays: z.array(relayUrl(isProd)).max(10).optional(),
    triggers: z.array(z.enum(nostrTriggers)).optional(),
  });
```

Add `nostrOptOut: z.boolean().optional()` to `sessionSchema` and `proposalSchema` (the PATCH schemas are `.partial()` of them). The mapping to the column and the permission check land in Task 8; here the field is only accepted.

- [ ] **Step 7: Routes**

```ts
// server/src/routes/nostr.ts
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import { limit } from '../ratelimit.js';
import { badRequest } from '../errors.js';           // whatever app.ts's 400 helper is called
import { parse, nostrEnableSchema, nostrImportSchema, nostrPatchSchema } from '../validation.js';
import { encryptEventKey, generateKeys, keysFromNsec, openEventKey, toNpub, toNsec } from '../nostr/keys.js';
import { markDirty } from '../nostr/queue.js';        // Task 4; until then a no-op stub in queue.ts
import type { AppContext } from '../app.js';

export function nostrRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const admin = requireRole(ctx.db, 'admin');
  const update = (id: number, sql: string, ...args: unknown[]) =>
    ctx.db.prepare(`UPDATE events SET ${sql} WHERE id = ?`).run(...args, id);

  router.get('/nostr', admin, (req, res) => {
    const e = req.event;
    const rows = ctx.db.prepare(`SELECT * FROM nostr_published WHERE event_id = ?`).all(e.id) as NostrPublishedRow[];
    const relays = JSON.parse(e.nostr_relays ?? '[]') as string[];
    res.json({
      enabled: e.nostr_enabled === 1,
      npub: e.nostr_pubkey ? toNpub(e.nostr_pubkey) : null,
      relays,
      triggers: JSON.parse(e.nostr_triggers) as string[],
      counts: {
        published: rows.filter((r) => r.published_at && !r.deleted).length,
        dirty: rows.filter((r) => r.dirty_since).length,
        pending: rows.filter((r) => r.pending !== '[]').length,
        deleted: rows.filter((r) => r.deleted).length,
      },
      relayStatus: relays.map((url) => ({
        url,
        pending: rows.filter((r) => (JSON.parse(r.pending) as string[]).includes(url)).length,
        lastError: rows.map((r) => r.last_error).filter((m): m is string => !!m && m.startsWith(url + ':')).at(-1) ?? null,
      })),
    });
  });

  router.post('/nostr/enable', admin, (req, res) => {
    parse(nostrEnableSchema, req.body);
    const e = req.event;
    if (!e.nostr_seckey) {
      const keys = generateKeys();
      update(e.id, 'nostr_pubkey = ?, nostr_seckey = ?', keys.pubkey, encryptEventKey(keys.seckey, ctx.config));
    }
    if (!e.nostr_relays) update(e.id, 'nostr_relays = ?', JSON.stringify(ctx.config.nostrDefaultRelays));
    update(e.id, 'nostr_enabled = 1');
    markDirty(ctx.db, e.id);
    audit(ctx.db, { identityId: req.identity.id, eventId: e.id, action: 'nostr_enabled', entity: 'event', entityId: e.id });
    res.json({ npub: toNpub((ctx.db.prepare(`SELECT nostr_pubkey FROM events WHERE id = ?`).get(e.id) as { nostr_pubkey: string }).nostr_pubkey) });
  });

  router.post('/nostr/disable', admin, (req, res) => {
    update(req.event.id, 'nostr_enabled = 0');
    audit(ctx.db, { identityId: req.identity.id, eventId: req.event.id, action: 'nostr_disabled', entity: 'event', entityId: req.event.id });
    res.status(204).end();
  });

  router.patch('/nostr', admin, (req, res) => {
    const body = parse(nostrPatchSchema(ctx.config.isProd), req.body);
    const e = req.event;
    if (body.relays) {
      const before = JSON.parse(e.nostr_relays ?? '[]') as string[];
      update(e.id, 'nostr_relays = ?', JSON.stringify(body.relays));
      const added = body.relays.filter((r) => !before.includes(r));
      if (added.length) appendPending(ctx.db, e.id, added);   // Task 4 exports it; stub until then
    }
    if (body.triggers) update(e.id, 'nostr_triggers = ?', JSON.stringify(body.triggers));
    audit(ctx.db, { identityId: req.identity.id, eventId: e.id, action: 'nostr_settings', entity: 'event', entityId: e.id });
    res.status(200).json({ ok: true });
  });

  router.post('/nostr/import-key', admin, limit(ctx.limiter, 'auth'), (req, res) => {
    const { nsec } = parse(nostrImportSchema, req.body);
    let keys;
    try { keys = keysFromNsec(nsec); } catch { throw badRequest('not a valid nsec'); }
    update(req.event.id, 'nostr_pubkey = ?, nostr_seckey = ?', keys.pubkey, encryptEventKey(keys.seckey, ctx.config));
    markDirty(ctx.db, req.event.id);
    audit(ctx.db, { identityId: req.identity.id, eventId: req.event.id, action: 'nostr_key_imported', entity: 'event', entityId: req.event.id });
    res.status(204).end();
  });

  router.post('/nostr/export-key', admin, limit(ctx.limiter, 'auth'), (req, res) => {
    const seckey = openEventKey(req.event, ctx.config);
    if (!seckey) throw badRequest('this event has no key, or the instance secret changed');
    audit(ctx.db, { identityId: req.identity.id, eventId: req.event.id, action: 'nostr_key_exported', entity: 'event', entityId: req.event.id });
    res.json({ nsec: toNsec(seckey) });
  });

  return router;
}
```

Mount in `server/src/app.ts` beside the other event routers: `event.use(nostrRoutes(ctx));`. Confirm the name of the 400 helper and `req.event` / `req.identity` against `server/src/routes/settings.ts`, and that the event row on `req.event` is re-read after `update` where a later statement in the same handler needs the new value (the enable route above re-reads the pubkey for that reason).

- [ ] **Step 8: Keep the columns out of DTOs, exports and imports**

`toEventDto` (`server/src/mappers.ts:43`) is an explicit object literal; do not add the columns. `exportEvent.ts:47-67` is an allow-list; do not add them. In `importEvent.ts`, an incoming document with any `nostr*` key at event level is ignored (write a one-line test: import a document containing `nostrSeckey` and check the column stays NULL). `nostrOptOut` on sessions and proposals *does* travel: add it to the session and proposal export shape and import mapping.

- [ ] **Step 9: Boot re-encryption**

In `server/src/index.ts`, after `migrate(...)` and before the server listens:

```ts
import { rotateAtRest } from './secretsAtRest.js';
const rotated = rotateAtRest(db, { current: config.atRestSecret, previous: config.atRestSecretPrevious },
  [{ table: 'events', column: 'nostr_seckey', purpose: 'nostr-seckey' }]);
if (config.atRestSecretPrevious) console.log(`secretsAtRest: re-encrypted ${rotated} blob(s); SECRETS_AT_REST_KEY_PREVIOUS can be removed`);
```

Test in `tests/secretsAtRest.test.ts`: insert an event with a blob under secret A, call `rotateAtRest` with `{ current: 'B', previous: 'A' }`, expect 1 and that `decryptAtRest` with `{ current: 'B' }` works.

- [ ] **Step 10: SECURITY.md and docs/schema.md**

SECURITY.md: a row in the threat table for the Nostr key (what leaks if the database leaks: an encrypted blob, useless without the at-rest secret), the `SECRETS_AT_REST_KEY` and `_PREVIOUS` variables, the rotation cost, the import and export routes with their rate limit and audit rows. `docs/schema.md`: the new columns and `nostr_published`.

- [ ] **Step 11: Run, lint, commit**

`npx vitest run tests/nostrRoutes.test.ts tests/secretsAtRest.test.ts` → PASS. `npm run lint`. `npm test` once. Commits, in order: `chore(deps): add nostr-tools`; `feat(nostr): schema and encrypted signing key per event` (migration, keys.ts, row types); `feat(nostr): enable, disable, import and export key routes` (routes, validation, mount, export exclusion, docs).

---

## Ticket LIB-216 · Calendar sync

### Task 3: Pure builders

**Files:**
- Create: `server/src/nostr/build.ts`
- Test: `tests/nostrBuild.test.ts`

**Interfaces:**
- Consumes: `EventRow`, `SessionRow` (`server/src/db.ts`).
- Produces:
  ```ts
  export interface SessionFacts {
    session: SessionRow; event: EventRow;
    room: string | null; format: string | null; tags: string[]; speakers: string[];
  }
  export type Template = { kind: number; created_at: number; tags: string[][]; content: string };
  export const sessionDTag = (eventId: number, sessionId: number) => `e${eventId}-s${sessionId}`;
  export function sessionUrl(cfg: { publicUrl?: string }, event: EventRow, sessionId: number): string | null;
  export function buildSessionEvent(f: SessionFacts, pubkey: string, publicUrl: string | undefined, nowSec: number): Template;
  export function buildCalendarEvent(event: EventRow, sessionDTags: string[], pubkey: string, publicUrl: string | undefined, nowSec: number): Template;
  export function buildProfileEvent(event: EventRow, publicUrl: string | undefined, nowSec: number): Template;
  export function buildDeletion(kind: number, pubkey: string, dTag: string, nowSec: number): Template;
  export function naddrFor(kind: number, pubkey: string, dTag: string, relays: string[]): string;
  export function loadSessionFacts(db: Db, sessionId: number): SessionFacts | null;  // joins room, format, tags, speakers
  export function publishableSessionIds(db: Db, eventId: number): number[];           // not draft, not deleted, not opted out
  ```

- [ ] **Step 1: Failing tests (snapshot against a full fixture)**

```ts
// tests/nostrBuild.test.ts
import { describe, expect, it } from 'vitest';
import { buildCalendarEvent, buildDeletion, buildProfileEvent, buildSessionEvent, sessionDTag } from '../server/src/nostr/build.js';

const event = { id: 7, slug: 'longconf', name: 'LongConf', timezone: 'Europe/Berlin', start_date: '2026-06-01', end_date: '2026-06-02' } as EventRow;
const session = { id: 42, event_id: 7, title: 'Zines as documentation', description: 'Bring **scissors**.', starts_at: '2026-06-01T09:00:00.000Z', ends_at: '2026-06-01T10:00:00.000Z', livestreams: '["https://live.example/a"]', draft: 0, deleted_at: null, nostr_optout: 0 } as SessionRow;
const facts = { session, event, room: 'Room B', format: 'Workshop', tags: ['Docs', 'zines'], speakers: ['Grace', 'Linus'] };
const PUB = 'a'.repeat(64);

describe('buildSessionEvent', () => {
  it('maps every field', () => {
    const t = buildSessionEvent(facts, PUB, 'https://sesh.example', 1_780_000_000);
    expect(t.kind).toBe(31923);
    expect(t.created_at).toBe(1_780_000_000);
    expect(t.tags).toEqual([
      ['d', 'e7-s42'],
      ['title', 'Zines as documentation'],
      ['start', '1780304400'],
      ['end', '1780308000'],
      ['start_tzid', 'Europe/Berlin'],
      ['end_tzid', 'Europe/Berlin'],
      ['D', '1780264800'],                      // 2026-06-01 00:00 Europe/Berlin
      ['location', 'Room B · LongConf'],
      ['summary', 'Workshop · Room B · Grace, Linus'],
      ['t', 'docs'],
      ['t', 'zines'],
      ['r', 'https://sesh.example/e/longconf/s/42'],
      ['r', 'https://live.example/a'],
      ['a', `31924:${PUB}:programme`],
    ]);
    expect(t.content).toBe('Grace, Linus\n\nBring **scissors**.\n\nhttps://sesh.example/e/longconf/s/42');
  });
  it('omits the site link without PUBLIC_URL', () => {
    const t = buildSessionEvent(facts, PUB, undefined, 0);
    expect(t.tags.filter((x) => x[0] === 'r')).toEqual([['r', 'https://live.example/a']]);
    expect(t.content.endsWith('Bring **scissors**.')).toBe(true);
  });
  it('keeps d stable across a slug rename', () => {
    expect(sessionDTag(7, 42)).toBe(buildSessionEvent({ ...facts, event: { ...event, slug: 'renamed' } }, PUB, undefined, 0).tags[0][1]);
  });
});

describe('calendar, profile, deletion', () => {
  it('builds the calendar', () => {
    const t = buildCalendarEvent(event, ['e7-s42', 'e7-s43'], PUB, 'https://sesh.example', 1);
    expect(t.kind).toBe(31924);
    expect(t.tags).toEqual([['d', 'programme'], ['title', 'LongConf'], ['a', `31923:${PUB}:e7-s42`], ['a', `31923:${PUB}:e7-s43`]]);
    expect(t.content).toBe('LongConf, 1–2 June 2026. https://sesh.example/e/longconf');
  });
  it('builds the profile', () => {
    const t = buildProfileEvent(event, undefined, 1);
    expect(t.kind).toBe(0);
    expect(JSON.parse(t.content)).toEqual({ name: 'LongConf', about: '1–2 June 2026' });
  });
  it('builds a deletion with a and k', () => {
    expect(buildDeletion(31923, PUB, 'e7-s42', 5).tags).toEqual([['a', `31923:${PUB}:e7-s42`], ['k', '31923']]);
  });
});
```

The `D` expectation: compute `Date.parse('2026-06-01T00:00:00+02:00') / 1000` and put the literal in. Check the exact date wording against how the app formats date ranges elsewhere (`web/src/lib` has a range formatter; reuse its wording, not its code).

- [ ] **Step 2: Run to verify it fails** → module not found.

- [ ] **Step 3: Implement build.ts**

```ts
// server/src/nostr/build.ts
import * as nip19 from 'nostr-tools/nip19';
import type { Db, EventRow, SessionRow } from '../db.js';

export interface SessionFacts { /* as in Interfaces */ }
export type Template = { kind: number; created_at: number; tags: string[][]; content: string };

export const sessionDTag = (eventId: number, sessionId: number): string => `e${eventId}-s${sessionId}`;
export const CALENDAR_D = 'programme';

export const eventUrl = (publicUrl: string | undefined, event: EventRow): string | null =>
  publicUrl ? `${publicUrl}/e/${event.slug}` : null;
export const sessionUrl = (publicUrl: string | undefined, event: EventRow, sessionId: number): string | null =>
  publicUrl ? `${publicUrl}/e/${event.slug}/s/${sessionId}` : null;

const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** Unix seconds of local midnight of the day `iso` falls on in `tz`. */
export function dayStartUnix(iso: string, tz: string): number {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(utcMidnight));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  const offsetMs = asIfUtc - utcMidnight;          // what tz adds to UTC at that instant
  return Math.floor((utcMidnight - offsetMs) / 1000);
}

const joinPresent = (parts: (string | null | undefined)[], sep: string) => parts.filter(Boolean).join(sep);

export function buildSessionEvent(f: SessionFacts, pubkey: string, publicUrl: string | undefined, nowSec: number): Template {
  const { session: s, event: e } = f;
  const link = sessionUrl(publicUrl, e, s.id);
  const speakers = f.speakers.join(', ');
  const tags: string[][] = [
    ['d', sessionDTag(e.id, s.id)],
    ['title', s.title],
    ['start', String(unix(s.starts_at))],
    ['end', String(unix(s.ends_at))],
    ['start_tzid', e.timezone],
    ['end_tzid', e.timezone],
    ['D', String(dayStartUnix(s.starts_at, e.timezone))],
    ['location', joinPresent([f.room, e.name], ' · ')],
  ];
  const summary = joinPresent([f.format, f.room, speakers || null], ' · ');
  if (summary) tags.push(['summary', summary]);
  for (const t of f.tags) tags.push(['t', t.toLowerCase()]);
  if (link) tags.push(['r', link]);
  for (const url of JSON.parse(s.livestreams || '[]') as string[]) tags.push(['r', url]);
  tags.push(['a', `31924:${pubkey}:${CALENDAR_D}`]);
  const content = joinPresent([speakers || null, s.description?.trim() || null, link], '\n\n');
  return { kind: 31923, created_at: nowSec, tags, content };
}

export function buildCalendarEvent(event: EventRow, sessionDTags: string[], pubkey: string, publicUrl: string | undefined, nowSec: number): Template {
  const tags: string[][] = [['d', CALENDAR_D], ['title', event.name]];
  for (const d of sessionDTags) tags.push(['a', `31923:${pubkey}:${d}`]);
  return { kind: 31924, created_at: nowSec, tags, content: joinPresent([`${event.name}, ${dateRange(event)}.`, eventUrl(publicUrl, event)], ' ') };
}

export function buildProfileEvent(event: EventRow, publicUrl: string | undefined, nowSec: number): Template {
  const about = joinPresent([dateRange(event), eventUrl(publicUrl, event)], '. ');
  return { kind: 0, created_at: nowSec, tags: [], content: JSON.stringify({ name: event.name, about }) };
}

export function buildDeletion(kind: number, pubkey: string, dTag: string, nowSec: number): Template {
  return { kind: 5, created_at: nowSec, tags: [['a', `${kind}:${pubkey}:${dTag}`], ['k', String(kind)]], content: '' };
}

export const naddrFor = (kind: number, pubkey: string, dTag: string, relays: string[]): string =>
  nip19.naddrEncode({ kind, pubkey, identifier: dTag, relays });

export function publishableSessionIds(db: Db, eventId: number): number[] {
  return (db.prepare(`SELECT id FROM sessions WHERE event_id = ? AND draft = 0 AND deleted_at IS NULL AND nostr_optout = 0 ORDER BY starts_at, id`).all(eventId) as { id: number }[]).map((r) => r.id);
}

export function loadSessionFacts(db: Db, sessionId: number): SessionFacts | null {
  const session = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(sessionId) as SessionRow | undefined;
  if (!session) return null;
  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(session.event_id) as EventRow;
  const room = session.room_id ? (db.prepare(`SELECT name FROM rooms WHERE id = ?`).get(session.room_id) as { name: string } | undefined)?.name ?? null : null;
  const format = session.format_id ? (db.prepare(`SELECT name FROM session_formats WHERE id = ?`).get(session.format_id) as { name: string } | undefined)?.name ?? null : null;
  const tags = (db.prepare(`SELECT t.name FROM session_tags st JOIN tags t ON t.id = st.tag_id WHERE st.session_id = ? ORDER BY t.name`).all(sessionId) as { name: string }[]).map((r) => r.name);
  const speakers = (db.prepare(`SELECT p.display_name AS name FROM session_speakers ss JOIN people p ON p.id = ss.person_id WHERE ss.session_id = ? ORDER BY ss.rowid`).all(sessionId) as { name: string }[]).map((r) => r.name);
  return { session, event, room, format, tags, speakers };
}
```

`dateRange(event)` formats `start_date`/`end_date` as "1–2 June 2026" or "1 June 2026"; check `docs/schema.md` for the actual column names on `rooms`, `session_formats`, `people` (display name column) and `session_tags` before writing the joins. Sessions are deleted with `deleted_at`, not a flag.

- [ ] **Step 4: Run tests → PASS. Lint. Commit** `feat(nostr): build NIP-52 calendar events from sessions`.

### Task 4: Publish queue, sync loop, sweep, and the retract/resync/test routes

**Files:**
- Create: `server/src/nostr/queue.ts`
- Modify: `server/src/routes/sessions.ts`, `server/src/routes/proposals.ts:259-330`, `server/src/drafts.ts`, `server/src/series.ts`, the room/tag/format routes, the event settings route (name, dates, timezone), `server/src/routes/nostr.ts`, `server/src/index.ts`
- Test: `tests/nostrQueue.test.ts`, additions to `tests/nostrRoutes.test.ts`

**Interfaces:**
- Consumes: Task 3 builders; `openEventKey`; `finalizeEvent` from `nostr-tools/pure`; `SimplePool` from `nostr-tools/pool`.
- Produces:
  ```ts
  export interface Pool { publish(relays: string[], event: VerifiedEvent): Promise<string>[] }
  export function markDirty(db: Db, eventId: number, sessionId?: number): void;   // no session id = whole event
  export function appendPending(db: Db, eventId: number, relays: string[]): void;
  export function markRetract(db: Db, eventId: number): void;                     // every row deleted + dirty
  export function markResync(db: Db, eventId: number): void;                      // every row dirty
  export function syncTick(db: Db, cfg: Config, pool: Pool, nowMs?: number): Promise<void>;
  export function sweep(db: Db): void;                                            // the five-minute safety net
  export function publishProfileNow(db: Db, cfg: Config, pool: Pool, eventId: number): Promise<{ url: string; ok: boolean; message: string }[]>;
  export function startNostrSync(db: Db, cfg: Config): () => void;                // setInterval 10 s + 5 min, unref'd; returns stop
  ```

- [ ] **Step 1: Failing queue tests (fake pool, real DB)**

```ts
// tests/nostrQueue.test.ts
import { describe, expect, it } from 'vitest';
import { makeHarness, seedEvent, seedRoom } from './helpers.js';
import { markDirty, syncTick, sweep } from '../server/src/nostr/queue.js';
import { encryptEventKey, generateKeys } from '../server/src/nostr/keys.js';

class FakePool {
  sent: { relay: string; kind: number; d?: string }[] = [];
  refuse = new Set<string>();
  publish(relays: string[], ev: { kind: number; tags: string[][] }) {
    return relays.map((relay) => {
      this.sent.push({ relay, kind: ev.kind, d: ev.tags.find((t) => t[0] === 'd')?.[1] });
      return this.refuse.has(relay) ? Promise.reject(new Error('blocked: no')) : Promise.resolve('ok');
    });
  }
}

function enabled(h: ReturnType<typeof makeHarness>, relays = ['wss://a', 'wss://b']) {
  const eventId = seedEvent(h.db, { slug: 'conf' });
  const keys = generateKeys();
  h.db.prepare(`UPDATE events SET nostr_enabled = 1, nostr_pubkey = ?, nostr_seckey = ?, nostr_relays = ? WHERE id = ?`)
    .run(keys.pubkey, encryptEventKey(keys.seckey, h.config), JSON.stringify(relays), eventId);
  return eventId;
}
const insertSession = (h, eventId: number, title = 'S') =>
  Number(h.db.prepare(`INSERT INTO sessions (event_id, title, starts_at, ends_at, type, created_by, updated_at) VALUES (?, ?, '2026-06-01T09:00:00.000Z', '2026-06-01T10:00:00.000Z', 'official', 1, datetime('now'))`).run(eventId, title).lastInsertRowid);

const T0 = Date.parse('2026-06-01T00:00:00Z');

describe('publish queue', () => {
  it('a drag storm publishes once per row after quiet', async () => {
    const h = makeHarness(); const eventId = enabled(h); const sid = insertSession(h, eventId);
    const pool = new FakePool();
    for (let i = 0; i < 20; i++) markDirty(h.db, eventId, sid);
    await syncTick(h.db, h.config, pool, T0 + 5_000);            // inside the quiet window
    expect(pool.sent).toHaveLength(0);
    await syncTick(h.db, h.config, pool, T0 + 16_000);
    expect(pool.sent.filter((s) => s.kind === 31923)).toHaveLength(2);   // one per relay
    expect(pool.sent.filter((s) => s.kind === 31924)).toHaveLength(2);
    h.close();
  });

  it('a storm that never pauses still goes out within 60 s', async () => {
    const h = makeHarness(); const eventId = enabled(h); const sid = insertSession(h, eventId);
    const pool = new FakePool();
    const first = T0;
    // touched_at keeps moving; dirty_since stays at `first`
    for (let t = 0; t <= 70_000; t += 5_000) { markDirtyAt(h.db, eventId, sid, first + t); await syncTick(h.db, h.config, pool, first + t); }
    expect(pool.sent.some((s) => s.kind === 31923)).toBe(true);
    h.close();
  });

  it('a refusing relay keeps the row pending for that relay only', async () => {
    const h = makeHarness(); const eventId = enabled(h); const sid = insertSession(h, eventId);
    const pool = new FakePool(); pool.refuse.add('wss://b');
    markDirty(h.db, eventId, sid);
    await syncTick(h.db, h.config, pool, T0 + 60_000);
    const row = h.db.prepare(`SELECT * FROM nostr_published WHERE entity='session' AND entity_id=?`).get(sid) as any;
    expect(JSON.parse(row.pending)).toEqual(['wss://b']);
    expect(row.published_at).not.toBeNull();
    expect(row.tries).toBe(1);
    expect(row.last_error).toMatch(/^wss:\/\/b: /);
    pool.refuse.clear(); pool.sent = [];
    await syncTick(h.db, h.config, pool, T0 + 60_000 + 61_000);   // past next_try
    expect(pool.sent.map((s) => s.relay)).toEqual(['wss://b', 'wss://b']);  // session + calendar
    h.close();
  });

  it('delete yields a kind 5 with a and k, restore re-enters', async () => {
    const h = makeHarness(); const eventId = enabled(h); const sid = insertSession(h, eventId);
    const pool = new FakePool();
    markDirty(h.db, eventId, sid); await syncTick(h.db, h.config, pool, T0 + 60_000);
    h.db.prepare(`UPDATE sessions SET deleted_at = datetime('now') WHERE id = ?`).run(sid);
    markDirty(h.db, eventId, sid); pool.sent = [];
    await syncTick(h.db, h.config, pool, T0 + 120_000);
    expect(pool.sent.filter((s) => s.kind === 5)).toHaveLength(2);
    expect((h.db.prepare(`SELECT deleted FROM nostr_published WHERE entity_id=? AND entity='session'`).get(sid) as any).deleted).toBe(1);
    h.db.prepare(`UPDATE sessions SET deleted_at = NULL WHERE id = ?`).run(sid);
    markDirty(h.db, eventId, sid); pool.sent = [];
    await syncTick(h.db, h.config, pool, T0 + 180_000);
    expect(pool.sent.filter((s) => s.kind === 31923)).toHaveLength(2);
    h.close();
  });

  it('a mark during the build is not lost', async () => {
    // Use a pool whose publish() calls markDirty before resolving; the row must be dirty again after the tick.
  });

  it('the sweep catches a session updated without a mark', () => {
    const h = makeHarness(); const eventId = enabled(h); const sid = insertSession(h, eventId);
    sweep(h.db);
    expect(h.db.prepare(`SELECT dirty_since FROM nostr_published WHERE entity_id = ? AND entity = 'session'`).get(sid)).toBeTruthy();
    h.close();
  });

  it('an event rename marks sessions, calendar and profile', () => { /* markDirty(db, eventId) then count rows with dirty_since */ });
});
```

Write `markDirtyAt` as a test-only helper that calls `markDirty` and then sets `touched_at` to the given instant, or give `markDirty` an optional `nowMs` parameter (preferred; production callers omit it). Fill in the two sketched tests with real assertions before running.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement queue.ts**

```ts
// server/src/nostr/queue.ts
import { finalizeEvent, type VerifiedEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import type { Config } from '../config.js';
import type { Db, EventRow, NostrPublishedRow } from '../db.js';
import { openEventKey } from './keys.js';
import {
  CALENDAR_D, buildCalendarEvent, buildDeletion, buildProfileEvent, buildSessionEvent,
  loadSessionFacts, publishableSessionIds, sessionDTag, type Template,
} from './build.js';

export interface Pool { publish(relays: string[], event: VerifiedEvent): Promise<string>[] }

export const QUIET_MS = 15_000;
export const MAX_WAIT_MS = 60_000;
export const CAP_MS = 60 * 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

const UPSERT = `
  INSERT INTO nostr_published (event_id, entity, entity_id, d_tag, dirty_since, touched_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(event_id, entity, entity_id) DO UPDATE SET
    touched_at = excluded.touched_at,
    dirty_since = COALESCE(dirty_since, excluded.dirty_since)`;

/** Flag what a write changed. Never throws into the request; no relay I/O. */
export function markDirty(db: Db, eventId: number, sessionId?: number, nowMs = Date.now()): void {
  try {
    const e = db.prepare(`SELECT nostr_pubkey FROM events WHERE id = ?`).get(eventId) as { nostr_pubkey: string | null } | undefined;
    if (!e?.nostr_pubkey) return;                       // never enabled: nothing to keep in sync
    const now = iso(nowMs);
    const up = db.prepare(UPSERT);
    const ids = sessionId !== undefined
      ? [sessionId]
      : (db.prepare(`SELECT id FROM sessions WHERE event_id = ?`).all(eventId) as { id: number }[]).map((r) => r.id);
    db.transaction(() => {
      for (const id of ids) up.run(eventId, 'session', id, sessionDTag(eventId, id), now, now);
      if (sessionId === undefined) up.run(eventId, 'profile', eventId, 'profile', now, now);
      up.run(eventId, 'calendar', eventId, CALENDAR_D, now, now);
    })();
  } catch (err) {
    console.error('nostr: markDirty failed', err);
  }
}

export function markResync(db: Db, eventId: number): void { markDirty(db, eventId); }

export function markRetract(db: Db, eventId: number): void {
  db.prepare(`UPDATE nostr_published SET deleted = 1, dirty_since = COALESCE(dirty_since, ?), touched_at = ? WHERE event_id = ?`)
    .run(iso(Date.now()), iso(Date.now()), eventId);
  db.prepare(`UPDATE events SET nostr_enabled = 0 WHERE id = ?`).run(eventId);
}

export function appendPending(db: Db, eventId: number, relays: string[]): void {
  const rows = db.prepare(`SELECT entity, entity_id, pending FROM nostr_published WHERE event_id = ? AND published_at IS NOT NULL`).all(eventId) as Pick<NostrPublishedRow, 'entity' | 'entity_id' | 'pending'>[];
  const upd = db.prepare(`UPDATE nostr_published SET pending = ?, next_try = NULL WHERE event_id = ? AND entity = ? AND entity_id = ?`);
  for (const r of rows) {
    const set = new Set<string>([...(JSON.parse(r.pending) as string[]), ...relays]);
    upd.run(JSON.stringify([...set]), eventId, r.entity, r.entity_id);
  }
}

/** Build the current version of a row: a template plus whether it is a deletion. */
function buildRow(db: Db, cfg: Config, event: EventRow, row: NostrPublishedRow, nowSec: number): { template: Template; deleted: boolean } {
  const pub = event.nostr_pubkey!;
  if (row.entity === 'profile') {
    return event.nostr_enabled ? { template: buildProfileEvent(event, cfg.publicUrl, nowSec), deleted: false }
                               : { template: buildDeletion(0, pub, '', nowSec), deleted: true };
  }
  if (row.entity === 'calendar') {
    if (!event.nostr_enabled) return { template: buildDeletion(31924, pub, CALENDAR_D, nowSec), deleted: true };
    const ds = publishableSessionIds(db, event.id).map((id) => sessionDTag(event.id, id));
    return { template: buildCalendarEvent(event, ds, pub, cfg.publicUrl, nowSec), deleted: false };
  }
  const facts = loadSessionFacts(db, row.entity_id);
  const gone = !facts || !event.nostr_enabled || facts.session.deleted_at || facts.session.draft || facts.session.nostr_optout;
  return gone ? { template: buildDeletion(31923, pub, row.d_tag, nowSec), deleted: true }
              : { template: buildSessionEvent(facts, pub, cfg.publicUrl, nowSec), deleted: false };
}

function dueRows(db: Db, event: EventRow, nowMs: number): NostrPublishedRow[] {
  return db.prepare(`
    SELECT * FROM nostr_published
    WHERE event_id = ?
      AND (next_try IS NULL OR next_try <= ?)
      AND (? = 1 OR deleted = 1)
      AND ( (dirty_since IS NOT NULL AND (touched_at <= ? OR dirty_since <= ?))
         OR (dirty_since IS NULL AND pending != '[]') )
    ORDER BY (entity = 'calendar'), entity_id`)
    .all(event.id, iso(nowMs), event.nostr_enabled, iso(nowMs - QUIET_MS), iso(nowMs - MAX_WAIT_MS)) as NostrPublishedRow[];
}

async function processRow(db: Db, cfg: Config, pool: Pool, event: EventRow, seckey: Uint8Array, relays: string[], row: NostrPublishedRow, nowMs: number): Promise<void> {
  const { template, deleted } = buildRow(db, cfg, event, row, Math.floor(nowMs / 1000));
  const signed = finalizeEvent(template, seckey);
  let pending: string[];
  if (row.dirty_since !== null) {
    pending = relays;
    db.prepare(`UPDATE nostr_published
      SET last_event_id = ?, pending = ?, deleted = ?, published_at = NULL, dirty_since = NULL, touched_at = NULL
      WHERE event_id = ? AND entity = ? AND entity_id = ? AND touched_at = ?`)
      .run(signed.id, JSON.stringify(pending), deleted ? 1 : 0, row.event_id, row.entity, row.entity_id, row.touched_at);
    // changes === 0 means a mark landed during the build: the row stays dirty and is rebuilt next tick.
  } else {
    pending = JSON.parse(row.pending) as string[];
  }
  if (pending.length === 0) return;
  const results = await Promise.allSettled(pool.publish(pending, signed));
  const still = pending.filter((_, i) => results[i].status === 'rejected');
  const firstError = results.flatMap((r, i) => (r.status === 'rejected' ? [`${pending[i]}: ${String((r as PromiseRejectedResult).reason?.message ?? (r as PromiseRejectedResult).reason)}`] : []))[0] ?? null;
  const acceptedAny = still.length < pending.length;
  const where = `WHERE event_id = ? AND entity = ? AND entity_id = ?`;
  if (still.length === 0) {
    db.prepare(`UPDATE nostr_published SET pending = '[]', tries = 0, next_try = NULL, last_error = NULL, published_at = COALESCE(published_at, ?) ${where}`)
      .run(iso(nowMs), row.event_id, row.entity, row.entity_id);
  } else {
    const tries = row.tries + 1;
    db.prepare(`UPDATE nostr_published SET pending = ?, tries = ?, next_try = ?, last_error = ?, published_at = CASE WHEN ? THEN COALESCE(published_at, ?) ELSE published_at END ${where}`)
      .run(JSON.stringify(still), tries, iso(nowMs + Math.min(60_000 * 2 ** row.tries, CAP_MS)), firstError, acceptedAny ? 1 : 0, iso(nowMs), row.event_id, row.entity, row.entity_id);
  }
}

export async function syncTick(db: Db, cfg: Config, pool: Pool, nowMs = Date.now()): Promise<void> {
  const events = db.prepare(`
    SELECT * FROM events WHERE nostr_seckey IS NOT NULL AND (nostr_enabled = 1
      OR EXISTS (SELECT 1 FROM nostr_published p WHERE p.event_id = events.id AND p.deleted = 1 AND (p.dirty_since IS NOT NULL OR p.pending != '[]')))`).all() as EventRow[];
  for (const event of events) {
    const seckey = openEventKey(event, cfg);
    if (!seckey) { console.error(`nostr: event ${event.id}: key does not decrypt; is the at-rest secret unchanged?`); continue; }
    const relays = JSON.parse(event.nostr_relays ?? '[]') as string[];
    for (const row of dueRows(db, event, nowMs)) {
      try { await processRow(db, cfg, pool, event, seckey, relays, row, nowMs); }
      catch (err) { console.error('nostr: row failed', row.entity, row.entity_id, err); }
    }
  }
}

/** Safety net for a missed markDirty call site. */
export function sweep(db: Db, nowMs = Date.now()): void {
  const events = db.prepare(`SELECT id FROM events WHERE nostr_enabled = 1`).all() as { id: number }[];
  for (const { id } of events) {
    const stale = db.prepare(`
      SELECT s.id FROM sessions s
      LEFT JOIN nostr_published p ON p.event_id = s.event_id AND p.entity = 'session' AND p.entity_id = s.id
      WHERE s.event_id = ? AND s.draft = 0 AND s.deleted_at IS NULL AND s.nostr_optout = 0
        AND (p.entity_id IS NULL OR (p.dirty_since IS NULL AND p.pending = '[]' AND (p.published_at IS NULL OR p.published_at < s.updated_at)))`)
      .all(id) as { id: number }[];
    for (const s of stale) markDirty(db, id, s.id, nowMs);
  }
}

export async function publishProfileNow(db: Db, cfg: Config, pool: Pool, eventId: number) {
  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(eventId) as EventRow;
  const seckey = openEventKey(event, cfg);
  if (!seckey) throw new Error('key does not decrypt');
  const relays = JSON.parse(event.nostr_relays ?? '[]') as string[];
  const signed = finalizeEvent(buildProfileEvent(event, cfg.publicUrl, Math.floor(Date.now() / 1000)), seckey);
  const results = await Promise.allSettled(pool.publish(relays, signed));
  return relays.map((url, i) => {
    const r = results[i];
    return r.status === 'fulfilled' ? { url, ok: true, message: String(r.value) } : { url, ok: false, message: String(r.reason?.message ?? r.reason) };
  });
}

export function startNostrSync(db: Db, cfg: Config): () => void {
  const pool: Pool = new SimplePool();
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await syncTick(db, cfg, pool); } finally { running = false; } };
  const a = setInterval(tick, 10_000); a.unref();
  const b = setInterval(() => sweep(db), 5 * 60_000); b.unref();
  void tick();
  return () => { clearInterval(a); clearInterval(b); };
}
```

A kind-0 deletion (`buildDeletion(0, pub, '', …)`) is only reachable through retract; NIP-09 lets a kind 5 name a replaceable event by `a` with an empty `d`. Keep it; it is what "retract everything" means for the profile.

- [ ] **Step 4: Hook `markDirty` at every write site**

Beside each `audit()` call, one line. The list, from the spec: session create, update, delete, restore, link, unlink, repeat, draft publish (`server/src/routes/sessions.ts`, `server/src/drafts.ts`, `server/src/series.ts`); pitch place (`server/src/routes/proposals.ts:259-330`, after the insert inside the transaction); room, tag, format rename or delete and event name, date or timezone change (their routes; call `markDirty(ctx.db, eventId)` with no session id). Grep `audit(ctx.db` to find them all; every hit that changes a session, a room, a tag, a format or the event row gets a call. Not the SSE broker.

- [ ] **Step 5: The three routes and the boot wiring**

Add to `server/src/routes/nostr.ts`:

```ts
  router.post('/nostr/retract', admin, (req, res) => {
    markRetract(ctx.db, req.event.id);
    audit(ctx.db, { identityId: req.identity.id, eventId: req.event.id, action: 'nostr_retracted', entity: 'event', entityId: req.event.id });
    res.status(204).end();
  });
  router.post('/nostr/resync', admin, (req, res) => { markResync(ctx.db, req.event.id); res.status(204).end(); });
  router.post('/nostr/test', admin, limit(ctx.limiter, 'auth'), async (req, res) => {
    res.json({ relays: await publishProfileNow(ctx.db, ctx.config, ctx.nostrPool, req.event.id) });
  });
```

`ctx.nostrPool` is a `Pool` on the app context, `new SimplePool()` in `index.ts` and a fake in tests (`makeHarness` accepts it through `overrides` or a new field; add `nostrPool?: Pool` to `Harness`). In `index.ts`: `const stopNostr = startNostrSync(db, config);` beside the identity sweep.

Route tests to add in `tests/nostrRoutes.test.ts`: retract marks every row deleted, sets `nostr_enabled = 0`, and a following `syncTick` sends kind 5 for each; enable afterwards republishes; `PATCH` with a new relay appends it to every published row's `pending`; `POST /test` returns one entry per relay from the fake pool.

- [ ] **Step 6: Docs**

`ARCHITECTURE.md`: a section on calendar sync (the queue, the loop, per-relay pending) and `nostr_published` in the table of tables. `web/public/api.md`: the routes.

- [ ] **Step 7: Run, lint, full suite once, commit**

Commits: `feat(nostr): publish queue and sync loop for calendar events`; `feat(nostr): mark the queue from every session write`; `feat(nostr): retract, resync and test routes`.

---

## Ticket LIB-214 · Shared announcer

### Task 5: Land `announcer.ts`

This task depends on the state of `feat/telegram-announcements` (PR #116). Do it after Tasks 1–4 if that PR is still open; otherwise first.

**Files:**
- Create or extract: `server/src/announcer.ts`
- Modify: `server/src/telegram.ts` (if merged), `server/src/index.ts`, `server/src/routes/sessions.ts`, `server/src/routes/proposals.ts`
- Test: `tests/announcer.test.ts`

**Interfaces (from `_planning/specs/announcements.md`, verbatim):**

```ts
export type Trigger = 'up_next' | 'digest' | 'added' | 'changed' | 'pitched' | 'placed';
export interface Announcement {
  trigger: Trigger;
  event: EventRow;
  at: string;                      // ISO instant the announcement is about
  sessions: SessionFacts[];        // the sessions concerned (reuse Task 3's SessionFacts)
  before?: { starts_at: string; ends_at: string; room: string | null };
  proposal?: ProposalRow;
}
export interface Transport {
  name: 'telegram' | 'nostr';
  enabled(event: EventRow, trigger: Trigger): boolean;
  send(event: EventRow, announcement: Announcement): Promise<void>;
}
export class Announcer {
  constructor(db: Db, transports: Transport[]);
  tick(nowMs?: number): Promise<void>;                          // up_next and digest
  announce(a: Omit<Announcement, 'event'> & { eventId: number }): void;  // write-path triggers; fire-and-forget
}
```

- [ ] **Step 1:** If Telegram merged: move the `Announcer` class out of `server/src/telegram.ts` unchanged, make Telegram a `Transport`, keep its test suite green. If not: create `announcer.ts` from the spec's *Scheduler loop and write-path hooks* section with the rules there (window not edge; mark before send; in-memory sent set keyed `${transport}:${eventId}:${trigger}:${key}`; `added`/`placed` suppress `up_next` inside `lead`; `changed` coalesced over 60 s; imports and repeat announce one line).
- [ ] **Step 2:** Tests with a fake transport, the list in announcements.md's *Transport interface and tests* paragraph, one `it` per clause.
- [ ] **Step 3:** Call `announcer.announce(...)` beside `audit()` for `added`, `changed`, `pitched`, `placed` (the `placed` call sits next to Task 4's `markDirty` in the place route).
- [ ] **Step 4:** `setInterval(() => announcer.tick(), 60_000).unref()` in `index.ts`. Commit `feat(server): shared announcer with per-transport triggers`.

---

## Ticket LIB-217 · Kind-1 notes

### Task 6: The Nostr transport

**Files:**
- Create: `server/src/nostr/notes.ts`
- Modify: `server/src/index.ts` (register the transport)
- Test: `tests/nostrNotes.test.ts`

**Interfaces:**
- Consumes: `Announcement`, `Transport` (Task 5); `naddrFor`, `sessionDTag`, `sessionUrl`, `eventUrl` (Task 3); `openEventKey`; `Pool`.
- Produces:
  ```ts
  export function renderNote(a: Announcement, pubkey: string, relays: string[], publicUrl: string | undefined): { content: string; tags: string[][] } | null; // null = post nothing
  export function nostrTransport(db: Db, cfg: Config, pool: Pool): Transport;
  ```

- [ ] **Step 1: Failing snapshot tests**, one per trigger, built from a fixture with two sessions in two rooms. Expected `up_next` output (verbatim from the spec, times in the event's timezone):

```
Up next at 14:00 at LongConf

Room A — Scaling an unconference (Ada)
Room B — Zines as documentation (Grace, Linus)

nostr:naddr1… · nostr:naddr1… · https://sesh.example/e/longconf
```

Assert: `tags` has one `['a', '31923:<pub>:<d>']` per session; each `naddr` in the content decodes (`nip19.decode`) to the same coordinate; with `publicUrl` undefined the last line has no `https://`; `digest` caps at 40 lines with `… and N more`; an empty `digest` returns null; `placed` renders the second spec example; `pitched` gives title, pitcher, first line of the description, board link.

- [ ] **Step 2: Implement**

```ts
// server/src/nostr/notes.ts
import { finalizeEvent } from 'nostr-tools/pure';
import type { Announcement, Transport, Trigger } from '../announcer.js';
import { eventUrl, naddrFor, sessionDTag, sessionUrl } from './build.js';
import { openEventKey } from './keys.js';
import type { Pool } from './queue.js';

const localTime = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const line = (f: SessionFacts) => `${f.room ?? '—'} — ${f.session.title}${f.speakers.length ? ` (${f.speakers.join(', ')})` : ''}`;

export function renderNote(a, pubkey, relays, publicUrl) {
  const e = a.event;
  const refs = a.sessions.map((f) => `nostr:${naddrFor(31923, pubkey, sessionDTag(e.id, f.session.id), relays)}`);
  const tags = a.sessions.map((f) => ['a', `31923:${pubkey}:${sessionDTag(e.id, f.session.id)}`]);
  const footer = [...refs, eventUrl(publicUrl, e)].filter(Boolean).join(' · ');
  switch (a.trigger) {
    case 'up_next': {
      if (!a.sessions.length) return null;
      return { tags, content: `Up next at ${localTime(a.at, e.timezone)} at ${e.name}\n\n${a.sessions.map(line).join('\n')}\n\n${footer}` };
    }
    case 'digest': { /* one line per session, breaks included, cap 40 + "… and N more"; null when empty */ }
    case 'placed': { /* "Placed from the pitch board: <title>\n<Tomorrow|Today|date> HH:MM in <room> · <speakers>\n\n<naddr> · <session url>" */ }
    case 'added': case 'changed': case 'pitched': { /* per spec; pitched links the board, no a tags */ }
  }
}

export function nostrTransport(db, cfg, pool): Transport {
  return {
    name: 'nostr',
    enabled: (event, trigger) => event.nostr_enabled === 1 && (JSON.parse(event.nostr_triggers) as Trigger[]).includes(trigger),
    async send(event, a) {
      const seckey = openEventKey(event, cfg);
      if (!seckey) throw new Error('nostr: key does not decrypt');
      const relays = JSON.parse(event.nostr_relays ?? '[]') as string[];
      const note = renderNote(a, event.nostr_pubkey!, relays, cfg.publicUrl);
      if (!note) return;
      const signed = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: note.tags, content: note.content }, seckey);
      const results = await Promise.allSettled(pool.publish(relays, signed));
      if (results.every((r) => r.status === 'rejected')) throw new Error('nostr: no relay accepted the note');
    },
  };
}
```

Replace the three commented cases with code before running; the spec's Kind-1 notes section has the exact wording for each. No retry: the announcer logs a throw and keeps the sent mark.

- [ ] **Step 3:** Register in `index.ts`: `new Announcer(db, [telegramTransport?, nostrTransport(db, config, nostrPool)])`. Tests pass, lint, commit `feat(nostr): kind-1 notes as an announcer transport`.

---

## Ticket LIB-218 · Publish tab

### Task 7: Publish tab in Manage Event

**Files:**
- Create: `web/src/pages/AdminPublish.tsx`
- Modify: `web/src/lib/adminSearch.ts:17-25` (add `{ id: 'publish', label: 'Publish' }`) and the `AdminSetting` entries; `web/src/pages/AdminPage.tsx:2104-2109` (pattern; add the `publish` panel); `web/src/lib/api.ts:88+`
- Test: `tests/adminPublish.test.tsx` (`// @vitest-environment jsdom`), plus the headless-Chromium pass

**Interfaces:**
- Consumes the routes from Tasks 2 and 4. `api.ts` gains:
  ```ts
  nostrStatus: (slug) => request<NostrStatus>('GET', `/e/${slug}/nostr`),
  nostrEnable: (slug) => request<{ npub: string }>('POST', `/e/${slug}/nostr/enable`, { acknowledged: true }),
  nostrDisable, nostrRetract, nostrResync: (slug) => request<void>('POST', `/e/${slug}/nostr/<x>`),
  nostrPatch: (slug, body: { relays?: string[]; triggers?: Trigger[] }) => request('PATCH', `/e/${slug}/nostr`, body),
  nostrTest: (slug) => request<{ relays: { url: string; ok: boolean; message: string }[] }>('POST', `/e/${slug}/nostr/test`),
  nostrImportKey: (slug, nsec: string) => request<void>('POST', `/e/${slug}/nostr/import-key`, { nsec }),
  nostrExportKey: (slug) => request<{ nsec: string }>('POST', `/e/${slug}/nostr/export-key`),
  ```
  and `NostrStatus` mirrors the `GET /nostr` JSON from Task 2.

- [ ] **Step 1: Component structure** (`AdminPublish.tsx`): a `NostrSection` and, once LIB-210 has landed, the Telegram section moved in. Nostr, off state: the warning block (verbatim from the spec: the field list, "Everything already written goes out too", "Relays keep copies; a deletion is a request"), an *I understand* checkbox, **Enable** disabled until ticked. On state: `npub` with **Copy** and *Open on njump* (`https://njump.me/<npub>`), relay list editor (add/remove, `wss://` validation client-side too, max 10), six trigger checkboxes each with an **Example** button that renders the note for the event's own next slot (call `renderNote` server-side via a `GET /nostr/example?trigger=` route, or defer Example to a follow-up if it needs a new route: state which in the commit), **Send a test** showing each relay's answer verbatim, the status table (relay, pending rows, latest error; counts), **Resync**, **Retract everything** (confirm dialog restating that relays may keep copies), **Export key** (shows the `nsec` once with the spec's sentence *"Keep a copy: if this instance's secret changes, this key is gone."*), **Import key** (an `nsec` field and a confirm that the identity changes). Turning off says plainly that nothing already published is removed and points at Retract.
- [ ] **Step 2: Tab plumbing.** `ADMIN_TABS` gains `publish`; `AdminPage.tsx` renders `<AdminPublish slug={slug} />` under `tab === 'publish'` with the same `role="tabpanel"` wrapper as backup; every control gets an `AdminSetting` entry (`tab: 'publish'`, `anchor` = the control's id).
- [ ] **Step 3: jsdom tests**: enable button disabled until acknowledged; status renders relays and counts from a mocked `api.nostrStatus`; retract asks for confirmation; export shows the nsec only after the call resolves.
- [ ] **Step 4: Chromium pass** with `DEMO_MODE=1 npm run dev`: enable, edit relays, send a test against a local relay or the fake, export, retract. Screenshot each state.
- [ ] **Step 5:** Lint, tests, commit `feat(web): Publish tab with the Nostr section`.

---

## Ticket LIB-219 · Forms and badge

### Task 8: Opt-out on forms, the badge, DTO fields

**Files:**
- Modify: `server/src/mappers.ts:258-285` (`toSessionDto`), the proposal DTO mapper, `server/src/routes/sessions.ts:379` and `server/src/routes/proposals.ts:177` (PATCH handling of `nostrOptOut`), `server/src/routes/proposals.ts:280-300` (inherit on place), `web/src/components/SessionModal.tsx`, `web/src/components/ProposalModal.tsx:91-119`, `web/src/components/SessionDetail.tsx:234-255`
- Test: additions to `tests/nostrRoutes.test.ts`; `tests/sessionDetail.test.tsx` for the badge

**Interfaces:**
- Session DTO gains `nostrOptOut: boolean` and `nostr: { naddr: string } | null`. Proposal DTO gains `nostrOptOut: boolean`. Event DTO gains `nostrEnabled: boolean` (the forms need it; it is not the key and not a secret).
- `nostr` on the session DTO is non-null when the `nostr_published` row exists, `deleted = 0` and `published_at IS NOT NULL`; `naddr` = `naddrFor(31923, event.nostr_pubkey, sessionDTag(eventId, sessionId), relays)`.

- [ ] **Step 1: Failing route tests**: a stranger's PATCH with `nostrOptOut` is 403, the author's and the organiser's succeed (`canMutate`, `server/src/series.ts:36`); a placed pitch with `nostr_optout = 1` produces a session with `nostr_optout = 1`; PATCH `nostrOptOut: true` on a published session calls `markDirty` (the row becomes dirty; the next tick's kind 5 is Task 4's job); the DTO's `nostr` is null before publish, set after a tick with the fake pool, null again after deletion.
- [ ] **Step 2: Server side.** Map `nostrOptOut` ↔ `nostr_optout` in both PATCH handlers under the existing permission check; copy the column in the place transaction; compute `nostr` in `toSessionDto`'s caller (it needs the event and the row; load rows for the page's sessions in one query, like `speakersBySession`).
- [ ] **Step 3: Forms.** While `event.nostrEnabled`, one line above the first field of `SessionModal` and `ProposalModal`: *"This event publishes its programme and pitch board to Nostr"* with a **Publish to Nostr** checkbox beside it, ticked by default, its hint *"Unticking after publishing asks relays to delete it"*. Hidden entirely while Nostr is off. The checkbox writes `nostrOptOut: !checked`.
- [ ] **Step 4: Badge.** In `SessionDetail.tsx` next to the existing badge spans: when `session.nostr`, a small **on Nostr** link to `https://njump.me/${session.nostr.naddr}`, `target="_blank" rel="noopener"`.
- [ ] **Step 5:** jsdom test for the badge and the notice; Chromium pass on both modals; lint; commit `feat(nostr): opt-out on session and pitch forms, badge on the sheet`.

---

## Ticket LIB-220 · Verification on a public relay (Marcel)

### Task 9: Manual verification and the last docs

- [ ] LIB-221 (D6) decided: put the relays in `deploy/*.env.example` and staging2's variables.
- [ ] Deploy `dev` to staging2 with `PUBLIC_URL` and `NOSTR_DEFAULT_RELAYS` set; enable Nostr on a seeded event; work through the checklist on LIB-220 (Flockstr or Coracle renders the calendar; a follow in Damus, Amethyst or Primal shows the notes; a moved session updates in place; a deleted one disappears from at least one relay; export, rotate `SECRETS_AT_REST_KEY` with `_PREVIOUS`, confirm the key still opens).
- [ ] Docs check: `ARCHITECTURE.md`, `SECURITY.md`, `docs/schema.md`, `web/public/api.md`, `deploy/*.env.example`, and once Task 5 is in, `_planning/specs/telegram-announcements.md`'s pointer paragraphs. Move the STATUS.md backlog group to CHANGELOG.md.

---

## Self-review

**Spec coverage.** Key management → Tasks 1, 2. Selective publishing → Tasks 4 (what is built), 8 (opt-out, notice), 7 (warning copy). Calendar sync → Tasks 3, 4. Kind-1 notes → Tasks 5, 6. Configuration, routes and admin UI → Tasks 1, 2, 4, 7. Tests → every task. Dependencies → the order above and Task 5's two entry paths. Out of scope items have no task. Known gaps, deliberate: the **Example** button needs a route the spec did not define; Task 7 says to decide and record. The spec's "if membership changed, rebuild the 31924" is implemented as "every session mark also marks the calendar", which rebuilds more often but never misses; the spec's wording still holds.

**Type consistency.** `SessionFacts` is defined once (Task 3) and consumed by Tasks 4, 5, 6. `Pool` is defined in Task 4 and used by Tasks 6 and 7's test harness. `Template` is Task 3's; `finalizeEvent` takes it as an `EventTemplate`. `markDirty(db, eventId, sessionId?, nowMs?)` is the one signature everywhere.

**Placeholders.** Task 6's `renderNote` has three cases left as comments pointing at the spec's exact wording; Task 4's tests have two `it` bodies sketched. Both are flagged in their steps and must be filled before the step's test run.
