import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actorWithRole,
  agentFor,
  makeHarness,
  seedEvent,
  type Agent,
  type Harness,
} from './helpers.js';

/**
 * Reading an event's passwords back, and getting into an event nobody can
 * open any more.
 *
 * The premise, which these tests are mostly about pinning down: an event
 * password is a shared door code, not a personal credential. One this server
 * generated is kept in clear beside its hash so the organiser can read it out
 * at a registration desk; one a person typed is theirs and is only ever
 * hashed. Everything below follows from that split.
 */
describe('reading and replacing event passwords', () => {
  let harness: Harness;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    // `seedEvent` writes hashes directly with no plaintext — the same shape as
    // an event whose organiser typed all three passwords themselves.
    seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  const createEvent = (body: Record<string, unknown>) =>
    admin.post('/api/events').set('X-Instance-Key', 'instance-pw').send({
      timezone: 'Europe/Berlin',
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      ...body,
    });

  describe('what the organiser can read', () => {
    it('shows a generated password back to the organiser', async () => {
      const created = await createEvent({ name: 'Fresh', slug: 'fresh-conf' }).expect(201);
      const generated = created.body.generatedPasswords;
      const owner = await actorWithRole(harness, 'fresh-conf', generated.adminPassword);

      const res = await owner.get('/api/e/fresh-conf/passwords').expect(200);
      expect(res.body).toEqual({
        viewer: generated.viewerPassword,
        user: generated.userPassword,
        admin: generated.adminPassword,
      });
    });

    it('says nothing about a password its organiser typed', async () => {
      const created = await createEvent({
        name: 'Typed',
        slug: 'typed-conf',
        adminPassword: 'chosen-by-hand',
      }).expect(201);
      const owner = await actorWithRole(harness, 'typed-conf', 'chosen-by-hand');

      const res = await owner.get('/api/e/typed-conf/passwords').expect(200);
      // Not an empty string, which would read as "the password is blank".
      expect(res.body.admin).toBeNull();
      expect(res.body.viewer).toBe(created.body.generatedPasswords.viewerPassword);
    });

    it('is null across the board for an event predating the plaintext column', async () => {
      const res = await admin.get('/api/e/testconf/passwords').expect(200);
      expect(res.body).toEqual({ viewer: null, user: null, admin: null });
    });

    it('is not readable by an attendee', async () => {
      const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
      await attendee.get('/api/e/testconf/passwords').expect(403);
    });

    it('is not readable by a stranger', async () => {
      await agentFor(harness).get('/api/e/testconf/passwords').expect(401);
    });

    it('logs who read them', async () => {
      await admin.get('/api/e/testconf/passwords').expect(200);
      const res = await admin.get('/api/e/testconf/audit').expect(200);
      expect(res.body.entries.some((e: { action: string }) => e.action === 'reveal_passwords')).toBe(
        true,
      );
    });
  });

  describe('replacing one', () => {
    const enter = (slug: string, password: string) =>
      agentFor(harness).post(`/api/e/${slug}/auth`).send({ password });

    it('mints a new password, and the old one stops working', async () => {
      const res = await admin.post('/api/e/testconf/passwords/viewer/reset').expect(200);
      const fresh: string = res.body.password;

      await enter('testconf', 'viewer-pw').expect(403);
      const entered = await enter('testconf', fresh).expect(200);
      expect(entered.body.role).toBe('viewer');
    });

    it('makes a typed password readable, because the replacement is generated', async () => {
      await admin.post('/api/e/testconf/passwords/user/reset').expect(200);
      const res = await admin.get('/api/e/testconf/passwords').expect(200);
      expect(typeof res.body.user).toBe('string');
      // Untouched, so still nothing to show for the other two.
      expect(res.body.viewer).toBeNull();
    });

    it('never mints one another role already answers to', async () => {
      // The roles are told apart by these strings alone, so a collision would
      // silently grant whichever is higher.
      const res = await admin.post('/api/e/testconf/passwords/admin/reset').expect(200);
      const fresh: string = res.body.password;
      await enter('testconf', 'viewer-pw').expect(200);
      const entered = await enter('testconf', fresh).expect(200);
      expect(entered.body.role).toBe('admin');
    });

    it('leaves everyone already signed in exactly where they are', async () => {
      // Rotating a password does not evict role rows — a mid-event reset must
      // not sign the room out.
      await admin.post('/api/e/testconf/passwords/admin/reset').expect(200);
      await admin.get('/api/e/testconf/bundle').expect(200);
    });

    it('refuses a role that is not one of the three', async () => {
      await admin.post('/api/e/testconf/passwords/speaker/reset').expect(400);
    });

    it('is not something an attendee can do', async () => {
      const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
      await attendee.post('/api/e/testconf/passwords/admin/reset').expect(403);
    });

    it('is not something a stranger can do', async () => {
      const stranger = agentFor(harness);
      // Mint the identity the browser already has by the time it sees the
      // gate — without one the request is anonymous and never reaches here.
      await stranger.get('/api/me').expect(200);
      await stranger.post('/api/e/testconf/passwords/admin/reset').expect(403);
    });
  });

  describe('the locked-out event', () => {
    /** An identity with no role on this event — the shape of a browser sitting
     *  at the gate of an event whose organisers have all lost their password. */
    const stranded = async (): Promise<Agent> => {
      const agent = agentFor(harness);
      await agent.get('/api/me').expect(200);
      return agent;
    };

    it('opens again for whoever holds the instance password', async () => {
      const res = await (await stranded())
        .post('/api/e/testconf/passwords/admin/reset')
        .set('X-Instance-Key', 'instance-pw')
        .expect(200);
      const entered = await agentFor(harness)
        .post('/api/e/testconf/auth')
        .send({ password: res.body.password })
        .expect(200);
      expect(entered.body.role).toBe('admin');
    });

    it('resets the organiser password only', async () => {
      // Recovery needs exactly one way back in; the new organiser can reset
      // the rest from inside. A deploy secret that could rewrite every
      // password on the instance would be a master key, which it is not.
      await (await stranded())
        .post('/api/e/testconf/passwords/viewer/reset')
        .set('X-Instance-Key', 'instance-pw')
        .expect(403);
    });

    it('refuses a wrong instance password', async () => {
      await (await stranded())
        .post('/api/e/testconf/passwords/admin/reset')
        .set('X-Instance-Key', 'not-the-key')
        .expect(403);
    });

    it('grants no role by itself', async () => {
      const stranger = await stranded();
      await stranger
        .post('/api/e/testconf/passwords/admin/reset')
        .set('X-Instance-Key', 'instance-pw')
        .expect(200);
      // The password came back; the door did not open on its own.
      await stranger.get('/api/e/testconf/bundle').expect(401);
    });

    it('is logged distinctly from an organiser doing it', async () => {
      await (await stranded())
        .post('/api/e/testconf/passwords/admin/reset')
        .set('X-Instance-Key', 'instance-pw')
        .expect(200);
      const res = await admin.get('/api/e/testconf/audit').expect(200);
      const actions = res.body.entries.map((e: { action: string }) => e.action);
      expect(actions).toContain('reset_pw_instance');
    });
  });

  describe('what the plaintext must never reach', () => {
    /** The risk this whole feature introduces: a password now exists in clear
     *  on the event row, so every shape built from that row is a place it
     *  could escape to. Both are built from explicit field lists rather than
     *  by spreading the row, and these hold them to it. */
    const seesPassword = (payload: unknown, password: string) =>
      JSON.stringify(payload).includes(password);

    it('is not in the bundle every viewer receives', async () => {
      const created = await createEvent({ name: 'Leaky', slug: 'leaky-conf' }).expect(201);
      const generated = created.body.generatedPasswords;
      const viewer = await actorWithRole(harness, 'leaky-conf', generated.viewerPassword);

      const res = await viewer.get('/api/e/leaky-conf/bundle').expect(200);
      for (const password of Object.values(generated) as string[]) {
        expect(seesPassword(res.body, password)).toBe(false);
      }
    });

    it('is not in the per-event export an organiser hands around', async () => {
      const created = await createEvent({ name: 'Shared', slug: 'shared-conf' }).expect(201);
      const generated = created.body.generatedPasswords;
      const owner = await actorWithRole(harness, 'shared-conf', generated.adminPassword);

      const res = await owner.get('/api/e/shared-conf/export.json').expect(200);
      for (const password of Object.values(generated) as string[]) {
        expect(seesPassword(res.body, password)).toBe(false);
      }
    });
  });

  describe('changing a password in settings', () => {
    it('forgets the plaintext of the generated one it replaces', async () => {
      const created = await createEvent({ name: 'Rotate', slug: 'rotate-conf' }).expect(201);
      const generated = created.body.generatedPasswords;
      const owner = await actorWithRole(harness, 'rotate-conf', generated.adminPassword);

      await owner
        .patch('/api/e/rotate-conf/settings')
        .send({ viewerPassword: 'typed-in-by-hand' })
        .expect(200);

      const res = await owner.get('/api/e/rotate-conf/passwords').expect(200);
      // Showing the superseded phrase would be worse than showing nothing:
      // it is a password that no longer opens anything.
      expect(res.body.viewer).toBeNull();
      expect(res.body.admin).toBe(generated.adminPassword);
    });
  });
});

