import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actorWithRole,
  agentFor,
  makeHarness,
  seedEvent,
  type Harness,
  nextUsername,
} from './helpers.js';

/**
 * `POST /password-role` is the invite QR's one server-side piece: it says which
 * role a password grants without granting it, so the panel refuses to draw a
 * code for a password nobody can enter with.
 */
describe('password-role', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db);
  });
  afterEach(() => harness.close());

  it('names the role behind each password', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    for (const [password, role] of [
      ['viewer-pw', 'viewer'],
      ['user-pw', 'user'],
      ['admin-pw', 'admin'],
    ] as const) {
      const res = await admin.post('/api/e/testconf/password-role').send({ password }).expect(200);
      expect(res.body).toEqual({ role });
    }
  });

  it('refuses a password no role answers to', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.post('/api/e/testconf/password-role').send({ password: 'nope' }).expect(403);
  });

  it('grants nothing — checking the organiser password does not promote', async () => {
    // The whole reason this is not `POST /auth`: an organiser encoding the
    // *viewer* password must not demote themselves out of the page they are
    // standing on, and an attendee must not climb by asking.
    const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    await attendee
      .post('/api/e/testconf/password-role')
      .send({ password: 'admin-pw', displayName: nextUsername() })
      .expect(403);
    const me = await attendee.get('/api/me').expect(200);
    expect(me.body.roles.testconf).toBe('user');
  });

  it('is closed to anyone without a role at all', async () => {
    const stranger = agentFor(harness);
    await stranger.get('/api/me').expect(200);
    await stranger
      .post('/api/e/testconf/password-role')
      .send({ password: 'admin-pw', displayName: nextUsername() })
      .expect(401);
  });

  it('logs who made an invite code', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin
      .post('/api/e/testconf/password-role')
      .send({ password: 'user-pw', displayName: nextUsername() })
      .expect(200);
    const row = harness.db
      .prepare<[], { action: string; entity: string }>(
        "SELECT action, entity FROM audit WHERE action = 'invite_qr'",
      )
      .get();
    expect(row).toEqual({ action: 'invite_qr', entity: 'event' });
  });
});
