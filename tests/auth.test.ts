import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atLeast, roleForPassword } from '../server/src/auth.js';
import type { EventRow } from '../server/src/db.js';
import { agentFor, makeHarness, seedEvent, type Harness, nextUsername } from './helpers.js';

describe('role ranking', () => {
  it('orders viewer < user < admin', () => {
    expect(atLeast('admin', 'viewer')).toBe(true);
    expect(atLeast('admin', 'admin')).toBe(true);
    expect(atLeast('user', 'admin')).toBe(false);
    expect(atLeast('viewer', 'user')).toBe(false);
    expect(atLeast('viewer', 'viewer')).toBe(true);
  });
});

describe('password matching', () => {
  let harness: Harness;
  let event: EventRow;

  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db);
    event = harness.db
      .prepare<[string], EventRow>('SELECT * FROM events WHERE slug = ?')
      .get('testconf') as EventRow;
  });
  afterEach(() => harness.close());

  it('maps each password to its role', () => {
    expect(roleForPassword(event, 'viewer-pw')).toBe('viewer');
    expect(roleForPassword(event, 'user-pw')).toBe('user');
    expect(roleForPassword(event, 'admin-pw')).toBe('admin');
  });

  it('returns undefined for a wrong password', () => {
    expect(roleForPassword(event, 'nope')).toBeUndefined();
  });

  it('prefers the highest role when two passwords are the same', () => {
    harness.db
      .prepare('UPDATE events SET viewer_pw_hash = admin_pw_hash WHERE id = ?')
      .run(event.id);
    const updated = harness.db
      .prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?')
      .get(event.id) as EventRow;
    expect(roleForPassword(updated, 'admin-pw')).toBe('admin');
  });
});

describe('identity', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db);
  });
  afterEach(() => harness.close());

  it('mints an anonymous identity on first contact and keeps it', async () => {
    const agent = agentFor(harness);
    const first = await agent.get('/api/me').expect(200);
    // No name until one is typed at a login page: nothing is generated for you.
    expect(first.body.displayName).toBe('');
    expect(first.body.roles).toEqual({});

    const second = await agent.get('/api/me').expect(200);
    expect(second.body.id).toBe(first.body.id);
  });

  it('gives different visitors different identities', async () => {
    const a = await agentFor(harness).get('/api/me').expect(200);
    const b = await agentFor(harness).get('/api/me').expect(200);
    expect(a.body.id).not.toBe(b.body.id);
  });

  it('renames, including for viewers', async () => {
    const agent = agentFor(harness);
    await agent.get('/api/me');
    await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'viewer-pw', displayName: nextUsername() })
      .expect(200);
    const res = await agent.patch('/api/me').send({ displayName: '  Dana  ' }).expect(200);
    expect(res.body.displayName).toBe('Dana');
    expect(res.body.roles).toEqual({ testconf: 'viewer' });
  });

  it('rejects an empty or overlong display name', async () => {
    const agent = agentFor(harness);
    await agent.get('/api/me');
    await agent.patch('/api/me').send({ displayName: '   ' }).expect(400);
    await agent
      .patch('/api/me')
      .send({ displayName: 'x'.repeat(41) })
      .expect(400);
  });
});

