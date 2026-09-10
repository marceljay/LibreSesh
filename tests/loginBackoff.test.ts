import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ADDRESS_FAILURES_PER_HOUR,
  Backoff,
  LOGIN_DISTINCT_ADDRESSES,
  LOGIN_FAILURES_PER_HOUR,
  LOGIN_FREE_ATTEMPTS,
  Tally,
  loginBlockSeconds,
} from '../server/src/ratelimit.js';
import { agentFor, makeHarness, seedEvent, type Agent, type Harness } from './helpers.js';

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

describe('stopping new sign-ins for one event', () => {
  let now = 1_000_000;
  const tally = new Tally(() => now);
  const key = 'event:1';
  const opts = (source: string) => ({
    threshold: LOGIN_FAILURES_PER_HOUR,
    blockMs: 15 * 60_000,
    source,
    distinctSources: LOGIN_DISTINCT_ADDRESSES,
  });

  beforeEach(() => {
    now = 1_000_000;
    tally.reset();
  });

  /** n failures spread over enough addresses to satisfy the distinct rule. */
  const spread = (n: number): number => {
    let closedAt = 0;
    for (let i = 0; i < n; i += 1) {
      closedAt = tally.fail(key, opts(`10.0.0.${i % LOGIN_DISTINCT_ADDRESSES}`)) || closedAt;
    }
    return closedAt;
  };

  it('stops sign-ins on the threshold failure when addresses are spread', () => {
    expect(spread(LOGIN_FAILURES_PER_HOUR - 1)).toBe(0);
    expect(tally.blockedFor(key)).toBe(0);
    expect(tally.fail(key, opts('10.0.0.99'))).toBe(LOGIN_FAILURES_PER_HOUR);
    expect(tally.blockedFor(key)).toBe(15 * 60);
  });

  // The reason the distinct-address rule exists: otherwise one address can
  // stop the event accepting any new sign-in, repeatedly.
  it('never triggers on one address alone, however many times it fails', () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_HOUR * 5; i += 1) {
      expect(tally.fail(key, opts('10.0.0.1'))).toBe(0);
    }
    expect(tally.blockedFor(key)).toBe(0);
  });

  it('needs enough distinct addresses, not just enough failures', () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_HOUR * 2; i += 1) {
      // Nine addresses, one short of the requirement.
      expect(tally.fail(key, opts(`10.0.0.${i % (LOGIN_DISTINCT_ADDRESSES - 1)}`))).toBe(0);
    }
    expect(tally.blockedFor(key)).toBe(0);
  });

  it('reports it once, not on every later failure', () => {
    spread(LOGIN_FAILURES_PER_HOUR);
    expect(tally.fail(key, opts('10.0.0.5'))).toBe(0);
    expect(tally.fail(key, opts('10.0.0.6'))).toBe(0);
  });

  it('accepts sign-ins again after a quarter of an hour', () => {
    spread(LOGIN_FAILURES_PER_HOUR);
    now += 15 * 60_000;
    expect(tally.blockedFor(key)).toBe(0);
  });

  it('counts a sliding hour, so a slow trickle never triggers it', () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_HOUR * 2; i += 1) {
      expect(tally.fail(key, opts(`10.0.0.${i % LOGIN_DISTINCT_ADDRESSES}`))).toBe(0);
      now += 2 * 60_000;
    }
    expect(tally.blockedFor(key)).toBe(0);
  });

  it('is per event', () => {
    spread(LOGIN_FAILURES_PER_HOUR);
    expect(tally.blockedFor(key)).toBeGreaterThan(0);
    expect(tally.blockedFor('event:2')).toBe(0);
  });
});

describe('per-address cap, whatever cookie is presented', () => {
  let now = 1_000_000;
  const tally = new Tally(() => now);
  const key = 'address:1:10.0.0.1';
  const opts = { threshold: ADDRESS_FAILURES_PER_HOUR, blockMs: 15 * 60_000 };

  beforeEach(() => {
    now = 1_000_000;
    tally.reset();
  });

  it('sits above what several hundred people behind one address produce', () => {
    // 200 people sharing one address, each mistyping twice.
    for (let i = 0; i < 400; i += 1) tally.fail(key, opts);
    expect(tally.blockedFor(key)).toBeGreaterThan(0);
    // That is past the cap, so the cap has to be at least this high.
    expect(ADDRESS_FAILURES_PER_HOUR).toBeGreaterThanOrEqual(300);
  });

  it('blocks the address once the cap is passed, whatever cookies were used', () => {
    for (let i = 0; i < ADDRESS_FAILURES_PER_HOUR - 1; i += 1) tally.fail(key, opts);
    expect(tally.blockedFor(key)).toBe(0);
    expect(tally.fail(key, opts)).toBe(ADDRESS_FAILURES_PER_HOUR);
    expect(tally.blockedFor(key)).toBe(15 * 60);
  });
});

