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
} from './helpers.js';
import { pruneNotifications } from '../server/src/notifications.js';

/**
 * Delivery: a mention that survives a closed tab, and the three other things
 * worth being told about. The design is in
 * `_planning/specs/mentions-and-notifications.md`.
 *
 * What these pin is mostly what *does not* get written — the silence rules are
 * the difference between a bell people keep and one they switch off on the
 * first day.
 */
describe('notifications', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;
  let ada: Agent;
  let grace: Agent;
  let sessionId: number;

  const inbox = (who: Agent) => who.get('/api/e/testconf/notifications').expect(200);

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw', 'organiser');
    ada = await actorWithRole(harness, 'testconf', 'user-pw', 'ada');
    grace = await actorWithRole(harness, 'testconf', 'user-pw', 'grace');

    const res = await admin
      .post('/api/e/testconf/sessions')
      .send({ roomId, title: 'Talk', startsAt: at(DAY_ONE, 600), endsAt: at(DAY_ONE, 660) })
      .expect(201);
    sessionId = res.body.id;
  });

  afterEach(() => harness.close());

  const comment = (who: Agent, body: string) =>
    who.post(`/api/e/testconf/sessions/${sessionId}/contributions`).send({ kind: 'note', body });

  describe('a mention', () => {
    it('lands in the mentioned person’s inbox, not the room’s', async () => {
      await comment(grace, 'ask @ada about this').expect(201);

      const mine = await inbox(ada);
      expect(mine.body.items).toHaveLength(1);
      expect(mine.body.items[0]).toMatchObject({
        kind: 'mention',
        subjectType: 'session',
        subjectId: sessionId,
        title: 'grace mentioned you',
        readAt: null,
      });
      expect(mine.body.unread).toBe(1);

      // The other people in the event hear nothing about it.
      expect((await inbox(admin)).body.items).toHaveLength(0);
      expect((await inbox(grace)).body.items).toHaveLength(0);
    });

    it('is parsed by the same rules the comment renders through', async () => {
      // An email is not a mention, and neither is a name nobody holds — the
      // shared tokenizer's boundary rules, running server-side this time.
      await comment(grace, 'mail ada@example.com or ask @nobody').expect(201);
      expect((await inbox(ada)).body.items).toHaveLength(0);
    });

    it('is not written for mentioning yourself', async () => {
      await comment(ada, 'note to self, @ada').expect(201);
      expect((await inbox(ada)).body.items).toHaveLength(0);
    });

    it('is written once for a name repeated in one comment', async () => {
      await comment(grace, '@ada and again @ada').expect(201);
      expect((await inbox(ada)).body.items).toHaveLength(1);
    });
  });

  describe('a session moving', () => {
    it('tells the people who starred it', async () => {
      await ada.put(`/api/e/testconf/sessions/${sessionId}/star`).expect(204);
      await admin
        .patch(`/api/e/testconf/sessions/${sessionId}`)
        .send({ roomId, title: 'Talk', startsAt: at(DAY_ONE, 700), endsAt: at(DAY_ONE, 760) })
        .expect(200);

      const mine = await inbox(ada);
      expect(mine.body.items).toHaveLength(1);
      expect(mine.body.items[0]).toMatchObject({ kind: 'starred_changed', title: 'Talk moved' });
    });

    it('says nothing when the edit was not a move', async () => {
      await ada.put(`/api/e/testconf/sessions/${sessionId}/star`).expect(204);
      await admin
        .patch(`/api/e/testconf/sessions/${sessionId}`)
        .send({ roomId, title: 'Retitled', startsAt: at(DAY_ONE, 600), endsAt: at(DAY_ONE, 660) })
        .expect(200);

      // A retitle is not a move. Telling a roomful of starrers that a typo was
      // fixed is how a bell gets switched off for good.
      expect((await inbox(ada)).body.items).toHaveLength(0);
    });

    it('tells them when it is cancelled', async () => {
      await ada.put(`/api/e/testconf/sessions/${sessionId}/star`).expect(204);
      await admin.delete(`/api/e/testconf/sessions/${sessionId}`).expect(204);

      expect((await inbox(ada)).body.items[0]).toMatchObject({
        kind: 'starred_changed',
        title: 'Talk was cancelled',
      });
    });
  });

  describe('switches', () => {
    it('writes nothing for a kind that was switched off', async () => {
      await ada
        .patch('/api/e/testconf/notifications/mutes')
        .send({ kind: 'mention', muted: true })
        .expect(200);

      await comment(grace, 'hello @ada').expect(201);
      expect((await inbox(ada)).body.items).toHaveLength(0);
    });

    it('is one person’s decision, not the event’s', async () => {
      await ada
        .patch('/api/e/testconf/notifications/mutes')
        .send({ kind: 'mention', muted: true })
        .expect(200);

      const mine = await inbox(ada);
      expect(mine.body.muted).toEqual(['mention']);
      expect((await inbox(grace)).body.muted).toEqual([]);
    });

    it('switching back on is a delete, so the default needs no row', async () => {
      await ada
        .patch('/api/e/testconf/notifications/mutes')
        .send({ kind: 'mention', muted: true })
        .expect(200);
      await ada
        .patch('/api/e/testconf/notifications/mutes')
        .send({ kind: 'mention', muted: false })
        .expect(200);

      const rows = harness.db
        .prepare('SELECT COUNT(*) c FROM notification_mutes')
        .get() as { c: number };
      expect(rows.c).toBe(0);
      await comment(grace, 'hello again @ada').expect(201);
      expect((await inbox(ada)).body.items).toHaveLength(1);
    });

    it('refuses a kind it does not have', async () => {
      await ada
        .patch('/api/e/testconf/notifications/mutes')
        .send({ kind: 'everything', muted: true })
        .expect(400);
    });
  });

  describe('reading', () => {
    it('opening the panel is the read', async () => {
      await comment(grace, '@ada').expect(201);
      const read = await ada.post('/api/e/testconf/notifications/read').expect(200);
      expect(read.body.unread).toBe(0);
      expect(read.body.items[0].readAt).not.toBeNull();
    });

    it('cannot read anyone else’s', async () => {
      await comment(grace, '@ada').expect(201);
      // Rows are selected by identity, so grace's inbox simply has nothing in
      // it — there is no id to pass and nothing to forge.
      expect((await inbox(grace)).body.items).toHaveLength(0);
    });
  });

  describe('pruning', () => {
    it('drops read at 30 days and unread at 90', async () => {
      await comment(grace, '@ada').expect(201);
      const id = (await inbox(ada)).body.items[0].id as number;
      const ageDays = (days: number) =>
        harness.db
          .prepare('UPDATE notifications SET created_at = ? WHERE id = ?')
          .run(new Date(Date.now() - days * 86_400_000).toISOString(), id);

      ageDays(45);
      expect(pruneNotifications(harness.db)).toBe(0); // unread, inside 90
      await ada.post('/api/e/testconf/notifications/read').expect(200);
      expect(pruneNotifications(harness.db)).toBe(1); // read, past 30
    });
  });
});
