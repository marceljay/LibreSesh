import { describe, expect, it } from 'vitest';
import { ancestry, isDevCommand, parsePids } from '../scripts/killDev.js';

/**
 * `npm run dev:kill` stops processes, so what is worth pinning is not that it
 * kills but what it *refuses* to. Two rules bound the blast radius: a process
 * must be listening on this project's dev ports or have this checkout as its
 * working directory, and it must look like a dev server. Parallel agents run a
 * dev stack each out of their own git worktree, and a sweep by name alone
 * (`pkill vite`) takes all of them down.
 */
describe('what counts as a dev server', () => {
  it('recognises the three commands the dev script actually starts', () => {
    expect(isDevCommand('node /repo/node_modules/.bin/vite --config web/vite.config.ts')).toBe(true);
    expect(isDevCommand('node /repo/node_modules/.bin/tsx watch server/src/index.ts')).toBe(true);
    expect(isDevCommand('node /repo/node_modules/.bin/concurrently -n api,web')).toBe(true);
  });

  it('spares vite’s esbuild service, which only matches by its path', () => {
    // Its binary lives under .../vite/node_modules/@esbuild/..., so the word
    // "vite" is in the command line of something that is not a server.
    expect(isDevCommand('/repo/node_modules/vite/node_modules/@esbuild/linux-arm64/bin/esbuild')).toBe(
      false,
    );
  });

  it('spares the ordinary commands that share a cwd with the dev server', () => {
    expect(isDevCommand('npm run build')).toBe(false);
    expect(isDevCommand('node /repo/node_modules/.bin/vitest run')).toBe(false);
    expect(isDevCommand('tsx scripts/seed.ts')).toBe(false);
    // `tsx` alone is not it — only `tsx watch`, which is the server.
    expect(isDevCommand('tsx server/src/index.ts')).toBe(false);
  });
});

describe('the sweep never takes itself down', () => {
  /** A synthetic process tree: 5 → 4 → 3 → 1. */
  const parents = new Map([
    [5, 4],
    [4, 3],
    [3, 1],
  ]);
  const readStat = (pid: number) => parents.get(pid);

  it('collects every parent up to init', () => {
    expect([...ancestry(5, readStat)].sort((a, b) => a - b)).toEqual([3, 4, 5]);
  });

  it('stops at a process whose parent is unknown', () => {
    expect([...ancestry(99, readStat)]).toEqual([99]);
  });

  it('does not spin on a cycle', () => {
    const cyclic = (pid: number) => ({ 7: 8, 8: 7 })[pid as 7 | 8];
    expect([...ancestry(7, cyclic)].sort((a, b) => a - b)).toEqual([7, 8]);
  });
});

describe('reading pids out of lsof or ss', () => {
  it('takes whitespace-separated pids and dedupes them', () => {
    expect(parsePids('12\n34\n34\n')).toEqual([12, 34]);
  });

  it('ignores anything that is not a pid, and never returns init', () => {
    expect(parsePids('  1 \n0\nnot-a-pid\n\n42 ')).toEqual([42]);
  });

  it('is empty for empty output, which is what "nothing listening" looks like', () => {
    expect(parsePids('')).toEqual([]);
  });
});
