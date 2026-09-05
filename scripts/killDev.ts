/**
 * Stop this project's dev servers, then get out of the way.
 *
 *   npm run dev:kill          — stop them
 *   npm run dev:fresh         — stop them, then `npm run dev`
 *   npm run dev:demo:fresh    — stop them, then `npm run dev:demo`
 *
 * The failure this exists for: a `tsx watch` or Vite left over from an earlier
 * session holds :3000 or :3001, and the next `npm run dev` either dies on
 * "port in use" or — worse — comes up on stale config while looking fine.
 *
 * **What it will not kill.** Only two things are ever targeted: whoever is
 * *listening on this project's dev ports*, and processes whose **working
 * directory is this checkout** running a dev command. A git worktree's dev
 * server has its own cwd and its own ports, so it survives — which matters,
 * because parallel agents run one each and killing them by name (`pgrep vite`)
 * takes the lot down. Name matching alone is never enough on its own here.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** The checkout this script belongs to — the cwd every process is judged by. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Vite, and the API behind it. `PORT` mirrors what `dev:api` passes. */
const PORTS = [Number(process.env.WEB_PORT ?? 3000), Number(process.env.PORT ?? 3001)];

/** A dev process worth stopping, when it is also *ours* by cwd. Deliberately
 *  narrow: `npm`, `sh` and `node` on their own are not on it. */
const DEV_COMMAND = /(vite|tsx watch|concurrently)\b/;

/** Vite's bundled esbuild service sits under a path containing "vite", so it
 *  matches the pattern above without being a dev server. Vite starts a new one
 *  anyway; killing it achieves nothing and reads as a wild swing. */
const NOT_A_SERVER = /esbuild/;

/** Is this command line one of ours to stop? Exported for the tests: the two
 *  regexes above are the whole blast radius, so they are worth pinning. */
export function isDevCommand(cmd: string): boolean {
  return DEV_COMMAND.test(cmd) && !NOT_A_SERVER.test(cmd);
}

/** How long to wait for a port to come free after SIGTERM, before SIGKILL. */
const GRACE_MS = 4000;

export interface Victim {
  pid: number;
  /** Why it was picked — shown so a surprising kill is explainable. */
  reason: 'listening' | 'cwd';
  cmd: string;
}

/**
 * PIDs listening on `port`. `lsof` first (it is on macOS and most Linux),
 * `ss` second, and neither being present is not an error — the cwd sweep
 * below still catches our own strays.
 */
export function listenersOn(port: number): number[] {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parsePids(out);
  } catch {
    // Not installed, or nothing listening — `lsof -t` exits non-zero on both.
  }
  try {
    const out = execFileSync('ss', ['-tlnpH', `sport = :${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parsePids(out.match(/pid=(\d+)/g)?.join('\n').replace(/pid=/g, '') ?? '');
  } catch {
    return [];
  }
}

/** Whitespace-separated PIDs, deduped, ignoring anything that isn't one. */
export function parsePids(text: string): number[] {
  const pids = text
    .split(/\s+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 1);
  return [...new Set(pids)];
}

/** `/proc` only — macOS has no equivalent that is worth shelling out for, and
 *  there the port sweep does the work. Returns [] where `/proc` is absent. */
export function ownDevProcesses(root: string): { pid: number; cmd: string }[] {
  // Never stop the chain that is running this script. `dev:fresh` chains
  // `dev:kill && dev` through a shell whose own command line names the dev
  // command, and a sweep that took itself down would leave the second half
  // unrun and the ports half-freed.
  const mine = ancestry(process.pid);
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return [];
  }
  const found: { pid: number; cmd: string }[] = [];
  for (const entry of entries) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid <= 1 || mine.has(pid)) continue;
    try {
      // The cwd is the whole safety argument: a worktree's server reports its
      // own directory here, never ours.
      if (readlinkSync(`/proc/${pid}/cwd`) !== root) continue;
      const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
      if (isDevCommand(cmd)) found.push({ pid, cmd });
    } catch {
      // Gone between readdir and read, or not ours to look at. Either way skip.
    }
  }
  return found;
}

/** This process and every parent up to init — the set to leave alone. */
export function ancestry(pid: number, readStat = defaultReadStat): Set<number> {
  const seen = new Set<number>();
  let current = pid;
  while (current > 1 && !seen.has(current)) {
    seen.add(current);
    const parent = readStat(current);
    if (parent === undefined) break;
    current = parent;
  }
  return seen;
}

/** Parent pid from `/proc/<pid>/stat`, read past the comm field because a
 *  process name may itself hold spaces or brackets. */
function defaultReadStat(pid: number): number | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ppid = Number(after[1]);
    return Number.isInteger(ppid) ? ppid : undefined;
  } catch {
    return undefined;
  }
}

function describe(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim().slice(0, 90);
  } catch {
    return '(exited)';
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const victims = new Map<number, Victim>();
  for (const port of PORTS) {
    for (const pid of listenersOn(port)) {
      victims.set(pid, { pid, reason: 'listening', cmd: describe(pid) });
    }
  }
  // Supervisors are the reason this second sweep exists: `tsx watch` does not
  // hold the port, its child does — kill only the child and the parent puts a
  // fresh one back on the next save.
  for (const { pid, cmd } of ownDevProcesses(ROOT)) {
    if (!victims.has(pid)) victims.set(pid, { pid, reason: 'cwd', cmd });
  }

  if (victims.size === 0) {
    console.log(`nothing to stop — :${PORTS.join(', :')} are free`);
    return;
  }

  for (const v of victims.values()) {
    console.log(`stopping ${v.pid} (${v.reason}) ${v.cmd}`);
    try {
      process.kill(v.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }

  const deadline = Date.now() + GRACE_MS;
  while (Date.now() < deadline && [...victims.keys()].some(alive)) await sleep(150);

  for (const pid of victims.keys()) {
    if (!alive(pid)) continue;
    console.log(`  ${pid} ignored SIGTERM — SIGKILL`);
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Raced us to it.
    }
  }

  // The ports are what the next command actually needs, so report on those
  // rather than on the processes.
  await sleep(200);
  const busy = PORTS.filter((p) => listenersOn(p).length > 0);
  if (busy.length > 0) {
    console.error(
      `still listening on :${busy.join(', :')} — something outside this checkout holds it. ` +
        'Not killing it: find it with `lsof -nP -iTCP -sTCP:LISTEN` and decide yourself.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`:${PORTS.join(', :')} free`);
}

// Importable for the tests without running the sweep. `void`, not top-level
// await: the tests load this file through a CJS interop path that has none.
if (process.argv[1] && resolve(process.argv[1]).startsWith(resolve(ROOT, 'scripts'))) {
  void main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
