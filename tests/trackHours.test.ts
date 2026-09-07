import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { windowOn } from '../server/src/shared/trackHours.js';
import {
  DAY_ONE,
  DAY_TWO,
  actorWithRole,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';

describe('windowOn', () => {
  const track = (over: Partial<Parameters<typeof windowOn>[0]> = {}) => ({
    startMin: 540,
    endMin: 780,
    windows: [],
    ...over,
  });

  it('is null when the track keeps no hours', () => {
    expect(windowOn(track({ startMin: null, endMin: null }), DAY_ONE)).toBeNull();
  });

  it('gives the track window on an ordinary day', () => {
    expect(windowOn(track(), DAY_ONE)).toEqual({ startMin: 540, endMin: 780 });
  });

  it('lets a day replace the window rather than narrow it', () => {
    const wide = track({ windows: [{ date: DAY_TWO, startMin: 480, endMin: 1200 }] });
    expect(windowOn(wide, DAY_TWO)).toEqual({ startMin: 480, endMin: 1200 });
    expect(windowOn(wide, DAY_ONE)).toEqual({ startMin: 540, endMin: 780 });
  });

  it("honours a day's window even when the track itself keeps none", () => {
    const only = track({
      startMin: null,
      endMin: null,
      windows: [{ date: DAY_ONE, startMin: 600, endMin: 700 }],
    });
    expect(windowOn(only, DAY_ONE)).toEqual({ startMin: 600, endMin: 700 });
    expect(windowOn(only, DAY_TWO)).toBeNull();
  });
});

describe('track hours', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;
  let attendee: Agent;
  let trackId: number;

  /** The event permits an attendee to place open sessions in this room. */
  const allowOpenBooking = () => {
    harness.db
      .prepare(
        'INSERT INTO event_permissions (event_id, capability, role, allowed) VALUES (?, ?, ?, 1)',
      )
      .run(eventId, 'session.create_open', 'user');
  };

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 1 });
    allowOpenBooking();
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    const made = await admin
      .post('/api/e/testconf/tracks')
      // 09:00–13:00 on an event whose grid runs 08:00–22:00.
      .send({ name: 'Workshops', startMin: 540, endMin: 780 })
      .expect(201);
    trackId = made.body.id as number;
  });
  afterEach(() => harness.close());

  const book = (
    agent: Agent,
    startMin: number,
    endMin: number,
    body: Record<string, unknown> = {},
  ) =>
    agent.post('/api/e/testconf/sessions').send({
      roomId,
      title: 'Talk',
      trackId,
      startsAt: at(DAY_ONE, startMin),
      endsAt: at(DAY_ONE, endMin),
      ...body,
    });

  it('carries the hours on the track it made', async () => {
    const { body } = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(body.tracks[0]).toMatchObject({ startMin: 540, endMin: 780, windows: [] });
  });

  it('refuses half a window', async () => {
    await admin.post('/api/e/testconf/tracks').send({ name: 'Half', startMin: 540 }).expect(400);
  });

  it("takes an attendee's session inside the hours", async () => {
    await book(attendee, 600, 660).expect(201);
  });

  it('refuses one that starts before the track opens', async () => {
    const res = await book(attendee, 500, 600).expect(400);
    expect(res.body.error.message).toContain('09:00–13:00');
  });

  it('refuses one that runs past the close, even having started inside', async () => {
    await book(attendee, 720, 840).expect(400);
  });

  it('takes a session that fills the window exactly', async () => {
    await book(attendee, 540, 780).expect(201);
  });

  it('lets an organiser place the exception', async () => {
    await book(admin, 900, 960).expect(201);
  });

  it('holds a speaker to the hours, unlike the blocking rule', async () => {
    const { body: me } = await attendee.get('/api/me').expect(200);
    harness.db
      .prepare('UPDATE roles SET role = ? WHERE identity_id = ? AND event_id = ?')
      .run('speaker', me.id, eventId);
    await book(attendee, 900, 960).expect(400);
  });

  it('leaves a session with no track alone', async () => {
    await book(attendee, 900, 960, { trackId: null }).expect(201);
  });

  it('leaves a track with no hours alone', async () => {
    const open = await admin.post('/api/e/testconf/tracks').send({ name: 'Open' }).expect(201);
    await book(attendee, 900, 960, { trackId: open.body.id }).expect(201);
  });

  it('lets a day of its own replace the window', async () => {
    await admin
      .patch(`/api/e/testconf/tracks/${trackId}`)
      .send({ windows: [{ date: DAY_TWO, startMin: 840, endMin: 1080 }] })
      .expect(200);
    // The afternoon is fine on day two and still refused on day one.
    await attendee
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Talk',
        trackId,
        startsAt: at(DAY_TWO, 900),
        endsAt: at(DAY_TWO, 960),
      })
      .expect(201);
    await book(attendee, 900, 960).expect(400);
  });

  it('refuses two windows on one day', async () => {
    await admin
      .patch(`/api/e/testconf/tracks/${trackId}`)
      .send({
        windows: [
          { date: DAY_TWO, startMin: 540, endMin: 600 },
          { date: DAY_TWO, startMin: 660, endMin: 720 },
        ],
      })
      .expect(400);
  });

  it('narrowing the window leaves the sessions already inside it where they are', async () => {
    const made = await book(attendee, 600, 660).expect(201);
    await admin
      .patch(`/api/e/testconf/tracks/${trackId}`)
      .send({ startMin: 660, endMin: 780 })
      .expect(200);

    const { body } = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(body.sessions).toHaveLength(1);
    // And its owner can still edit it, because it is not being placed anew.
    await attendee
      .patch(`/api/e/testconf/sessions/${made.body.id}`)
      .send({ title: 'Talk, corrected' })
      .expect(200);
    // Moving it, though, is a placement, and the new hours apply.
    await attendee
      .patch(`/api/e/testconf/sessions/${made.body.id}`)
      .send({ startsAt: at(DAY_ONE, 570), endsAt: at(DAY_ONE, 630) })
      .expect(400);
  });

  it('refuses moving an existing session onto a track it does not fit', async () => {
    const made = await book(attendee, 900, 960, { trackId: null }).expect(201);
    await attendee.patch(`/api/e/testconf/sessions/${made.body.id}`).send({ trackId }).expect(400);
  });

  it('lifts the limit when both ends are sent as null', async () => {
    await admin
      .patch(`/api/e/testconf/tracks/${trackId}`)
      .send({ startMin: null, endMin: null })
      .expect(200);
    await book(attendee, 900, 960).expect(201);
  });

  it('a rename does not quietly open the hours', async () => {
    await admin.patch(`/api/e/testconf/tracks/${trackId}`).send({ name: 'Labs' }).expect(200);
    await book(attendee, 900, 960).expect(400);
  });

  it('drops the overrides with the track and does not revive them', async () => {
    await admin
      .patch(`/api/e/testconf/tracks/${trackId}`)
      .send({ windows: [{ date: DAY_TWO, startMin: 840, endMin: 1080 }] })
      .expect(200);
    await admin.delete(`/api/e/testconf/tracks/${trackId}`).expect(204);
    const revived = await admin
      .post('/api/e/testconf/tracks')
      .send({ name: 'Workshops' })
      .expect(201);
    expect(revived.body).toMatchObject({ id: trackId, startMin: null, endMin: null, windows: [] });
  });
});
