import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DAY_ONE,
  actorWithRole,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
  nextUsername,
} from './helpers.js';

describe('contributions', () => {
  let harness: Harness;
  let sessionId: number;
  let admin: Agent;
  let author: Agent;
  let otherUser: Agent;
  let viewer: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    const eventId = seedEvent(harness.db);
    const roomId = seedRoom(harness.db, eventId, { openBooking: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    author = await actorWithRole(harness, 'testconf', 'user-pw');
    otherUser = await actorWithRole(harness, 'testconf', 'user-pw');
    viewer = await actorWithRole(harness, 'testconf', 'viewer-pw');

    const res = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Talk',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    sessionId = res.body.id;
  });
  afterEach(() => harness.close());

  const post = (agent: Agent, payload: Record<string, unknown>) =>
    agent.post(`/api/e/testconf/sessions/${sessionId}/contributions`).send(payload);

  it('accepts notes and questions from users', async () => {
    const note = await post(author, { kind: 'note', body: 'A note' }).expect(201);
    expect(note.body.kind).toBe('note');
    expect(note.body.createdByName).toMatch(/^tester_/);
    await post(author, { kind: 'question', body: 'Why?' }).expect(201);
  });

  it('requires an http(s) URL for links and forbids one elsewhere', async () => {
    await post(author, { kind: 'link', body: 'Slides' }).expect(400);
    await post(author, {
      kind: 'link',
      body: 'Slides',
      url: 'javascript:alert(1)',
    }).expect(400);
    await post(author, { kind: 'note', body: 'A note', url: 'https://x.test' }).expect(400);
    const ok = await post(author, {
      kind: 'link',
      body: 'Slides',
      url: 'https://example.org/s',
    }).expect(201);
    expect(ok.body.url).toBe('https://example.org/s');
  });

  it('rejects an empty or overlong body', async () => {
    await post(author, { kind: 'note', body: '   ' }).expect(400);
    await post(author, { kind: 'note', body: 'x'.repeat(2001) }).expect(400);
  });

  it('blocks viewers', async () => {
    await post(viewer, { kind: 'note', body: 'Nope' }).expect(403);
  });

  it('lets the author delete their own but not another’s', async () => {
    const mine = await post(author, { kind: 'note', body: 'Mine' }).expect(201);
    await otherUser.delete(`/api/e/testconf/contributions/${mine.body.id}`).expect(403);
    await author.delete(`/api/e/testconf/contributions/${mine.body.id}`).expect(204);
  });

  it('lets an admin delete anyone’s', async () => {
    const theirs = await post(author, { kind: 'note', body: 'Theirs' }).expect(201);
    await admin.delete(`/api/e/testconf/contributions/${theirs.body.id}`).expect(204);
  });

  it('hides a contribution from non-admins but keeps it for admins', async () => {
    const item = await post(author, { kind: 'note', body: 'Spam' }).expect(201);
    await author
      .patch(`/api/e/testconf/contributions/${item.body.id}/hidden`)
      .send({ hidden: true })
      .expect(403);
    await admin
      .patch(`/api/e/testconf/contributions/${item.body.id}/hidden`)
      .send({ hidden: true })
      .expect(200);

    const asUser = await author.get(`/api/e/testconf/sessions/${sessionId}`).expect(200);
    expect(asUser.body.contributions).toHaveLength(0);

    const asAdmin = await admin.get(`/api/e/testconf/sessions/${sessionId}`).expect(200);
    expect(asAdmin.body.contributions).toHaveLength(1);
    expect(asAdmin.body.contributions[0].hidden).toBe(true);
  });

  it('counts only visible contributions in the bundle', async () => {
    const a = await post(author, { kind: 'note', body: 'One' }).expect(201);
    await post(author, { kind: 'note', body: 'Two' }).expect(201);
    await admin.patch(`/api/e/testconf/contributions/${a.body.id}/hidden`).send({ hidden: true });

    const userBundle = await author.get('/api/e/testconf/bundle').expect(200);
    expect(userBundle.body.contributionCounts[sessionId]).toBe(1);

    const adminBundle = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(adminBundle.body.contributionCounts[sessionId]).toBe(2);
  });

  it('404s a contribution belonging to another event', async () => {
    const otherEvent = seedEvent(harness.db, { slug: 'other' });
    const otherRoom = seedRoom(harness.db, otherEvent, { openBooking: 1 });
    const otherAdmin = await actorWithRole(harness, 'other', 'admin-pw');
    const otherSession = await otherAdmin
      .post('/api/e/other/sessions')
      .send({
        roomId: otherRoom,
        title: 'Elsewhere',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    const foreign = await otherAdmin
      .post(`/api/e/other/sessions/${otherSession.body.id}/contributions`)
      .send({ kind: 'note', body: 'Elsewhere' })
      .expect(201);

    await admin.delete(`/api/e/testconf/contributions/${foreign.body.id}`).expect(404);
  });

  it('rate limits at 10 contributions a minute', async () => {
    for (let i = 0; i < 10; i++) {
      await post(author, { kind: 'note', body: `n${i}` }).expect(201);
    }
    const res = await post(author, { kind: 'note', body: 'over' }).expect(429);
    expect(res.body.error.code).toBe('rate_limited');
  });
});

describe('rooms and tags', () => {
  let harness: Harness;
  let eventId: number;
  let admin: Agent;
  let user: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    user = await actorWithRole(harness, 'testconf', 'user-pw');
  });
  afterEach(() => harness.close());

  it('is admin-only', async () => {
    await user.post('/api/e/testconf/rooms').send({ name: 'Nope' }).expect(403);
    await user.post('/api/e/testconf/tags').send({ name: 'Nope' }).expect(403);
    await user.patch('/api/e/testconf/settings').send({ name: 'Nope' }).expect(403);
  });

  it('creates, patches and soft-deletes a room', async () => {
    const created = await admin
      .post('/api/e/testconf/rooms')
      .send({ name: 'Hall', capacity: 100, openBooking: true })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Hall', capacity: 100, openBooking: true });

    const patched = await admin
      .patch(`/api/e/testconf/rooms/${created.body.id}`)
      .send({ openBooking: false })
      .expect(200);
    expect(patched.body.openBooking).toBe(false);

    await admin.delete(`/api/e/testconf/rooms/${created.body.id}`).expect(204);
    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.rooms).toHaveLength(0);
  });

  it('edits a room’s capacity and description together', async () => {
    const created = await admin.post('/api/e/testconf/rooms').send({ name: 'Hall' }).expect(201);
    expect(created.body).toMatchObject({ capacity: null, description: '' });

    const patched = await admin
      .patch(`/api/e/testconf/rooms/${created.body.id}`)
      .send({ name: 'Main Hall', capacity: 250, description: 'Ground floor, past the desk' })
      .expect(200);
    expect(patched.body).toMatchObject({
      name: 'Main Hall',
      capacity: 250,
      description: 'Ground floor, past the desk',
    });
  });

  it('clears a room’s capacity back to null', async () => {
    // The admin form sends null for a blank capacity box. `null` is a real
    // value here — "no capacity set" — and must not be read as "unchanged",
    // which is what an `??` on the server would do.
    const created = await admin
      .post('/api/e/testconf/rooms')
      .send({ name: 'Hall', capacity: 80 })
      .expect(201);

    const cleared = await admin
      .patch(`/api/e/testconf/rooms/${created.body.id}`)
      .send({ capacity: null })
      .expect(200);
    expect(cleared.body.capacity).toBeNull();
    expect(cleared.body.name).toBe('Hall');
  });

  it('gives each new room a colour no other room is using', async () => {
    const a = await admin.post('/api/e/testconf/rooms').send({ name: 'A' }).expect(201);
    const b = await admin.post('/api/e/testconf/rooms').send({ name: 'B' }).expect(201);
    const c = await admin.post('/api/e/testconf/rooms').send({ name: 'C' }).expect(201);
    const colors = [a.body.color, b.body.color, c.body.color];
    expect(new Set(colors).size).toBe(3);
    for (const color of colors) expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('honours an explicitly chosen colour', async () => {
    const res = await admin
      .post('/api/e/testconf/rooms')
      .send({ name: 'Hall', color: '#123456' })
      .expect(201);
    expect(res.body.color).toBe('#123456');

    const patched = await admin
      .patch(`/api/e/testconf/rooms/${res.body.id}`)
      .send({ color: '#abcdef' })
      .expect(200);
    expect(patched.body.color).toBe('#abcdef');
  });

  it('rejects a colour that is not a hex triplet', async () => {
    await admin.post('/api/e/testconf/rooms').send({ name: 'X', color: 'red' }).expect(400);
    await admin.post('/api/e/testconf/rooms').send({ name: 'X', color: '#fff' }).expect(400);
  });

  it('leaves fields the patch omits untouched', async () => {
    const created = await admin
      .post('/api/e/testconf/rooms')
      .send({ name: 'Hall', capacity: 80, description: 'Upstairs', openBooking: true })
      .expect(201);

    const patched = await admin
      .patch(`/api/e/testconf/rooms/${created.body.id}`)
      .send({ name: 'Hall B' })
      .expect(200);
    expect(patched.body).toMatchObject({
      name: 'Hall B',
      capacity: 80,
      description: 'Upstairs',
      openBooking: true,
    });
  });

  it('refuses to delete a room that still has sessions', async () => {
    const roomId = seedRoom(harness.db, eventId, { openBooking: 1 });
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Occupied',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    const res = await admin.delete(`/api/e/testconf/rooms/${roomId}`).expect(409);
    expect(res.body.error.code).toBe('room_in_use');
  });

  it('keeps tag names unique per event and revives a deleted one', async () => {
    const created = await admin.post('/api/e/testconf/tags').send({ name: 'AI' }).expect(201);
    await admin.post('/api/e/testconf/tags').send({ name: 'AI' }).expect(409);

    await admin.delete(`/api/e/testconf/tags/${created.body.id}`).expect(204);
    const revived = await admin
      .post('/api/e/testconf/tags')
      .send({ name: 'AI', color: '#123456' })
      .expect(201);
    expect(revived.body.id).toBe(created.body.id);
    expect(revived.body.color).toBe('#123456');
  });

  it('renames a tag and recolours it', async () => {
    const tag = await admin.post('/api/e/testconf/tags').send({ name: 'AI' }).expect(201);
    const patched = await admin
      .patch(`/api/e/testconf/tags/${tag.body.id}`)
      .send({ name: 'Machine learning', color: '#123456' })
      .expect(200);
    expect(patched.body).toMatchObject({
      id: tag.body.id,
      name: 'Machine learning',
      color: '#123456',
    });
  });

  it('leaves the colour alone when only the name is patched', async () => {
    const tag = await admin
      .post('/api/e/testconf/tags')
      .send({ name: 'AI', color: '#abcdef' })
      .expect(201);
    const patched = await admin
      .patch(`/api/e/testconf/tags/${tag.body.id}`)
      .send({ name: 'ML' })
      .expect(200);
    expect(patched.body.color).toBe('#abcdef');
  });

  it('refuses to rename a tag onto another tag’s name', async () => {
    await admin.post('/api/e/testconf/tags').send({ name: 'AI' }).expect(201);
    const other = await admin.post('/api/e/testconf/tags').send({ name: 'Web' }).expect(201);
    const res = await admin
      .patch(`/api/e/testconf/tags/${other.body.id}`)
      .send({ name: 'AI' })
      .expect(409);
    expect(res.body.error.code).toBe('tag_exists');
  });

  it('lets a tag keep its own name on an unrelated patch', async () => {
    const tag = await admin.post('/api/e/testconf/tags').send({ name: 'AI' }).expect(201);
    await admin
      .patch(`/api/e/testconf/tags/${tag.body.id}`)
      .send({ name: 'AI', color: '#000000' })
      .expect(200);
  });

  it('drops a deleted tag from its sessions', async () => {
    const roomId = seedRoom(harness.db, eventId, { openBooking: 1 });
    const tag = await admin.post('/api/e/testconf/tags').send({ name: 'Web' }).expect(201);
    const session = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Tagged',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
        tagIds: [tag.body.id],
      })
      .expect(201);
    expect(session.body.tagIds).toEqual([tag.body.id]);

    await admin.delete(`/api/e/testconf/tags/${tag.body.id}`).expect(204);
    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.sessions[0].tagIds).toEqual([]);
  });

  it('validates the colour format', async () => {
    await admin.post('/api/e/testconf/tags').send({ name: 'Bad', color: 'red' }).expect(400);
  });
});

