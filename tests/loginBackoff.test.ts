import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Backoff,
  Tally,
  LOGIN_FAILURES_PER_HOUR,
  LOGIN_FREE_ATTEMPTS,
  loginBlockSeconds,
} from '../server/src/ratelimit.js';
import { agentFor, makeHarness, seedEvent, type Harness } from './helpers.js';

/**
 * D3 §1a and §1b, as pure objects first: the clock is injectable, so the
 * doubling and the sliding hour are testable without waiting for either.
 */
describe('per-address backoff', () => {
  let now = 1_000_000;
  const backoff = new Backoff(() => now);
  const key = 'e1:1.2.3.4';

  beforeEach(() => {
    now = 1_000_000;
    backoff.reset();
  });

  const failTimes = (n: number, k = key): void => {
    for (let i = 0; i < n; i += 1) backoff.fail(k);
  };

  it('lets five attempts through with no wait at all', () => {
    for (let i = 0; i < LOGIN_FREE_ATTEMPTS - 1; i += 1) {
      backoff.fail(key);
      expect(backoff.check(key)).toBe(0);
    }
  });

  it('blocks for two minutes once the free attempts are spent', () => {
    failTimes(LOGIN_FREE_ATTEMPTS);
    expect(backoff.check(key)).toBe(120);
    now += 119_000;
    expect(backoff.check(key)).toBe(1);
    now += 1_000;
    expect(backoff.check(key)).toBe(0);
  });

  it('gives five more free attempts, then a quarter of an hour', () => {
    failTimes(LOGIN_FREE_ATTEMPTS);
    now += 120_000;
    for (let i = 0; i < LOGIN_FREE_ATTEMPTS - 1; i += 1) {
      backoff.fail(key);
      expect(backoff.check(key)).toBe(0);
    }
    backoff.fail(key);
    expect(backoff.check(key)).toBe(900);
  });

  it('stays at a quarter of an hour for every failure after that', () => {
    failTimes(LOGIN_FREE_ATTEMPTS * 2);
    now += 900_000;
    backoff.fail(key);
    expect(backoff.check(key)).toBe(900);
    now += 900_000;
    backoff.fail(key);
    expect(backoff.check(key)).toBe(900);
  });

  it('forgets the misses once a password is right', () => {
    failTimes(LOGIN_FREE_ATTEMPTS);
    backoff.succeed(key);
    expect(backoff.check(key)).toBe(0);
    // And the count with them: five free attempts again, not one.
    failTimes(LOGIN_FREE_ATTEMPTS - 1);
    expect(backoff.check(key)).toBe(0);
  });

  it('is keyed on the pair, so one event cannot spend another’s patience', () => {
    failTimes(LOGIN_FREE_ATTEMPTS);
    expect(backoff.check(key)).toBeGreaterThan(0);
    expect(backoff.check('e2:1.2.3.4')).toBe(0);
    expect(backoff.check('e1:5.6.7.8')).toBe(0);
  });
});

describe('how long each failure costs', () => {
  it('is five free, two minutes, five free, then a quarter of an hour', () => {
    expect([1, 2, 3, 4].map(loginBlockSeconds)).toEqual([0, 0, 0, 0]);
    expect(loginBlockSeconds(5)).toBe(120);
    expect([6, 7, 8, 9].map(loginBlockSeconds)).toEqual([0, 0, 0, 0]);
    expect(loginBlockSeconds(10)).toBe(900);
    expect(loginBlockSeconds(50)).toBe(900);
  });
});

