import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImportResult } from '../server/src/importEvent.js';
import { localDate, localMinuteOfDay } from '../server/src/shared/time.js';
import {
  actorWithRole,
  agentFor,
  DAY_ONE,
  DAY_TWO,
  makeHarness,
  seedEvent,
  TEST_TIMEZONE,
  type Agent,
  type Harness,
} from './helpers.js';

/** The shape a transcribed schedule arrives in: names and wall-clock times. */
const document = () => ({
  format: 'libresesh.event' as const,
  version: 1 as const,
  event: {
    name: 'Photo Conf',
    slug: 'photoconf',
    timezone: TEST_TIMEZONE,
    startDate: DAY_ONE,
    endDate: DAY_TWO,
  },
  rooms: [{ name: 'Main hall', capacity: 200 }, { name: 'Side room' }],
  tracks: [
    { name: 'Design', description: 'Craft, research and critique.' },
    { name: 'Infrastructure' },
  ],
  tags: [{ name: 'beginner' }],
  sessions: [
    {
      room: 'Main hall',
      track: 'Design',
      tags: ['beginner'],
      title: 'Opening keynote',
      speaker: 'Ada Lovelace',
      date: DAY_ONE,
      start: '09:00',
      end: '10:00',
    },
    {
      room: 'Side room',
      title: 'Hallway track, formalised',
      date: DAY_ONE,
      start: '11:00',
      end: '11:30',
    },
  ],
});

