import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionRow } from '../server/src/db.js';
import { publishSession } from '../server/src/drafts.js';
import { Broker } from '../server/src/sse.js';
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

const base = '/api/e/testconf';

describe('draft sessions', () => {
  let harness: Harness;
  let eventId: number;
  let mainRoom: number;
  let openRoom: number;
  let admin: Agent;
  /** Books sessions of their own. */
  let drafter: Agent;
  /** Another attendee, with no hand in anything. */
  let bystander: Agent;
  let viewer: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    mainRoom = seedRoom(harness.db, eventId, { name: 'Main Hall' });
    openRoom = seedRoom(harness.db, eventId, { name: 'Open Room', openBooking: 1, sortOrder: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw', 'organiser');
    drafter = await actorWithRole(harness, 'testconf', 'user-pw', 'drafter');
    bystander = await actorWithRole(harness, 'testconf', 'user-pw', 'bystander');
    viewer = await actorWithRole(harness, 'testconf', 'viewer-pw', 'reader');
  });
  afterEach(() => harness.close());

  const body = (overrides: Record<string, unknown> = {}) => ({
    roomId: openRoom,
    title: 'Parked',
    startsAt: at(DAY_ONE, 600),
    endsAt: at(DAY_ONE, 660),
    ...overrides,
  });
  const create = (agent: Agent, overrides: Record<string, unknown> = {}) =>
    agent.post(`${base}/sessions`).send(body(overrides));
  const bundleIds = async (agent: Agent): Promise<number[]> =>
    ((await agent.get(`${base}/bundle`).expect(200)).body.sessions as { id: number }[]).map(
      (s) => s.id,
    );
  const identityOf = (username: string): number =>
    (
      harness.db
        .prepare('SELECT identity_id FROM event_identities WHERE display_name = ?')
        .get(username) as { identity_id: number }
    ).identity_id;
  const personOf = async (agent: Agent): Promise<number> =>
    (
      (await agent.get(`${base}/bundle`).expect(200)).body.people as {
        id: number;
        isMine: boolean;
      }[]
    ).find((p) => p.isMine)!.id;

  it('is seen by whoever added it and the organisers, and by nobody else', async () => {
    const res = await create(drafter, { draft: true }).expect(201);
    expect(res.body.draft).toBe(true);
    const id = res.body.id as number;

    expect(await bundleIds(drafter)).toContain(id);
    expect(await bundleIds(admin)).toContain(id);
    expect(await bundleIds(bystander)).not.toContain(id);
    expect(await bundleIds(viewer)).not.toContain(id);

    // Not there, rather than forbidden: a refusal would say there is something.
    await bystander.get(`${base}/sessions/${id}`).expect(404);
    await viewer.get(`${base}/sessions/${id}`).expect(404);
    await admin.get(`${base}/sessions/${id}`).expect(200);
    await bystander.patch(`${base}/sessions/${id}`).send({ title: 'Mine now' }).expect(404);
    await bystander.delete(`${base}/sessions/${id}`).expect(404);
  });

  it('is seen by the people credited on it', async () => {
    const speaker = await personOf(bystander);
    const res = await create(admin, { roomId: mainRoom, draft: true, speakers: [speaker] }).expect(
      201,
    );
    expect(await bundleIds(bystander)).toContain(res.body.id);
    expect(await bundleIds(drafter)).not.toContain(res.body.id);
  });

  it('claims no room and holds no floor', async () => {
    await create(admin, { title: 'Maybe', draft: true }).expect(201);
    await create(admin, {
      roomId: mainRoom,
      title: 'Maybe a keynote',
      type: 'official',
      blocksOpenBooking: true,
      draft: true,
    }).expect(201);
    // Same room, same hour, with a hold over it: both are drafts, so neither
    // is in the way.
    await create(drafter, { title: 'Actually on' }).expect(201);
  });

  it('is placed when it is published, and held to every rule a booking meets', async () => {
    await create(drafter, { title: 'Got there first' }).expect(201);
    // A draft may sit in a taken slot…
    const parked = await create(bystander, { draft: true }).expect(201);
    // …and publishing it there is refused, as booking it would be.
    const refused = await bystander
      .patch(`${base}/sessions/${parked.body.id}`)
      .send({ draft: false })
      .expect(409);
    expect(refused.body.error.code).toBe('overlap');

    // Somewhere free, it goes on.
    const published = await bystander
      .patch(`${base}/sessions/${parked.body.id}`)
      .send({ draft: false, startsAt: at(DAY_ONE, 720), endsAt: at(DAY_ONE, 780) })
      .expect(200);
    expect(published.body.draft).toBe(false);
    expect(await bundleIds(viewer)).toContain(parked.body.id);
  });

  it('lets a draft be edited in a slot that is taken', async () => {
    const parked = await create(bystander, { draft: true }).expect(201);
    await create(drafter, { title: 'Got there later' }).expect(201);
    await bystander
      .patch(`${base}/sessions/${parked.body.id}`)
      .send({ title: 'Still parked' })
      .expect(200);
  });

  it('is taken off the schedule by the creator or an organiser, never a co-speaker', async () => {
    const speaker = await personOf(bystander);
    const talk = await create(admin, { roomId: mainRoom, speakers: [speaker] }).expect(201);
    await bystander.patch(`${base}/sessions/${talk.body.id}`).send({ draft: true }).expect(403);
    // Editing the words is still theirs.
    await bystander
      .patch(`${base}/sessions/${talk.body.id}`)
      .send({ title: 'Better title' })
      .expect(200);

    const res = await admin.patch(`${base}/sessions/${talk.body.id}`).send({ draft: true });
    expect(res.status).toBe(200);
    expect(res.body.draft).toBe(true);
    // Credited, so they still see it, even though they cannot publish it.
    expect(await bundleIds(bystander)).toContain(talk.body.id);
    expect(await bundleIds(viewer)).not.toContain(talk.body.id);
  });

  it('tells the people who starred it when it comes off, and not when it moves after', async () => {
    const talk = await create(admin, { roomId: mainRoom }).expect(201);
    await bystander.put(`${base}/sessions/${talk.body.id}/star`).expect(204);
    const titles = () =>
      (
        harness.db
          .prepare('SELECT title FROM notifications WHERE identity_id = ? ORDER BY id')
          .all(identityOf('bystander')) as { title: string }[]
      ).map((n) => n.title);

    await admin.patch(`${base}/sessions/${talk.body.id}`).send({ draft: true }).expect(200);
    expect(titles()).toEqual(['Parked was taken off the schedule']);

    await admin
      .patch(`${base}/sessions/${talk.body.id}`)
      .send({ startsAt: at(DAY_ONE, 720), endsAt: at(DAY_ONE, 780) })
      .expect(200);
    await admin.delete(`${base}/sessions/${talk.body.id}`).expect(204);
    expect(titles()).toHaveLength(1);
  });

  it('keeps stars, notes and calendar feeds off a draft', async () => {
    const parked = await create(drafter, { title: 'Quiet one', draft: true }).expect(201);
    await bystander.put(`${base}/sessions/${parked.body.id}/star`).expect(404);
    const note = await drafter
      .post(`${base}/sessions/${parked.body.id}/contributions`)
      .send({ kind: 'note', body: 'hello' })
      .expect(409);
    expect(note.body.error.code).toBe('draft');

    // Even for its own author: a phone's calendar is the one copy that would
    // not vanish when the session is taken off.
    const ics = await drafter.get(`${base}/calendar.ics`).expect(200);
    expect(ics.text).not.toContain('Quiet one');

    // A star from when it was published neither counts nor shows.
    const talk = await create(admin, { roomId: mainRoom, title: 'Was on' }).expect(201);
    await bystander.put(`${base}/sessions/${talk.body.id}/star`).expect(204);
    await admin.patch(`${base}/sessions/${talk.body.id}`).send({ draft: true }).expect(200);
    const seen = (await bystander.get(`${base}/bundle`).expect(200)).body;
    expect(seen.starredSessionIds).not.toContain(talk.body.id);
    expect(seen.starCounts[talk.body.id]).toBeUndefined();
    const feed = await bystander.get(`${base}/calendar.ics?mine=1`).expect(200);
    expect(feed.text).not.toContain('Was on');
  });

  it('is left off a profile for everyone who may not see it', async () => {
    const speaker = await personOf(bystander);
    const res = await create(admin, { roomId: mainRoom, draft: true, speakers: [speaker] }).expect(
      201,
    );
    const profile = (agent: Agent) =>
      agent
        .get(`${base}/people/${speaker}`)
        .expect(200)
        .then((r) => (r.body.sessions as { id: number }[]).map((s) => s.id));
    expect(await profile(viewer)).not.toContain(res.body.id);
    expect(await profile(bystander)).toContain(res.body.id);
  });

  it('makes a repeated run all drafts', async () => {
    const res = await drafter
      .post(`${base}/sessions/repeat`)
      .send({ ...body({ draft: true }), repeat: { until: '2026-06-02' } })
      .expect(201);
    const ids = (res.body.sessions as { id: number; draft: boolean }[]).map((s) => {
      expect(s.draft).toBe(true);
      return s.id;
    });
    expect(ids).toHaveLength(2);
    const shown = await bundleIds(bystander);
    for (const id of ids) expect(shown).not.toContain(id);
  });

  it('comes back from its own export as a draft', async () => {
    await create(admin, { title: 'On' }).expect(201);
    await create(admin, { title: 'Off', draft: true }).expect(201);
    const exported = JSON.parse((await admin.get(`${base}/export.json`).expect(200)).text) as {
      sessions: { title: string; draft?: boolean }[];
    };
    const byTitle = new Map(exported.sessions.map((s) => [s.title, s]));
    expect(byTitle.get('Off')?.draft).toBe(true);
    // Absent rather than false, so a published session reads as it always has.
    expect(byTitle.get('On')).not.toHaveProperty('draft');
  });

  describe('on the stream', () => {
    const frames = new Map<number, string[]>();
    const fakeStream = (identityId: number, broker: Broker) => {
      const seen: string[] = [];
      frames.set(identityId, seen);
      const res = {
        writeHead: () => res,
        write: (chunk: string) => {
          if (chunk.startsWith('event: change')) seen.push(chunk);
          return true;
        },
        flushHeaders: () => undefined,
        end: () => undefined,
      } as unknown as Response;
      broker.subscribe('testconf', res, identityId);
    };
    const row = (id: number): SessionRow =>
      harness.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;

    it('sends a draft only to who may see it, and its removal to the rest', async () => {
      const talk = await create(drafter, { title: 'Shy' }).expect(201);
      await drafter.patch(`${base}/sessions/${talk.body.id}`).send({ draft: true }).expect(200);

      const broker = new Broker();
      try {
        for (const name of ['drafter', 'organiser', 'bystander', 'reader']) {
          fakeStream(identityOf(name), broker);
        }
        const event = { id: eventId, slug: 'testconf' };
        publishSession(harness.db, broker, event, 'session.updated', row(talk.body.id));
        publishSession(harness.db, broker, event, 'session.created', row(talk.body.id));

        const of = (name: string) => frames.get(identityOf(name))!.join('');
        for (const name of ['drafter', 'organiser']) {
          expect(of(name)).toContain('"title":"Shy"');
          expect(of(name)).not.toContain('session.deleted');
        }
        for (const name of ['bystander', 'reader']) {
          expect(of(name)).not.toContain('Shy');
          // An update takes it off their screen; a create tells them nothing.
          expect(frames.get(identityOf(name))).toHaveLength(1);
          expect(of(name)).toContain('session.deleted');
        }
      } finally {
        broker.close();
      }
    });
  });
});
