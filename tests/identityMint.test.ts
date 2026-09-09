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

  /**
   * Spend the address's mint allowance without making 300 requests. Doing it
   * over HTTP took seconds, and the bucket refills continuously — under a
   * loaded suite enough tokens came back mid-run to mint again, which made
   * these tests fail for a reason that had nothing to do with what they
   * assert.
   */
  const drain = (ip: string): void => {
    for (let i = 0; i < LIMITS.mint.capacity; i += 1) {
      harness.app.ctx.limiter.consume(`mint:ip:${ip}`, LIMITS.mint);
    }
  };

  it('stops creating rows once the allowance is spent, and stays readable', async () => {
    expect((await cookieless()).status).toBe(200);
    expect(countIdentities()).toBe(1);

    drain('10.0.0.1');
    const res = await cookieless();
    expect(res.status).toBe(200);
    // No row, and no cookie for an identity that was never created.
    expect(countIdentities()).toBe(1);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers 429 too_many_identities where a role is needed', async () => {
    seedEvent(harness.db, { slug: 'conf' });
    drain('10.0.0.1');

    const res = await request(harness.app.express)
      .get('/api/e/conf/bundle')
      .set('X-Forwarded-For', '10.0.0.1');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('too_many_identities');
  });

  it('is per address: one exhausted address does not close another', async () => {
    drain('10.0.0.1');
    expect((await cookieless('10.0.0.1')).headers['set-cookie']).toBeUndefined();

    const other = await cookieless('10.0.0.2');
    expect(other.status).toBe(200);
    expect(countIdentities()).toBe(1);
  });

  it('never refuses a visitor who already holds a cookie', async () => {
    const agent = agentFor(harness);
    const uid = (await agent.get('/api/me').set('X-Forwarded-For', '10.0.0.7')).body.uid;

    drain('10.0.0.7');

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
