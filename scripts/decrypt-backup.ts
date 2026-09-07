/**
 * Open an encrypted whole-database backup.
 *
 *   npm run decrypt-backup -- libresesh-backup-2026-08-30T12-00-00.lsbk restored.db
 *
 * The framing is ours (see `server/src/backup.ts`), so `openssl enc` cannot do
 * this — which is exactly why the tool ships beside the feature. Run it before
 * you need it: a backup you have never restored is a guess, not a backup.
 *
 * The passphrase is read from the terminal with echo off, or from
 * `BACKUP_PASSPHRASE` when there is no terminal (CI, a restore script).
 */
import { createDecipheriv } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  openSync,
  readSync,
  statSync,
  closeSync,
} from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, argv, exit } from 'node:process';
import { pipeline } from 'node:stream/promises';
import { HEADER_BYTES, TAG_BYTES, deriveKey, parseHeader } from '../server/src/backup.js';

function usage(problem: string): never {
  console.error(`${problem}

  npm run decrypt-backup -- <backup.lsbk> <output.db>`);
  exit(1);
}

/** Read a passphrase without echoing it. Falls back to the env var when
 *  stdin is not a terminal, so this works unattended. */
async function readPassphrase(): Promise<string> {
  const fromEnv = process.env.BACKUP_PASSPHRASE;
  if (fromEnv) return fromEnv;
  if (!stdin.isTTY) {
    usage('No terminal to ask on — set BACKUP_PASSPHRASE instead.');
  }

  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  // readline echoes what it reads; muting the output stream for the duration
  // is the standard trick, and cheaper than a dependency.
  const muted = { muted: false };
  const write = stdout.write.bind(stdout);
  (stdout as unknown as { write: typeof write }).write = ((chunk: string, ...rest: unknown[]) =>
    muted.muted ? true : write(chunk, ...(rest as []))) as typeof write;
  try {
    const promise = rl.question('Passphrase: ');
    muted.muted = true;
    const answer = await promise;
    muted.muted = false;
    write('\n');
    return answer;
  } finally {
    muted.muted = false;
    (stdout as unknown as { write: typeof write }).write = write;
    rl.close();
  }
}

async function main(): Promise<void> {
  const [source, destination] = argv.slice(2);
  if (!source || !destination) usage('Both a backup file and an output path are needed.');
  if (!existsSync(source)) usage(`No such file: ${source}`);
  if (existsSync(destination)) usage(`${destination} already exists — pick a new path.`);

  const total = statSync(source).size;
  if (total < HEADER_BYTES + TAG_BYTES) usage('That file is too small to be a backup.');

  // Header at the front, authentication tag at the back: GCM cannot know the
  // tag until it has encrypted the last byte, and the server streams.
  const fd = openSync(source, 'r');
  let header: Buffer;
  let tag: Buffer;
  try {
    header = Buffer.alloc(HEADER_BYTES);
    readSync(fd, header, 0, HEADER_BYTES, 0);
    tag = Buffer.alloc(TAG_BYTES);
    readSync(fd, tag, 0, TAG_BYTES, total - TAG_BYTES);
  } finally {
    closeSync(fd);
  }

  const { params, salt, iv } = parseHeader(header);
  const passphrase = await readPassphrase();

  console.log(`Deriving the key (scrypt N=${params.N}, r=${params.r}, p=${params.p})…`);
  const key = await deriveKey(passphrase, salt, params);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  await pipeline(
    createReadStream(source, { start: HEADER_BYTES, end: total - TAG_BYTES - 1 }),
    decipher,
    createWriteStream(destination),
  );

  console.log(`Wrote ${destination} (${total - HEADER_BYTES - TAG_BYTES} bytes).`);
  console.log(
    'Check it before trusting it:  sqlite3 ' + destination + ' "PRAGMA integrity_check;"',
  );
}

main().catch((err: unknown) => {
  // A wrong passphrase surfaces here, as a failed tag check on the last chunk.
  const message = err instanceof Error ? err.message : String(err);
  console.error(
    /unable to authenticate|Unsupported state/i.test(message)
      ? 'Could not decrypt: wrong passphrase, or the file is damaged.'
      : `Failed: ${message}`,
  );
  exit(1);
});
