import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actorWithRole,
  agentFor,
  makeHarness,
  seedEvent,
  seedRoom,
  type Harness,
} from './helpers.js';

/**
 * Renaming an event moves its address. The point of these tests is everything
 * that must *not* move with it: the roles people hold, the programme, and the
 * old URL, which goes on resolving so nothing already handed out breaks.
 */
describe('renaming an event', () => {
  let harness: Harness;
  let eventId: number;

  beforeEach(() => {
    harness = makeHarness();
    eventId = seedEvent(harness.db, { slug: 'testconf' });
  });
  afterEach(() => harness.close());

  it('moves the event to the new slug', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const res = await admin
      .patch('/api/e/testconf/settings')
      .send({ slug: 'unconf-2026' })
      .expect(200);
    expect(res.body.slug).toBe('unconf-2026');

    const bundle = await admin.get('/api/e/unconf-2026/bundle').expect(200);
    expect(bundle.body.event.id).toBe(eventId);
  });

  it('keeps the old slug resolving to the same event', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    seedRoom(harness.db, eventId, { name: 'Main hall' });
    await admin.patch('/api/e/testconf/settings').send({ slug: 'unconf-2026' }).expect(200);

    // Not a redirect the caller has to follow — the old address answers.
    const old = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(old.body.event.id).toBe(eventId);
    // And it answers with the *new* name, which is what lets the web app move
    // the address bar on.
    expect(old.body.event.slug).toBe('unconf-2026');
    expect(old.body.rooms.map((r: { name: string }) => r.name)).toEqual(['Main hall']);
  });

  it('costs nobody their role, on either address', async () => {
    const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.patch('/api/e/testconf/settings').send({ slug: 'unconf-2026' }).expect(200);

    // The attendee never saw the rename and holds no new cookie: a role is
    // stored against the event, not the name it went by when it was granted.
    const viaNew = await attendee.get('/api/e/unconf-2026/bundle').expect(200);
    expect(viaNew.body.role).toBe('user');
    const viaOld = await attendee.get('/api/e/testconf/bundle').expect(200);
    expect(viaOld.body.role).toBe('user');
    // The organiser is still the organiser, and can rename it again.
    await admin.patch('/api/e/unconf-2026/settings').send({ name: 'Renamed' }).expect(200);
  });

  it('refuses a slug another event is using', async () => {
    seedEvent(harness.db, { slug: 'otherconf' });
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const res = await admin
      .patch('/api/e/testconf/settings')
      .send({ slug: 'otherconf' })
      .expect(409);
    expect(res.body.error.code).toBe('slug_taken');
  });

  it('refuses a slug another event has been renamed away from', async () => {
    seedEvent(harness.db, { slug: 'otherconf' });
    const other = await actorWithRole(harness, 'otherconf', 'admin-pw');
    await other.patch('/api/e/otherconf/settings').send({ slug: 'otherconf-2026' }).expect(200);

    // `otherconf` still points somewhere. Handing it to this event would steal
    // every old link pointing at the other one.
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const res = await admin.patch('/api/e/testconf/settings').send({ slug: 'otherconf' }).expect(409);
    expect(res.body.error.code).toBe('slug_taken');
  });

  it('lets an event move back to a slug it used to have', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.patch('/api/e/testconf/settings').send({ slug: 'unconf-2026' }).expect(200);
    const back = await admin
      .patch('/api/e/unconf-2026/settings')
      .send({ slug: 'testconf' })
      .expect(200);
    expect(back.body.slug).toBe('testconf');

    // Both still resolve, and neither is left redirecting to itself.
    await admin.get('/api/e/testconf/bundle').expect(200);
    await admin.get('/api/e/unconf-2026/bundle').expect(200);
    const rows = harness.db
      .prepare('SELECT slug FROM event_slugs WHERE event_id = ?')
      .all(eventId) as { slug: string }[];
    expect(rows.map((r) => r.slug)).toEqual(['unconf-2026']);
  });

  it('will not let a new event claim a slug that still redirects', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.patch('/api/e/testconf/settings').send({ slug: 'unconf-2026' }).expect(200);

    const res = await agentFor(harness)
      .post('/api/events')
      .set('X-Instance-Key', 'instance-pw')
      .send({
        name: 'Impostor',
        slug: 'testconf',
        timezone: 'Europe/Berlin',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
      })
      .expect(409);
    expect(res.body.error.code).toBe('slug_taken');
  });

  it('is only an organiser’s to do, and is logged as a rename', async () => {
    const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    await attendee.patch('/api/e/testconf/settings').send({ slug: 'nope' }).expect(403);

    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.patch('/api/e/testconf/settings').send({ slug: 'unconf-2026' }).expect(200);
    const log = await admin.get('/api/e/unconf-2026/audit').expect(200);
    expect(log.body.entries[0].action).toBe('rename');

    // An ordinary edit is still an edit.
    await admin.patch('/api/e/unconf-2026/settings').send({ name: 'Renamed' }).expect(200);
    const after = await admin.get('/api/e/unconf-2026/audit').expect(200);
    expect(after.body.entries[0].action).toBe('update');
  });

  it('rejects a slug that is not a slug', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.patch('/api/e/testconf/settings').send({ slug: 'Not A Slug' }).expect(400);
    await admin.patch('/api/e/testconf/settings').send({ slug: 'ab' }).expect(400);
  });
});
