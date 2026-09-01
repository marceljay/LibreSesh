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

/** Admin-minted, per-person, revocable codes on the device-link rail. */
describe('speaker codes', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 0 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  /** An unclaimed person the organiser typed onto a session. */
  const seedPerson = async (name = 'Ada Lovelace'): Promise<number> => {
    const res = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        type: 'official',
        title: `Talk by ${name}`,
        speakers: [name],
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    return res.body.speakers[0].id as number;
  };

  const mint = (personId: number) =>
    admin.post(`/api/e/testconf/people/${personId}/speaker-code`).expect(200);

  it('minting claims the person and the phrase signs a device in as them', async () => {
    const personId = await seedPerson();
    const { body } = await mint(personId);
    expect(body.phrase).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[a-z]+$/);

    const phone = agentFor(harness);
    const { body: linked } = await phone
      .post('/api/me/link')
      .send({ phrase: body.phrase })
      .expect(200);
    expect(linked.roles.testconf).toBe('speaker');

    // They are that person: the bundle marks the profile as theirs, under
    // the person's name.
    const bundle = await phone.get('/api/e/testconf/bundle').expect(200);
    const person = bundle.body.people.find((p: { id: number }) => p.id === personId);
    expect(person.isMine).toBe(true);
    expect(bundle.body.displayName).toBe('Ada Lovelace');

    // And they can rewrite their talk, scheduled for them in a closed room.
    const sessionId = bundle.body.sessions[0].id as number;
    await phone
      .patch(`/api/e/testconf/sessions/${sessionId}`)
      .send({ description: 'My own words.' })
      .expect(200);
  });

  it('works from several devices and survives a device-phrase mint', async () => {
    const personId = await seedPerson();
    const { body } = await mint(personId);

    const phone = agentFor(harness);
    await phone.post('/api/me/link').send({ phrase: body.phrase }).expect(200);
    // The speaker mints a device phrase of their own; their speaker code
    // must not be invalidated by it.
    await phone.post('/api/me/link-code').expect(200);

    const laptop = agentFor(harness);
    const { body: second } = await laptop
      .post('/api/me/link')
      .send({ phrase: body.phrase })
      .expect(200);
    const { body: first } = await phone.get('/api/me').expect(200);
    expect(second.id).toBe(first.id);
  });

  it('revoking kills the phrase; re-minting replaces it', async () => {
    const personId = await seedPerson();
    const { body: a } = await mint(personId);
    const { body: b } = await mint(personId);
    await agentFor(harness).post('/api/me/link').send({ phrase: a.phrase }).expect(403);
    await agentFor(harness).post('/api/me/link').send({ phrase: b.phrase }).expect(200);

    await admin.delete(`/api/e/testconf/people/${personId}/speaker-code`).expect(204);
    await agentFor(harness).post('/api/me/link').send({ phrase: b.phrase }).expect(403);
  });

  it('never downgrades a role the person already holds', async () => {
    // An organiser who is also speaking stays an organiser.
    const profile = await admin
      .patch('/api/e/testconf/me/profile')
      .send({ name: 'Orga' })
      .expect(201);
    await mint(profile.body.id as number);
    const { body: me } = await admin.get('/api/me').expect(200);
    expect(me.roles.testconf).toBe('admin');
  });

  it('suffixes the display name when the person’s name is already taken', async () => {
    await actorWithRole(harness, 'testconf', 'user-pw').then((a) =>
      a.post('/api/e/testconf/auth').send({ password: 'user-pw', displayName: 'Grace' }),
    );
    const personId = await seedPerson('Grace');
    const { body } = await mint(personId);
    const phone = agentFor(harness);
    await phone.post('/api/me/link').send({ phrase: body.phrase }).expect(200);
    const bundle = await phone.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.displayName).toMatch(/^Grace #\d+$/);
  });

  it('is admin-only to mint or revoke', async () => {
    const personId = await seedPerson();
    const user = await actorWithRole(harness, 'testconf', 'user-pw');
    await user.post(`/api/e/testconf/people/${personId}/speaker-code`).expect(403);
    await user.delete(`/api/e/testconf/people/${personId}/speaker-code`).expect(403);
  });

  /**
   * The code is a live credential. If the profile it stands for leaves the
   * roster, the phrase has to die with it — an organiser cannot revoke what
   * the revoke route can no longer load.
   */
  describe('a code does not outlive its profile', () => {
    it('dies when the person is deleted', async () => {
      const personId = await seedPerson();
      const { body } = await mint(personId);

      await admin.delete(`/api/e/testconf/people/${personId}`).expect(204);

      const stranger = agentFor(harness);
      await stranger.get('/api/me').expect(200);
      await stranger.post('/api/me/link').send({ phrase: body.phrase }).expect(403);
      await stranger.get('/api/e/testconf/bundle').expect(401);
      expect(
        harness.db.prepare('SELECT COUNT(*) AS n FROM link_codes').get(),
      ).toEqual({ n: 0 });
    });

    /** The backstop, for a row written before the routes learned to revoke. */
    it('is refused when its person was soft-deleted behind the app’s back', async () => {
      const personId = await seedPerson();
      const { body } = await mint(personId);
      harness.db
        .prepare('UPDATE people SET deleted_at = ? WHERE id = ?')
        .run(new Date().toISOString(), personId);

      const stranger = agentFor(harness);
      await stranger.get('/api/me').expect(200);
      await stranger.post('/api/me/link').send({ phrase: body.phrase }).expect(403);
    });

    it('leaves an ordinary device phrase alone', async () => {
      const personId = await seedPerson();
      await mint(personId);
      const phone = agentFor(harness);
      await phone.get('/api/me').expect(200);
      const { body } = await phone.post('/api/me/link-code').expect(200);

      const laptop = agentFor(harness);
      await laptop.get('/api/me').expect(200);
      await laptop.post('/api/me/link').send({ phrase: body.phrase }).expect(200);
    });
  });
});
