import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DAY_ONE,
  DAY_TWO,
  actorWithRole,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';

describe('session formats', () => {
  let harness: Harness;
  let admin: Agent;
  let eventId: number;
  let roomId: number;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  const newSession = (body: Record<string, unknown> = {}) =>
    admin.post('/api/e/testconf/sessions').send({
      roomId,
      title: 'Talk',
      startsAt: at(DAY_ONE, 600),
      endsAt: at(DAY_ONE, 660),
      ...body,
    });

  it('starts with none, so the session form shows no format row', async () => {
    const res = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(res.body.formats).toEqual([]);
  });

  it('creates one with a colour nothing else is using, in the order made', async () => {
    const a = await admin.post('/api/e/testconf/formats').send({ name: 'Talk' }).expect(201);
    const b = await admin.post('/api/e/testconf/formats').send({ name: 'Workshop' }).expect(201);
    expect(a.body.color).not.toBe(b.body.color);
    // A format carries no length: see migration 015.
    expect(a.body).not.toHaveProperty('defaultMin');

    // The organiser's running order, not alphabetical — Workshop after Talk.
    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.formats.map((f: { name: string }) => f.name)).toEqual(['Talk', 'Workshop']);
  });

  it('keeps names unique per event and revives a deleted one', async () => {
    const made = await admin.post('/api/e/testconf/formats').send({ name: 'Panel' }).expect(201);
    await admin.post('/api/e/testconf/formats').send({ name: 'Panel' }).expect(409);

    await admin.delete(`/api/e/testconf/formats/${made.body.id}`).expect(204);
    const revived = await admin.post('/api/e/testconf/formats').send({ name: 'Panel' }).expect(201);
    expect(revived.body.id).toBe(made.body.id);
  });

  it('renames and recolours, and carries no length to change', async () => {
    const made = await admin.post('/api/e/testconf/formats').send({ name: 'Talk' }).expect(201);

    const renamed = await admin
      .patch(`/api/e/testconf/formats/${made.body.id}`)
      .send({ name: 'Short talk', color: '#123456' })
      .expect(200);
    expect(renamed.body).toEqual({ id: made.body.id, name: 'Short talk', color: '#123456' });
  });

  it('is admin-only to manage, like rooms and tags', async () => {
    const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    await attendee.post('/api/e/testconf/formats').send({ name: 'Talk' }).expect(403);
  });

  it('puts a format on a session, and refuses one from another event', async () => {
    const format = await admin.post('/api/e/testconf/formats').send({ name: 'Talk' }).expect(201);
    const made = await newSession({ formatId: format.body.id }).expect(201);
    expect(made.body.formatId).toBe(format.body.id);

    await newSession({
      formatId: format.body.id + 999,
      startsAt: at(DAY_ONE, 720),
      endsAt: at(DAY_ONE, 780),
    }).expect(400);
  });

  it('leaves the format alone on a patch that does not mention it, and clears it on null', async () => {
    const format = await admin.post('/api/e/testconf/formats').send({ name: 'Talk' }).expect(201);
    const made = await newSession({ formatId: format.body.id }).expect(201);

    const retitled = await admin
      .patch(`/api/e/testconf/sessions/${made.body.id}`)
      .send({ title: 'A better title' })
      .expect(200);
    expect(retitled.body.formatId).toBe(format.body.id);

    const cleared = await admin
      .patch(`/api/e/testconf/sessions/${made.body.id}`)
      .send({ formatId: null })
      .expect(200);
    expect(cleared.body.formatId).toBeNull();
  });

  it('deleting a format leaves its sessions where they are, without a kind', async () => {
    const format = await admin.post('/api/e/testconf/formats').send({ name: 'Talk' }).expect(201);
    const made = await newSession({ formatId: format.body.id }).expect(201);

    await admin.delete(`/api/e/testconf/formats/${format.body.id}`).expect(204);

    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.formats).toEqual([]);
    const session = bundle.body.sessions.find((s: { id: number }) => s.id === made.body.id);
    expect(session).toBeDefined();
    expect(session.formatId).toBeNull();
  });

  it('gives every session of a repeat the same format', async () => {
    const format = await admin
      .post('/api/e/testconf/formats')
      .send({ name: 'Standup' })
      .expect(201);
    const res = await admin
      .post('/api/e/testconf/sessions/repeat')
      .send({
        roomId,
        title: 'Standup',
        startsAt: at(DAY_ONE, 540),
        endsAt: at(DAY_ONE, 555),
        formatId: format.body.id,
        repeat: { until: DAY_TWO },
      })
      .expect(201);
    expect(res.body.sessions.length).toBeGreaterThan(1);
    for (const session of res.body.sessions) expect(session.formatId).toBe(format.body.id);
  });

  it('carries formats into a clone, and no sessions with them', async () => {
    await admin.post('/api/e/testconf/formats').send({ name: 'Talk' }).expect(201);
    await admin
      .post('/api/events/testconf/clone')
      .send({
        newSlug: 'testconf-2',
        newName: 'Testconf 2',
        startDate: DAY_ONE,
        endDate: DAY_TWO,
        viewerPassword: 'viewer-pw-2',
        userPassword: 'user-pw-2',
        adminPassword: 'admin-pw-2',
      })
      .expect(201);

    const clone = await actorWithRole(harness, 'testconf-2', 'admin-pw-2');
    const bundle = await clone.get('/api/e/testconf-2/bundle').expect(200);
    expect(bundle.body.formats).toHaveLength(1);
    expect(bundle.body.formats[0].name).toBe('Talk');
    expect(bundle.body.sessions).toEqual([]);
  });

  it('exports the formats and what each session calls itself', async () => {
    const format = await admin.post('/api/e/testconf/formats').send({ name: 'Talk' }).expect(201);
    await newSession({ formatId: format.body.id }).expect(201);

    const res = await admin.get('/api/e/testconf/export.json').expect(200);
    expect(res.body.formats).toEqual([
      { id: format.body.id, name: 'Talk', color: expect.any(String) },
    ]);
    expect(res.body.sessions[0].formatId).toBe(format.body.id);
  });
});
