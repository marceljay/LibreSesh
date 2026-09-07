import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CAPABILITY_IDS, getPermissions } from '../server/src/permissions.js';
import { ROOM_COLORS, nextRoomColor } from '../server/src/shared/roomColors.js';
import {
  actorWithRole,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
  nextUsername,
} from './helpers.js';

describe('permission matrix', () => {
  let harness: Harness;
  let eventId: number;
  let openRoom: number;
  let admin: Agent;
  let user: Agent;
  let viewer: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    seedRoom(harness.db, eventId, { name: 'Main Hall' });
    openRoom = seedRoom(harness.db, eventId, { name: 'Open', openBooking: 1, sortOrder: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    user = await actorWithRole(harness, 'testconf', 'user-pw');
    viewer = await actorWithRole(harness, 'testconf', 'viewer-pw');
  });
  afterEach(() => harness.close());

  const seedSession = async () => {
    const res = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId: openRoom,
        title: 'Keynote',
        startsAt: '2026-06-01T08:00:00.000Z',
        endsAt: '2026-06-01T09:00:00.000Z',
      })
      .expect(201);
    return res.body.id as number;
  };

  const setPerm = (capability: string, roles: string[]) =>
    admin.patch('/api/e/testconf/permissions').send({ [capability]: roles });

  describe('defaults', () => {
    it('reproduces the documented role matrix', () => {
      const m = getPermissions(harness.db, eventId);
      expect(m['contribution.create']).toEqual(['user', 'speaker', 'admin']);
      expect(m['contribution.moderate']).toEqual(['admin']);
      expect(m['session.star']).toEqual(['viewer', 'user', 'speaker', 'admin']);
      // Open by default: co-hosts are invited, not gatekept.
      expect(m['session.credit_others']).toEqual(['user', 'speaker', 'admin']);
    });

    it('ships in the bundle so the client can gate its own controls', async () => {
      const res = await viewer.get('/api/e/testconf/bundle').expect(200);
      expect(Object.keys(res.body.permissions).sort()).toEqual([...CAPABILITY_IDS].sort());
    });
  });

  describe('opening a capability up', () => {
    it('lets a viewer comment once given contribution.create', async () => {
      const sessionId = await seedSession();
      await viewer
        .post(`/api/e/testconf/sessions/${sessionId}/contributions`)
        .send({ kind: 'note', body: 'blocked for now' })
        .expect(403);

      await setPerm('contribution.create', ['viewer', 'user']).expect(200);

      await viewer
        .post(`/api/e/testconf/sessions/${sessionId}/contributions`)
        .send({ kind: 'note', body: 'now allowed' })
        .expect(201);
    });
  });

  describe('closing a capability down', () => {
    it('stops an attendee commenting once contribution.create is viewer-only', async () => {
      const sessionId = await seedSession();
      await user
        .post(`/api/e/testconf/sessions/${sessionId}/contributions`)
        .send({ kind: 'note', body: 'allowed by default' })
        .expect(201);

      await setPerm('contribution.create', ['viewer']).expect(200);

      await user
        .post(`/api/e/testconf/sessions/${sessionId}/contributions`)
        .send({ kind: 'note', body: 'no longer' })
        .expect(403);
    });

    it('stops an attendee starring once session.star is closed', async () => {
      const sessionId = await seedSession();
      await user.put(`/api/e/testconf/sessions/${sessionId}/star`).expect(204);
      await setPerm('session.star', []).expect(200);
      await user.put(`/api/e/testconf/sessions/${sessionId}/star`).expect(403);
    });

    it('stops an attendee creating open sessions', async () => {
      await setPerm('session.create_open', []).expect(200);
      await user
        .post('/api/e/testconf/sessions')
        .send({
          roomId: openRoom,
          title: 'Nope',
          startsAt: '2026-06-01T10:00:00.000Z',
          endsAt: '2026-06-01T11:00:00.000Z',
        })
        .expect(403);
    });

    it('stops an attendee pitching', async () => {
      await user.post('/api/e/testconf/proposals').send({ title: 'Fine' }).expect(201);
      await setPerm('proposal.create', []).expect(200);
      await user.post('/api/e/testconf/proposals').send({ title: 'Nope' }).expect(403);
    });
  });

  describe('the admin column is not a switch', () => {
    it('keeps admin on even when the request tries to remove it', async () => {
      const res = await setPerm('contribution.moderate', ['viewer']).expect(200);
      expect(res.body['contribution.moderate']).toContain('admin');
    });

    it('leaves an admin able to moderate after trying to switch it off', async () => {
      const sessionId = await seedSession();
      const note = await user
        .post(`/api/e/testconf/sessions/${sessionId}/contributions`)
        .send({ kind: 'note', body: 'moderate me' })
        .expect(201);

      await setPerm('contribution.moderate', []).expect(200);

      await admin
        .patch(`/api/e/testconf/contributions/${note.body.id}/hidden`)
        .send({ hidden: true })
        .expect(200);
    });

    it('never stores an admin row', async () => {
      await setPerm('contribution.create', ['admin']).expect(200);
      const rows = harness.db
        .prepare("SELECT * FROM event_permissions WHERE event_id = ? AND role = 'admin'")
        .all(eventId);
      expect(rows).toHaveLength(0);
    });
  });

  describe('access to the matrix itself', () => {
    it('is admin-only', async () => {
      await user.patch('/api/e/testconf/permissions').send({ 'session.star': [] }).expect(403);
      await viewer.patch('/api/e/testconf/permissions').send({ 'session.star': [] }).expect(403);
    });

    it('ignores a capability it does not know', async () => {
      await setPerm('made.up', ['viewer']).expect(200);
      const rows = harness.db
        .prepare('SELECT * FROM event_permissions WHERE event_id = ?')
        .all(eventId);
      expect(rows).toHaveLength(0);
    });

    it('stores nothing when the request matches the defaults', async () => {
      await setPerm('contribution.create', ['user', 'speaker']).expect(200);
      const rows = harness.db
        .prepare('SELECT * FROM event_permissions WHERE event_id = ?')
        .all(eventId);
      expect(rows).toHaveLength(0);
    });

    it('is scoped to one event', async () => {
      const otherId = seedEvent(harness.db, { slug: 'other' });
      await setPerm('contribution.create', ['viewer', 'user']).expect(200);
      expect(getPermissions(harness.db, otherId)['contribution.create']).toEqual([
        'user',
        'speaker',
        'admin',
      ]);
    });
  });
  /**
   * Who an attendee may put on a session. Open by default; switched off, the
   * speaker field is a toggle between themselves and nobody — except that
   * editing their own talk must not strip the co-host an organiser added.
   */
  describe('crediting other people', () => {
    const roomFor = () => seedRoom(harness.db, eventId, { name: 'Open', openBooking: 1 });
    const post = (agent: Agent, speakers: (number | string)[], roomId: number, hour = 10) =>
      agent.post('/api/e/testconf/sessions').send({
        roomId,
        title: 'Talk',
        speakers,
        startsAt: `2026-06-01T${String(hour).padStart(2, '0')}:00:00.000Z`,
        endsAt: `2026-06-01T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
      });
    const mine = async (agent: Agent): Promise<number> => {
      const bundle = await agent.get('/api/e/testconf/bundle').expect(200);
      return bundle.body.people.find((p: { isMine: boolean }) => p.isMine).id as number;
    };

    it('is open by default: an attendee may name a co-host, typed or picked', async () => {
      const roomId = roomFor();
      const other = await actorWithRole(harness, 'testconf', 'user-pw');
      await post(user, [await mine(user), await mine(other)], roomId).expect(201);
      await post(user, ['Someone New'], roomId, 8).expect(201);
    });

    it('switched off, holds an attendee to themselves', async () => {
      await setPerm('session.credit_others', ['speaker']).expect(200);
      const roomId = roomFor();
      const other = await actorWithRole(harness, 'testconf', 'user-pw');
      const me = await mine(user);
      await post(user, [me], roomId).expect(201);
      const refused = await post(user, [me, await mine(other)], roomId, 8).expect(403);
      expect(refused.body.error.message).toMatch(/only credit yourself/);
      await post(user, ['Someone New'], roomId, 8).expect(403);
      await user
        .post('/api/e/testconf/proposals')
        .send({ title: 'Pitch', speakerName: 'Someone Else' })
        .expect(403);
      await user
        .post('/api/e/testconf/proposals')
        .send({ title: 'Pitch', speakerId: me })
        .expect(201);
      // Organisers are never held to it.
      await post(admin, ['Someone New'], roomId, 10).expect(201);
    });

    it('switched off, still lets an attendee keep a co-host an organiser added', async () => {
      await setPerm('session.credit_others', ['speaker']).expect(200);
      const roomId = roomFor();
      const other = await actorWithRole(harness, 'testconf', 'user-pw');
      const me = await mine(user);
      const theirs = await mine(other);
      const session = await post(user, [me], roomId).expect(201);
      await admin
        .patch(`/api/e/testconf/sessions/${session.body.id}`)
        .send({ speakers: [me, theirs] })
        .expect(200);
      // Keeping them, or dropping them, is fine; adding a third is not.
      await user
        .patch(`/api/e/testconf/sessions/${session.body.id}`)
        .send({ speakers: [theirs, me], title: 'Renamed' })
        .expect(200);
      const third = await actorWithRole(harness, 'testconf', 'user-pw');
      await user
        .patch(`/api/e/testconf/sessions/${session.body.id}`)
        .send({ speakers: [me, theirs, await mine(third)] })
        .expect(403);
      await user
        .patch(`/api/e/testconf/sessions/${session.body.id}`)
        .send({ speakers: [me] })
        .expect(200);
    });
  });
});

describe('room colour palette', () => {
  it('picks the first unused colour, then cycles', () => {
    expect(nextRoomColor([])).toBe(ROOM_COLORS[0]);
    expect(nextRoomColor([ROOM_COLORS[0]])).toBe(ROOM_COLORS[1]);
    // Case should not decide whether a colour counts as taken.
    expect(nextRoomColor([ROOM_COLORS[0].toUpperCase()])).toBe(ROOM_COLORS[1]);
    // Every colour spoken for: fall back to cycling rather than returning
    // undefined.
    expect(ROOM_COLORS).toContain(nextRoomColor([...ROOM_COLORS]));
  });

  it('offers a palette of washed-out tints', () => {
    expect(ROOM_COLORS.length).toBeGreaterThanOrEqual(6);
    for (const c of ROOM_COLORS) expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe('confirming the organiser password', () => {
  let harness: Harness;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  it('accepts the organiser password', async () => {
    await admin
      .post('/api/e/testconf/confirm-admin')
      .send({ password: 'admin-pw', displayName: nextUsername() })
      .expect(204);
  });

  it('rejects another role’s password without touching the caller’s role', async () => {
    await admin
      .post('/api/e/testconf/confirm-admin')
      .send({ password: 'viewer-pw', displayName: nextUsername() })
      .expect(403);
    // The whole point of not reusing POST /auth: that would have demoted them.
    const res = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(res.body.role).toBe('admin');
  });

  it('rejects a wrong password', async () => {
    await admin.post('/api/e/testconf/confirm-admin').send({ password: 'nope' }).expect(403);
  });

  it('is closed to non-organisers', async () => {
    const user = await actorWithRole(harness, 'testconf', 'user-pw');
    await user
      .post('/api/e/testconf/confirm-admin')
      .send({ password: 'admin-pw', displayName: nextUsername() })
      .expect(403);
  });
});
