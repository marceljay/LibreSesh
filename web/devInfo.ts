import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import type { Plugin } from 'vite';

/**
 * What the dev bar at the bottom of every page shows: which checkout this dev
 * server serves, where it sits in git, and when it came up.
 *
 * Read from git on every request rather than stamped once at start, as the
 * build info in vite.config.ts is: a commit or a branch switch while the server
 * runs would otherwise leave the bar naming a commit the served tree has moved
 * past. The start time is the one thing that is fixed for the server's life —
 * a restart (config change, `r` in the terminal) makes a new one.
 */
export interface DevInfo {
  /** Basename of the checkout's top-level directory. */
  worktree: string | null;
  worktreePath: string | null;
  /** Whether this is the main checkout rather than a linked worktree. */
  mainWorktree: boolean;
  branch: string | null;
  commit: string | null;
  dirty: boolean;
  /** ISO time the dev server (re)started. */
  startedAt: string;
}

export const DEV_INFO_PATH = '/__dev-info';
const CACHE_MS = 3000;

function git(cwd: string, command: string): string | null {
  try {
    const out = execSync(`git ${command}`, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

export function readDevInfo(cwd: string, startedAt: string): DevInfo {
  const worktreePath = git(cwd, 'rev-parse --show-toplevel');
  // In the main checkout the two are the same directory; a linked worktree's
  // own git dir lives under the main one's `.git/worktrees/`.
  const gitDir = git(cwd, 'rev-parse --path-format=absolute --git-dir');
  const commonDir = git(cwd, 'rev-parse --path-format=absolute --git-common-dir');
  return {
    worktree: worktreePath ? basename(worktreePath) : null,
    worktreePath,
    mainWorktree: gitDir !== null && gitDir === commonDir,
    // Detached HEAD prints nothing here, which `git()` already turns into null.
    branch: git(cwd, 'branch --show-current'),
    commit: git(cwd, 'rev-parse --short HEAD'),
    dirty: git(cwd, 'status --porcelain') !== null,
    startedAt,
  };
}

/** Serves `/__dev-info` from the dev server only; a production build never
 *  includes it, so the bar's fetch has nothing to reach there either. */
export function devInfoPlugin(): Plugin {
  return {
    name: 'libresesh:dev-info',
    apply: 'serve',
    configureServer(server) {
      const startedAt = new Date().toISOString();
      // Four git calls per page load add up when every route change is a load;
      // a few seconds of reuse is still fresh enough to catch a new commit.
      let cached: { at: number; body: string } | null = null;
      // Registered here rather than in a returned function so it runs before
      // Vite's SPA fallback, which would otherwise answer with index.html.
      server.middlewares.use(DEV_INFO_PATH, (_req, res) => {
        if (!cached || Date.now() - cached.at > CACHE_MS) {
          cached = {
            at: Date.now(),
            body: JSON.stringify(readDevInfo(server.config.root, startedAt)),
          };
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(cached.body);
      });
    },
  };
}
