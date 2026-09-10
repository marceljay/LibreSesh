import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatPreflight, preflight } from '../server/src/preflight.js';

const dirs: string[] = [];
const scratchDb = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'libresesh-preflight-'));
  dirs.push(dir);
  return join(dir, 'app.db');
};
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const prod = (over: Record<string, string | undefined> = {}) => ({
  NODE_ENV: 'production',
  COOKIE_SECRET: 'a-secret',
  // Long enough to clear the D3 §2 check; the length rules are tested below.
  INSTANCE_ADMIN_PASSWORD: 'kZ2p-instance-key-long-enough',
  ALLOW_EPHEMERAL_DB: '1',
  ...over,
});

describe('deployment preflight', () => {
  it('says nothing outside production', () => {
    expect(preflight({ NODE_ENV: 'development' })).toEqual([]);
    expect(preflight({})).toEqual([]);
  });

  it('passes a correctly configured instance', () => {
    expect(preflight(prod())).toEqual([]);
  });

  // D3 §2: the one password on the box nobody chose and no rotation notice
  // covers. Every instance shares it and it opens event creation, import and
  // the whole-database backup.
  it('refuses to boot on an instance password under 16 characters', () => {
    const problems = preflight(prod({ INSTANCE_ADMIN_PASSWORD: 'short-one-123' }));
    expect(problems).toHaveLength(1);
    expect(problems[0].severity).toBe('fatal');
    expect(problems[0].problem).toContain('shorter than 16');
  });

  it('warns, but boots, between 16 and 24 characters', () => {
    const problems = preflight(prod({ INSTANCE_ADMIN_PASSWORD: 'sixteen-chars-ok!' }));
    expect(problems).toHaveLength(1);
    expect(problems[0].severity).toBe('warning');
    expect(problems[0].problem).toContain('shorter than 24');
  });

  it('says nothing about a long instance password', () => {
    expect(preflight(prod({ INSTANCE_ADMIN_PASSWORD: 'x'.repeat(24) }))).toEqual([]);
  });

  // The whole point: one round of fixes, not one problem per redeploy.
  it('reports every problem at once rather than the first', () => {
    const problems = preflight({
      NODE_ENV: 'production',
      DATABASE_PATH: scratchDb(),
      RAILWAY_SERVICE_NAME: 'libresesh',
    });
    const text = formatPreflight(problems);
    expect(text).toContain('COOKIE_SECRET');
    expect(text).toContain('INSTANCE_ADMIN_PASSWORD');
    expect(text).toContain('not a mounted volume');
    expect(text).toContain('TRUST_PROXY');
    expect(problems.filter((p) => p.severity === 'fatal')).toHaveLength(3);
  });

  it('treats an unmounted data directory as fatal', () => {
    const problems = preflight(prod({ ALLOW_EPHEMERAL_DB: undefined, DATABASE_PATH: scratchDb() }));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.severity).toBe('fatal');
    expect(problems[0]!.fix).toContain('ALLOW_EPHEMERAL_DB=1');
  });

  it('lets a deliberately disposable instance through', () => {
    expect(preflight(prod({ ALLOW_EPHEMERAL_DB: '1', DATABASE_PATH: scratchDb() }))).toEqual([]);
  });

  it('points at the Volumes tab on Railway, and at compose elsewhere', () => {
    const path = scratchDb();
    const railway = preflight(
      prod({ ALLOW_EPHEMERAL_DB: undefined, DATABASE_PATH: path, RAILWAY_PROJECT_ID: 'p1' }),
    );
    expect(railway[0]!.fix).toContain('Volumes tab');
    expect(railway[0]!.fix).toContain('cannot be declared in railway.json');

    const elsewhere = preflight(prod({ ALLOW_EPHEMERAL_DB: undefined, DATABASE_PATH: path }));
    expect(elsewhere[0]!.fix).toContain('docker-compose');
  });

  // A warning must not stop a deploy that is otherwise fine.
  it('makes the proxy hint a warning, not a failure', () => {
    const problems = preflight(prod({ RAILWAY_SERVICE_NAME: 'libresesh' }));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.severity).toBe('warning');
    expect(problems[0]!.problem).toContain('TRUST_PROXY');
    expect(formatPreflight(problems).startsWith('Warnings:')).toBe(true);
  });

  it('stays quiet about the proxy when TRUST_PROXY is set', () => {
    expect(preflight(prod({ RAILWAY_SERVICE_NAME: 'x', TRUST_PROXY: '1' }))).toEqual([]);
  });

  it('leads with the refusal when anything is fatal', () => {
    const text = formatPreflight(preflight({ NODE_ENV: 'production', ALLOW_EPHEMERAL_DB: '1' }));
    expect(text.startsWith('Refusing to start')).toBe(true);
    expect(text).toContain('2 problems');
  });
});
