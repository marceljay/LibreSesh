import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actorWithRole,
  at,
  DAY_ONE,
  makeHarness,
  seedEvent,
  seedRoom,
  type Harness, agentFor } from './helpers.js';

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

  it('keeps the credit order it was given', async () => {
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
    expect(bundle.body.people.filter((p: { claimed: boolean }) => !p.claimed)).toHaveLength(2);
  });

  it('drops a person named twice on the same session', async () => {
    const first = await makeSession(['Ada Lovelace']);
    const adaId = first.body.speakers[0].id as number;
    const again = await makeSession([adaId, 'ada  LOVELACE'], 700);
    expect(again.body.speakers.map((p: { id: number }) => p.id)).toEqual([adaId]);
  });

  it('replaces the whole credit list on a PATCH, and clears it on an empty list', async () => {
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

  it('leaves the credits alone when the patch says nothing about it', async () => {
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
 * The right to edit follows the credits, not the first row of it. This is the
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

    // Grace arrives under her name — the gate offers the profile typed onto
    // the panel and she takes it — and is given the speaker role.
    const grace = agentFor(harness);
    const me = await grace.get('/api/me').expect(200);
    await grace
      .post('/api/e/testconf/auth')
      .send({ password: 'user-pw', displayName: 'Grace Hopper', claimProfile: true })
      .expect(200);
    harness.db
      .prepare('UPDATE roles SET role = ? WHERE identity_id = ? AND event_id = ?')
      .run('speaker', me.body.id, eventId);
    expect(
      harness.db
        .prepare<[number], { identity_id: number | null }>('SELECT identity_id FROM people WHERE id = ?')
        .get(graceId)?.identity_id,
    ).toBe(me.body.id);

    const patched = await grace
      .patch(`/api/e/testconf/sessions/${session.body.id}`)
      .send({ description: 'What we will actually cover.' })
      .expect(200);
    expect(patched.body.description).toBe('What we will actually cover.');
  });
});

/**
 * The bug this covers: an organiser schedules a talk and types the speaker's
 * name onto it, that person arrives at the gate as an ordinary attendee — the
 * role almost every speaker holds, since the speaker role is only handed out
 * by a code somebody has to remember to send — and could not touch their own
 * session. `assertMayMutate` wanted the credits *and* `atLeast('speaker')`.
 */
describe('a speaker holding the attendee role owns their own session', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;
  let sessionId: number;
  /** Signed in as Ada, who is credited on the official session, role `user`. */
  let ada: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db, { slug: 'testconf' });
    roomId = seedRoom(harness.db, eventId, { name: 'Main hall' });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');

    const session = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Panel',
        type: 'official',
        speakers: ['Ada Lovelace', 'Grace Hopper'],
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    sessionId = session.body.id as number;

    ada = agentFor(harness);
    await ada.get('/api/me').expect(200);
    await ada
      .post('/api/e/testconf/auth')
      .send({ password: 'user-pw', displayName: 'Ada Lovelace', claimProfile: true })
      .expect(200);
  });
  afterEach(() => harness.close());

  it('is only an attendee, and still edits the official session she is on', async () => {
    const bundle = await ada.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.role).toBe('user');

    const patched = await ada
      .patch(`/api/e/testconf/sessions/${sessionId}`)
      .send({ description: 'What we will actually cover.' })
      .expect(200);
    expect(patched.body.description).toBe('What we will actually cover.');
  });

  it('may save the whole session back unchanged, which is what the form posts', async () => {
    // The form sends room, start and end every time, untouched. Judged on
    // presence rather than on change, this was refused as "moving" it.
    const res = await ada
      .patch(`/api/e/testconf/sessions/${sessionId}`)
      .send({
        roomId,
        title: 'Panel',
        description: 'A fuller description.',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('still cannot move it: the slot is the programme', async () => {
    await ada
      .patch(`/api/e/testconf/sessions/${sessionId}`)
      .send({ startsAt: at(DAY_ONE, 660), endsAt: at(DAY_ONE, 720) })
      .expect(403);
  });

  it('still cannot delete it: being credited is not a mandate to remove it', async () => {
    await ada.delete(`/api/e/testconf/sessions/${sessionId}`).expect(403);
  });

  it('edits it even where attendees may not create sessions at all', async () => {
    // A curated conference turns this off — and it used to take the speakers'
    // own talks with it, because the edit route asked for the create
    // capability.
    await admin
      .patch('/api/e/testconf/permissions')
      .send({ 'session.create_open': ['admin'] })
      .expect(200);

    await ada
      .patch(`/api/e/testconf/sessions/${sessionId}`)
      .send({ description: 'Still mine to write.' })
      .expect(200);
  });

  it('leaves a session she is not on alone', async () => {
    const other = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Someone else',
        startsAt: at(DAY_ONE, 720),
        endsAt: at(DAY_ONE, 780),
      })
      .expect(201);
    await ada
      .patch(`/api/e/testconf/sessions/${other.body.id}`)
      .send({ description: 'Not mine.' })
      .expect(403);
  });
});
