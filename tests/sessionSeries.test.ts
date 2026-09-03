import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actorWithRole,
  agentFor,
  at,
  DAY_ONE,
  DAY_TWO,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';

/**
 * Linked sessions: a soft `series_id` grouping that lets an edit offer to apply
 * to the rest, and that an attendee can build over their own sessions. The one
 * rule with teeth is that linking grants no edit right the actor did not have.
 */
describe('linked sessions', () => {
  let harness: Harness;
  let openRoom: number;
  let hallRoom: number;
  let admin: Agent;
  let user: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    const eventId = seedEvent(harness.db);
    hallRoom = seedRoom(harness.db, eventId, { name: 'Main Hall' });
    openRoom = seedRoom(harness.db, eventId, { name: 'Open Room', openBooking: 1, sortOrder: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    user = await actorWithRole(harness, 'testconf', 'user-pw');
  });
  afterEach(() => harness.close());

  /** An open session placed by `agent`; the creator is `agent`'s identity. */
  const make = async (
    agent: Agent,
    title: string,
    date: string,
    startMin = 540,
    room = openRoom,
  ) => {
    const res = await agent
      .post('/api/e/testconf/sessions')
      .send({
        roomId: room,
        title,
        startsAt: at(date, startMin),
        endsAt: at(date, startMin + 60),
      })
      .expect(201);
    return res.body as { id: number; seriesId: string | null; title: string };
  };

  const link = (agent: Agent, sessionIds: number[]) =>
    agent.post('/api/e/testconf/sessions/link').send({ sessionIds });

  const unlink = (agent: Agent, sessionId: number) =>
    agent.post('/api/e/testconf/sessions/unlink').send({ sessionId });

  it('lets an attendee link their own same-named sessions', async () => {
    const mon = await make(user, 'Morning Yoga', DAY_ONE);
    const tue = await make(user, 'Morning Yoga', DAY_TWO);
    expect(mon.seriesId).toBeNull();

    const res = await link(user, [mon.id, tue.id]).expect(200);
    expect(res.body.seriesId).toBeTruthy();
    expect(res.body.sessions).toHaveLength(2);
    for (const s of res.body.sessions) expect(s.seriesId).toBe(res.body.seriesId);
  });

  it('offers only the actor’s same-titled sessions as candidates', async () => {
    const mon = await make(user, 'Morning Yoga', DAY_ONE);
    const tue = await make(user, 'Morning Yoga', DAY_TWO);
    await make(user, 'Evening Run', DAY_ONE, 1080); // different title
    const admins = await make(admin, 'Morning Yoga', DAY_ONE, 540, hallRoom); // not the user's

    const res = await user
      .get(`/api/e/testconf/sessions/${mon.id}/link-candidates`)
      .expect(200);
    const ids = res.body.candidates.map((c: { id: number }) => c.id);
    expect(ids).toEqual([tue.id]); // excludes the anchor, the other title, and the admin's
    expect(ids).not.toContain(admins.id);
  });

  it('refuses to link a session the actor may not edit', async () => {
    const mine = await make(user, 'Morning Yoga', DAY_ONE);
    const theirs = await make(admin, 'Morning Yoga', DAY_ONE, 540, hallRoom);
    const res = await link(user, [mine.id, theirs.id]).expect(403);
    expect(res.body.error.message).toMatch(/not your session|cannot change/i);

    // And nothing was linked as a side effect.
    const after = await user.get(`/api/e/testconf/sessions/${mine.id}/link-candidates`).expect(200);
    expect(after.body.candidates).toHaveLength(0);
  });

  it('refuses to link sessions that do not share a title', async () => {
    const yoga = await make(user, 'Morning Yoga', DAY_ONE);
    const run = await make(user, 'Evening Run', DAY_TWO);
    const res = await link(user, [yoga.id, run.id]).expect(400);
    expect(res.body.error.message).toMatch(/share a title/i);
  });

  it('treats a differently-cased, differently-spaced title as the same', async () => {
    const a = await make(user, 'Morning Yoga', DAY_ONE);
    const b = await make(user, '  morning   YOGA ', DAY_TWO);
    await link(user, [a.id, b.id]).expect(200);
  });

  it('unlinks one, and collapses a series that would be left with one', async () => {
    const a = await make(user, 'Morning Yoga', DAY_ONE);
    const b = await make(user, 'Morning Yoga', DAY_TWO);
    const { body: linked } = await link(user, [a.id, b.id]).expect(200);
    const seriesId = linked.seriesId as string;

    const res = await unlink(user, a.id).expect(200);
    // a left the series, and b — now the only member — was unlinked with it.
    const byId = new Map(
      res.body.sessions.map((s: { id: number; seriesId: string | null }) => [s.id, s.seriesId]),
    );
    expect(byId.get(a.id)).toBeNull();
    expect(byId.get(b.id)).toBeNull();
    expect(seriesId).toBeTruthy();
  });

  it('keeps a three-member series alive when one is unlinked', async () => {
    const a = await make(user, 'Standup', DAY_ONE, 540);
    const b = await make(user, 'Standup', DAY_ONE, 600);
    const c = await make(user, 'Standup', DAY_TWO, 540);
    const { body: linked } = await link(user, [a.id, b.id, c.id]).expect(200);

    await unlink(user, a.id).expect(200);
    const cand = await user.get(`/api/e/testconf/sessions/${b.id}/link-candidates`).expect(200);
    // b and c still share the series; a is gone from it and back among candidates.
    const bundle = await user.get('/api/e/testconf/bundle').expect(200);
    const seriesOf = (id: number) =>
      bundle.body.sessions.find((s: { id: number }) => s.id === id).seriesId;
    expect(seriesOf(b.id)).toBe(linked.seriesId);
    expect(seriesOf(c.id)).toBe(linked.seriesId);
    expect(seriesOf(a.id)).toBeNull();
    expect(cand.body.candidates.map((x: { id: number }) => x.id)).toContain(a.id);
  });

  it('merges into an existing series rather than forking a new id', async () => {
    const a = await make(user, 'Morning Yoga', DAY_ONE, 540);
    const b = await make(user, 'Morning Yoga', DAY_ONE, 600);
    const c = await make(user, 'Morning Yoga', DAY_TWO, 540);
    const { body: first } = await link(user, [a.id, b.id]).expect(200);

    const { body: second } = await link(user, [b.id, c.id]).expect(200);
    expect(second.seriesId).toBe(first.seriesId); // c joined a's series, not a third one
    expect(second.sessions).toHaveLength(3); // all three announced
  });

  it('needs a signed-in editor: a viewer cannot link', async () => {
    const a = await make(user, 'Morning Yoga', DAY_ONE);
    const b = await make(user, 'Morning Yoga', DAY_TWO);
    await agentFor(harness).post('/api/e/testconf/sessions/link').send({ sessionIds: [a.id, b.id] }).expect(401);
  });
});
