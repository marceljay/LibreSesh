import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import type { ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db } from './db.js';

// `promisify` resolves to the overload without options, which is the one
// overload we cannot use — the cost parameters are the whole point.
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Whole-database backup: a `VACUUM INTO` snapshot sealed with AES-256-GCM
 * under a passphrase typed at download time.
 *
 * The framing is ours, so `openssl enc` cannot open one of these — which is
 * why `scripts/decrypt-backup.ts` ships with it. A backup nobody can restore
 * is not a backup. The header is deliberately self-describing (it carries the
 * KDF parameters, not just the salt) so a file written today still opens after
 * we raise the scrypt cost.
 *
 *   offset  size  field
 *        0     8  magic "LSESHBK1"
 *        8     4  scrypt N          (uint32 BE)
 *       12     2  scrypt r          (uint16 BE)
 *       14     2  scrypt p          (uint16 BE)
 *       16    16  salt
 *       32    12  GCM nonce
 *       44     …  ciphertext (same length as the plaintext DB)
 *     last    16  GCM authentication tag
 *
 * The tag trails the ciphertext because it does not exist until the last byte
 * is encrypted, and this is written straight to the socket. A reader seeks to
 * the end for it — trivial for a file, which is the only thing this is for.
 */
export const BACKUP_MAGIC = Buffer.from('LSESHBK1', 'ascii');
export const HEADER_BYTES = 44;
export const TAG_BYTES = 16;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** ~32MB and roughly 100ms per attempt — the cost an offline guesser pays. */
export const SCRYPT_PARAMS: ScryptParams = { N: 1 << 15, r: 8, p: 1 };
const KEY_BYTES = 32;
/** Node's default `maxmem` is 32MB, which is exactly what N=2^15,r=8 needs. */
const MAX_MEM = 128 * 1024 * 1024;

export async function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: ScryptParams = SCRYPT_PARAMS,
): Promise<Buffer> {
  return scrypt(passphrase.normalize('NFKC'), salt, KEY_BYTES, { ...params, maxmem: MAX_MEM });
}

export function buildHeader(
  salt: Buffer,
  iv: Buffer,
  params: ScryptParams = SCRYPT_PARAMS,
): Buffer {
  const header = Buffer.alloc(HEADER_BYTES);
  BACKUP_MAGIC.copy(header, 0);
  header.writeUInt32BE(params.N, 8);
  header.writeUInt16BE(params.r, 12);
  header.writeUInt16BE(params.p, 14);
  salt.copy(header, 16);
  iv.copy(header, 32);
  return header;
}

export interface ParsedHeader {
  params: ScryptParams;
  salt: Buffer;
  iv: Buffer;
}

/** Throws a plain `Error` — this is read by the CLI, not by a route. */
export function parseHeader(header: Buffer): ParsedHeader {
  if (header.length < HEADER_BYTES) throw new Error('Truncated backup: no header');
  if (!timingSafeEqual(header.subarray(0, 8), BACKUP_MAGIC)) {
    throw new Error('Not a LibreSesh backup (bad magic)');
  }
  return {
    params: {
      N: header.readUInt32BE(8),
      r: header.readUInt16BE(12),
      p: header.readUInt16BE(14),
    },
    salt: header.subarray(16, 32),
    iv: header.subarray(32, 44),
  };
}

export const newSalt = (): Buffer => randomBytes(16);
export const newIv = (): Buffer => randomBytes(12);

/**
 * A consistent snapshot of the whole database in one file, taken without
 * stopping the server: `VACUUM INTO` reads inside a transaction, so it cannot
 * catch a half-applied write. The destination must not already exist.
 */
export function vacuumInto(db: Db, destination: string): void {
  // The path is a bound parameter, not interpolated — a data directory with a
  // quote in its name is unlikely but not our business to mangle.
  db.prepare('VACUUM INTO ?').run(destination);
}