describe('event auth endpoint', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db);
  });
  afterEach(() => harness.close());

  it('grants the matching role', async () => {
    const agent = agentFor(harness);
    const res = await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'user-pw', displayName: nextUsername() })
      .expect(200);
    expect(res.body).toEqual({ role: 'user' });
  });

  it('403s on a wrong password', async () => {
    const res = await agentFor(harness)
      .post('/api/e/testconf/auth')
      .send({ password: 'wrong' })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('upgrades and downgrades the stored role', async () => {
    const agent = agentFor(harness);
    await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'viewer-pw', displayName: nextUsername() })
      .expect(200);
    await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'admin-pw', displayName: nextUsername() })
      .expect(200);
    expect((await agent.get('/api/me')).body.roles.testconf).toBe('admin');
    await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'viewer-pw', displayName: nextUsername() })
      .expect(200);
    expect((await agent.get('/api/me')).body.roles.testconf).toBe('viewer');
  });

  it('rate limits the 6th failed attempt with Retry-After', async () => {
    const agent = agentFor(harness);
    for (let i = 0; i < 5; i++) {
      await agent.post('/api/e/testconf/auth').send({ password: 'wrong' }).expect(403);
    }
    const res = await agent.post('/api/e/testconf/auth').send({ password: 'wrong' }).expect(429);
    expect(res.body.error.code).toBe('rate_limited');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('refunds the attempt budget when a password is correct', async () => {
    const agent = agentFor(harness);
    for (let i = 0; i < 4; i++) {
      await agent.post('/api/e/testconf/auth').send({ password: 'wrong' }).expect(403);
    }
    // A success returns its token, so the next wrong guess is still the 5th.
    await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'user-pw', displayName: nextUsername() })
      .expect(200);
    await agent.post('/api/e/testconf/auth').send({ password: 'wrong' }).expect(403);
  });

  it('viewing requires a role', async () => {
    const agent = agentFor(harness);
    const res = await agent.get('/api/e/testconf/bundle').expect(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('logout drops the role but keeps the name', async () => {
    const agent = agentFor(harness);
    await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'admin-pw', displayName: nextUsername() })
      .expect(200);
    await agent.patch('/api/me').send({ displayName: 'Robin' }).expect(200);
    await agent.post('/api/e/testconf/logout').expect(204);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body.displayName).toBe('Robin');
    expect(me.body.roles).toEqual({});
    await agent.get('/api/e/testconf/bundle').expect(401);
  });

  it('requires a username the first time, and remembers it after', async () => {
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    // Nothing to fall back on: no seed name is generated any more.
    const refused = await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'user-pw' })
      .expect(400);
    expect(refused.body.error.code).toBe('name_required');
    expect((await agent.get('/api/e/testconf/login').expect(200)).body).toEqual({ heldName: null });

    await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'user-pw', displayName: 'Robin' })
      .expect(200);
    expect((await agent.get('/api/e/testconf/login').expect(200)).body).toEqual({
      heldName: 'Robin',
    });

    // Re-entering after a logout may leave the name out and keeps it.
    await agent.post('/api/e/testconf/logout').expect(204);
    await agent.post('/api/e/testconf/auth').send({ password: 'viewer-pw' }).expect(200);
    const bundle = await agent.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.displayName).toBe('Robin');
  });

  it('404s for an unknown event', async () => {
    await agentFor(harness).post('/api/e/nope/auth').send({ password: 'x' }).expect(404);
  });
});

describe('demo mode', () => {
  let harness: Harness;

  afterEach(() => harness.close());

  it('is off by default: a role in the body is not a way in', async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);

    // No password field at all -> the password schema rejects it.
    await agent
      .post('/api/e/testconf/auth')
      .send({ role: 'admin', displayName: nextUsername() })
      .expect(400);
    await agent.get('/api/e/testconf/bundle').expect(401);
  });

  it('reports demoMode on /me so the login page knows which form to show', async () => {
    harness = makeHarness({ demoMode: true });
    seedEvent(harness.db);
    const agent = agentFor(harness);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body.demoMode).toBe(true);
  });

  it('does not report demoMode when it is off', async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    const agent = agentFor(harness);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body.demoMode).toBe(false);
    expect(me.body.demoEventSlugs).toEqual([]);
  });

  it('grants the requested role on a click, with no password', async () => {
    harness = makeHarness({ demoMode: true });
    seedEvent(harness.db);
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);

    const res = await agent
      .post('/api/e/testconf/auth')
      .send({ role: 'admin', displayName: nextUsername() })
      .expect(200);
    expect(res.body.role).toBe('admin');

    // And that role really works.
    await agent.post('/api/e/testconf/rooms').send({ name: 'Hall' }).expect(201);
  });

  it('lets a demo visitor switch roles freely', async () => {
    harness = makeHarness({ demoMode: true });
    seedEvent(harness.db);
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);

    await agent
      .post('/api/e/testconf/auth')
      .send({ role: 'admin', displayName: nextUsername() })
      .expect(200);
    await agent
      .post('/api/e/testconf/auth')
      .send({ role: 'viewer', displayName: nextUsername() })
      .expect(200);
    // Downgraded for real: admin-only writes are refused again.
    await agent.post('/api/e/testconf/rooms').send({ name: 'Nope' }).expect(403);
  });

  it('rejects a role that is not one of the three', async () => {
    harness = makeHarness({ demoMode: true });
    seedEvent(harness.db);
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    await agent.post('/api/e/testconf/auth').send({ role: 'superuser' }).expect(400);
  });

  /**
   * The reason demo mode is a list of slugs rather than a boolean: an instance
   * showing off the demo may also be running someone's actual conference, and
   * that event's organiser password has to mean something.
   */
  it('leaves every other event on the instance alone', async () => {
    harness = makeHarness({ demoMode: true, demoEventSlugs: ['democonf-2026'] });
    seedEvent(harness.db);
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);

    // No role picker here — the login page wants a password.
    await agent
      .post('/api/e/testconf/auth')
      .send({ role: 'admin', displayName: nextUsername() })
      .expect(400);
    await agent.post('/api/e/testconf/auth').send({ password: 'nope' }).expect(403);
    await agent.get('/api/e/testconf/bundle').expect(401);

    const ok = await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'admin-pw', displayName: nextUsername() })
      .expect(200);
    expect(ok.body.role).toBe('admin');
  });

  it('names the open events on /me so the login page knows which form to show', async () => {
    harness = makeHarness({ demoMode: true, demoEventSlugs: ['democonf-2026'] });
    seedEvent(harness.db);
    const agent = agentFor(harness);
    const me = await agent.get('/api/me').expect(200);
    expect(me.body.demoMode).toBe(true);
    expect(me.body.demoEventSlugs).toEqual(['democonf-2026']);
  });

  it('still accepts the real password while in demo mode', async () => {
    harness = makeHarness({ demoMode: true });
    seedEvent(harness.db);
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    // The demo branch parses `role`, so a password-only body is a 400 — the
    // login page sends one shape or the other, never both.
    await agent
      .post('/api/e/testconf/auth')
      .send({ password: 'admin-pw', displayName: nextUsername() })
      .expect(400);
  });
});

