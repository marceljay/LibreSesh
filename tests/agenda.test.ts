import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DAY_ONE,
  actorWithRole,
  agentFor,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';

describe('personal agenda', () => {
  let harness: Harness;
  let roomId: number;
  let admin: Agent;
  let viewer: Agent;
  let other: Agent;
  let sessionA: number;
  let sessionB: number;

  beforeEach(async () => {
    harness = makeHarness();
    const eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { name: 'Main Hall', openBooking: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    viewer = await actorWithRole(harness, 'testconf', 'viewer-pw');
    other = await actorWithRole(harness, 'testconf', 'viewer-pw');

    const a = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Keynote; with a semicolon',
        speakers: ['Ada Lovelace'],
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    const b = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Second',
        startsAt: at(DAY_ONE, 700),
        endsAt: at(DAY_ONE, 760),
      })
      .expect(201);
    sessionA = a.body.id;
    sessionB = b.body.id;
  });
  afterEach(() => harness.close());

  describe('starring', () => {
    it('stars and unstars, and reports it in the bundle', async () => {
      await viewer.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      let bundle = await viewer.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.starredSessionIds).toEqual([sessionA]);

      await viewer.delete(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      bundle = await viewer.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.starredSessionIds).toEqual([]);
    });

    it('is idempotent', async () => {
      await viewer.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      await viewer.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      const bundle = await viewer.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.starredSessionIds).toEqual([sessionA]);
    });

    it('unstarring something never starred is harmless', async () => {
      await viewer.delete(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
    });

    it('keeps one person’s stars private to them', async () => {
      await viewer.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      const theirs = await other.get('/api/e/testconf/bundle').expect(200);
      expect(theirs.body.starredSessionIds).toEqual([]);
    });

    it('counts stars across everyone as an interest signal', async () => {
      await viewer.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      await other.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      await other.put(`/api/e/testconf/sessions/${sessionB}/star`).expect(204);

      const bundle = await viewer.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.starCounts[sessionA]).toBe(2);
      expect(bundle.body.starCounts[sessionB]).toBe(1);
      // Everyone sees the same totals, not just their own.
      const asOther = await other.get('/api/e/testconf/bundle').expect(200);
      expect(asOther.body.starCounts).toEqual(bundle.body.starCounts);
    });

    it('omits a session nobody starred from the counts', async () => {
      const bundle = await viewer.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.starCounts[sessionA]).toBeUndefined();
    });

    it('drops the count when the session is deleted', async () => {
      await viewer.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      await admin.delete(`/api/e/testconf/sessions/${sessionA}`).expect(204);
      const bundle = await viewer.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.starCounts[sessionA]).toBeUndefined();
    });

    it('needs a role', async () => {
      await agentFor(harness).put(`/api/e/testconf/sessions/${sessionA}/star`).expect(401);
    });

    it('404s an unknown session', async () => {
      await viewer.put('/api/e/testconf/sessions/9999/star').expect(404);
    });

    it('drops a starred session from the list once it is deleted', async () => {
      await viewer.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      await admin.delete(`/api/e/testconf/sessions/${sessionA}`).expect(204);
      const bundle = await viewer.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.starredSessionIds).toEqual([]);
    });

    it('still works on an archived event, since a bookmark is not event content', async () => {
      await admin.patch('/api/e/testconf/settings').send({ archived: true }).expect(200);
      await viewer.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
    });
  });

  describe('iCal feed', () => {
    it('serves the whole schedule to a signed-in viewer', async () => {
      const res = await viewer.get('/api/e/testconf/calendar.ics').expect(200);
      expect(res.headers['content-type']).toMatch(/text\/calendar/);
      expect(res.headers['content-disposition']).toContain('testconf.ics');
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect((res.text.match(/BEGIN:VEVENT/g) ?? []).length).toBe(2);
      expect(res.text).toContain('LOCATION:Main Hall');
      expect(res.text).toContain('Speaker: Ada Lovelace');
      // The semicolon in the title must arrive escaped, not raw.
      expect(res.text).toContain(String.raw`SUMMARY:Keynote\; with a semicolon`);
    });

    it('filters to starred sessions with mine=1', async () => {
      await viewer.put(`/api/e/testconf/sessions/${sessionB}/star`).expect(204);
      const res = await viewer.get('/api/e/testconf/calendar.ics?mine=1').expect(200);
      expect((res.text.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
      expect(res.text).toContain('SUMMARY:Second');
      expect(res.headers['content-disposition']).toContain('testconf-my-agenda.ics');
    });

    it('refuses a stranger with no role and no token', async () => {
      await agentFor(harness).get('/api/e/testconf/calendar.ics').expect(401);
    });

    it('lets a token stand in for the cookie', async () => {
      await viewer.put(`/api/e/testconf/sessions/${sessionA}/star`).expect(204);
      const { body } = await viewer.post('/api/e/testconf/calendar-token').expect(200);
      expect(body.token).toBeTruthy();

      // A fresh client with no cookie — this is what a calendar app looks like.
      const stranger = agentFor(harness);
      const res = await stranger
        .get(`/api/e/testconf/calendar.ics?token=${body.token}&mine=1`)
        .expect(200);
      expect((res.text.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
      expect(res.text).toContain('SUMMARY:Keynote');
    });

    it('returns the same token on a second request', async () => {
      const first = await viewer.post('/api/e/testconf/calendar-token').expect(200);
      const second = await viewer.post('/api/e/testconf/calendar-token').expect(200);
      expect(second.body.token).toBe(first.body.token);
    });

    it('rejects a bogus token', async () => {
      await agentFor(harness).get('/api/e/testconf/calendar.ics?token=nonsense').expect(401);
    });

    it('stops honouring a token once its owner loses the role', async () => {
      const { body } = await viewer.post('/api/e/testconf/calendar-token').expect(200);
      await agentFor(harness).get(`/api/e/testconf/calendar.ics?token=${body.token}`).expect(200);
      await viewer.post('/api/e/testconf/logout').expect(204);
      await agentFor(harness).get(`/api/e/testconf/calendar.ics?token=${body.token}`).expect(401);
    });

    it('does not leak another event through a valid token', async () => {
      seedEvent(harness.db, { slug: 'other' });
      const { body } = await viewer.post('/api/e/testconf/calendar-token').expect(200);
      await agentFor(harness).get(`/api/e/other/calendar.ics?token=${body.token}`).expect(401);
    });

    it('omits deleted sessions', async () => {
      await admin.delete(`/api/e/testconf/sessions/${sessionB}`).expect(204);
      const res = await viewer.get('/api/e/testconf/calendar.ics').expect(200);
      expect((res.text.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
      expect(res.text).not.toContain('SUMMARY:Second');
    });
  });
});
