import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, openDb, type Db } from '../server/src/db.js';

const MIGRATIONS = join(import.meta.dirname, '..', 'server', 'migrations');

describe('migrations', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
  });
  afterEach(() => db.close());

  it('creates every table the app relies on', () => {
    const tables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    for (const table of [
      'events',
      'identities',
      'roles',
      'rooms',
      'tags',
      'sessions',
      'session_tags',
      'contributions',
      'tracks',
      'event_identities',
      'audit',
      'migrations',
    ]) {
      expect(tables).toContain(table);
    }
  });

  it('renamed the booking permission off the word "track"', () => {
    const columns = db
      .prepare<[], { name: string }>('PRAGMA table_info(rooms)')
      .all()
      .map((c) => c.name);
    expect(columns).toContain('open_booking');
    expect(columns).not.toContain('open_track');
  });

  it('is idempotent', () => {
    const before = db.prepare<[], { name: string }>('SELECT name FROM migrations').all();
    expect(() => migrate(db)).not.toThrow();
    expect(db.prepare<[], { name: string }>('SELECT name FROM migrations').all()).toEqual(before);
  });

  it('enforces the role and type checks', () => {
    expect(() =>
      db
        .prepare('INSERT INTO roles (identity_id, event_id, role, granted_at) VALUES (1, 1, ?, ?)')
        .run('superuser', new Date().toISOString()),
    ).toThrow();
  });

  it('runs in WAL mode with foreign keys on', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('memory');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  /**
   * Migration 010: everyone who has entered an event is a person there. The
   * backfill has to cover both shapes of older data — an event name without a
   * profile, and a role holder with neither (the demo seed, and events from
   * before per-event names) — and leave alone what already has one.
   */
  describe('010 backfills a person for everyone who has entered', () => {
    let dir: string;
    let old: Db;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'libresesh-mig-'));
      const upTo009 = join(dir, 'upto009');
      mkdirSync(upTo009);
      for (const f of readdirSync(MIGRATIONS).filter((f) => f < '010')) {
        copyFileSync(join(MIGRATIONS, f), join(upTo009, f));
      }
      old = new Database(join(dir, 'old.db'));
      old.pragma('foreign_keys = ON');
      migrate(old, upTo009);
    });
    afterEach(() => {
      old.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('inserts the missing rows and only those', () => {
      const now = '2026-09-01T10:00:00.000Z';
      old
        .prepare(
          `INSERT INTO events (id, slug, name, timezone, start_date, end_date, day_start_min, day_end_min,
             viewer_pw_hash, user_pw_hash, admin_pw_hash, archived, created_at)
           VALUES (1, 'conf', 'Conf', 'UTC', '2026-09-01', '2026-09-02', 480, 1320, 'x', 'x', 'x', 0, ?)`,
        )
        .run(now);
      const identity = old.prepare(
        `INSERT INTO identities (id, public_id, token, display_name, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      identity.run(1, 'aaaaa', 't1', 'ada', now, now); // name + profile already
      identity.run(2, 'bbbbb', 't2', 'grace', now, now); // name, no profile
      identity.run(3, 'ccccc', 't3', 'linus', now, now); // role only, seed name
      identity.run(4, 'ddddd', 't4', '', now, now); // role only, no name at all
      const enter = old.prepare(
        'INSERT INTO event_identities (event_id, identity_id, display_name, claimed_at) VALUES (1, ?, ?, ?)',
      );
      enter.run(1, 'ada', now);
      enter.run(2, 'grace', now);
      const role = old.prepare(
        "INSERT INTO roles (identity_id, event_id, role, granted_at) VALUES (?, 1, 'user', ?)",
      );
      for (const id of [1, 2, 3, 4]) role.run(id, now);
      old
        .prepare(
          `INSERT INTO people (event_id, identity_id, name, bio, links, created_at, updated_at)
           VALUES (1, 1, 'Ada Lovelace', '', '[]', ?, ?)`,
        )
        .run(now, now);

      migrate(old, MIGRATIONS);

      const people = old
        .prepare<[], { identity_id: number | null; name: string }>(
          'SELECT identity_id, name FROM people WHERE event_id = 1 ORDER BY identity_id',
        )
        .all();
      expect(people).toEqual([
        { identity_id: 1, name: 'Ada Lovelace' },
        { identity_id: 2, name: 'grace' },
        { identity_id: 3, name: 'linus' },
      ]);
      // The seed-named role holder got an event name too; the nameless one
      // stays outside until it types one at the login page.
      const names = old
        .prepare<[], { identity_id: number }>(
          'SELECT identity_id FROM event_identities WHERE event_id = 1 ORDER BY identity_id',
        )
        .all()
        .map((r) => r.identity_id);
      expect(names).toEqual([1, 2, 3]);
    });
  });
});
