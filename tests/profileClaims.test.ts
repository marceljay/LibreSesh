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

/**
 * An organiser adds "Marcel Jackisch" as a speaker before he arrives. Marcel
 * enters as `marcel`, which gives him a profile of his own, and the shell is
 * still sitting there with his talks on it. Three routes could join the two,
 * and all of them needed somebody else to act first. This is the fourth: he
 * asks, an organiser agrees, and the shell survives with his identity on it.
 */
describe('asking for the profile an organiser left for you', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;
  let marcel: Agent;
  let someoneElse: Agent;
  let shellId: number;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    marcel = await actorWithRole(harness, 'testconf', 'user-pw');
    someoneElse = await actorWithRole(harness, 'testconf', 'user-pw');
    const session = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'The keynote',
        speakers: ['Marcel Jackisch'],
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    shellId = session.body.speakers[0].id as number;
  });
  afterEach(() => harness.close());

  const ask = (agent: Agent, personId = shellId) =>
    agent.post(`/api/e/testconf/people/${personId}/claim`);
  const claimsFor = async (agent: Agent) =>
    (await agent.get('/api/e/testconf/bundle').expect(200)).body.claims as {
      id: number;
      personId: number;
      username: string;
      requesterUid?: string;
      requesterPersonId?: number | null;
      declinedAt: string | null;
      isMine: boolean;
    }[];
  const mineIn = async (agent: Agent) => {
    const bundle = await agent.get('/api/e/testconf/bundle').expect(200);
    return bundle.body.people.find((p: { isMine: boolean }) => p.isMine) as
      { id: number; name: string } | undefined;
  };

  it('asks, and nothing moves until an organiser agrees', async () => {
    const before = await mineIn(marcel);
    await ask(marcel).expect(201);

    // The shell is untouched: asking is not taking.
    const bundle = await marcel.get('/api/e/testconf/bundle').expect(200);
    const shell = bundle.body.people.find((p: { id: number }) => p.id === shellId);
    expect(shell.claimed).toBe(false);
    expect((await mineIn(marcel))?.id).toBe(before?.id);
    expect(bundle.body.claims).toHaveLength(1);
    expect(bundle.body.claims[0]).toMatchObject({ personId: shellId, isMine: true });
  });

  it('shows an organiser who is asking, and tells nobody else', async () => {
    await ask(marcel).expect(201);
    const seen = await claimsFor(admin);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.requesterUid).toMatch(/^[0-9a-f]{5}$/);
    expect(seen[0]?.requesterPersonId).toBe((await mineIn(marcel))?.id);
    // Someone else's request is not their business, and the private fields
    // are absent rather than null for anyone who is not an organiser.
    expect(await claimsFor(someoneElse)).toHaveLength(0);
    const own = await claimsFor(marcel);
    expect(own).toHaveLength(1);
    expect(own[0]).not.toHaveProperty('requesterUid');
  });

  it('approving hands the shell over and folds their own profile in', async () => {
    const theirs = await mineIn(marcel);
    await ask(marcel).expect(201);
    const claims = await claimsFor(admin);
    await admin.post(`/api/e/testconf/claims/${claims[0]?.id}/approve`).expect(200);

    // The shell survived, keeping its name and its talk, and is now his.
    const bundle = await marcel.get('/api/e/testconf/bundle').expect(200);
    const held = bundle.body.people.find((p: { isMine: boolean }) => p.isMine);
    expect(held).toMatchObject({ id: shellId, name: 'Marcel Jackisch', claimed: true });
    expect(bundle.body.people.some((p: { id: number }) => p.id === theirs?.id)).toBe(false);
    expect(bundle.body.sessions[0].speakers[0].id).toBe(shellId);
    // The queue is empty, and he keeps his username and his role.
    expect(bundle.body.claims).toHaveLength(0);
    expect(bundle.body.role).toBe('user');
  });

  it('declining leaves the shell alone and tells the asker, once', async () => {
    await ask(marcel).expect(201);
    const claims = await claimsFor(admin);
    await admin.post(`/api/e/testconf/claims/${claims[0]?.id}/decline`).expect(200);

    expect(await claimsFor(admin)).toHaveLength(0);
    const own = await claimsFor(marcel);
    expect(own).toHaveLength(1);
    expect(own[0]?.declinedAt).toBeTruthy();

    // Cleared by the asker, and then they may ask again.
    await marcel.delete(`/api/e/testconf/claims/${own[0]?.id}`).expect(200);
    expect(await claimsFor(marcel)).toHaveLength(0);
    await ask(marcel).expect(201);
  });

  it('turns down everyone else waiting on the same profile', async () => {
    await ask(marcel).expect(201);
    await ask(someoneElse).expect(201);
    const claims = await claimsFor(admin);
    expect(claims).toHaveLength(2);
    const his = (await mineIn(marcel))?.id;
    const marcels = claims.find((c) => c.requesterPersonId === his);

    await admin.post(`/api/e/testconf/claims/${marcels?.id}/approve`).expect(200);
    expect(await claimsFor(admin)).toHaveLength(0);
    const loser = await claimsFor(someoneElse);
    expect(loser[0]?.declinedAt).toBeTruthy();
  });

  it('refuses a profile somebody already holds, and a second open request', async () => {
    const held = await mineIn(someoneElse);
    const taken = await ask(marcel, held?.id).expect(409);
    expect(taken.body.error.code).toBe('already_claimed');

    await ask(marcel).expect(201);
    const other = await admin.post('/api/e/testconf/people').send({ name: 'Another' }).expect(201);
    const second = await ask(marcel, other.body.id).expect(409);
    expect(second.body.error.code).toBe('claim_pending');
  });

  it('lets only organisers decide, and only the asker withdraw', async () => {
    await ask(marcel).expect(201);
    const id = (await claimsFor(admin))[0]?.id;
    await marcel.post(`/api/e/testconf/claims/${id}/approve`).expect(403);
    await someoneElse.post(`/api/e/testconf/claims/${id}/decline`).expect(403);
    await someoneElse.delete(`/api/e/testconf/claims/${id}`).expect(403);
    await marcel.delete(`/api/e/testconf/claims/${id}`).expect(200);
  });

  it('is written down, both ways', async () => {
    await ask(marcel).expect(201);
    const id = (await claimsFor(admin))[0]?.id;
    await admin.post(`/api/e/testconf/claims/${id}/approve`).expect(200);
    const audit = await admin.get('/api/e/testconf/audit').expect(200);
    const actions = audit.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('claim_approve');
    expect(actions).toContain('claim_request');
  });

  it('is read-only once the event is archived', async () => {
    await admin.patch('/api/e/testconf/settings').send({ archived: true }).expect(200);
    await ask(marcel).expect(409);
  });
});
