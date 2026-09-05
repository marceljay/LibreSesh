import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fromExport, isEventExport } from '../server/src/importDocument.js';
import type { EventExport, ImportResult } from '../server/src/shared/types.js';
import {
  actorWithRole,
  agentFor,
  at,
  DAY_ONE,
  DAY_TWO,
  makeHarness,
  seedEvent,
  type Agent,
  type Harness,
} from './helpers.js';

/**
 * The round trip: export an event, import the file, export the result, and
 * compare. This is the test whose absence let two formats wear one name for
 * months — the importer said it recognised `libresesh.event` and refused every
 * export that carried it.
 */
describe('an export imports back', () => {
  let harness: Harness;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });

  afterEach(() => harness.close());

  const created = async (res: { body: unknown }): Promise<number> =>
    (res.body as { id: number }).id;

  /** A programme using every field an export carries, so a dropped one shows. */
  const buildProgramme = async (): Promise<void> => {
    const hall = await created(
      await admin
        .post('/api/e/testconf/rooms')
        .send({ name: 'Main hall', description: 'Ground floor', capacity: 200, color: '#112233' })
        .expect(201),
    );
    const side = await created(
      await admin
        .post('/api/e/testconf/rooms')
        .send({ name: 'Side room', openBooking: true })
        .expect(201),
    );
    const workshops = await created(
      await admin
        .post('/api/e/testconf/tracks')
        .send({
          name: 'Workshops',
          description: 'Bring a laptop',
          startMin: 9 * 60,
          endMin: 13 * 60,
          windows: [{ date: DAY_TWO, startMin: 14 * 60, endMin: 18 * 60 }],
        })
        .expect(201),
    );
    const deepDive = await created(
      await admin.post('/api/e/testconf/tags').send({ name: 'Deep dive', color: '#445566' }).expect(201),
    );
    const talk = await created(
      await admin.post('/api/e/testconf/formats').send({ name: 'Talk', color: '#778899' }).expect(201),
    );
    await admin
      .post('/api/e/testconf/breaks')
      .send({ label: 'Lunch', startMin: 12 * 60, endMin: 13 * 60 })
      .expect(201);
    // Ends at midnight: the one minute-of-day the importer spells `24:00`.
    await admin
      .post('/api/e/testconf/breaks')
      .send({ label: 'Party', startMin: 20 * 60, endMin: 24 * 60, date: DAY_TWO })
      .expect(201);

    const opening = await created(
      await admin
        .post('/api/e/testconf/sessions')
        .send({
          roomId: hall,
          trackId: workshops,
          formatId: talk,
          tagIds: [deepDive],
          title: 'Opening',
          description: 'How this works',
          speakers: ['Ada Lovelace', 'Grace Hopper'],
          livestreams: [{ label: 'Main camera', url: 'https://example.org/live' }],
          blocksOpenBooking: true,
          startsAt: at(DAY_ONE, 9 * 60),
          endsAt: at(DAY_ONE, 10 * 60),
        })
        .expect(201),
    );
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId: side,
        type: 'open',
        title: 'Hallway track',
        startsAt: at(DAY_TWO, 15 * 60),
        endsAt: at(DAY_TWO, 16 * 60),
      })
      .expect(201);

    // The record of the event being used, which an import cannot take.
    await admin
      .post('/api/e/testconf/proposals')
      .send({ title: 'A pitch', description: 'maybe later' })
      .expect(201);
    await admin
      .post(`/api/e/testconf/sessions/${opening}/contributions`)
      .send({ kind: 'note', body: 'A note from the room' })
      .expect(201);
    await admin.put(`/api/e/testconf/sessions/${opening}/star`).expect(204);
  };

  const fetchExport = async (agent: Agent, slug: string): Promise<EventExport> =>
    JSON.parse((await agent.get(`/api/e/${slug}/export.json`).expect(200)).text) as EventExport;

  const importer = async (): Promise<Agent> => {
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    return agent;
  };

  const post = async (
    doc: unknown,
    { dryRun = false, status = dryRun ? 200 : 201 } = {},
  ): Promise<ImportResult> => {
    const res = await (await importer())
      .post(`/api/events/import${dryRun ? '?dryRun=1' : ''}`)
      .set('X-Instance-Key', 'instance-pw')
      .send(doc)
      .expect(status);
    return res.body as ImportResult;
  };

  /** The same export, addressed to a free slug — the one edit a restore needs. */
  const renamed = (dump: EventExport, slug: string): EventExport => ({
    ...dump,
    event: { ...dump.event, slug },
  });

  it('is recognised as an export, and a typed document is not', () => {
    expect(isEventExport({ event: { name: 'x' }, sessions: [{ room: 'Hall' }] })).toBe(false);
    expect(isEventExport({ exportedAt: '2026-09-04T00:00:00.000Z', event: {} })).toBe(true);
    // Trimmed by hand — no `exportedAt` — but the ids give it away.
    expect(isEventExport({ event: {}, rooms: [{ id: 3, name: 'Hall' }] })).toBe(true);
    expect(isEventExport({ event: {}, sessions: [{ roomId: 3 }] })).toBe(true);
    expect(isEventExport([])).toBe(false);
    expect(isEventExport(null)).toBe(false);
  });

  it('survives export → import → export', async () => {
    await buildProgramme();
    const first = await fetchExport(admin, 'testconf');

    const result = await post(renamed(first, 'testconf-copy'));
    expect(result.counts).toMatchObject({
      rooms: 2,
      tracks: 1,
      tags: 1,
      formats: 1,
      breaks: 2,
      sessions: 2,
      people: 2,
    });

    const copyAdmin = await actorWithRole(
      harness,
      'testconf-copy',
      result.generatedPasswords.adminPassword!,
    );
    const second = await fetchExport(copyAdmin, 'testconf-copy');

    // Ids differ by construction, so compare what they stand for: the
    // authoring form of each, which has none.
    expect(fromExport(renamed(second, 'x')).doc).toEqual(fromExport(renamed(first, 'x')).doc);

    // And the specifics a lossy translation would have flattened.
    const opening = second.sessions!.find((s) => s.title === 'Opening')!;
    expect(opening.speakers).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(opening.livestreams).toEqual([{ label: 'Main camera', url: 'https://example.org/live' }]);
    expect(opening.blocksOpenBooking).toBe(true);
    expect(opening.startsAt).toBe(at(DAY_ONE, 9 * 60));
    expect(second.tracks[0]).toMatchObject({
      startMin: 9 * 60,
      endMin: 13 * 60,
      windows: [{ date: DAY_TWO, startMin: 14 * 60, endMin: 18 * 60 }],
    });
    expect(second.breaks.map((b) => [b.label, b.endMin, b.date])).toEqual([
      ['Lunch', 13 * 60, null],
      ['Party', 24 * 60, DAY_TWO],
    ]);
    expect(second.rooms.map((r) => [r.name, r.color, r.openBooking])).toEqual([
      ['Main hall', '#112233', false],
      ['Side room', second.rooms[1]!.color, true],
    ]);
    expect(second.formats.map((f) => f.name)).toEqual(['Talk']);
  });

  it('says up front what an import cannot take from an export', async () => {
    await buildProgramme();
    const dump = await fetchExport(admin, 'testconf');
    const result = await post(renamed(dump, 'testconf-copy'), { dryRun: true });
    expect(result.warnings[0]).toMatch(/^This is an export/);
    // Two speakers, plus the organiser: everyone at an event is a person.
    expect(result.warnings[0]).toContain('3 profiles');
    expect(result.warnings[0]).toContain('1 pitch');
    expect(result.warnings[0]).toContain('1 contribution');
    expect(result.warnings[0]).toContain('the star counts');
  });

  it('says nothing when nothing is lost', async () => {
    const dump = await fetchExport(admin, 'testconf');
    // An export carries its organiser's profile; a programme-only one does not.
    const result = await post(renamed({ ...dump, people: [] }, 'testconf-copy'), { dryRun: true });
    expect(result.warnings).toEqual([]);
  });

  it('refuses the same slug, the way any import does', async () => {
    const dump = await fetchExport(admin, 'testconf');
    await post(dump, { status: 409 });
  });

  it('names the row when a hand-edited export points at a room it lost', async () => {
    await buildProgramme();
    const dump = await fetchExport(admin, 'testconf');
    const broken = renamed({ ...dump, rooms: dump.rooms.slice(0, 1) }, 'testconf-copy');
    const res = await (await importer())
      .post('/api/events/import')
      .set('X-Instance-Key', 'instance-pw')
      .send(broken)
      .expect(400);
    expect((res.body as { error: { message: string } }).error.message).toMatch(
      /sessions\[1\] "Hallway track": roomId \d+ is not in this export/,
    );
  });

  it('reads an older export that spelled the speaker in the singular', () => {
    const { doc } = fromExport({
      exportedAt: '2026-01-01T00:00:00.000Z',
      event: { name: 'Old', slug: 'old' },
      rooms: [{ id: 1, name: 'Hall' }],
      sessions: [{ roomId: 1, title: 'Talk', speaker: 'Ada', speakers: [] }],
    });
    expect((doc as { sessions: { speaker?: string }[] }).sessions[0]).toMatchObject({
      room: 'Hall',
      speaker: 'Ada',
    });
  });
});

describe('livestreams in a typed document', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
  });

  afterEach(() => harness.close());

  it('land on the session', async () => {
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    const result = (
      await agent
        .post('/api/events/import')
        .set('X-Instance-Key', 'instance-pw')
        .send({
          event: {
            name: 'Streamed',
            slug: 'streamed',
            timezone: 'Europe/Berlin',
            startDate: DAY_ONE,
            endDate: DAY_ONE,
          },
          rooms: [{ name: 'Hall' }],
          sessions: [
            {
              room: 'Hall',
              title: 'Keynote',
              date: DAY_ONE,
              start: '09:00',
              end: '10:00',
              livestreams: [{ label: 'Stream', url: 'https://example.org/stream' }],
            },
          ],
        })
        .expect(201)
    ).body as ImportResult;
    const admin = await actorWithRole(harness, 'streamed', result.generatedPasswords.adminPassword!);
    const dump = JSON.parse(
      (await admin.get('/api/e/streamed/export.json').expect(200)).text,
    ) as EventExport;
    expect(dump.sessions![0]!.livestreams).toEqual([
      { label: 'Stream', url: 'https://example.org/stream' },
    ]);
  });
});
