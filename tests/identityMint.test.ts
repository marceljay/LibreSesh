import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from '../server/src/ratelimit.js';
import { sweepIdleIdentities } from '../server/src/sweepIdentities.js';
import { agentFor, makeHarness, seedEvent, type Harness } from './helpers.js';

/**
 * D3 §3. A request with no valid cookie was minting an identity row before
 * any rate limit ran — the limits are keyed on the identity being created, so
 * an attacker who never sent a cookie met no limit at all. Minting is now
 * budgeted per source address; over it, the request is anonymous rather than
 * refused, so public reads still work.
 */
describe('minting an identity is budgeted per address', () => {
  let harness: Harness;

  // `trustProxy` so each request can name its own source address: the budget
  // is per address, and a test that cannot vary the address cannot show it.
  beforeEach(() => {
    harness = makeHarness({ trustProxy: true });
  });
  afterEach(() => harness.close());

  /** A fresh agent each time: no cookie jar, so every call mints. */
  const cookieless = (ip = '10.0.0.1') =>
    request(harness.app.express).get('/api/me').set('X-Forwarded-For', ip);

  const countIdentities = (): number =>
    harness.db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM identities').get()!.n;

  it('stops creating rows past the budget, and stays readable', async () => {
    for (let i = 0; i < 300; i += 1) await cookieless();
    expect(countIdentities()).toBe(300);

    const res = await cookieless();
    expect(res.status).toBe(200);
    expect(countIdentities()).toBe(300);
    // No cookie is set for an identity that was never created.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers 429 too_many_identities where a role is needed', async () => {
    seedEvent(harness.db, { slug: 'conf' });
    for (let i = 0; i < 300; i += 1) await cookieless();

    const res = await request(harness.app.express)
      .get('/api/e/conf/bundle')
      .set('X-Forwarded-For', '10.0.0.1');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('too_many_identities');
  });

  it('is per address: one exhausted address does not close another', async () => {
    for (let i = 0; i < 320; i += 1) await cookieless('10.0.0.1');
    const before = countIdentities();
    expect(before).toBe(300);

    const res = await cookieless('10.0.0.2');
    expect(res.status).toBe(200);
    expect(countIdentities()).toBe(301);
  });

  it('never refuses a visitor who already holds a cookie', async () => {
    const agent = agentFor(harness);
    const uid = (await agent.get('/api/me').set('X-Forwarded-For', '10.0.0.7')).body.uid;

    // Drain the mint bucket for that address directly rather than through 300
    // requests, which would also spend the `read` budget and prove the wrong
    // thing. This isolates the claim: the mint budget is on *creating* a row.
    for (let i = 0; i < 300; i += 1) {
      harness.app.ctx.limiter.consume('mint:ip:10.0.0.7', LIMITS.mint);
    }

    const res = await agent.get('/api/me').set('X-Forwarded-For', '10.0.0.7');
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe(uid);
  });
});

describe('sweeping identities that never became anybody', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });
  afterEach(() => harness.close());

  const insert = (lastSeen: string | null, createdAt = lastSeen ?? '2020-01-01T00:00:00.000Z') =>
    Number(
      harness.db
        .prepare(
          'INSERT INTO identities (public_id, token, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          Math.random().toString(16).slice(2, 7),
          Math.random().toString(36),
          '',
          createdAt,
          lastSeen,
        ).lastInsertRowid,
    );

  it('deletes only the idle and the roleless', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60_000).toISOString();
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
    const eventId = seedEvent(harness.db, { slug: 'conf' });

    const idle = insert(old);
    const seenLately = insert(recent);
    const withRole = insert(old);
    const withName = insert(old);
    const withFeed = insert(old);
    const neverSeen = insert(null, old);

    harness.db
      .prepare(
        "INSERT INTO roles (identity_id, event_id, role, granted_at) VALUES (?, ?, 'user', ?)",
      )
      .run(withRole, eventId, old);
    harness.db
      .prepare(
        'INSERT INTO event_identities (event_id, identity_id, display_name, claimed_at) VALUES (?, ?, ?, ?)',
      )
      .run(eventId, withName, 'someone', old);
    harness.db
      .prepare('UPDATE identities SET ics_token = ? WHERE id = ?')
      .run('feed-token', withFeed);

    expect(sweepIdleIdentities(harness.db)).toBe(2);

    const alive = (id: number): boolean =>
      harness.db.prepare('SELECT 1 FROM identities WHERE id = ?').get(id) !== undefined;
    expect(alive(idle)).toBe(false);
    expect(alive(neverSeen)).toBe(false);
    expect(alive(seenLately)).toBe(true);
    expect(alive(withRole)).toBe(true);
    expect(alive(withName)).toBe(true);
    expect(alive(withFeed)).toBe(true);
  });
});
