import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkDurableStorage,
  isMountPoint,
  isWritableDirectory,
  isWritableFileIfPresent,
} from '../server/src/storage.js';

const dirs: string[] = [];
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'libresesh-storage-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('durable storage check', () => {
  it('treats an ordinary directory as not a mount point', () => {
    const dir = join(scratch(), 'data');
    mkdirSync(dir);
    expect(isMountPoint(dir)).toBe(false);
  });

  // The exact shape of the Railway failure: DATABASE_PATH points somewhere
  // that does not exist yet, openDb would create it, and it would not persist.
  it('treats a directory that does not exist yet as not a mount point', () => {
    expect(isMountPoint(join(scratch(), 'never-created'))).toBe(false);
  });

  it('treats the filesystem root as a mount point', () => {
    expect(isMountPoint('/')).toBe(true);
  });

  it('reports the directory holding the database file', () => {
    const dir = scratch();
    const check = checkDurableStorage(join(dir, 'app.db'));
    expect(check.directory).toBe(dir);
    expect(check.durable).toBe(false);
  });
});

describe('writability probe', () => {
  it('accepts a directory it can write to', () => {
    expect(isWritableDirectory(scratch())).toBe(true);
  });

  // openDb mkdirs the data directory, so "does not exist yet" must not read as
  // "cannot write" — the question is whether the nearest real ancestor allows it.
  it('accepts a directory that does not exist yet but can be created', () => {
    expect(isWritableDirectory(join(scratch(), 'a', 'b', 'c'))).toBe(true);
  });

  // The shape of the Railway crash: the volume is there, owned by someone else.
  it('rejects a directory it cannot write to', () => {
    const dir = join(scratch(), 'readonly');
    mkdirSync(dir);
    chmodSync(dir, 0o500);
    try {
      // Running the suite as root would defeat the permission bits entirely.
      if (typeof process.getuid === 'function' && process.getuid() === 0) return;
      expect(isWritableDirectory(dir)).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
    }
  });
});

describe('existing database file', () => {
  const asRoot = (): boolean => typeof process.getuid === 'function' && process.getuid() === 0;

  it('says yes when the file is not there yet', () => {
    expect(isWritableFileIfPresent(join(scratch(), 'app.db'))).toBe(true);
  });

  it('says yes for a file it can write', () => {
    const file = join(scratch(), 'app.db');
    writeFileSync(file, 'x');
    expect(isWritableFileIfPresent(file)).toBe(true);
  });

  // One run as root leaves a root-owned app.db in a directory that is still
  // writable — the directory probe passes and SQLite still fails.
  it('says no for a read-only file inside a writable directory', () => {
    const dir = scratch();
    const file = join(dir, 'app.db');
    writeFileSync(file, 'x');
    chmodSync(file, 0o444);
    try {
      if (asRoot()) return;
      expect(isWritableDirectory(dir)).toBe(true);
      expect(isWritableFileIfPresent(file)).toBe(false);
    } finally {
      chmodSync(file, 0o644);
    }
  });

  it('does not truncate the file it probes', () => {
    const file = join(scratch(), 'app.db');
    writeFileSync(file, 'important bytes');
    isWritableFileIfPresent(file);
    expect(readFileSync(file, 'utf8')).toBe('important bytes');
  });
});