describe('event import from JSON', () => {
  let harness: Harness;
  let importer: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    importer = agentFor(harness);
    await importer.get('/api/me').expect(200);
  });

  afterEach(() => harness.close());

  const post = async (
    doc: unknown,
    { key = 'instance-pw', dryRun = false } = {},
  ): Promise<ImportResult> => {
    const res = await importer
      .post(`/api/events/import${dryRun ? '?dryRun=1' : ''}`)
      .set('X-Instance-Key', key)
      .send(doc)
      .expect(dryRun ? 200 : 201);
    return res.body as ImportResult;
  };

  const failure = async (doc: unknown, status: number): Promise<string> => {
    const res = await importer
      .post('/api/events/import')
      .set('X-Instance-Key', 'instance-pw')
      .send(doc)
      .expect(status);
    return (res.body as { error: { message: string } }).error.message;
  };

  it('needs the instance password', async () => {
    await importer.post('/api/events/import').send(document()).expect(403);
    await importer
      .post('/api/events/import')
      .set('X-Instance-Key', 'not-the-password')
      .send(document())
      .expect(403);
  });

  it('builds the event, its rooms, tracks, tags and sessions', async () => {
    const result = await post(document());

    expect(result.counts).toEqual({ rooms: 2, tracks: 2, tags: 1, breaks: 0, sessions: 2, people: 1 });
    expect(result.warnings).toEqual([]);

    const admin = await actorWithRole(harness, 'photoconf', result.generatedPasswords.adminPassword!);
    const bundle = (await admin.get('/api/e/photoconf/bundle').expect(200)).body as {
      rooms: { name: string; capacity: number | null }[];
      tracks: { name: string; description: string }[];
      sessions: {
        title: string;
        startsAt: string;
        endsAt: string;
        speaker: string;
        trackId: number | null;
        tagIds: number[];
      }[];
    };

    // Array order is column order: the rooms come back as they were printed.
    expect(bundle.rooms.map((r) => r.name)).toEqual(['Main hall', 'Side room']);
    // A transcribed track keeps its context, and one declared without any
    // arrives blank rather than absent.
    expect(bundle.tracks.map((t) => t.description)).toEqual(['Craft, research and critique.', '']);
    expect(bundle.rooms[0]?.capacity).toBe(200);
    expect(bundle.tracks.map((t) => t.name)).toEqual(['Design', 'Infrastructure']);

    const keynote = bundle.sessions.find((s) => s.title === 'Opening keynote');
    expect(keynote).toBeDefined();
    // 09:00 was local time in the event's zone, not UTC.
    expect(localDate(new Date(keynote!.startsAt), TEST_TIMEZONE)).toBe(DAY_ONE);
    expect(localMinuteOfDay(new Date(keynote!.startsAt), TEST_TIMEZONE)).toBe(9 * 60);
    expect(localMinuteOfDay(new Date(keynote!.endsAt), TEST_TIMEZONE)).toBe(10 * 60);
    expect(keynote!.speaker).toBe('Ada Lovelace');
    expect(keynote!.trackId).not.toBeNull();
    expect(keynote!.tagIds).toHaveLength(1);
  });

  it('mints the passwords left blank, and they open the event', async () => {
    const result = await post(document());
    expect(Object.keys(result.generatedPasswords).sort()).toEqual([
      'adminPassword',
      'userPassword',
      'viewerPassword',
    ]);
    await actorWithRole(harness, 'photoconf', result.generatedPasswords.viewerPassword!);
  });

  it('keeps a supplied password to itself', async () => {
    const doc = document();
    const result = await post({
      ...doc,
      event: { ...doc.event, adminPassword: 'a-typed-admin-password' },
    });
    expect(result.generatedPasswords.adminPassword).toBeUndefined();
    await actorWithRole(harness, 'photoconf', 'a-typed-admin-password');
  });

  it('reuses one profile for a speaker named twice', async () => {
    const doc = document();
    doc.sessions[1] = { ...doc.sessions[1]!, speaker: 'ada   lovelace' };
    const result = await post(doc);
    expect(result.counts.people).toBe(1);
  });

  it('lands a session that holds the floor, and holds it against attendees', async () => {
    const doc = document();
    doc.sessions[0] = { ...doc.sessions[0]!, blocksOpenBooking: true };
    await post(doc);
    const row = harness.db
      .prepare<[string], { blocks_open_booking: number }>(
        'SELECT blocks_open_booking FROM sessions WHERE title = ?',
      )
      .get('Opening keynote');
    expect(row?.blocks_open_booking).toBe(1);
  });

  it('lands the breaks it declares, every day by default', async () => {
    const doc = document() as Record<string, unknown>;
    doc.breaks = [
      { label: 'Lunch', start: '12:00', end: '14:00' },
      { label: 'Dinner', start: '19:00', end: '21:00', date: (doc.sessions as { date: string }[])[0]!.date },
    ];
    const result = await post(doc as Parameters<typeof post>[0]);
    expect(result.counts.breaks).toBe(2);
    const rows = harness.db
      .prepare<[], { label: string; start_min: number; end_min: number; date: string | null }>(
        'SELECT label, start_min, end_min, date FROM breaks ORDER BY start_min',
      )
      .all();
    expect(rows).toEqual([
      { label: 'Lunch', start_min: 720, end_min: 840, date: null },
      { label: 'Dinner', start_min: 1140, end_min: 1260, date: expect.any(String) },
    ]);
  });

  it('lands the hours a track keeps, and the days that differ', async () => {
    const doc = document() as Record<string, unknown>;
    doc.tracks = [
      {
        name: 'Design',
        start: '09:00',
        end: '13:00',
        windows: [{ date: DAY_TWO, start: '14:00', end: '18:00' }],
      },
      { name: 'Infrastructure' },
    ];
    await post(doc as Parameters<typeof post>[0]);

    const rows = harness.db
      .prepare<[], { name: string; start_min: number | null; end_min: number | null }>(
        'SELECT name, start_min, end_min FROM tracks ORDER BY sort_order',
      )
      .all();
    expect(rows).toEqual([
      { name: 'Design', start_min: 540, end_min: 780 },
      // A track that says nothing keeps no hours, exactly as before the feature.
      { name: 'Infrastructure', start_min: null, end_min: null },
    ]);
    const windows = harness.db
      .prepare<[], { date: string; start_min: number; end_min: number }>(
        'SELECT date, start_min, end_min FROM track_windows',
      )
      .all();
    expect(windows).toEqual([{ date: DAY_TWO, start_min: 840, end_min: 1080 }]);
  });

  it('refuses track hours that do not close after they open', async () => {
    const doc = document() as Record<string, unknown>;
    doc.tracks = [{ name: 'Design', start: '13:00', end: '09:00' }];
    expect(await failure(doc, 400)).toMatch(/close after it opens/);
  });

  it('imports a session that carried the retired background flag, and says so', async () => {
    const doc = document();
    doc.sessions[0] = { ...doc.sessions[0]!, background: true };
    const result = await post(doc);
    expect(result.warnings.some((w) => w.includes('breaks are their own list'))).toBe(true);
  });

  describe('dry run', () => {
    it('reports the same counts and writes nothing', async () => {
      const result = await post(document(), { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.eventId).toBeNull();
      expect(result.counts).toEqual({ rooms: 2, tracks: 2, tags: 1, breaks: 0, sessions: 2, people: 1 });

      const events = (await agentFor(harness).get('/api/events').expect(200)).body as unknown[];
      expect(events).toHaveLength(0);
      // The slug is still free, so the real run can follow the rehearsal.
      await post(document());
    });

    it('fails the same way a real import would', async () => {
      const doc = document();
      doc.sessions[0] = { ...doc.sessions[0]!, room: 'Balcony' };
      await importer
        .post('/api/events/import?dryRun=1')
        .set('X-Instance-Key', 'instance-pw')
        .send(doc)
        .expect(400);
    });
  });

  describe('contradictions in the document', () => {
    it('refuses a session in a room nobody declared, naming the row', async () => {
      const doc = document();
      doc.sessions[0] = { ...doc.sessions[0]!, room: 'Balcony' };
      const message = await failure(doc, 400);
      expect(message).toContain('sessions[0] "Opening keynote"');
      expect(message).toContain('Balcony');
    });

    it('refuses a hold on an open session, naming the row', async () => {
      const doc = document();
      doc.sessions[0] = { ...doc.sessions[0]!, type: 'open', blocksOpenBooking: true };
      const message = await failure(doc, 400);
      expect(message).toContain('sessions[0] "Opening keynote"');
      expect(message).toMatch(/official/i);
    });

    it('refuses a break pinned to a day outside the event', async () => {
      const doc = document() as Record<string, unknown>;
      doc.breaks = [{ label: 'Lunch', start: '12:00', end: '14:00', date: '2030-01-01' }];
      const message = await failure(doc as Parameters<typeof failure>[0], 400);
      expect(message).toContain('breaks[0] "Lunch"');
      expect(message).toMatch(/outside the event dates/i);
    });

    it('refuses an undeclared track or tag', async () => {
      const withTrack = document();
      withTrack.sessions[0] = { ...withTrack.sessions[0]!, track: 'Governance' };
      expect(await failure(withTrack, 400)).toContain('Governance');

      const withTag = document();
      withTag.sessions[0] = { ...withTag.sessions[0]!, tags: ['advanced'] };
      expect(await failure(withTag, 400)).toContain('advanced');
    });

    it('refuses a session outside the event dates', async () => {
      const doc = document();
      doc.sessions[0] = { ...doc.sessions[0]!, date: '2026-07-04' };
      const message = await failure(doc, 400);
      expect(message).toContain('2026-07-04');
      expect(message).toContain('outside the event dates');
    });

    it('refuses two rooms with the same name', async () => {
      const doc = document();
      doc.rooms = [{ name: 'Main hall' }, { name: 'main  hall' }];
      expect(await failure(doc, 400)).toContain('Two rooms');
    });

    it('refuses a slug that is taken', async () => {
      seedEvent(harness.db, { slug: 'photoconf' });
      expect(await failure(document(), 409)).toContain('slug is already taken');
    });

    it('refuses a time that is not on the five-minute grid', async () => {
      const doc = document();
      doc.sessions[0] = { ...doc.sessions[0]!, start: '09:03' };
      expect(await failure(doc, 400)).toContain('sessions[0]');
    });

    it('leaves nothing behind when a later row fails', async () => {
      const doc = document();
      doc.sessions[1] = { ...doc.sessions[1]!, room: 'Balcony' };
      await failure(doc, 400);

      const events = (await agentFor(harness).get('/api/events').expect(200)).body as unknown[];
      expect(events).toHaveLength(0);
    });
  });

  describe('warnings', () => {
    it('flags a session the schedule will not show', async () => {
      const doc = document();
      doc.event = { ...doc.event, dayStartMin: 600 };
      doc.sessions[0] = { ...doc.sessions[0]!, start: '09:00', end: '09:30' };
      const result = await post(doc);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('sessions[0] "Opening keynote"');
      expect(result.warnings[0]).toContain('outside the hours');
      // A warning is not a refusal: the session is in the event.
      expect(result.counts.sessions).toBe(2);
    });

    it('flags a double booking without refusing it', async () => {
      const doc = document();
      doc.sessions[1] = {
        ...doc.sessions[1]!,
        room: 'Main hall',
        start: '09:30',
        end: '10:30',
        track: undefined as unknown as string,
      };
      const result = await post(doc);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('overlaps');
      expect(result.counts.sessions).toBe(2);
    });
  });

  it('takes instants instead of local times', async () => {
    const doc = document();
    doc.sessions = [
      {
        room: 'Main hall',
        title: 'Written by a program',
        startsAt: '2026-06-01T07:00:00.000Z',
        endsAt: '2026-06-01T08:00:00.000Z',
      } as (typeof doc.sessions)[number],
    ];
    const result = await post(doc);
    expect(result.counts.sessions).toBe(1);
    expect(result.warnings).toEqual([]);
  });

  describe('repeats', () => {
    /** A week-long event with one repeating row and nothing else in it. */
    const weekly = (repeat: unknown, overrides: Record<string, unknown> = {}) => {
      const doc = document();
      doc.event = { ...doc.event, startDate: '2026-06-01', endDate: '2026-06-07' };
      doc.sessions = [
        {
          room: 'Main hall',
          title: 'Morning circle',
          date: '2026-06-01',
          start: '09:00',
          end: '09:30',
          repeat,
          ...overrides,
        } as (typeof doc.sessions)[number],
      ];
      return doc;
    };

    const datesOf = async (slug: string, password: string): Promise<string[]> => {
      const admin = await actorWithRole(harness, slug, password);
      const bundle = (await admin.get(`/api/e/${slug}/bundle`).expect(200)).body as {
        sessions: { startsAt: string }[];
      };
      return bundle.sessions
        .map((s) => localDate(new Date(s.startsAt), TEST_TIMEZONE))
        .sort((a, b) => a.localeCompare(b));
    };

    it('lands one ordinary session on every day of the run', async () => {
      const result = await post(weekly({ until: '2026-06-07' }));

      expect(result.counts.sessions).toBe(7);
      expect(result.warnings).toEqual([]);
      expect(await datesOf('photoconf', result.generatedPasswords.adminPassword!)).toEqual([
        '2026-06-01',
        '2026-06-02',
        '2026-06-03',
        '2026-06-04',
        '2026-06-05',
        '2026-06-06',
        '2026-06-07',
      ]);
    });

    it('lands only on the weekdays it names', async () => {
      // 2026-06-01 is a Monday, so the run is Mon, Wed, Fri.
      const result = await post(weekly({ until: '2026-06-07', days: ['mon', 'wed', 'fri'] }));

      expect(result.counts.sessions).toBe(3);
      expect(await datesOf('photoconf', result.generatedPasswords.adminPassword!)).toEqual([
        '2026-06-01',
        '2026-06-03',
        '2026-06-05',
      ]);
    });

    it('skips the days it excepts, and says so when a skip skips nothing', async () => {
      const result = await post(
        weekly({ until: '2026-06-03', except: ['2026-06-02', '2026-06-30'] }),
      );

      expect(result.counts.sessions).toBe(2);
      expect(await datesOf('photoconf', result.generatedPasswords.adminPassword!)).toEqual([
        '2026-06-01',
        '2026-06-03',
      ]);
      // The one outside the run is the shape a mistyped date takes.
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('2026-06-30');
    });

    /**
     * The reason a repeat refuses instants. Berlin's clocks go back on
     * 2026-10-25, so these three sessions are 24, 25 and 24 hours apart — and
     * all three start at 14:00, which is what the printed programme says.
     */
    it('keeps the printed time across a clock change', async () => {
      const doc = document();
      doc.event = { ...doc.event, startDate: '2026-10-24', endDate: '2026-10-26' };
      doc.sessions = [
        {
          room: 'Main hall',
          title: 'Tech track',
          date: '2026-10-24',
          start: '14:00',
          end: '16:00',
          repeat: { until: '2026-10-26' },
        } as (typeof doc.sessions)[number],
      ];
      const result = await post(doc);
      expect(result.counts.sessions).toBe(3);

      const admin = await actorWithRole(harness, 'photoconf', result.generatedPasswords.adminPassword!);
      const bundle = (await admin.get('/api/e/photoconf/bundle').expect(200)).body as {
        sessions: { startsAt: string }[];
      };
      const starts = bundle.sessions.map((s) => localMinuteOfDay(new Date(s.startsAt), TEST_TIMEZONE));
      expect(starts).toEqual([840, 840, 840]);
    });

    it('warns once about the whole run, not once a day', async () => {
      const doc = weekly({ until: '2026-06-07' });
      doc.event = { ...doc.event, dayStartMin: 600 };
      const result = await post(doc);

      expect(result.counts.sessions).toBe(7);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('repeats every day');
      expect(result.warnings[0]).toContain('outside the hours');
    });

    it('refuses a run that contradicts the row above it', async () => {
      expect(await failure(weekly({ until: '2026-05-30' }), 400)).toContain('before this session');
      // 2026-06-01 is a Monday, and a run that excludes its own first day is
      // two statements about when it starts.
      expect(await failure(weekly({ until: '2026-06-07', days: ['tue'] }), 400)).toContain(
        'does not include mon',
      );
      expect(await failure(weekly({ until: '2026-06-30' }), 400)).toContain(
        'after the event ends 2026-06-07',
      );
      expect(
        await failure(weekly({ until: '2026-06-07', except: ['2026-06-01'], days: ['mon'] }), 400),
      ).toContain('lands on no day at all');
    });

    it('refuses to repeat a session written as instants', async () => {
      const doc = weekly({ until: '2026-06-07' }, {
        date: undefined,
        start: undefined,
        end: undefined,
        startsAt: '2026-06-01T07:00:00.000Z',
        endsAt: '2026-06-01T08:00:00.000Z',
      });
      expect(await failure(doc, 400)).toContain('repeat needs date/start/end');
    });
  });

  // The template is what anyone starts from, so a stale one is worse than
  // none. This is the only thing that keeps it honest.
  it('imports the example document shipped in docs/', async () => {
    const path = new URL('../docs/examples/schedule-import.example.json', import.meta.url);
    const doc = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const result = await post(doc, { dryRun: true });

    expect(result.warnings).toEqual([]);
    expect(result.counts).toEqual({
      rooms: 3,
      tracks: 2,
      tags: 2,
      breaks: 2,
      sessions: 6,
      people: 2,
    });
  });

  it('refuses a document with both time forms, or a key it does not know', async () => {
    const both = document();
    both.sessions[0] = { ...both.sessions[0]!, startsAt: '2026-06-01T07:00:00.000Z' } as never;
    expect(await failure(both, 400)).toContain('not both');

    expect(await failure({ ...document(), session: [] }, 400)).toBeTruthy();
  });
});
