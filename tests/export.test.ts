import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventExport } from '../server/src/shared/types.js';
import {
  actorWithRole,
  at,
  DAY_ONE,
  makeHarness,
  seedEvent,
  seedRoom,
  seedTag,
  type Agent,
  type Harness,
} from './helpers.js';

describe('per-event JSON export', () => {
  let harness: Harness;
  let admin: Agent;
  let eventId: number;
  let roomId: number;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { name: 'Main hall' });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });

  afterEach(() => harness.close());

  const fetchExport = async (agent: Agent): Promise<EventExport> => {
    const res = await agent.get('/api/e/testconf/export.json').expect(200);
    return JSON.parse(res.text) as EventExport;
  };

  it('is admin-only', async () => {
    const viewer = await actorWithRole(harness, 'testconf', 'viewer-pw');
    await viewer.get('/api/e/testconf/export.json').expect(403);
    const user = await actorWithRole(harness, 'testconf', 'user-pw');
    await user.get('/api/e/testconf/export.json').expect(403);
    await admin.get('/api/e/testconf/export.json').expect(200);
  });

  it('downloads as a file named for the event', async () => {
    const res = await admin.get('/api/e/testconf/export.json').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="testconf-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('carries the whole programme', async () => {
    const tagId = seedTag(harness.db, eventId, 'Deep dive');
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Opening',
        description: 'How this works',
        speakers: ['Ada'],
        tagIds: [tagId],
        startsAt: at(DAY_ONE, 9 * 60),
        endsAt: at(DAY_ONE, 10 * 60),
      })
      .expect(201);
    await admin
      .post('/api/e/testconf/proposals')
      .send({ title: 'A pitch', description: 'maybe later', tagIds: [tagId] })
      .expect(201);

    const dump = await fetchExport(admin);
    expect(dump.format).toBe('libresesh.event');
    expect(dump.version).toBe(1);
    expect(dump.event.slug).toBe('testconf');
    expect(dump.rooms.map((r) => r.name)).toEqual(['Main hall']);
    expect(dump.tags.map((t) => t.name)).toEqual(['Deep dive']);
    expect(dump.sessions).toHaveLength(1);
    expect(dump.sessions[0]?.title).toBe('Opening');
    expect(dump.sessions[0]?.tagIds).toEqual([tagId]);
    expect(dump.sessions[0]?.speaker).toBe('Ada');
    expect(dump.proposals.map((p) => p.title)).toEqual(['A pitch']);
    expect(dump.people.map((p) => p.name)).toContain('Ada');
  });

  it("carries a track's context, so an export can rebuild what it said", async () => {
    await admin
      .post('/api/e/testconf/tracks')
      .send({ name: 'Workshops', description: 'Hands-on. Bring a laptop.' })
      .expect(201);
    await admin.post('/api/e/testconf/tracks').send({ name: 'Talks' }).expect(201);

    const dump = await fetchExport(admin);
    expect(dump.tracks.map((t) => t.name)).toEqual(['Workshops', 'Talks']);
    expect(dump.tracks.map((t) => t.description)).toEqual(['Hands-on. Bring a laptop.', '']);
  });

  it('keeps contributions with the name that wrote them', async () => {
    const created = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Talk',
        startsAt: at(DAY_ONE, 9 * 60),
        endsAt: at(DAY_ONE, 10 * 60),
      })
      .expect(201);
    const sessionId = (created.body as { id: number }).id;
    await admin
      .post(`/api/e/testconf/sessions/${sessionId}/contributions`)
      .send({ kind: 'note', body: 'A note from the room' })
      .expect(201);

    const dump = await fetchExport(admin);
    expect(dump.contributions).toHaveLength(1);
    expect(dump.contributions[0]?.body).toBe('A note from the room');
    expect(dump.contributions[0]?.createdByName).toBeTruthy();
  });

  it('leaves deleted rows out', async () => {
    const created = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Cancelled',
        startsAt: at(DAY_ONE, 11 * 60),
        endsAt: at(DAY_ONE, 12 * 60),
      })
      .expect(201);
    await admin
      .delete(`/api/e/testconf/sessions/${(created.body as { id: number }).id}`)
      .expect(204);

    const dump = await fetchExport(admin);
    expect(dump.sessions).toHaveLength(0);
  });

  it('counts stars and pitch interest without saying who', async () => {
    const created = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Popular',
        startsAt: at(DAY_ONE, 13 * 60),
        endsAt: at(DAY_ONE, 14 * 60),
      })
      .expect(201);
    const sessionId = (created.body as { id: number }).id;
    const user = await actorWithRole(harness, 'testconf', 'user-pw');
    await user.put(`/api/e/testconf/sessions/${sessionId}/star`).expect(204);

    const dump = await fetchExport(admin);
    expect(dump.sessions[0]?.starCount).toBe(1);
    expect(JSON.stringify(dump)).not.toContain('identityId');
  });

  /**
   * The point of this export existing separately from the encrypted whole-DB
   * one: it is safe to hand to an organiser. If a secret ever leaks into it,
   * this is the test that should fail.
   */
  it('contains no secret material', async () => {
    const admins = harness.db
      .prepare<[], { admin_pw_hash: string }>('SELECT admin_pw_hash FROM events')
      .all();
    const identities = harness.db
      .prepare<[], { token: string }>('SELECT token FROM identities')
      .all();
    expect(identities.length).toBeGreaterThan(0);

    const text = (await admin.get('/api/e/testconf/export.json').expect(200)).text;
    for (const row of admins) expect(text).not.toContain(row.admin_pw_hash);
    for (const row of identities) expect(text).not.toContain(row.token);
    expect(text).not.toContain('pw_hash');
    expect(text).not.toContain('token');
  });
});
