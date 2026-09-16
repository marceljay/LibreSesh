/**
 * Column-level encryption for secrets the server must read back in clear:
 * a Nostr signing key, a bot token. Identity tokens are stored in clear
 * because they are useless without `COOKIE_SECRET`; a signing key is not,
 * so it is encrypted under a key derived from the at-rest secret, which
 * defaults to the cookie secret and is kept off the database's volume.
 *
 * The blob names the secret that made it (`v1.<keyid>.<base64>`), so boot
 * can re-encrypt after a rotation without trying every key: set the old
 * value in `SECRETS_AT_REST_KEY_PREVIOUS` for one boot and `rotateAtRest`
 * moves every blob to the current secret.
 */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { Db } from './db.js';

export interface AtRestKeys {
  current: string;
  previous?: string;
}

const NONCE = 12;
const TAG = 16;

/** First eight hex digits of SHA-256 of the secret; identifies, never reveals. */
export const keyId = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex').slice(0, 8);

const derive = (secret: string, purpose: string): Buffer =>
  Buffer.from(hkdfSync('sha256', secret, '', `libresesh/${purpose}/v1`, 32));

export function encryptAtRest(plain: Uint8Array, purpose: string, secret: string): string {
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv('aes-256-gcm', derive(secret, purpose), nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return `v1.${keyId(secret)}.${Buffer.concat([nonce, body]).toString('base64')}`;
}

function secretFor(id: string, keys: AtRestKeys): string {
  if (id === keyId(keys.current)) return keys.current;
  if (keys.previous && id === keyId(keys.previous)) return keys.previous;
  throw new Error(`secretsAtRest: no secret for keyid ${id}`);
}

export function decryptAtRest(blob: string, purpose: string, keys: AtRestKeys): Uint8Array {
  const [version, id, b64] = blob.split('.');
  if (version !== 'v1' || !id || !b64) throw new Error('secretsAtRest: malformed blob');
  const raw = Buffer.from(b64, 'base64');
  if (raw.length < NONCE + TAG) throw new Error('secretsAtRest: malformed blob');
  const nonce = raw.subarray(0, NONCE);
  const tag = raw.subarray(raw.length - TAG);
  const ciphertext = raw.subarray(NONCE, raw.length - TAG);
  const decipher = createDecipheriv('aes-256-gcm', derive(secretFor(id, keys), purpose), nonce);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export const needsReencrypt = (blob: string, keys: AtRestKeys): boolean =>
  blob.split('.')[1] !== keyId(keys.current);

export interface EncryptedColumn {
  table: string;
  column: string;
  purpose: string;
}

/**
 * Re-encrypt every blob not already under `keys.current`. Returns the count.
 * A blob under a secret that is neither current nor previous is left alone
 * and reported, since throwing here would stop the boot for one bad row.
 */
export function rotateAtRest(db: Db, keys: AtRestKeys, columns: EncryptedColumn[]): number {
  let n = 0;
  for (const { table, column, purpose } of columns) {
    const rows = db
      .prepare(`SELECT rowid AS id, ${column} AS blob FROM ${table} WHERE ${column} IS NOT NULL`)
      .all() as { id: number; blob: string }[];
    const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
    for (const row of rows) {
      if (!needsReencrypt(row.blob, keys)) continue;
      let plain: Uint8Array;
      try {
        plain = decryptAtRest(row.blob, purpose, keys);
      } catch (err) {
        console.error(`secretsAtRest: ${table}.${column} rowid ${row.id}: ${String(err)}`);
        continue;
      }
      update.run(encryptAtRest(plain, purpose, keys.current), row.id);
      n += 1;
    }
  }
  return n;
}
