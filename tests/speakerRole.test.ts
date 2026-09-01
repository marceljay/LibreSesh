import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atLeast } from '../server/src/auth.js';
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

describe('speaker role ranking', () => {
  it('sits between attendee and organiser', () => {
    expect(atLeast('speaker', 'user')).toBe(true);
    expect(atLeast('speaker', 'admin')).toBe(false);
    expect(atLeast('admin', 'speaker')).toBe(true);
    expect(atLeast('user', 'speaker')).toBe(false);
  });
});

describe('speaker role', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;
  let speaker: Agent;
  let personId: number;

  const promote = (identityId: number) =>
    harness.db
      .prepare('UPDATE roles SET role = ? WHERE identity_id = ? AND event_id = ?')
      .run('speaker', identityId, eventId);

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 0 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    speaker = await actorWithRole(harness, 'testconf', 'user-pw');
    const profile = await speaker
      .patch('/api/e/testconf/me/profile')
      .send({ name: 'Ada' })
      .expect(201);
    personId = profile.body.id as number;
    const { body: me } = await speaker.get('/api/me').expect(200);
    promote(me.id as number);
  });
  afterEach(() => harness.close());

  it('the schema accepts it', () => {
    expect(() =>
      harness.db
        .prepare(
          'INSERT INTO event_permissions (event_id, capability, role, allowed) VALUES (?, ?, ?, 1)',
        )
        .run(eventId, 'contribution.create', 'speaker'),
    ).not.toThrow();
  });

  it('lets a speaker rewrite an official talk they hold, but not move or delete it', async () => {
    // Organiser schedules the talk on the speaker's behalf, in a closed room.
    const created = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        type: 'official',
        title: 'Keynote',
        speakers: [personId],
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    const id = created.body.id as number;

    const edited = await speaker
      .patch(`/api/e/testconf/sessions/${id}`)
      .send({ description: 'What the talk is actually about.' })
      .expect(200);
    expect(edited.body.description).toBe('What the talk is actually about.');

    await speaker
      .patch(`/api/e/testconf/sessions/${id}`)
      .send({ startsAt: at(DAY_ONE, 700), endsAt: at(DAY_ONE, 760) })
      .expect(403);
    await speaker.delete(`/api/e/testconf/sessions/${id}`).expect(403);

    // A different attendee, even promoted, cannot touch someone else's talk.
    const other = await actorWithRole(harness, 'testconf', 'user-pw');
    const { body: otherMe } = await other.get('/api/me').expect(200);
    promote(otherMe.id as number);
    await other
      .patch(`/api/e/testconf/sessions/${id}`)
      .send({ description: 'mine now' })
      .expect(403);
  });

  it('a plain attendee who holds the talk still cannot edit it', async () => {
    const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    const profile = await attendee
      .patch('/api/e/testconf/me/profile')
      .send({ name: 'Grace' })
      .expect(201);
    const created = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        type: 'official',
        title: 'Talk',
        speakers: [profile.body.id],
        startsAt: at(DAY_ONE, 800),
        endsAt: at(DAY_ONE, 860),
      })
      .expect(201);
    await attendee
      .patch(`/api/e/testconf/sessions/${created.body.id}`)
      .send({ description: 'nope' })
      .expect(403);
  });

  it('shows up in the permission matrix defaults', async () => {
    const bundle = await speaker.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.role).toBe('speaker');
    expect(bundle.body.permissions['session.create_open']).toContain('speaker');
    expect(bundle.body.permissions['contribution.moderate']).not.toContain('speaker');
  });
});
