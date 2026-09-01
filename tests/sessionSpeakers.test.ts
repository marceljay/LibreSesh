import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actorWithRole,
  at,
  DAY_ONE,
  makeHarness,
  seedEvent,
  seedRoom,
  type Harness,
} from './helpers.js';

/**
 * A session can be given by more than one person.
 *
 * `sessions.speaker_id` held exactly one, which is wrong for most of the
 * formats an unconference actually runs — a panel, a pair, a workshop with two
 * facilitators, a talk and its translator. It also decided more than the
 * label: a speaker may edit the session they are giving, and a second name on
 * the poster had none of that.
 */
describe('a session bills everyone giving it', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;

  beforeEach(() => {
    harness = makeHarness();
    eventId = seedEvent(harness.db, { slug: 'testconf' });
    roomId = seedRoom(harness.db, eventId, { name: 'Main hall' });
  });
  afterEach(() => harness.close());

  const makeSession = async (speakers: (number | string)[], startMin = 600) => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    return admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Panel',
        speakers,
        startsAt: at(DAY_ONE, startMin),
        endsAt: at(DAY_ONE, startMin + 60),
      })
      .expect(201);
  };

  it('keeps the billing order it was given', async () => {
    const res = await makeSession(['Ada Lovelace', 'Grace Hopper', 'Radia Perlman']);
    expect(res.body.speakers.map((p: { name: string }) => p.name)).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
      'Radia Perlman',
    ]);

    // And on the way back out of the database, not just in the response.
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    const session = bundle.body.sessions.find((s: { id: number }) => s.id === res.body.id);
    expect(session.speakers.map((p: { name: string }) => p.name)).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
      'Radia Perlman',
    ]);
  });

  it('mixes people already on the roster with names typed for new ones', async () => {
    const first = await makeSession(['Ada Lovelace']);
    const adaId = first.body.speakers[0].id as number;

    const second = await makeSession([adaId, 'Grace Hopper'], 700);
    expect(second.body.speakers[0].id).toBe(adaId);
    expect(second.body.speakers[1].name).toBe('Grace Hopper');

    // One profile for Ada, one for Grace — the second session reused her.
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.people).toHaveLength(2);
  });

  it('drops a person named twice on the same session', async () => {
    const first = await makeSession(['Ada Lovelace']);
    const adaId = first.body.speakers[0].id as number;
    const again = await makeSession([adaId, 'ada  LOVELACE'], 700);
    expect(again.body.speakers.map((p: { id: number }) => p.id)).toEqual([adaId]);
  });

  it('replaces the whole billing on a PATCH, and clears it on an empty list', async () => {
    const res = await makeSession(['Ada Lovelace', 'Grace Hopper']);
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');

    const swapped = await admin
      .patch(`/api/e/testconf/sessions/${res.body.id}`)
      .send({ speakers: ['Radia Perlman'] })
      .expect(200);
    expect(swapped.body.speakers.map((p: { name: string }) => p.name)).toEqual(['Radia Perlman']);

    const cleared = await admin
      .patch(`/api/e/testconf/sessions/${res.body.id}`)
      .send({ speakers: [] })
      .expect(200);
    expect(cleared.body.speakers).toEqual([]);
  });

  it('leaves the billing alone when the patch says nothing about it', async () => {
    const res = await makeSession(['Ada Lovelace', 'Grace Hopper']);
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const patched = await admin
      .patch(`/api/e/testconf/sessions/${res.body.id}`)
      .send({ title: 'Panel, renamed' })
      .expect(200);
    expect(patched.body.speakers).toHaveLength(2);
  });

  it('refuses a person from another event', async () => {
    const other = seedEvent(harness.db, { slug: 'otherconf' });
    const now = new Date().toISOString();
    const foreign = Number(
      harness.db
        .prepare(
          `INSERT INTO people (event_id, identity_id, name, bio, links, created_at, updated_at)
           VALUES (?, NULL, 'Outsider', '', '[]', ?, ?)`,
        )
        .run(other, now, now).lastInsertRowid,
    );
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Panel',
        speakers: [foreign],
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(400);
  });
});

/**
 * The right to edit follows the billing, not the first row of it. This is the
 * half of the change that is not cosmetic: before it, the second name on a
 * panel could read their own session and nothing else.
 */
describe('every speaker on the bill may edit the session', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;

  beforeEach(() => {
    harness = makeHarness();
    eventId = seedEvent(harness.db, { slug: 'testconf' });
    roomId = seedRoom(harness.db, eventId, { name: 'Main hall' });
  });
  afterEach(() => harness.close());

  it('lets the second name rewrite the talk they are giving', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const session = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Panel',
        speakers: ['Ada Lovelace', 'Grace Hopper'],
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    const graceId = session.body.speakers[1].id as number;

    // Grace signs in, is given the speaker role, and claims her profile — what
    // redeeming a speaker code amounts to.
    const grace = await actorWithRole(harness, 'testconf', 'user-pw');
    const me = await grace.get('/api/me').expect(200);
    harness.db
      .prepare('UPDATE roles SET role = ? WHERE identity_id = ? AND event_id = ?')
      .run('speaker', me.body.id, eventId);
    harness.db
      .prepare('UPDATE people SET identity_id = ? WHERE id = ?')
      .run(me.body.id, graceId);

    const patched = await grace
      .patch(`/api/e/testconf/sessions/${session.body.id}`)
      .send({ description: 'What we will actually cover.' })
      .expect(200);
    expect(patched.body.description).toBe('What we will actually cover.');
  });
});
