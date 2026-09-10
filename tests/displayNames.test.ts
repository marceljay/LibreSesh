import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentFor,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
  nextUsername,
} from './helpers.js';

/** Mint an identity and enter `slug` under a chosen name. */
async function enterAs(
  harness: Harness,
  slug: string,
  displayName: string,
  password = 'user-pw',
): Promise<{ agent: Agent; status: number }> {
  const agent = agentFor(harness);
  await agent.get('/api/me').expect(200);
  const res = await agent.post(`/api/e/${slug}/auth`).send({ password, displayName });
  return { agent, status: res.status };
}

describe('display names are unique per event', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db, { slug: 'confone' });
    seedEvent(harness.db, { slug: 'conftwo' });
  });
  afterEach(() => harness.close());

  it('lets the first arrival take a name', async () => {
    const { status } = await enterAs(harness, 'confone', 'Ada');
    expect(status).toBe(200);
  });

  it('refuses a name already held by someone else in the same event', async () => {
    await enterAs(harness, 'confone', 'Ada');
    const second = await enterAs(harness, 'confone', 'Ada');
    expect(second.status).toBe(409);
  });

  it('grants no role when the name is refused, so the login page can ask again', async () => {
    await enterAs(harness, 'confone', 'Ada');
    const { agent } = await enterAs(harness, 'confone', 'Ada');
    await agent.get('/api/e/confone/bundle').expect(401);

    // The same visitor gets in under a free name.
    await agent.post('/api/e/confone/auth').send({ password: 'user-pw', displayName: 'Grace' });
    const bundle = await agent.get('/api/e/confone/bundle').expect(200);
    expect(bundle.body.displayName).toBe('Grace');
  });

  it('allows the same name in a different event', async () => {
    await enterAs(harness, 'confone', 'Ada');
    const other = await enterAs(harness, 'conftwo', 'Ada');
    expect(other.status).toBe(200);
  });

  it('lets you keep your own name when you re-enter', async () => {
    const { agent } = await enterAs(harness, 'confone', 'Ada');
    await agent
      .post('/api/e/confone/auth')
      .send({ password: 'admin-pw', displayName: nextUsername() })
      .expect(200);
    await agent
      .post('/api/e/confone/auth')
      .send({ password: 'admin-pw', displayName: 'Ada' })
      .expect(200);
  });

  it('reports the name for this event in the bundle, not the global seed', async () => {
    const { agent } = await enterAs(harness, 'confone', 'Ada');
    await agent.post('/api/e/conftwo/auth').send({ password: 'user-pw', displayName: 'Grace' });

    const one = await agent.get('/api/e/confone/bundle').expect(200);
    const two = await agent.get('/api/e/conftwo/bundle').expect(200);
    expect(one.body.displayName).toBe('Ada');
    expect(two.body.displayName).toBe('Grace');
  });

  it('offers the name you last chose when you enter somewhere new', async () => {
    const { agent } = await enterAs(harness, 'confone', 'Ada');
    const me = await agent.get('/api/me').expect(200);
    expect(me.body.displayName).toBe('Ada');
  });
});

describe('renaming inside an event', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db, { slug: 'confone' });
    seedEvent(harness.db, { slug: 'conftwo' });
  });
  afterEach(() => harness.close());

  it('renames you in that event only', async () => {
    const { agent } = await enterAs(harness, 'confone', 'Ada');
    await agent.post('/api/e/conftwo/auth').send({ password: 'user-pw', displayName: 'Ada' });

    await agent.patch('/api/e/confone/me').send({ displayName: 'Grace' }).expect(200);

    const one = await agent.get('/api/e/confone/bundle').expect(200);
    const two = await agent.get('/api/e/conftwo/bundle').expect(200);
    expect(one.body.displayName).toBe('Grace');
    expect(two.body.displayName).toBe('Ada');
  });

  it('refuses a name taken by someone else here', async () => {
    await enterAs(harness, 'confone', 'Ada');
    const { agent } = await enterAs(harness, 'confone', 'Grace');
    await agent.patch('/api/e/confone/me').send({ displayName: 'Ada' }).expect(409);
  });

  it('is a no-op when you re-claim the name you already hold', async () => {
    const { agent } = await enterAs(harness, 'confone', 'Ada');
    await agent.patch('/api/e/confone/me').send({ displayName: 'Ada' }).expect(200);
  });

  it('needs a role — a stranger cannot rename into an event', async () => {
    const stranger = agentFor(harness);
    await stranger.get('/api/me').expect(200);
    await stranger.patch('/api/e/confone/me').send({ displayName: 'Ada' }).expect(401);
  });
});

describe('names survive leaving an event', () => {
  let harness: Harness;
  let eventId: number;

  beforeEach(() => {
    harness = makeHarness();
    eventId = seedEvent(harness.db, { slug: 'confone' });
    seedRoom(harness.db, eventId);
  });
  afterEach(() => harness.close());

  it('keeps a name reserved after sign-out, so nobody inherits your posts', async () => {
    const { agent } = await enterAs(harness, 'confone', 'Ada');
    await agent.post('/api/e/confone/logout').expect(204);

    const other = await enterAs(harness, 'confone', 'Ada');
    expect(other.status).toBe(409);
  });

  it('credits a session to the name its author used in that event', async () => {
    const admin = agentFor(harness);
    await admin.get('/api/me').expect(200);
    await admin
      .post('/api/e/confone/auth')
      .send({ password: 'admin-pw', displayName: 'Ada' })
      .expect(200);

    const rooms = await admin.get('/api/e/confone/bundle').expect(200);
    const roomId = rooms.body.rooms[0].id as number;

    await admin
      .post('/api/e/confone/sessions')
      .send({
        title: 'Analytical Engines',
        roomId,
        startsAt: '2026-06-01T08:00:00.000Z',
        endsAt: '2026-06-01T09:00:00.000Z',
        kind: 'official',
      })
      .expect(201);

    // Renaming in the event renames the credit, because the name is the
    // event's, not a copy taken at write time.
    await admin.patch('/api/e/confone/me').send({ displayName: 'Grace' }).expect(200);
    const after = await admin.get('/api/e/confone/bundle').expect(200);
    expect(after.body.sessions[0].createdByName).toBe('Grace');
  });
});
