/**
 * One consolidated check of everything a production instance needs, run before
 * anything else at boot.
 *
 * The point is to fail *once*. `loadConfig` throws on the first missing
 * variable it meets, so a fresh deploy with three things wrong used to take
 * three rounds of edit-redeploy-read-the-log to get running, each round
 * revealing exactly one more problem. Collect them all instead and print the
 * fix beside each.
 *
 * Volumes and variables cannot be declared in railway.json — the platform owns
 * both — so this is where the deployment instructions actually live: in the
 * program, next to the thing that needs them, rather than in a document nobody
 * reads until something breaks.
 */
import { checkDurableStorage, isWritableDirectory, isWritableFileIfPresent } from './storage.js';

export interface PreflightProblem {
  /** What is wrong, in the imperative: the reader is looking at a log. */
  problem: string;
  /** What to do about it. */
  fix: string;
  /** Warnings do not stop the boot; everything else does. */
  severity: 'fatal' | 'warning';
}

type Env = Record<string, string | undefined>;

/** Below this the boot stops; below the second, it warns (D3 §2). */
export const INSTANCE_KEY_MIN = 16;
export const INSTANCE_KEY_COMFORTABLE = 24;

/** Railway (and most PaaS) inject their own markers; used only to sharpen advice. */
const onRailway = (env: Env): boolean =>
  Boolean(env.RAILWAY_ENVIRONMENT_NAME ?? env.RAILWAY_SERVICE_NAME ?? env.RAILWAY_PROJECT_ID);

export function preflight(env: Env): PreflightProblem[] {
  const problems: PreflightProblem[] = [];
  if (env.NODE_ENV !== 'production') return problems;

  const railway = onRailway(env);
  const where = railway
    ? 'the service’s Variables tab'
    : 'the environment (deploy/.env for Docker Compose)';

  if (!env.COOKIE_SECRET) {
    problems.push({
      severity: 'fatal',
      problem: 'COOKIE_SECRET is not set.',
      fix: `Set it in ${where} to a long random string — \`openssl rand -hex 32\`. It signs the identity cookie: set it once and keep it, because changing it later signs everyone out and leaves their display names held by the identities they lost. Keep it out of the data volume — that is where the tokens it signs live.`,
    });
  }

  if (!env.INSTANCE_ADMIN_PASSWORD) {
    problems.push({
      severity: 'fatal',
      problem: 'INSTANCE_ADMIN_PASSWORD is not set.',
      fix: `Set it in ${where}. It is the password that lets someone create events on this instance — not an event password.`,
    });
  } else if (env.INSTANCE_ADMIN_PASSWORD.length < INSTANCE_KEY_MIN) {
    // The one password on the box that no organiser chose and no rotation
    // notice covers. Every instance shares it, it opens event creation,
    // import and the whole-database backup, and it is typed by machines far
    // more than by people — so length here costs nobody anything.
    problems.push({
      severity: 'fatal',
      problem: `INSTANCE_ADMIN_PASSWORD is shorter than ${INSTANCE_KEY_MIN} characters.`,
      fix: `Set a longer one in ${where} — \`openssl rand -base64 24\`. It opens event creation, import and the whole-database backup on this instance, and it is the same for everyone who has it.`,
    });
  } else if (env.INSTANCE_ADMIN_PASSWORD.length < INSTANCE_KEY_COMFORTABLE) {
    problems.push({
      severity: 'warning',
      problem: `INSTANCE_ADMIN_PASSWORD is shorter than ${INSTANCE_KEY_COMFORTABLE} characters.`,
      fix: `It works, and \`openssl rand -base64 24\` in ${where} is free. Attempts are rate-limited (five a quarter hour per address) and audited, so this is depth rather than a hole.`,
    });
  }

  const databasePath = env.DATABASE_PATH ?? 'data/app.db';
  if (env.ALLOW_EPHEMERAL_DB !== '1' && databasePath !== ':memory:') {
    const { durable, directory } = checkDurableStorage(databasePath);
    if (!durable) {
      problems.push({
        severity: 'fatal',
        problem: `${directory} is not a mounted volume, so the database would be destroyed on the next deploy.`,
        fix: railway
          ? `Attach a volume to this service with mount path exactly ${directory}. Volumes cannot be declared in railway.json — add it in the service’s Volumes tab. If this instance is meant to be disposable, set ALLOW_EPHEMERAL_DB=1 instead.`
          : `Mount a volume at ${directory} (deploy/docker-compose.yml binds ./data:/data), or point DATABASE_PATH at one that is already mounted. If this instance is meant to be disposable, set ALLOW_EPHEMERAL_DB=1 instead.`,
      });
    }
  }

  // A mounted volume the process cannot write to fails deep inside SQLite as
  // `SQLITE_CANTOPEN`, which says nothing about ownership. Catch it up here.
  if (databasePath !== ':memory:') {
    const { directory } = checkDurableStorage(databasePath);
    const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'unknown';
    const ownershipFix =
      'A mounted volume usually arrives owned by root, while the app runs as an unprivileged user. deploy/entrypoint.sh fixes the ownership at start-up and then drops privileges — if you are not using it, either run this container as root or chown the volume to the user the app runs as.';

    if (!isWritableDirectory(directory)) {
      problems.push({
        severity: 'fatal',
        problem: `${directory} exists but this process cannot write to it (running as uid ${uid}).`,
        fix: ownershipFix,
      });
    } else if (!isWritableFileIfPresent(databasePath)) {
      // A writable directory is not enough: one earlier run as root is all it
      // takes to leave a root-owned app.db behind in a directory that is
      // otherwise fine.
      problems.push({
        severity: 'fatal',
        problem: `${databasePath} exists but this process cannot write to it, even though ${directory} is writable (running as uid ${uid}).`,
        fix: `The database file was almost certainly created by a run as a different user — going back and forth over RAILWAY_RUN_UID does exactly this. ${ownershipFix}`,
      });
    }
  }

  // Not fatal: an instance can legitimately be reached directly. But on a PaaS
  // it never is, and without this every visitor shares one rate-limit bucket.
  if (railway && env.TRUST_PROXY !== '1') {
    problems.push({
      severity: 'warning',
      problem:
        'TRUST_PROXY is not set, but this looks like a platform that terminates TLS in front of the app.',
      fix: `Set TRUST_PROXY=1 in ${where}, or rate limiting sees the proxy as the only client and one visitor can lock out everyone.`,
    });
  }

  return problems;
}

export function formatPreflight(problems: PreflightProblem[]): string {
  const line = (p: PreflightProblem): string =>
    `  ${p.severity === 'fatal' ? '✗' : '!'} ${p.problem}\n      → ${p.fix}`;
  const fatal = problems.filter((p) => p.severity === 'fatal');
  const warnings = problems.filter((p) => p.severity === 'warning');
  const parts: string[] = [];
  if (fatal.length > 0) {
    parts.push(
      `Refusing to start — ${fatal.length} problem${fatal.length === 1 ? '' : 's'} with this deployment:`,
      ...fatal.map(line),
    );
  }
  if (warnings.length > 0) {
    parts.push(fatal.length > 0 ? '\nAlso worth fixing:' : 'Warnings:', ...warnings.map(line));
  }
  return parts.join('\n');
}