describe('per-event closure', () => {
  let now = 1_000_000;
  const tally = new Tally(() => now);

  beforeEach(() => {
    now = 1_000_000;
    tally.reset();
  });

  const failTimes = (eventId: number, n: number): number => {
    let closedAt = 0;
    for (let i = 0; i < n; i += 1) closedAt = tally.fail(eventId) || closedAt;
    return closedAt;
  };

  it('closes the login on the threshold failure, whatever the sources', () => {
    expect(failTimes(1, LOGIN_FAILURES_PER_HOUR - 1)).toBe(0);
    expect(tally.closedFor(1)).toBe(0);
    expect(tally.fail(1)).toBe(LOGIN_FAILURES_PER_HOUR);
    expect(tally.closedFor(1)).toBe(15 * 60);
  });

  it('reports the closure once, not on every later failure', () => {
    failTimes(1, LOGIN_FAILURES_PER_HOUR);
    expect(tally.fail(1)).toBe(0);
    expect(tally.fail(1)).toBe(0);
  });

  it('reopens after a quarter of an hour', () => {
    failTimes(1, LOGIN_FAILURES_PER_HOUR);
    now += 15 * 60_000;
    expect(tally.closedFor(1)).toBe(0);
  });

  it('counts a sliding hour, so a slow trickle never closes anything', () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_HOUR * 2; i += 1) {
      expect(tally.fail(1)).toBe(0);
      now += 2 * 60_000;
    }
    expect(tally.closedFor(1)).toBe(0);
  });

  it('is per event', () => {
    failTimes(1, LOGIN_FAILURES_PER_HOUR);
    expect(tally.closedFor(1)).toBeGreaterThan(0);
    expect(tally.closedFor(2)).toBe(0);
  });
});

describe('the login route, end to end', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness({ trustProxy: true });
    seedEvent(harness.db, { slug: 'conf' });
  });
  afterEach(() => harness.close());

  const attempt = (password: string, ip = '10.0.0.1', name = 'someone') =>
    agentFor(harness)
      .post('/api/e/conf/auth')
      .set('X-Forwarded-For', ip)
      .send({ password, displayName: name });

  it('lets five wrong passwords through, then holds the sixth for two minutes', async () => {
    for (let i = 0; i < LOGIN_FREE_ATTEMPTS; i += 1) {
      expect((await attempt('nope')).status).toBe(403);
    }
    const blocked = await attempt('nope');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('120');
    expect(blocked.body.error.message).toContain('couple of minutes');
  });

  it('lets a mistyped password be corrected immediately', async () => {
    // The case the free attempts exist for: somebody misreads a four-word
    // phrase off a slide, fixes it, and is in. No wait, no lockout.
    expect((await attempt('nope')).status).toBe(403);
    expect((await attempt('viewer-pw')).status).toBe(200);
  });

  it('closes the event to newcomers after sixty failures from many addresses', async () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_HOUR; i += 1) {
      await attempt('nope', `10.1.${Math.floor(i / 256)}.${i % 256}`);
    }
    // A fresh address, and the right password: still refused, and no bcrypt
    // was spent deciding that.
    const res = await attempt('viewer-pw', '10.9.9.9');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('login_closed');

    const rows = harness.db
      .prepare<[], { entity_id: number | null }>(
        "SELECT entity_id FROM audit WHERE action = 'login_closed'",
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_id).toBe(LOGIN_FAILURES_PER_HOUR);
  });

  it('leaves everyone already inside alone while the door is shut', async () => {
    const inside = agentFor(harness);
    expect(
      (
        await inside
          .post('/api/e/conf/auth')
          .set('X-Forwarded-For', '10.5.5.5')
          .send({ password: 'viewer-pw', displayName: 'ada' })
      ).status,
    ).toBe(200);

    for (let i = 0; i < LOGIN_FAILURES_PER_HOUR; i += 1) {
      await attempt('nope', `10.2.${Math.floor(i / 256)}.${i % 256}`);
    }

    const res = await inside.get('/api/e/conf/bundle').set('X-Forwarded-For', '10.5.5.5');
    expect(res.status).toBe(200);
  });

  it('tells an organiser what has been happening', async () => {
    const admin = agentFor(harness);
    await admin
      .post('/api/e/conf/auth')
      .set('X-Forwarded-For', '10.5.5.6')
      .send({ password: 'admin-pw', displayName: 'organiser' });

    await attempt('nope', '10.3.3.3');
    const res = await admin.get('/api/e/conf/login-health').set('X-Forwarded-For', '10.5.5.6');
    expect(res.status).toBe(200);
    expect(res.body.failuresLastHour).toBe(1);
    expect(res.body.lastClosure).toBeNull();
  });
});
