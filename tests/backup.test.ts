import { execFileSync } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  BACKUP_MAGIC,
  HEADER_BYTES,
  TAG_BYTES,
  deriveKey,
  parseHeader,
} from '../server/src/backup.js';
import { actorWithRole, agentFor, makeHarness, seedEvent, type Harness } from './helpers.js';

const PASSPHRASE = 'a-long-enough-passphrase';

/** What `scripts/decrypt-backup.ts` does, minus the terminal. */
async function decrypt(blob: Buffer, passphrase: string): Promise<Buffer> {
  const { params, salt, iv } = parseHeader(blob.subarray(0, HEADER_BYTES));
  const key = await deriveKey(passphrase, salt, params);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(blob.subarray(blob.length - TAG_BYTES));
  return Buffer.concat([
    decipher.update(blob.subarray(HEADER_BYTES, blob.length - TAG_BYTES)),
    decipher.final(),
  ]);
}

describe('encrypted whole-database backup', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db, { slug: 'testconf' });
  });

  afterEach(() => harness.close());

  const download = async (
    passphrase = PASSPHRASE,
    key = 'instance-pw',
  ): Promise<{ status: number; body: Buffer; headers: Record<string, string> }> => {
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    const res = await agent
      .post('/api/backup')
      .set('X-Instance-Key', key)
      .send({ passphrase })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    return {
      status: res.status,
      body: res.body as Buffer,
      headers: res.headers as Record<string, string>,
    };
  };

  it('refuses the wrong instance password', async () => {
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    await agent
      .post('/api/backup')
      .set('X-Instance-Key', 'not-the-password')
      .send({ passphrase: PASSPHRASE })
      .expect(403);
  });

  it('refuses an event admin who has no instance password', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.post('/api/backup').send({ passphrase: PASSPHRASE }).expect(403);
  });

  it('refuses a passphrase too short to be worth typing', async () => {
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    const res = await agent
      .post('/api/backup')
      .set('X-Instance-Key', 'instance-pw')
      .send({ passphrase: 'short' })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('validation');
  });

  it('returns a sealed file that opens into a working database', async () => {
    const { status, body, headers } = await download();
    expect(status).toBe(200);
    expect(headers['content-disposition']).toMatch(
      /attachment; filename="libresesh-backup-.*\.lsbk"/,
    );
    expect(headers['content-length']).toBe(String(body.length));
    expect(body.subarray(0, 8).equals(BACKUP_MAGIC)).toBe(true);

    // The ciphertext must not be the database in a hat.
    expect(body.includes(Buffer.from('SQLite format 3'))).toBe(false);

    const plain = await decrypt(body, PASSPHRASE);
    expect(plain.subarray(0, 15).toString()).toBe('SQLite format 3');

    const restored = join(harness.dir, 'restored.db');
    writeFileSync(restored, plain);
    const db = new Database(restored, { readonly: true });
    try {
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      const slugs = db.prepare<[], { slug: string }>('SELECT slug FROM events').all();
      expect(slugs.map((r) => r.slug)).toEqual(['testconf']);
    } finally {
      db.close();
    }
  });

  it('will not open under the wrong passphrase', async () => {
    const { body } = await download();
    await expect(decrypt(body, 'a-different-passphrase')).rejects.toThrow();
  });

  it('uses a fresh salt and nonce every time', async () => {
    const first = parseHeader((await download()).body.subarray(0, HEADER_BYTES));
    const second = parseHeader((await download()).body.subarray(0, HEADER_BYTES));
    expect(first.salt.equals(second.salt)).toBe(false);
    expect(first.iv.equals(second.iv)).toBe(false);
  });

  it('leaves no snapshot behind', async () => {
    await download();
    const leftovers = readdirSync(harness.dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  /**
   * The shipped tool, not a re-implementation of it. A backup nobody has ever
   * restored is a guess — including ours.
   */
  it('opens with scripts/decrypt-backup.ts', async () => {
    const { body } = await download();
    const sealed = join(harness.dir, 'backup.lsbk');
    const restored = join(harness.dir, 'from-script.db');
    writeFileSync(sealed, body);

    execFileSync('npx', ['tsx', 'scripts/decrypt-backup.ts', sealed, restored], {
      env: { ...process.env, BACKUP_PASSPHRASE: PASSPHRASE },
      stdio: 'pipe',
    });

    expect(readFileSync(restored).subarray(0, 15).toString()).toBe('SQLite format 3');
    const db = new Database(restored, { readonly: true });
    try {
      expect(db.prepare<[], { slug: string }>('SELECT slug FROM events').all()).toEqual([
        { slug: 'testconf' },
      ]);
    } finally {
      db.close();
    }
  }, 30_000);

  it('refuses to decrypt under the wrong passphrase from the script', async () => {
    const { body } = await download();
    const sealed = join(harness.dir, 'backup2.lsbk');
    writeFileSync(sealed, body);
    expect(() =>
      execFileSync(
        'npx',
        ['tsx', 'scripts/decrypt-backup.ts', sealed, join(harness.dir, 'nope.db')],
        { env: { ...process.env, BACKUP_PASSPHRASE: 'the-wrong-passphrase' }, stdio: 'pipe' },
      ),
    ).toThrow();
  }, 30_000);

  it('records the download in the audit log', async () => {
    await download();
    const row = harness.db
      .prepare<[], { action: string; entity: string }>(
        "SELECT action, entity FROM audit WHERE action = 'backup'",
      )
      .get();
    expect(row).toEqual({ action: 'backup', entity: 'instance' });
  });
});
