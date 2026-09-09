import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Backoff, Tally, LOGIN_FAILURES_PER_HOUR } from '../server/src/ratelimit.js';
import { agentFor, makeHarness, seedEvent, type Harness } from './helpers.js';

/**
 * D3 §1a and §1b, as pure objects first: the clock is injectable, so the
 * doubling and the sliding hour are testable without waiting for either.
 */
describe('per-address backoff', () => {
  let now = 1_000_000;
  const backoff = new Backoff(() => now);

  beforeEach(() => {
    now = 1_000_000;
    backoff.reset();
  });

  it('doubles from a second, so a typo is nearly free', () => {
    backoff.fail('e1:1.2.3.4');
    expect(backoff.check('e1:1.2.3.4')).toBe(1);
    now += 1000;
    expect(backoff.check('e1:1.2.3.4')).toBe(0);

    backoff.fail('e1:1.2.3.4');
    expect(backoff.check('e1:1.2.3.4')).toBe(2);
    now += 2000;
    backoff.fail('e1:1.2.3.4');
    expect(backoff.check('e1:1.2.3.4')).toBe(4);
  });

  it('stops doubling at a quarter of an hour', () => {
    for (let i = 0; i < 30; i += 1) {
      backoff.fail('e1:1.2.3.4');
      now += 1000 * 60 * 60;
    }
    backoff.fail('e1:1.2.3.4');
    expect(backoff.check('e1:1.2.3.4')).toBe(900);
  });

  it('forgets the misses once a password is right', () => {
    backoff.fail('e1:1.2.3.4');
    backoff.fail('e1:1.2.3.4');
    backoff.succeed('e1:1.2.3.4');
    expect(backoff.check('e1:1.2.3.4')).toBe(0);
  });

  it('is keyed on the pair, so one event cannot spend another’s patience', () => {
    for (let i = 0; i < 5; i += 1) backoff.fail('e1:1.2.3.4');
    expect(backoff.check('e1:1.2.3.4')).toBeGreaterThan(0);
    expect(backoff.check('e2:1.2.3.4')).toBe(0);
    expect(backoff.check('e1:5.6.7.8')).toBe(0);
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

  it('makes the second wrong password from one address wait', async () => {
    expect((await attempt('nope')).status).toBe(403);
    const second = await attempt('nope');
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBe('1');
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
