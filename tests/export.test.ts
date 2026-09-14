import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventExport } from '../server/src/shared/types.js';
import {
  actorWithRole,
  at,
  DAY_ONE,
  DAY_TWO,
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
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="testconf-\d{4}-\d{2}-\d{2}\.json"/,
    );
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
    expect(dump.sessions![0]?.title).toBe('Opening');
    expect(dump.sessions![0]?.tagIds).toEqual([tagId]);
    expect(dump.sessions![0]?.speaker).toBe('Ada');
    expect(dump.proposals!.map((p) => p.title)).toEqual(['A pitch']);
    expect(dump.people!.map((p) => p.name)).toContain('Ada');
  });

  it("carries a track's context, so an export can rebuild what it said", async () => {
    await admin
      .post('/api/e/testconf/tracks')
      .send({ name: 'Workshops', description: 'Hands-on. Bring a laptop.' })
      .expect(201);
    await admin.post('/api/e/testconf/tracks').send({ name: 'Talks' }).expect(201);

    const dump = await fetchExport(admin);
    expect(dump.tracks!.map((t) => t.name)).toEqual(['Workshops', 'Talks']);
    expect(dump.tracks!.map((t) => t.description)).toEqual(['Hands-on. Bring a laptop.', '']);
  });

  it('carries the rest of Settings, and who may do what', async () => {
    await admin
      .patch('/api/e/testconf/settings')
      .send({ weekRailFrom: 21, auditKeep: 500, showOfficialBadge: true, pitchesEnabled: false })
      .expect(200);
    // Withdraw starring from viewers; everything else stays at its default.
    await admin
      .patch('/api/e/testconf/permissions')
      .send({ 'session.star': ['user', 'speaker', 'admin'] })
      .expect(200);

    const dump = await fetchExport(admin);
    expect(dump.event).toMatchObject({
      weekRailFrom: 21,
      auditKeep: 500,
      showOfficialBadge: true,
      pitchesEnabled: false,
    });
    // The effective matrix, every capability present, not just the override.
    expect(dump.permissions!['session.star']).toEqual(['user', 'speaker', 'admin']);
    expect(dump.permissions!['proposal.vote']).toEqual(['viewer', 'user', 'speaker', 'admin']);
    expect(Object.keys(dump.permissions!)).toContain('contribution.moderate');
  });

  it('says which sessions are one linked run', async () => {
    const ids: number[] = [];
    for (const day of [DAY_ONE, DAY_TWO]) {
      const res = await admin
        .post('/api/e/testconf/sessions')
        .send({ roomId, title: 'Morning yoga', startsAt: at(day, 8 * 60), endsAt: at(day, 9 * 60) })
        .expect(201);
      ids.push((res.body as { id: number }).id);
    }
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'On its own',
        startsAt: at(DAY_ONE, 10 * 60),
        endsAt: at(DAY_ONE, 11 * 60),
      })
      .expect(201);
    await admin.post('/api/e/testconf/sessions/link').send({ sessionIds: ids }).expect(200);

    const dump = await fetchExport(admin);
    const yoga = dump.sessions!.filter((s) => s.title === 'Morning yoga');
    expect(yoga).toHaveLength(2);
    expect(yoga[0]!.seriesId).toEqual(expect.any(String));
    expect(yoga[1]!.seriesId).toBe(yoga[0]!.seriesId);
    expect(dump.sessions!.find((s) => s.title === 'On its own')!.seriesId).toBeNull();
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
    expect(dump.contributions![0]?.body).toBe('A note from the room');
    expect(dump.contributions![0]?.createdByName).toBeTruthy();
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
    expect(dump.sessions![0]?.starCount).toBe(1);
    expect(JSON.stringify(dump)).not.toContain('identityId');
  });

  describe('choosing what goes in', () => {
    beforeEach(async () => {
      const created = await admin
        .post('/api/e/testconf/sessions')
        .send({
          roomId,
          title: 'Talk',
          speakers: ['Ada'],
          startsAt: at(DAY_ONE, 9 * 60),
          endsAt: at(DAY_ONE, 10 * 60),
        })
        .expect(201);
      await admin
        .post(`/api/e/testconf/sessions/${(created.body as { id: number }).id}/contributions`)
        .send({ kind: 'note', body: 'A note' })
        .expect(201);
      await admin.post('/api/e/testconf/proposals').send({ title: 'A pitch' }).expect(201);
    });

    it('is everything unless asked otherwise', async () => {
      const dump = await fetchExport(admin);
      expect(Object.keys(dump)).toEqual(
        expect.arrayContaining([
          'permissions',
          'rooms',
          'tracks',
          'tags',
          'formats',
          'breaks',
          'sessions',
          'people',
          'proposals',
          'contributions',
        ]),
      );
      expect(dump.event.dayStartMin).toBe(480);
    });

    it('leaves a part out entirely — absent, not empty', async () => {
      const res = await admin.get('/api/e/testconf/export.json?include=people').expect(200);
      const dump = JSON.parse(res.text) as EventExport;
      expect(dump.people!.map((p) => p.name)).toContain('Ada');
      expect('sessions' in dump).toBe(false);
      expect('proposals' in dump).toBe(false);
      expect('contributions' in dump).toBe(false);
      expect('rooms' in dump).toBe(false);
      expect('permissions' in dump).toBe(false);
      // The identity is not a choice.
      expect(dump.event.slug).toBe('testconf');
      expect('dayStartMin' in dump.event).toBe(false);
    });

    it('leaves the settings and the matrix out when asked, and keeps the rest', async () => {
      const res = await admin.get('/api/e/testconf/export.json?include=rooms,tags').expect(200);
      const dump = JSON.parse(res.text) as EventExport;
      expect(Object.keys(dump).sort()).toEqual([
        'event',
        'exportedAt',
        'format',
        'rooms',
        'tags',
        'version',
      ]);
      expect(dump.rooms!.map((r) => r.name)).toEqual(['Main hall']);
    });

    it('points at nothing that was left out', async () => {
      const tagId = seedTag(harness.db, eventId, 'Deep dive');
      const track = await admin.post('/api/e/testconf/tracks').send({ name: 'Talks' }).expect(201);
      await admin
        .post('/api/e/testconf/sessions')
        .send({
          roomId,
          trackId: (track.body as { id: number }).id,
          tagIds: [tagId],
          title: 'Tagged',
          startsAt: at(DAY_ONE, 11 * 60),
          endsAt: at(DAY_ONE, 12 * 60),
        })
        .expect(201);
      const res = await admin
        .get('/api/e/testconf/export.json?include=rooms,sessions,proposals')
        .expect(200);
      const dump = JSON.parse(res.text) as EventExport;
      const tagged = dump.sessions!.find((s) => s.title === 'Tagged')!;
      // Tags and tracks were not asked for, so the session names none.
      expect(tagged.tagIds).toEqual([]);
      expect(tagged.trackId).toBeNull();
      // A pitch's link to its placed session survives only with the sessions.
      const without = JSON.parse(
        (await admin.get('/api/e/testconf/export.json?include=proposals').expect(200)).text,
      ) as EventExport;
      expect(without.proposals!.every((p) => p.placedSessionId === null)).toBe(true);
      // And it reads back whole, because nothing in it points outside it.
      const importer = await actorWithRole(harness, 'testconf', 'viewer-pw');
      await importer
        .post('/api/events/import?dryRun=1')
        .set('X-Instance-Key', 'instance-pw')
        .send({ ...dump, event: { ...dump.event, slug: 'testconf-thin' } })
        .expect(200);
    });

    it('takes a list, in any order, with room for a stray space', async () => {
      const res = await admin
        .get('/api/e/testconf/export.json?include=contributions,%20sessions')
        .expect(200);
      const dump = JSON.parse(res.text) as EventExport;
      expect(dump.sessions).toHaveLength(1);
      expect(dump.contributions).toHaveLength(1);
      expect('people' in dump).toBe(false);
    });

    it('is the identity alone when asked for nothing else', async () => {
      const res = await admin.get('/api/e/testconf/export.json?include=').expect(200);
      const dump = JSON.parse(res.text) as EventExport;
      expect(Object.keys(dump).sort()).toEqual(['event', 'exportedAt', 'format', 'version']);
      expect(Object.keys(dump.event).sort()).toEqual([
        'archived',
        'createdAt',
        'endDate',
        'name',
        'slug',
        'startDate',
        'timezone',
      ]);
    });

    it('refuses a part it does not have rather than quietly thinning the file', async () => {
      await admin.get('/api/e/testconf/export.json?include=sessions,stars').expect(400);
    });

    it('imports back whatever was chosen', async () => {
      const res = await admin.get('/api/e/testconf/export.json?include=rooms,sessions').expect(200);
      const dump = JSON.parse(res.text) as EventExport;
      const importer = await actorWithRole(harness, 'testconf', 'viewer-pw');
      const result = await importer
        .post('/api/events/import?dryRun=1')
        .set('X-Instance-Key', 'instance-pw')
        .send({ ...dump, event: { ...dump.event, slug: 'testconf-copy' } })
        .expect(200);
      expect((result.body as { counts: { sessions: number } }).counts.sessions).toBe(1);
    });
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
