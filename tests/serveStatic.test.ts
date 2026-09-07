import { existsSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './helpers.js';

/**
 * The one branch of `createApp` no other test entered.
 *
 * `serveStatic` is off in the harness and off in dev, and on only when
 * `SERVE_STATIC=1` or `NODE_ENV=production` — which is to say, only in the
 * image people actually run. So the SPA fallback and the static mount were
 * built by every test and executed by none.
 *
 * That is not hypothetical: Express 5 routes through path-to-regexp 8, where
 * the bare `'*'` this used to be registered with is a syntax error thrown at
 * registration. The whole suite stayed green while production would have
 * failed to boot.
 */

const WEB_DIST = join(import.meta.dirname, '..', 'web', 'dist');

describe.skipIf(!existsSync(WEB_DIST))('serving the built app', () => {
  let h: Harness;

  beforeEach(() => {
    // Registering the routes at all is most of what this proves.
    h = makeHarness({ serveStatic: true });
  });
  afterEach(() => h.close());

  it('answers a deep link with index.html, so a refresh mid-route works', async () => {
    const res = await request(h.app.express).get('/e/some-event/s/12').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<div id="root">');
  });

  it('does not let the fallback swallow the API', async () => {
    // The catch-all is registered after /api, but "after" is only worth
    // anything if a missing API route still answers as the API.
    const res = await request(h.app.express).get('/api/e/nope/bundle');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('lets a hashed asset be cached hard and index.html not at all', async () => {
    const html = await request(h.app.express).get('/').expect(200);
    expect(html.headers['cache-control']).toBe('no-cache');
  });
});
