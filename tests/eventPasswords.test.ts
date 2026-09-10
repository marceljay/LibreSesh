import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actorWithRole,
  agentFor,
  makeHarness,
  seedEvent,
  type Agent,
  type Harness,
  nextUsername,
} from './helpers.js';

const BASE = {
  name: 'Password Conf',
  timezone: 'Europe/Berlin',
  startDate: '2026-09-01',
  endDate: '2026-09-02',
};

describe('event passwords must tell the roles apart', () => {
  let harness: Harness;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  const create = (body: Record<string, unknown>) =>
    admin.post('/api/events').set('X-Instance-Key', 'instance-pw').send(body);

  it('rejects an event whose three passwords are all the same', async () => {
    const res = await create({
      ...BASE,
      slug: 'same-conf',
      viewerPassword: 'letmein',
      userPassword: 'letmein',
      adminPassword: 'letmein',
    }).expect(400);
    expect(res.body.error.message).toMatch(/must be different/i);
  });

  // The dangerous pair: roleForPassword checks admin first, so sharing this
  // one password would make every viewer an organiser.
  it('rejects a viewer password that equals the admin password', async () => {
    await create({
      ...BASE,
      slug: 'clash-conf',
      viewerPassword: 'shared-one',
      userPassword: 'user111',
      adminPassword: 'shared-one',
    }).expect(400);
    // Nothing was created.
    const events = await agentFor(harness).get('/api/events').expect(200);
    expect(events.body.map((e: { slug: string }) => e.slug)).not.toContain('clash-conf');
  });

  it('accepts three distinct passwords', async () => {
    await create({
      ...BASE,
      slug: 'fine-conf',
      viewerPassword: 'viewer1',
      userPassword: 'user111',
      adminPassword: 'admin11',
    }).expect(201);
  });

  it('rejects a clone whose passwords collide', async () => {
    await admin
      .post('/api/events/testconf/clone')
      .send({
        newSlug: 'clone-conf',
        newName: 'Clone Conf',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        viewerPassword: 'dup-pass',
        userPassword: 'dup-pass',
        adminPassword: 'admin11',
      })
      .expect(400);
  });

  describe('changing them later', () => {
    it('rejects a new attendee password that is already the admin password', async () => {
      const res = await admin
        .patch('/api/e/testconf/settings')
        .send({ userPassword: 'admin-pw' })
        .expect(400);
      expect(res.body.error.message).toMatch(/already the organiser password/i);
    });

    it('rejects two new passwords that match each other', async () => {
      await admin
        .patch('/api/e/testconf/settings')
        .send({ viewerPassword: 'twinned', userPassword: 'twinned' })
        .expect(400);
    });

    // Swapping two passwords in one request is fine: the collision each would
    // have had is resolved by the other half of the same update.
    it('allows a swap done in a single request', async () => {
      await admin
        .patch('/api/e/testconf/settings')
        .send({ viewerPassword: 'admin-pw', adminPassword: 'viewer-pw' })
        .expect(200);
      // The roles really did trade places.
      const someone = agentFor(harness);
      await someone.get('/api/me').expect(200);
      const res = await someone
        .post('/api/e/testconf/auth')
        .send({ password: 'admin-pw', displayName: nextUsername() })
        .expect(200);
      expect(res.body.role).toBe('viewer');
    });

    it('still allows changing one password to something new', async () => {
      await admin
        .patch('/api/e/testconf/settings')
        .send({ viewerPassword: 'brand-new-one' })
        .expect(200);
    });
  });
});

