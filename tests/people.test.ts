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

describe('speaker profiles', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;
  let user: Agent;
  let viewer: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    user = await actorWithRole(harness, 'testconf', 'user-pw');
    viewer = await actorWithRole(harness, 'testconf', 'viewer-pw');
  });
  afterEach(() => harness.close());

  const makeSession = (agent: Agent, payload: Record<string, unknown> = {}) =>
    agent.post('/api/e/testconf/sessions').send({
      roomId,
      title: 'Talk',
      startsAt: at(DAY_ONE, 600),
      endsAt: at(DAY_ONE, 660),
      ...payload,
    });

  it('creates a person when a session names an unknown speaker', async () => {
    const res = await makeSession(admin, { speakers: ['Ada Lovelace'] }).expect(201);
    expect(res.body.speakers).toHaveLength(1);
    expect(res.body.speakers[0].name).toBe('Ada Lovelace');
    expect(res.body.speakers[0].id).toBeGreaterThan(0);

    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.people.map((p: { name: string }) => p.name)).toEqual(['Ada Lovelace']);
  });

  it('reuses the existing person for the same name', async () => {
    const first = await makeSession(admin, { speakers: ['Grace Hopper'] }).expect(201);
    const second = await makeSession(admin, {
      speakers: ['Grace Hopper'],
      startsAt: at(DAY_ONE, 700),
      endsAt: at(DAY_ONE, 760),
    }).expect(201);
    expect(second.body.speakers[0].id).toBe(first.body.speakers[0].id);
  });

  it('clears the speaker on an empty name and rejects an unknown id', async () => {
    const created = await makeSession(admin, { speakers: ['Temp'] }).expect(201);
    const cleared = await admin
      .patch(`/api/e/testconf/sessions/${created.body.id}`)
      .send({ speakers: [] })
      .expect(200);
    expect(cleared.body.speakers).toEqual([]);

    await admin
      .patch(`/api/e/testconf/sessions/${created.body.id}`)
      .send({ speakers: [9999] })
      .expect(400);
  });

  it('will not take a person from another event', async () => {
    const otherEvent = seedEvent(harness.db, { slug: 'other' });
    seedRoom(harness.db, otherEvent, { openBooking: 1 });
    const otherAdmin = await actorWithRole(harness, 'other', 'admin-pw');
    const foreign = await otherAdmin
      .post('/api/e/other/people')
      .send({ name: 'Elsewhere' })
      .expect(201);
    await makeSession(admin, { speakers: [foreign.body.id] }).expect(400);
  });

  it('serves a profile with the sessions that person hosts', async () => {
    const created = await makeSession(admin, { speakers: ['Radia Perlman'] }).expect(201);
    const detail = await viewer
      .get(`/api/e/testconf/people/${created.body.speakers[0].id}`)
      .expect(200);
    expect(detail.body.person.name).toBe('Radia Perlman');
    expect(detail.body.sessions).toHaveLength(1);
    expect(detail.body.sessions[0].id).toBe(created.body.id);
  });

  it('lets organisers create, edit and delete profiles', async () => {
    const created = await admin
      .post('/api/e/testconf/people')
      .send({
        name: 'Barbara Liskov',
        bio: 'On **abstraction**.',
        links: [{ label: 'Site', url: 'https://example.org' }],
      })
      .expect(201);
    expect(created.body.links).toEqual([{ label: 'Site', url: 'https://example.org' }]);
    expect(created.body.claimed).toBe(false);

    const patched = await admin
      .patch(`/api/e/testconf/people/${created.body.id}`)
      .send({ bio: 'Updated' })
      .expect(200);
    expect(patched.body.bio).toBe('Updated');

    await admin.delete(`/api/e/testconf/people/${created.body.id}`).expect(204);
    await viewer.get(`/api/e/testconf/people/${created.body.id}`).expect(404);
  });

  it('detaches a deleted person from their sessions instead of losing them', async () => {
    const session = await makeSession(admin, { speakers: ['Ephemeral'] }).expect(201);
    await admin.delete(`/api/e/testconf/people/${session.body.speakers[0].id}`).expect(204);

    const after = await admin.get(`/api/e/testconf/sessions/${session.body.id}`).expect(200);
    expect(after.body.session.speakers).toEqual([]);
  });

  it('rejects a non-http link and an overlong bio', async () => {
    await admin
      .post('/api/e/testconf/people')
      .send({ name: 'Bad', links: [{ label: 'x', url: 'javascript:alert(1)' }] })
      .expect(400);
    await admin
      .post('/api/e/testconf/people')
      .send({ name: 'Long', bio: 'x'.repeat(2001) })
      .expect(400);
  });

  it('keeps names unique within an event', async () => {
    await admin.post('/api/e/testconf/people').send({ name: 'Twin' }).expect(201);
    const clash = await admin.post('/api/e/testconf/people').send({ name: 'Twin' }).expect(409);
    expect(clash.body.error.code).toBe('name_taken');
  });

  it('blocks a non-admin from the roster endpoints', async () => {
    const person = await admin.post('/api/e/testconf/people').send({ name: 'Theirs' }).expect(201);
    await user.post('/api/e/testconf/people').send({ name: 'Nope' }).expect(403);
    await user.patch(`/api/e/testconf/people/${person.body.id}`).send({ bio: 'x' }).expect(403);
    await user.delete(`/api/e/testconf/people/${person.body.id}`).expect(403);
  });

  describe('your own profile', () => {
    it('creates one on first edit, defaulting to your display name', async () => {
      const me = await user.get('/api/me').expect(200);
      const created = await user
        .patch('/api/e/testconf/me/profile')
        .send({ bio: 'I like open rooms.' })
        .expect(201);
      expect(created.body.name).toBe(me.body.displayName);
      expect(created.body.isMine).toBe(true);
      expect(created.body.claimed).toBe(true);
    });

    it('updates the same profile rather than making a second one', async () => {
      const first = await user.patch('/api/e/testconf/me/profile').send({ bio: 'One' }).expect(201);
      const second = await user
        .patch('/api/e/testconf/me/profile')
        .send({ bio: 'Two', name: 'Renamed' })
        .expect(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.bio).toBe('Two');
      expect(second.body.name).toBe('Renamed');
    });

    it('lets a viewer edit their own profile too', async () => {
      const created = await viewer
        .patch('/api/e/testconf/me/profile')
        .send({ bio: 'Just watching.' })
        .expect(201);
      expect(created.body.isMine).toBe(true);
    });

    it('lets the owner patch it through the roster route, but not a stranger', async () => {
      const mine = await user.patch('/api/e/testconf/me/profile').send({ bio: 'Mine' }).expect(201);
      await user.patch(`/api/e/testconf/people/${mine.body.id}`).send({ bio: 'Edited' }).expect(200);
      await viewer.patch(`/api/e/testconf/people/${mine.body.id}`).send({ bio: 'No' }).expect(403);
      // Organisers still override.
      await admin.patch(`/api/e/testconf/people/${mine.body.id}`).send({ bio: 'Moderated' }).expect(200);
    });

    it('shows isMine only to the owner', async () => {
      await user.patch('/api/e/testconf/me/profile').send({ bio: 'Mine' }).expect(201);
      const asOwner = await user.get('/api/e/testconf/bundle').expect(200);
      const asOther = await viewer.get('/api/e/testconf/bundle').expect(200);
      expect(asOwner.body.people[0].isMine).toBe(true);
      expect(asOther.body.people[0].isMine).toBe(false);
      expect(asOther.body.people[0].claimed).toBe(true);
    });

    it('claims an unclaimed person that already has your name', async () => {
      // Naming yourself as the speaker auto-creates an unclaimed person. Editing
      // your profile afterwards must adopt that record, not collide with it —
      // otherwise you are locked out of your own profile permanently.
      const me = await user.get('/api/me').expect(200);
      const roomId = seedRoom(harness.db, eventId, { name: 'Self', openBooking: 1 });
      const session = await user
        .post('/api/e/testconf/sessions')
        .send({
          roomId,
          title: 'Mine',
          speakers: [me.body.displayName],
          startsAt: at(DAY_ONE, 800),
          endsAt: at(DAY_ONE, 860),
        })
        .expect(201);

      // 201: your profile now exists, whether it was created or adopted.
      const profile = await user
        .patch('/api/e/testconf/me/profile')
        .send({ bio: 'I ran this' })
        .expect(201);
      expect(profile.body.id).toBe(session.body.speakers[0].id);
      expect(profile.body.isMine).toBe(true);
      expect(profile.body.bio).toBe('I ran this');

      // One person, not two.
      const bundle = await user.get('/api/e/testconf/bundle').expect(200);
      const named = bundle.body.people.filter(
        (p: { name: string }) => p.name === me.body.displayName,
      );
      expect(named).toHaveLength(1);
    });

    it('still refuses a name another identity has claimed', async () => {
      await viewer.patch('/api/e/testconf/me/profile').send({ name: 'Taken' }).expect(201);
      const res = await user
        .patch('/api/e/testconf/me/profile')
        .send({ name: 'Taken' })
        .expect(409);
      expect(res.body.error.code).toBe('name_taken');
    });

    it('claims an unclaimed roster entry when you take its name', async () => {
      await admin.post('/api/e/testconf/people').send({ name: 'Unclaimed' }).expect(201);
      const res = await user
        .patch('/api/e/testconf/me/profile')
        .send({ name: 'Unclaimed' })
        .expect(201);
      expect(res.body.isMine).toBe(true);
    });

    it('is read-only once the event is archived', async () => {
      await admin.patch('/api/e/testconf/settings').send({ archived: true }).expect(200);
      await user.patch('/api/e/testconf/me/profile').send({ bio: 'x' }).expect(409);
    });
  });

  /**
   * The roster an organiser acts on: who holds each profile, at what role, and
   * whether the phrase they were sent has ever been used. `claimed` alone
   * cannot answer the last one, because minting a speaker code attaches an
   * identity at mint time.
   */
  describe('the roster an organiser sees', () => {
    const peopleFor = async (agent: Agent) =>
      (await agent.get('/api/e/testconf/bundle').expect(200)).body.people as {
        name: string;
        claimed: boolean;
        role?: string | null;
        codePending?: boolean;
      }[];

    it('marks a profile nobody holds', async () => {
      await makeSession(admin, { speakers: ['Ada Lovelace'] }).expect(201);
      const [ada] = await peopleFor(admin);
      expect(ada).toMatchObject({ name: 'Ada Lovelace', claimed: false, role: null });
      expect(ada?.codePending).toBe(false);
    });

    it('gives the role of whoever holds it', async () => {
      await user.patch('/api/e/testconf/me/profile').send({ name: 'Grace' });
      const [grace] = await peopleFor(admin);
      expect(grace).toMatchObject({ name: 'Grace', claimed: true, role: 'user' });
      expect(grace?.codePending).toBe(false);
    });

    it('flags a speaker code that nobody has redeemed yet', async () => {
      const res = await makeSession(admin, { speakers: ['Ada Lovelace'] }).expect(201);
      const personId = res.body.speakers[0].id as number;
      const code = await admin
        .post(`/api/e/testconf/people/${personId}/speaker-code`)
        .expect(200);

      // Claimed on paper — an identity exists — but nobody has turned up.
      const before = await peopleFor(admin);
      expect(before[0]).toMatchObject({ claimed: true, role: 'speaker', codePending: true });

      const phone = await actorWithRole(harness, 'testconf', 'viewer-pw');
      await phone.post('/api/me/link').send({ phrase: code.body.phrase }).expect(200);
      await phone.get('/api/e/testconf/bundle').expect(200);

      const after = await peopleFor(admin);
      expect(after[0]).toMatchObject({ claimed: true, role: 'speaker', codePending: false });
    });

    it('tells nobody else who runs the event', async () => {
      await user.patch('/api/e/testconf/me/profile').send({ name: 'Grace' });
      for (const agent of [user, viewer]) {
        const [grace] = await peopleFor(agent);
        // Absent, not null: "not disclosed to you" rather than "unclaimed".
        expect(grace).not.toHaveProperty('role');
        expect(grace).not.toHaveProperty('codePending');
        expect(grace?.claimed).toBe(true);
      }
    });
  });

  /**
   * Deleting a profile removes it from the roster; it does not remove the
   * person. They keep their identity, their role and their name in the event —
   * and, since migration 017, the ability to have a profile again.
   */
  describe('deleting a claimed profile', () => {
    it('leaves its owner signed in, with their role and name', async () => {
      await user.patch('/api/e/testconf/me').send({ displayName: 'Ada' }).expect(200);
      const mine = await user.patch('/api/e/testconf/me/profile').send({ name: 'Ada' });
      await admin.delete(`/api/e/testconf/people/${mine.body.id}`).expect(204);

      const bundle = await user.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.role).toBe('user');
      expect(bundle.body.displayName).toBe('Ada');
      expect(bundle.body.people).toHaveLength(0);
    });

    it('lets them make a new one — the tombstone no longer holds their slot', async () => {
      const mine = await user.patch('/api/e/testconf/me/profile').send({ name: 'Ada' });
      await admin.delete(`/api/e/testconf/people/${mine.body.id}`).expect(204);

      const again = await user.patch('/api/e/testconf/me/profile').send({ name: 'Ada again' });
      expect(again.status).toBeLessThan(300);
      expect(again.body.id).not.toBe(mine.body.id);
      expect(again.body.isMine).toBe(true);

      // And the deleted row keeps its owner, for the audit trail.
      const tombstone = harness.db
        .prepare('SELECT identity_id, deleted_at FROM people WHERE id = ?')
        .get(mine.body.id) as { identity_id: number | null; deleted_at: string | null };
      expect(tombstone.identity_id).not.toBeNull();
      expect(tombstone.deleted_at).not.toBeNull();
    });

    it('is safe to do to yourself — an organiser keeps their own event', async () => {
      const mine = await admin.patch('/api/e/testconf/me/profile').send({ name: 'The organiser' });
      await admin.delete(`/api/e/testconf/people/${mine.body.id}`).expect(204);

      const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.role).toBe('admin');
      // Still able to manage, and to give themselves a profile again.
      await admin.post('/api/e/testconf/rooms').send({ name: 'Hall' }).expect(201);
      const again = await admin.patch('/api/e/testconf/me/profile').send({ name: 'The organiser' });
      expect(again.status).toBeLessThan(300);
    });
  });
});