describe('event settings and creation', () => {
  let harness: Harness;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  it('needs the instance key to create an event', async () => {
    const payload = {
      name: 'New Conf',
      slug: 'new-conf',
      timezone: 'Europe/Berlin',
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      viewerPassword: 'viewer1',
      userPassword: 'user111',
      adminPassword: 'admin11',
    };
    await admin.post('/api/events').send(payload).expect(403);
    const res = await admin
      .post('/api/events')
      .set('X-Instance-Key', 'instance-pw')
      .send(payload)
      .expect(201);
    expect(res.body.slug).toBe('new-conf');

    // The creator is that event's admin straight away.
    const me = await admin.get('/api/me').expect(200);
    expect(me.body.roles['new-conf']).toBe('admin');
  });

  it('rejects a duplicate slug and a bad timezone', async () => {
    const base = {
      name: 'X',
      timezone: 'Europe/Berlin',
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      viewerPassword: 'viewer1',
      userPassword: 'user111',
      adminPassword: 'admin11',
    };
    await admin
      .post('/api/events')
      .set('X-Instance-Key', 'instance-pw')
      .send({ ...base, slug: 'testconf' })
      .expect(409);
    await admin
      .post('/api/events')
      .set('X-Instance-Key', 'instance-pw')
      .send({ ...base, slug: 'tz-conf', timezone: 'Mars/Olympus' })
      .expect(400);
  });

  it('carries the week-rail threshold into a clone', async () => {
    await admin.patch('/api/e/testconf/settings').send({ weekRailFrom: 21 }).expect(200);
    await admin
      .post('/api/events/testconf/clone')
      .send({
        newSlug: 'testconf-rail',
        newName: 'Test Conf Rail',
        startDate: '2027-06-01',
        endDate: '2027-06-30',
        viewerPassword: 'viewer2',
        userPassword: 'user222',
        adminPassword: 'admin22',
      })
      .expect(201);
    await admin
      .post('/api/e/testconf-rail/auth')
      .send({ password: 'admin22', displayName: nextUsername() })
      .expect(200);
    const res = await admin.get('/api/e/testconf-rail/bundle').expect(200);
    expect(res.body.event.weekRailFrom).toBe(21);
  });

  it('defaults the week-rail threshold to eight days', async () => {
    const res = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(res.body.event.weekRailFrom).toBe(8);
  });

  it('lets an organiser change the week-rail threshold', async () => {
    const res = await admin
      .patch('/api/e/testconf/settings')
      .send({ weekRailFrom: 21 })
      .expect(200);
    expect(res.body.weekRailFrom).toBe(21);
  });

  it('refuses a week-rail threshold outside 1–90', async () => {
    await admin.patch('/api/e/testconf/settings').send({ weekRailFrom: 0 }).expect(400);
    await admin.patch('/api/e/testconf/settings').send({ weekRailFrom: 91 }).expect(400);
    await admin.patch('/api/e/testconf/settings').send({ weekRailFrom: 4.5 }).expect(400);
  });

  it('leaves the threshold alone when a patch omits it', async () => {
    await admin.patch('/api/e/testconf/settings').send({ weekRailFrom: 14 }).expect(200);
    const res = await admin.patch('/api/e/testconf/settings').send({ name: 'Renamed' }).expect(200);
    expect(res.body.weekRailFrom).toBe(14);
  });

  it('clones rooms and tags but no sessions', async () => {
    await admin.post('/api/e/testconf/rooms').send({ name: 'Hall', openBooking: true }).expect(201);
    await admin.post('/api/e/testconf/tags').send({ name: 'AI' }).expect(201);
    const room = (await admin.get('/api/e/testconf/bundle')).body.rooms[0];
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId: room.id,
        title: 'Not copied',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);

    await admin
      .post('/api/events/testconf/clone')
      .send({
        newSlug: 'testconf-2',
        newName: 'Test Conf 2',
        startDate: '2027-06-01',
        endDate: '2027-06-02',
        viewerPassword: 'viewer2',
        userPassword: 'user222',
        adminPassword: 'admin22',
      })
      .expect(201);

    const clone = await admin.get('/api/e/testconf-2/bundle').expect(200);
    expect(clone.body.rooms.map((r: { name: string }) => r.name)).toEqual(['Hall']);
    expect(clone.body.tags.map((t: { name: string }) => t.name)).toEqual(['AI']);
    expect(clone.body.sessions).toEqual([]);
    expect(clone.body.event.startDate).toBe('2027-06-01');
  });

  it('changes passwords through settings', async () => {
    await admin.patch('/api/e/testconf/settings').send({ adminPassword: 'brand-new' }).expect(200);
    const fresh = await actorWithRole(harness, 'testconf', 'brand-new');
    const bundle = await fresh.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.role).toBe('admin');
  });

  it('defaults the user role label to attendee and lets an admin rename it', async () => {
    const before = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(before.body.event.userRoleLabel).toBe('attendee');

    const updated = await admin
      .patch('/api/e/testconf/settings')
      .send({ userRoleLabel: '  participant  ' })
      .expect(200);
    expect(updated.body.userRoleLabel).toBe('participant');

    await admin.patch('/api/e/testconf/settings').send({ userRoleLabel: '   ' }).expect(400);
    await admin
      .patch('/api/e/testconf/settings')
      .send({ userRoleLabel: 'x'.repeat(25) })
      .expect(400);
  });

  it('takes a user role label at creation and carries it into a clone', async () => {
    await admin
      .post('/api/events')
      .set('X-Instance-Key', 'instance-pw')
      .send({
        name: 'Labelled',
        slug: 'labelled',
        timezone: 'Europe/Berlin',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        viewerPassword: 'viewer1',
        userPassword: 'user111',
        adminPassword: 'admin11',
        userRoleLabel: 'member',
      })
      .expect(201);
    const bundle = await admin.get('/api/e/labelled/bundle').expect(200);
    expect(bundle.body.event.userRoleLabel).toBe('member');

    await admin
      .post('/api/events/labelled/clone')
      .send({
        newSlug: 'labelled-2',
        newName: 'Labelled 2',
        startDate: '2027-09-01',
        endDate: '2027-09-02',
        viewerPassword: 'viewer2',
        userPassword: 'user222',
        adminPassword: 'admin22',
      })
      .expect(201);
    const clone = await admin.get('/api/e/labelled-2/bundle').expect(200);
    expect(clone.body.event.userRoleLabel).toBe('member');
  });

  it('rejects an end date before the start', async () => {
    await admin
      .patch('/api/e/testconf/settings')
      .send({ startDate: '2026-06-05', endDate: '2026-06-01' })
      .expect(400);
  });
});
