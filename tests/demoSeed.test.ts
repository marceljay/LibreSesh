import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../server/src/db.js';
import { DEMO_SLUG, LONG_DEMO, seedDemoEvent } from '../server/src/seed.js';

const countFor = (db: Db, table: string, eventId: number): number =>
  db
    .prepare<[number], { n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE event_id = ?`)
    .get(eventId)!.n;

const eventId = (db: Db, slug = DEMO_SLUG): number | undefined =>
  db.prepare<[string], { id: number }>('SELECT id FROM events WHERE slug = ?').get(slug)?.id;

describe('demo event seeding', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
  });
  afterEach(() => db.close());

  it('creates the demo event with a full programme', () => {
    const result = seedDemoEvent(db);
    expect(result).not.toBeNull();
    expect(result!.slug).toBe(DEMO_SLUG);
    expect(result!.sessionCount).toBeGreaterThan(0);

    const id = eventId(db)!;
    expect(countFor(db, 'rooms', id)).toBe(4);
    expect(countFor(db, 'sessions', id)).toBe(result!.sessionCount);
    expect(countFor(db, 'people', id)).toBeGreaterThan(0);
  });

  // The boot path relies on this: a redeploy must not wipe what people added,
  // and must not stack a second copy of the programme on top of the first.
  it('leaves an existing event untouched and returns null', () => {
    const first = seedDemoEvent(db)!;
    const id = eventId(db)!;
    db.prepare('UPDATE events SET name = ? WHERE id = ?').run('Renamed By A Human', id);

    expect(seedDemoEvent(db)).toBeNull();
    expect(eventId(db)).toBe(id);
    expect(countFor(db, 'sessions', id)).toBe(first.sessionCount);
    expect(countFor(db, 'rooms', id)).toBe(4);
    expect(
      db.prepare<[number], { name: string }>('SELECT name FROM events WHERE id = ?').get(id)!.name,
    ).toBe('Renamed By A Human');
  });

  it('rebuilds the event when asked to replace it, leaving no orphans', () => {
    seedDemoEvent(db);
    const again = seedDemoEvent(db, { replace: true })!;
    const id = eventId(db)!;

    // Whole-table counts, not per-event ones: SQLite reuses rowids, so a
    // replaced event can come back with the id the wiped one had. Totals are
    // what prove the wipe took everything and nothing was stacked twice.
    const total = (table: string): number =>
      db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n;
    expect(total('events')).toBe(1);
    expect(total('rooms')).toBe(4);
    expect(total('sessions')).toBe(again.sessionCount);
    expect(countFor(db, 'sessions', id)).toBe(again.sessionCount);
    expect(total('session_tags')).toBeGreaterThan(0);
  });

  it('honours slug, name and day-count overrides', () => {
    const result = seedDemoEvent(db, { slug: 'longconf', name: 'LongConf', days: 14 })!;
    expect(result.slug).toBe('longconf');
    expect(eventId(db, 'longconf')).toBeDefined();
    expect(eventId(db)).toBeUndefined();
    // A long event gets tracks; a two-day one deliberately does not.
    expect(countFor(db, 'tracks', eventId(db, 'longconf')!)).toBeGreaterThan(0);
  });
});

describe('the long fixture', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
  });
  afterEach(() => db.close());

  // What a demo instance seeds alongside DemoConf: the two-day event has no
  // tracks and no week rail to speak of, so only this one exercises them.
  it('is a fortnight with tracks, and sits beside the short one', () => {
    const short = seedDemoEvent(db)!;
    const long = seedDemoEvent(db, { ...LONG_DEMO })!;

    expect(long.slug).toBe('longconf-2026');
    expect(long.sessionCount).toBeGreaterThan(short.sessionCount);
    expect(countFor(db, 'tracks', eventId(db, LONG_DEMO.slug)!)).toBeGreaterThan(0);
    expect(countFor(db, 'tracks', eventId(db, DEMO_SLUG)!)).toBe(0);

    const days =
      (new Date(long.endDate).getTime() - new Date(long.startDate).getTime()) / 86_400_000;
    expect(days).toBe(LONG_DEMO.days - 1);

    expect(db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM events').get()!.n).toBe(2);
  });
});
