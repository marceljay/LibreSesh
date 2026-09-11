import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp, type App } from '../server/src/app.js';
import { hashPassword } from '../server/src/auth.js';
import type { Config } from '../server/src/config.js';
import { openDb, type Db } from '../server/src/db.js';
import { zonedTimeToUtc } from '../server/src/shared/time.js';

export const TEST_TIMEZONE = 'Europe/Berlin';
export const DAY_ONE = '2026-06-01';
export const DAY_TWO = '2026-06-02';

export interface Harness {
  app: App;
  db: Db;
  dir: string;
  close: () => void;
}

export function makeHarness(overrides: Partial<Config> = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'libresesh-test-'));
  const databasePath = join(dir, 'test.db');
  const db = openDb(databasePath);
  const config: Config = {
    port: 0,
    databasePath,
    cookieSecret: 'test-secret',
    cookieSecretOrigin: 'env',
    instanceAdminPassword: 'instance-pw',
    trustProxy: false,
    serveStatic: false,
    demoMode: false,
    // A demo harness treats the default seeded event as the demo fixture —
    // the production default is the two seeded slugs, which no test seeds.
    demoEventSlugs: overrides.demoMode ? ['testconf'] : [],
    seedDemoEvent: false,
    allowEphemeralDb: true,
    buildCommit: null,
    ...overrides,
  };
  const app = createApp(db, config);
  return {
    app,
    db,
    dir,
    close: () => {
      app.ctx.broker.close();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Insert an event directly, bypassing the instance-password endpoint. */
export function seedEvent(
  db: Db,
  overrides: Partial<{ slug: string; archived: number; startDate: string; endDate: string }> = {},
): number {
  const info = db
    .prepare(
      `INSERT INTO events
        (slug, name, timezone, start_date, end_date, day_start_min, day_end_min,
         viewer_pw_hash, user_pw_hash, admin_pw_hash, archived, created_at)
       VALUES (?, ?, ?, ?, ?, 480, 1320, ?, ?, ?, ?, ?)`,
    )
    .run(
      overrides.slug ?? 'testconf',
      'Test Conf',
      TEST_TIMEZONE,
      overrides.startDate ?? DAY_ONE,
      overrides.endDate ?? DAY_TWO,
      hashPassword('viewer-pw'),
      hashPassword('user-pw'),
      hashPassword('admin-pw'),
      overrides.archived ?? 0,
      new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}

export function seedRoom(
  db: Db,
  eventId: number,
  overrides: Partial<{ name: string; openBooking: number; sortOrder: number }> = {},
): number {
  const info = db
    .prepare(
      'INSERT INTO rooms (event_id, name, description, capacity, open_booking, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      eventId,
      overrides.name ?? 'Room',
      '',
      null,
      overrides.openBooking ?? 0,
      overrides.sortOrder ?? 0,
    );
  return Number(info.lastInsertRowid);
}

export function seedTag(db: Db, eventId: number, name = 'Tag'): number {
  return Number(
    db
      .prepare('INSERT INTO tags (event_id, name, color) VALUES (?, ?, ?)')
      .run(eventId, name, '#6B7280').lastInsertRowid,
  );
}

/** A supertest agent carries the identity cookie across requests. */
export type Agent = ReturnType<typeof request.agent>;

export const agentFor = (harness: Harness): Agent => request.agent(harness.app.express);

let actorSeq = 0;
/** A username no other test actor has used: entering an event requires one,
 *  and it must be unique there. */
export const nextUsername = (): string => `tester_${(actorSeq += 1)}`;

/** Mint an identity, give it a username and grant it a role on `slug`. */
export async function actorWithRole(
  harness: Harness,
  slug: string,
  password: string,
  displayName: string = nextUsername(),
): Promise<Agent> {
  const agent = agentFor(harness);
  await agent.get('/api/me').expect(200);
  await agent.post(`/api/e/${slug}/auth`).send({ password, displayName }).expect(200);
  return agent;
}

/** UTC ISO for a wall-clock minute-of-day on a test date. */
export const at = (date: string, minuteOfDay: number): string =>
  zonedTimeToUtc(date, minuteOfDay, TEST_TIMEZONE).toISOString();
