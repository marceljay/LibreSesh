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

/**
 * Minting a speaker code is not a visit. The identity it creates for an
 * unclaimed profile used to be stamped "last seen now", so the People tab
 * showed the organiser a speaker who had never opened the app as seen just
 * now. The stamp arrives with the first request the redeemed cookie makes.
 */
describe('last seen, and a speaker code that has not been used', () => {
  let harness: Harness;
  let roomId: number;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    const eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 0 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  const seedPerson = async (): Promise<number> => {
    const res = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        type: 'official',
        title: 'Talk by Ada',
        speakers: ['Ada Lovelace'],
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    return res.body.speakers[0].id as number;
  };

  /** As the People tab reads it: the organiser's bundle carries the facts. */
  const lastSeen = async (personId: number): Promise<string | null | undefined> => {
    const people = (await admin.get('/api/e/testconf/bundle').expect(200)).body.people as {
      id: number;
      lastSeenAt: string | null;
    }[];
    return people.find((p) => p.id === personId)?.lastSeenAt;
  };

  it('shows no last-seen time after minting, and one after the code is redeemed', async () => {
    const personId = await seedPerson();
    expect(await lastSeen(personId)).toBeNull();

    const { body } = await admin
      .post(`/api/e/testconf/people/${personId}/speaker-code`)
      .expect(200);
    // Now somebody does — the identity the mint created — and has not been here.
    expect(await lastSeen(personId)).toBeNull();

    const device = agentFor(harness);
    await device.get('/api/me').expect(200);
    await device.post('/api/me/link').send({ phrase: body.phrase }).expect(200);
    // The redemption response carries the cookie; the next request is the
    // first one made *as* the speaker, and that is the visit.
    await device.get('/api/me').expect(200);
    expect(await lastSeen(personId)).toBeTruthy();
  });

  it('leaves a gate visitor stamped as before', async () => {
    const visitor = await actorWithRole(harness, 'testconf', 'user-pw');
    const me = (await visitor.get('/api/me').expect(200)).body;
    const row = harness.db
      .prepare<[number], { last_seen_at: string | null }>(
        'SELECT last_seen_at FROM identities WHERE id = ?',
      )
      .get(me.id);
    expect(row?.last_seen_at).toBeTruthy();
  });
});
