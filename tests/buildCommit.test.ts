import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeHarness } from './helpers.js';

/**
 * The About page showed "unknown" for the commit on every platform build,
 * because the image is built without `.git` and the platform hands the build
 * no args to stamp with. The commit *is* in the runtime environment, so the
 * server reads it there and `/api/me` carries it to the page.
 */
describe('the commit the server runs', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.BUILD_COMMIT;
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    delete process.env.NODE_ENV;
    process.env.DATABASE_PATH = 'data/unused.db';
    process.env.COOKIE_SECRET = 'x';
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  const load = async () => (await import('../server/src/config.js')).loadConfig();

  it('is taken from the platform, in the short form the bundle stamp uses', async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
    expect((await load()).buildCommit).toBe('0123456');
  });

  it('can be told explicitly, which wins over the platform', async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
    process.env.BUILD_COMMIT = 'abcdef0';
    expect((await load()).buildCommit).toBe('abcdef0');
  });

  it('is null when nothing says, not an empty string', async () => {
    process.env.BUILD_COMMIT = '  ';
    expect((await load()).buildCommit).toBeNull();
  });

  it('reaches the page on /api/me', async () => {
    const h = makeHarness({ buildCommit: 'abc1234' });
    try {
      const res = await request(h.app.express).get('/api/me').expect(200);
      expect(res.body.commit).toBe('abc1234');
    } finally {
      h.close();
    }
  });

  it('is null on /api/me where the server has none', async () => {
    const h = makeHarness();
    try {
      const res = await request(h.app.express).get('/api/me').expect(200);
      expect(res.body.commit).toBeNull();
    } finally {
      h.close();
    }
  });
});
