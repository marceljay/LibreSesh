import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../server/src/shared/types.js';
import { actorWithRole, makeHarness, seedEvent, type Agent, type Harness } from './helpers.js';

/**
 * Every route that only an organiser may call, called by everyone else.
 *
 * The capability switches have a parity sweep; the fixed admin-only routes —
 * rooms, tags, formats, tracks, breaks, people, claims, settings, the trash,
 * the audit log, the export — had 403 cases scattered through the feature
 * tests, and nothing said all of them did. This table says so: for each,
 * viewer, attendee and speaker get 403, and a browser holding no role at all
 * gets 401. The organiser's happy path stays with the feature tests.
 *
 * Ids are deliberately ones that do not exist. The role guard runs before
 * the handler loads anything, so 403 must arrive ahead of 404 — a route that
 * answered 404 here would be checking the row before the role.
 *
 * The list is data, not derived from source at test time: a parser that
 * missed a route would pass silently, whereas the count check below fails
 * when `server/src/routes/` grows an admin guard this table does not know.
 */
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

const ADMIN_ROUTES: [Method, string][] = [
  ['get', '/audit'],
  ['get', '/login-health'],
  ['post', '/login-attempts/reset'],
  ['get', '/export.json'],
  ['post', '/breaks'],
  ['patch', '/breaks/999'],
  ['delete', '/breaks/999'],
  ['post', '/claims/999/approve'],
  ['post', '/claims/999/decline'],
  ['post', '/formats'],
  ['patch', '/formats/999'],
  ['delete', '/formats/999'],
  ['post', '/people'],
  ['put', '/people/999/role'],
  ['post', '/people/999/archive'],
  ['post', '/people/999/merge'],
  ['post', '/people/999/speaker-code'],
  ['delete', '/people/999/speaker-code'],
  ['delete', '/people/999'],
  ['post', '/proposals/999/place'],
  ['post', '/rooms'],
  ['patch', '/rooms/999'],
  ['delete', '/rooms/999'],
  ['post', '/confirm-admin'],
  ['post', '/password-role'],
  ['patch', '/settings'],
  ['patch', '/permissions'],
  ['post', '/tags'],
  ['patch', '/tags/999'],
  ['delete', '/tags/999'],
  ['post', '/tracks'],
  ['patch', '/tracks/999'],
  ['patch', '/tracks'],
  ['delete', '/tracks/999'],
  ['get', '/trash'],
  ['post', '/sessions/999/restore'],
  ['post', '/contributions/999/restore'],
];

/** How many admin-guarded routes the source declares. */
function countAdminRoutesInSource(): number {
  const dir = join(__dirname, '..', 'server', 'src', 'routes');
  let n = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue;
    const src = readFileSync(join(dir, file), 'utf8');
    for (const m of src.matchAll(
      /router\.(get|post|put|patch|delete)\(\s*'[^']+'([\s\S]*?)\(req, res\)/g,
    )) {
      const middleware = m[2] ?? '';
      if (
        middleware.includes("requireRole(ctx.db, 'admin')") ||
        middleware.includes('...adminWrite')
      ) {
        n += 1;
      }
    }
  }
  return n;
}

describe('admin-only routes refuse everyone else', () => {
  let harness: Harness;
  let eventId: number;
  const actors = new Map<Role, Agent>();

  beforeAll(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    actors.set('viewer', await actorWithRole(harness, 'testconf', 'viewer-pw'));
    actors.set('user', await actorWithRole(harness, 'testconf', 'user-pw'));
    const speaker = await actorWithRole(harness, 'testconf', 'user-pw');
    const id = (await speaker.get('/api/me').expect(200)).body.id as number;
    harness.db
      .prepare('UPDATE roles SET role = ? WHERE identity_id = ? AND event_id = ?')
      .run('speaker', id, eventId);
    actors.set('speaker', speaker);
  });
  afterAll(() => harness.close());

  it('lists every admin-guarded route the source declares', () => {
    expect(countAdminRoutesInSource(), 'add the new route to ADMIN_ROUTES').toBe(
      ADMIN_ROUTES.length,
    );
  });

  for (const [method, path] of ADMIN_ROUTES) {
    const label = `${method.toUpperCase()} ${path}`;
    for (const role of ['viewer', 'user', 'speaker'] as const) {
      it(`${label} → 403 for ${role}`, async () => {
        const res = await (actors.get(role) as Agent)[method](`/api/e/testconf${path}`).send({});
        expect(res.status).toBe(403);
      });
    }
    it(`${label} → 401 with no role`, async () => {
      const res = await request(harness.app.express)[method](`/api/e/testconf${path}`).send({});
      expect(res.status).toBe(401);
    });
  }
});