describe('duplicating an event no longer demands three passwords', () => {
  let harness: Harness;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  const clone = (body: Record<string, unknown>) =>
    admin.post('/api/events/testconf/clone').send({
      newName: 'Next Year',
      newSlug: 'testconf-2027',
      startDate: '2027-06-01',
      endDate: '2027-06-02',
      ...body,
    });

  it('generates all three when none are given', async () => {
    const res = await clone({}).expect(201);
    const generated = res.body.generatedPasswords;
    expect(Object.keys(generated).sort()).toEqual([
      'adminPassword',
      'userPassword',
      'viewerPassword',
    ]);

    const entered = await agentFor(harness)
      .post('/api/e/testconf-2027/auth')
      .send({ password: generated.adminPassword })
      .expect(200);
    expect(entered.body.role).toBe('admin');
  });

  it('keeps the ones that were typed and fills in the rest', async () => {
    const res = await clone({ adminPassword: 'my-own-password' }).expect(201);
    expect(res.body.generatedPasswords.adminPassword).toBeUndefined();
    expect(typeof res.body.generatedPasswords.viewerPassword).toBe('string');
  });

  it('does not carry the source event’s passwords over', async () => {
    await clone({}).expect(201);
    // Duplicating last year's conference usually means this year's room is a
    // different room; inheriting the codes would be a silent share.
    await agentFor(harness)
      .post('/api/e/testconf-2027/auth')
      .send({ password: 'admin-pw' })
      .expect(403);
  });

  it('still refuses two matching passwords', async () => {
    await clone({ viewerPassword: 'same-one', adminPassword: 'same-one' }).expect(400);
  });
});
