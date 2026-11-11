import { describe, expect, it } from 'vitest';
import {
  decryptAtRest,
  encryptAtRest,
  keyId,
  needsReencrypt,
  rotateAtRest,
} from '../server/src/secretsAtRest.js';
import { makeHarness } from './helpers.js';

const plain = new TextEncoder().encode('hello');

describe('secretsAtRest', () => {
  it('round-trips under the current secret', () => {
    const blob = encryptAtRest(plain, 'test', 'secret-a');
    expect(blob.startsWith(`v1.${keyId('secret-a')}.`)).toBe(true);
    expect(decryptAtRest(blob, 'test', { current: 'secret-a' })).toEqual(plain);
  });

  it('fails with the wrong purpose', () => {
    const blob = encryptAtRest(plain, 'test', 'secret-a');
    expect(() => decryptAtRest(blob, 'other', { current: 'secret-a' })).toThrow();
  });

  it('fails with an unknown secret and names the keyid', () => {
    const blob = encryptAtRest(plain, 'test', 'secret-a');
    expect(() => decryptAtRest(blob, 'test', { current: 'secret-b' })).toThrow(/keyid/);
  });

  it('rejects a malformed blob', () => {
    expect(() => decryptAtRest('not-a-blob', 'test', { current: 'secret-a' })).toThrow(/malformed/);
  });

  it('opens under the previous secret and reports the need to re-encrypt', () => {
    const blob = encryptAtRest(plain, 'test', 'secret-a');
    const keys = { current: 'secret-b', previous: 'secret-a' };
    expect(decryptAtRest(blob, 'test', keys)).toEqual(plain);
    expect(needsReencrypt(blob, keys)).toBe(true);
    expect(needsReencrypt(encryptAtRest(plain, 'test', 'secret-b'), keys)).toBe(false);
  });

  it('uses a fresh nonce each time', () => {
    expect(encryptAtRest(plain, 'test', 's')).not.toEqual(encryptAtRest(plain, 'test', 's'));
  });
});

describe('rotateAtRest', () => {
  it('re-encrypts exactly the blobs made under the previous secret', () => {
    const h = makeHarness();
    h.db.exec(`CREATE TABLE secrets_test (id INTEGER PRIMARY KEY, blob TEXT)`);
    const under = (secret: string) => encryptAtRest(plain, 'p', secret);
    const insert = h.db.prepare(`INSERT INTO secrets_test (id, blob) VALUES (?, ?)`);
    insert.run(1, under('old'));
    insert.run(2, under('new'));
    insert.run(3, null);
    const columns = [{ table: 'secrets_test', column: 'blob', purpose: 'p' }];
    expect(rotateAtRest(h.db, { current: 'new', previous: 'old' }, columns)).toBe(1);
    const blobOf = (id: number) =>
      (
        h.db.prepare(`SELECT blob FROM secrets_test WHERE id = ?`).get(id) as {
          blob: string | null;
        }
      ).blob;
    expect(decryptAtRest(blobOf(1)!, 'p', { current: 'new' })).toEqual(plain);
    expect(needsReencrypt(blobOf(2)!, { current: 'new' })).toBe(false);
    expect(blobOf(3)).toBeNull();
    expect(rotateAtRest(h.db, { current: 'new' }, columns)).toBe(0);
    h.close();
  });
});
