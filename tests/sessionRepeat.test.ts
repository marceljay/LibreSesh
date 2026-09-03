import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionDto } from '../server/src/shared/types.js';
import { localDate, localMinuteOfDay } from '../server/src/shared/time.js';
import {
  actorWithRole,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  TEST_TIMEZONE,
  type Agent,
  type Harness,
} from './helpers.js';

/**
 * The session form's repeat: one request, many ordinary sessions. What matters
 * is that they *are* ordinary — there is no series to check, so the tests ask
 * which days landed and what time they start.
 */
describe('repeating a session from the form', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;
  let user: Agent;

  // 2026-06-01 is a Monday, so a week runs Mon…Sun.
  const MONDAY = '2026-06-01';
  const SUNDAY = '2026-06-07';

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db, { startDate: MONDAY, endDate: SUNDAY });
    roomId = seedRoom(harness.db, eventId, { name: 'Main Hall', openBooking: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    user = await actorWithRole(harness, 'testconf', 'user-pw');
  });
  afterEach(() => harness.close());

  const body = (overrides: Record<string, unknown> = {}) => ({
    roomId,
    title: 'Morning circle',
    startsAt: at(MONDAY, 9 * 60),
    endsAt: at(MONDAY, 9 * 60 + 30),
    repeat: { until: SUNDAY },
    ...overrides,
  });

  const repeat = (agent: Agent, overrides: Record<string, unknown> = {}) =>
    agent.post('/api/e/testconf/sessions/repeat').send(body(overrides));

  const datesOf = (sessions: SessionDto[]): string[] =>
    sessions.map((s) => localDate(new Date(s.startsAt), TEST_TIMEZONE));

  it('creates one ordinary session per day of the run', async () => {
    const res = await repeat(admin).expect(201);
    const sessions = res.body.sessions as SessionDto[];

    expect(datesOf(sessions)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-06-06',
      '2026-06-07',
    ]);
    // Ordinary, and separately addressable: deleting one leaves six.
    await admin.delete(`/api/e/testconf/sessions/${sessions[2]!.id}`).expect(204);
    const bundle = (await admin.get('/api/e/testconf/bundle').expect(200)).body as {
      sessions: SessionDto[];
    };
    expect(bundle.sessions).toHaveLength(6);
  });

  it('lands only on the weekdays it names', async () => {
    const res = await repeat(admin, {
      repeat: { until: SUNDAY, days: ['mon', 'wed', 'fri'] },
    }).expect(201);

    expect(datesOf(res.body.sessions as SessionDto[])).toEqual([
      '2026-06-01',
      '2026-06-03',
      '2026-06-05',
    ]);
  });

  it('skips the days it excepts', async () => {
    const res = await repeat(admin, {
      repeat: { until: '2026-06-03', except: ['2026-06-02'] },
    }).expect(201);

    expect(datesOf(res.body.sessions as SessionDto[])).toEqual(['2026-06-01', '2026-06-03']);
  });

  it('carries the room, track, tags, speaker and type onto every day', async () => {
    const res = await repeat(admin, {
      title: 'Tech track',
      type: 'official',
      speakers: ['Ada Lovelace'],
      description: 'Same every day.',
      repeat: { until: '2026-06-03' },
    }).expect(201);
    const sessions = res.body.sessions as SessionDto[];

    expect(sessions).toHaveLength(3);
    // One person, not three: the speaker is resolved once for the whole run.
    for (const s of sessions) {
      expect(s.type).toBe('official');
      expect(s.roomId).toBe(roomId);
      expect(s.speakers).toEqual(sessions[0]!.speakers);
      expect(s.description).toBe('Same every day.');
    }
    const people = (await admin.get('/api/e/testconf/bundle').expect(200)).body as {
      people: { claimed: boolean }[];
    };
    expect(people.people.filter((p) => !p.claimed)).toHaveLength(1);
  });

  /**
   * The reason the run repeats a wall clock and not a duration. Berlin's clocks
   * go back on 2026-10-25, so these three sessions are 24, 25 and 24 hours
   * apart — and all three start at 14:00, which is what the programme says.
   */
  it('keeps the printed time across a clock change', async () => {
    harness.close();
    harness = makeHarness();
    const eventId = seedEvent(harness.db, { startDate: '2026-10-24', endDate: '2026-10-26' });
    const room = seedRoom(harness.db, eventId, { name: 'Main Hall' });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');

    const res = await admin
      .post('/api/e/testconf/sessions/repeat')
      .send({
        roomId: room,
        title: 'Tech track',
        startsAt: at('2026-10-24', 14 * 60),
        endsAt: at('2026-10-24', 16 * 60),
        repeat: { until: '2026-10-26' },
      })
      .expect(201);

    const sessions = res.body.sessions as SessionDto[];
    expect(sessions).toHaveLength(3);
    for (const s of sessions) {
      expect(localMinuteOfDay(new Date(s.startsAt), TEST_TIMEZONE)).toBe(840);
      expect(localMinuteOfDay(new Date(s.endsAt), TEST_TIMEZONE)).toBe(960);
    }
  });

  it('lets an attendee place a run of their own open sessions', async () => {
    const res = await repeat(user).expect(201);
    const sessions = res.body.sessions as SessionDto[];
    expect(sessions).toHaveLength(7); // Mon–Sun, the morning-yoga case
    for (const s of sessions) expect(s.type).toBe('open'); // never official
  });

  it('forces an attendee run to open even if it asks for official', async () => {
    const res = await repeat(user, { type: 'official' }).expect(201);
    for (const s of res.body.sessions as SessionDto[]) expect(s.type).toBe('open');
  });

  it('links an attendee run when asked', async () => {
    const res = await repeat(user, { link: true }).expect(201);
    const ids = new Set((res.body.sessions as SessionDto[]).map((s) => s.seriesId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTruthy();
  });

  it('holds an attendee run to rooms open for booking', async () => {
    const closed = seedRoom(harness.db, eventId, { name: 'Locked', openBooking: 0 });
    const res = await repeat(user, { roomId: closed }).expect(403);
    expect(res.body.error.message).toMatch(/not open for booking/i);
  });

  it('keeps every day of an attendee run inside the day viewport', async () => {
    // 07:00 is before the event's 08:00 day start; the run must refuse rather
    // than place a session outside the viewport an attendee is held to.
    const res = await repeat(user, {
      startsAt: at(MONDAY, 7 * 60),
      endsAt: at(MONDAY, 7 * 60 + 30),
    }).expect(400);
    expect(res.body.error.message).toMatch(/2026-06-0/); // prefixed with the day
  });

  it('still lets an admin place a run, official and all', async () => {
    const res = await repeat(admin, { type: 'official' }).expect(201);
    for (const s of res.body.sessions as SessionDto[]) expect(s.type).toBe('official');
  });

  it('refuses a run that contradicts the session it belongs to', async () => {
    const message = async (overrides: Record<string, unknown>): Promise<string> => {
      const res = await repeat(admin, overrides).expect(400);
      return (res.body as { error: { message: string } }).error.message;
    };

    expect(await message({ repeat: { until: '2026-05-30' } })).toContain('before this session');
    expect(await message({ repeat: { until: SUNDAY, days: ['tue'] } })).toContain(
      'does not include mon',
    );
    expect(await message({ repeat: { until: '2026-07-01' } })).toContain(
      `after the event ends ${SUNDAY}`,
    );
    expect(
      await message({ repeat: { until: SUNDAY, days: ['mon'], except: [MONDAY] } }),
    ).toContain('lands on no day at all');
    // Nothing is written when a run is refused.
    const bundle = (await admin.get('/api/e/testconf/bundle').expect(200)).body as {
      sessions: unknown[];
    };
    expect(bundle.sessions).toHaveLength(0);
  });

  it('refuses a key it does not know inside the run', async () => {
    await repeat(admin, { repeat: { until: SUNDAY, every: 'day' } }).expect(400);
  });

  it('leaves the run loose by default — no series', async () => {
    const res = await repeat(admin).expect(201);
    for (const s of res.body.sessions as SessionDto[]) expect(s.seriesId).toBeNull();
  });

  it('links the run into one series when asked', async () => {
    const res = await repeat(admin, { link: true }).expect(201);
    const sessions = res.body.sessions as SessionDto[];
    const ids = new Set(sessions.map((s) => s.seriesId));
    expect(ids.size).toBe(1); // one shared id
    expect([...ids][0]).toBeTruthy(); // and it is not null
  });

  it('does not mint a series for a run that lands on a single day', async () => {
    const res = await repeat(admin, {
      repeat: { until: MONDAY }, // only the first day
      link: true,
    }).expect(201);
    const sessions = res.body.sessions as SessionDto[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0].seriesId).toBeNull();
  });
});
