import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actorWithRole, makeHarness, seedEvent, type Agent, type Harness } from './helpers.js';

/**
 * Whether the schedule marks its official programme is the organiser's call,
 * and off until they make it. The grid used to label the other kind on every
 * event whether or not the distinction meant anything there.
 */
describe('the official badge is an event setting', () => {
  let harness: Harness;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  it('starts off', async () => {
    const res = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(res.body.event.showOfficialBadge).toBe(false);
  });

  it('turns on and stays on', async () => {
    await admin.patch('/api/e/testconf/settings').send({ showOfficialBadge: true }).expect(200);
    const on = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(on.body.event.showOfficialBadge).toBe(true);

    // A settings save that says nothing about it leaves it alone — the form
    // posts the whole settings object, so this is the ordinary case.
    await admin.patch('/api/e/testconf/settings').send({ name: 'Renamed' }).expect(200);
    const still = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(still.body.event.showOfficialBadge).toBe(true);

    await admin.patch('/api/e/testconf/settings').send({ showOfficialBadge: false }).expect(200);
    const off = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(off.body.event.showOfficialBadge).toBe(false);
  });

  it('is an organiser setting, not an attendee one', async () => {
    const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    await attendee.patch('/api/e/testconf/settings').send({ showOfficialBadge: true }).expect(403);
  });

  it('carries into a clone, which runs the same shape of event', async () => {
    await admin.patch('/api/e/testconf/settings').send({ showOfficialBadge: true }).expect(200);
    await admin
      .post('/api/events/testconf/clone')
      .send({
        newSlug: 'testconf-2',
        newName: 'Testconf 2',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        viewerPassword: 'viewer-pw-2',
        userPassword: 'user-pw-2',
        adminPassword: 'admin-pw-2',
      })
      .expect(201);

    const clone = await actorWithRole(harness, 'testconf-2', 'admin-pw-2');
    const bundle = await clone.get('/api/e/testconf-2/bundle').expect(200);
    expect(bundle.body.event.showOfficialBadge).toBe(true);
  });
});