describe('the login route, end to end', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness({ trustProxy: true });
    seedEvent(harness.db, { slug: 'conf' });
    persistent = agentFor(harness);
  });
  afterEach(() => harness.close());

  /**
   * One agent means one cookie, which is what the waits are keyed on now.
   * Passing a fresh agent is how a test plays somebody who throws their
   * cookie away between guesses.
   */
  const attempt = (
    password: string,
    ip = '10.0.0.1',
    agent: Agent = persistent,
    name = 'someone',
  ) =>
    agent.post('/api/e/conf/auth').set('X-Forwarded-For', ip).send({ password, displayName: name });

  let persistent: Agent;

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
    // The case the free attempts exist for: somebody mistypes a four-word
    // phrase, corrects it, and signs in. No wait, no lockout.
    expect((await attempt('nope')).status).toBe(403);
    expect((await attempt('viewer-pw')).status).toBe(200);
  });

  it('stops new sign-ins after sixty failures from many addresses', async () => {
    for (let i = 0; i < LOGIN_FAILURES_PER_HOUR; i += 1) {
      await attempt('nope', `10.1.${Math.floor(i / 256)}.${i % 256}`, agentFor(harness));
    }
    // A different address, and the correct password: still refused, and no
    // bcrypt was spent deciding that.
    const res = await attempt('viewer-pw', '10.9.9.9', agentFor(harness));
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

  it('does not affect anyone who already holds a role', async () => {
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
      await attempt('nope', `10.2.${Math.floor(i / 256)}.${i % 256}`, agentFor(harness));
    }

    const res = await inside.get('/api/e/conf/bundle').set('X-Forwarded-For', '10.5.5.5');
    expect(res.status).toBe(200);
  });

  it('does not let one person’s mistakes delay others on the same address', async () => {
    // One shared address, two different people. The first spends their own
    // five attempts; the second signs in straight away.
    for (let i = 0; i < 6; i += 1) await attempt('nope');
    expect((await attempt('nope')).status).toBe(429);

    const someoneElse = agentFor(harness);
    const res = await attempt('viewer-pw', '10.0.0.1', someoneElse);
    expect(res.status).toBe(200);
  });

  /**
   * The limits are blunt on purpose, so both ways out of them matter: the
   * organiser knows things the server cannot, such as that the failures were
   * their own attendees given a password that was read out wrongly.
   */
  it('forgets every attempt when an organiser changes a password', async () => {
    const admin = agentFor(harness);
    await admin
      .post('/api/e/conf/auth')
      .set('X-Forwarded-For', '10.7.7.1')
      .send({ password: 'admin-pw', displayName: 'organiser' });

    for (let i = 0; i < 6; i += 1) await attempt('nope');
    expect((await attempt('nope')).status).toBe(429);

    await admin
      .patch('/api/e/conf/settings')
      .set('X-Forwarded-For', '10.7.7.1')
      .send({ viewerPassword: 'a-new-viewer-password' })
      .expect(200);

    // The same person, no longer waiting: the count was protecting a password
    // that no longer exists.
    expect((await attempt('a-new-viewer-password')).status).toBe(200);
  });

  it('forgets every attempt when an organiser asks it to', async () => {
    const admin = agentFor(harness);
    await admin
      .post('/api/e/conf/auth')
      .set('X-Forwarded-For', '10.7.7.2')
      .send({ password: 'admin-pw', displayName: 'organiser2' });

    for (let i = 0; i < 6; i += 1) await attempt('nope');
    expect((await attempt('nope')).status).toBe(429);

    await admin
      .post('/api/e/conf/login-attempts/reset')
      .set('X-Forwarded-For', '10.7.7.2')
      .expect(204);

    expect((await attempt('viewer-pw')).status).toBe(200);
  });

  it('starts accepting sign-ins again after a reset', async () => {
    const admin = agentFor(harness);
    await admin
      .post('/api/e/conf/auth')
      .set('X-Forwarded-For', '10.7.7.3')
      .send({ password: 'admin-pw', displayName: 'organiser3' });

    for (let i = 0; i < LOGIN_FAILURES_PER_HOUR; i += 1) {
      await attempt('nope', `10.8.${Math.floor(i / 256)}.${i % 256}`, agentFor(harness));
    }
    expect((await attempt('viewer-pw', '10.9.9.8', agentFor(harness))).status).toBe(429);

    await admin
      .post('/api/e/conf/login-attempts/reset')
      .set('X-Forwarded-For', '10.7.7.3')
      .expect(204);

    expect((await attempt('viewer-pw', '10.9.9.7', agentFor(harness))).status).toBe(200);
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