describe('blank passwords are filled in', () => {
  let harness: Harness;
  let admin: Agent;

  const create = (body: Record<string, unknown>) =>
    admin.post('/api/events').set('X-Instance-Key', 'instance-pw').send(body);

  const signIn = async (slug: string, password: string) => {
    const someone = agentFor(harness);
    await someone.get('/api/me').expect(200);
    return someone.post(`/api/e/${slug}/auth`).send({ password, displayName: nextUsername() });
  };

  afterEach(() => harness.close());

  describe('on a normal instance', () => {
    beforeEach(async () => {
      harness = makeHarness();
      seedEvent(harness.db);
      admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    });

    it('generates all three and returns them once', async () => {
      const res = await create({ ...BASE, slug: 'blank-conf' }).expect(201);
      const generated = res.body.generatedPasswords;
      expect(Object.keys(generated).sort()).toEqual([
        'adminPassword',
        'userPassword',
        'viewerPassword',
      ]);
      // Distinct, and each one really opens its own role.
      expect(new Set(Object.values(generated)).size).toBe(3);
      expect((await signIn('blank-conf', generated.viewerPassword)).body.role).toBe('viewer');
      expect((await signIn('blank-conf', generated.userPassword)).body.role).toBe('user');
      expect((await signIn('blank-conf', generated.adminPassword)).body.role).toBe('admin');
    });

    it('never uses the published demo passwords off a demo instance', async () => {
      const res = await create({ ...BASE, slug: 'not-demo' }).expect(201);
      expect(Object.values(res.body.generatedPasswords)).not.toContain('admin2026');
    });

    it('fills in only what was left blank', async () => {
      const res = await create({
        ...BASE,
        slug: 'partial-conf',
        adminPassword: 'chosen-by-hand',
      }).expect(201);
      const generated = res.body.generatedPasswords;
      expect(generated.adminPassword).toBeUndefined();
      expect(generated.viewerPassword).toBeDefined();
      expect((await signIn('partial-conf', 'chosen-by-hand')).body.role).toBe('admin');
    });

    it('still rejects a password below the length minimum', async () => {
      await create({ ...BASE, slug: 'short-conf', viewerPassword: 'abc' }).expect(400);
    });
  });

  describe('on a demo instance', () => {
    beforeEach(async () => {
      // The seeded fixture is the demo event; 'demo-conf' below is not, which
      // is the point — creating a real event on a demo instance must not hand
      // it the passwords printed in the README.
      harness = makeHarness({ demoMode: true });
      seedEvent(harness.db);
      admin = agentFor(harness);
      await admin.get('/api/me').expect(200);
      await admin
        .post('/api/e/testconf/auth')
        .send({ role: 'admin', displayName: nextUsername() })
        .expect(200);
    });

    it('gives a newly created event real passwords, not the published ones', async () => {
      const res = await create({ ...BASE, slug: 'demo-conf' }).expect(201);
      const generated = res.body.generatedPasswords as Record<string, string>;
      expect(Object.values(generated)).not.toContain('viewer2026');
      expect(Object.values(generated)).not.toContain('user2026');
      expect(Object.values(generated)).not.toContain('admin2026');
      // And that event's login page is a password prompt, not a role picker.
      const visitor = agentFor(harness);
      await visitor.get('/api/me').expect(200);
      await visitor
        .post('/api/e/demo-conf/auth')
        .send({ role: 'admin', displayName: nextUsername() })
        .expect(400);
    });

    it('restores the published passwords when the demo fixture is recreated', async () => {
      harness.close();
      harness = makeHarness({ demoMode: true, demoEventSlugs: ['demo-conf'] });
      admin = agentFor(harness);
      await admin.get('/api/me').expect(200);

      const res = await create({ ...BASE, slug: 'demo-conf' }).expect(201);
      expect(res.body.generatedPasswords).toEqual({
        viewerPassword: 'viewer2026',
        userPassword: 'user2026',
        adminPassword: 'admin2026',
      });
    });

    // Predictability is not worth handing out the wrong role.
    it('generates instead when a demo default would collide with a typed one', async () => {
      harness.close();
      harness = makeHarness({ demoMode: true, demoEventSlugs: ['demo-clash'] });
      admin = agentFor(harness);
      await admin.get('/api/me').expect(200);

      const res = await create({
        ...BASE,
        slug: 'demo-clash',
        adminPassword: 'viewer2026',
      }).expect(201);
      expect(res.body.generatedPasswords.viewerPassword).not.toBe('viewer2026');
      expect(res.body.generatedPasswords.userPassword).toBe('user2026');
    });
  });
});