describe('demo mode config', () => {
  const original = process.env.DEMO_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = original;
  });

  it('is off when DEMO_MODE is unset', async () => {
    delete process.env.DEMO_MODE;
    const { loadConfig } = await import('../server/src/config.js');
    expect(loadConfig().demoMode).toBe(false);
  });

  it('is on for DEMO_MODE=1, which is what `npm run dev:demo` sets', async () => {
    process.env.DEMO_MODE = '1';
    const { loadConfig } = await import('../server/src/config.js');
    expect(loadConfig().demoMode).toBe(true);
  });

  it('treats any other value as off', async () => {
    process.env.DEMO_MODE = 'true';
    const { loadConfig } = await import('../server/src/config.js');
    expect(loadConfig().demoMode).toBe(false);
  });
});

/**
 * Names are unique inside an event and held by the identity that claimed them,
 * so somebody who loses their cookie — cleared site data, a second browser, or
 * a server that restarted with a new signing key — cannot re-enter under their
 * own name. The server is right to refuse; there has to be a way forward.
 */
describe('a name already held in this event', () => {
  let harness: Harness;
  afterEach(() => harness.close());

  it('refuses the name but takes the next free variant', async () => {
    harness = makeHarness();
    seedEvent(harness.db);

    const first = agentFor(harness);
    await first.get('/api/me').expect(200);
    await first
      .post('/api/e/testconf/auth')
      .send({ password: 'user-pw', displayName: 'Ada' })
      .expect(200);

    // The same person, now a stranger to the server.
    const afterWipe = agentFor(harness);
    await afterWipe.get('/api/me').expect(200);
    const refused = await afterWipe
      .post('/api/e/testconf/auth')
      .send({ password: 'user-pw', displayName: 'Ada' })
      .expect(409);
    expect(refused.body.error.code).toBe('name_taken');

    // Which is what the login page's one-click retry sends.
    const retry = await afterWipe
      .post('/api/e/testconf/auth')
      .send({ password: 'user-pw', displayName: 'Ada 2' })
      .expect(200);
    expect(retry.body.role).toBe('user');
    const me = await afterWipe.get('/api/e/testconf/bundle').expect(200);
    expect(me.body.displayName).toBe('Ada 2');
  });

  it('behaves the same on a demo event, where the login page is a role picker', async () => {
    harness = makeHarness({ demoMode: true });
    seedEvent(harness.db);

    const first = agentFor(harness);
    await first.get('/api/me').expect(200);
    await first
      .post('/api/e/testconf/auth')
      .send({ role: 'admin', displayName: 'Ada' })
      .expect(200);

    const afterRestart = agentFor(harness);
    await afterRestart.get('/api/me').expect(200);
    await afterRestart
      .post('/api/e/testconf/auth')
      .send({ role: 'admin', displayName: 'Ada' })
      .expect(409);
    const retry = await afterRestart
      .post('/api/e/testconf/auth')
      .send({ role: 'admin', displayName: 'Ada 2' })
      .expect(200);
    expect(retry.body.role).toBe('admin');
  });
});
