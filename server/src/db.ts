import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Db = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Raw row shapes, mirroring the SQL schema 1:1. */
export interface EventRow {
  id: number;
  slug: string;
  name: string;
  timezone: string;
  start_date: string;
  end_date: string;
  day_start_min: number;
  week_rail_from: number;
  day_end_min: number;
  viewer_pw_hash: string;
  user_pw_hash: string;
  admin_pw_hash: string;
  archived: number;
  user_role_label: string;
  /** Audit entries kept for this event; 0 keeps everything. */
  audit_keep: number;
  /** Which view the schedule opens in when the reader has not picked one. */
  default_view: string;
  created_at: string;
}

export interface IdentityRow {
  id: number;
  /** The "UID" shown to admins: 5 random hex chars, unique across the instance. */
  public_id: string;
  token: string;
  display_name: string;
  created_at: string;
  last_seen_at: string;
  /** Capability token for calendar subscription URLs; null until first asked for. */
  ics_token: string | null;
}

export interface RoleRow {
  identity_id: number;
  event_id: number;
  role: 'viewer' | 'user' | 'admin';
  granted_at: string;
}

export interface RoomRow {
  id: number;
  event_id: number;
  name: string;
  description: string;
  capacity: number | null;
  color: string;
  open_booking: number;
  sort_order: number;
  deleted_at: string | null;
}

export interface TagRow {
  id: number;
  event_id: number;
  name: string;
  color: string;
  deleted_at: string | null;
}

/**
 * Lunch, dinner, the coffee break. Event furniture, drawn behind the grid and
 * attached to no room. `date` null means every day of the event.
 */
export interface BreakRow {
  id: number;
  event_id: number;
  label: string;
  /** Local minutes since midnight in the event's timezone. */
  start_min: number;
  end_min: number;
  date: string | null;
  created_at: string;
}

export interface SessionRow {
  id: number;
  event_id: number;
  room_id: number;
  track_id: number | null;
  type: 'official' | 'open';
  /** 1 = while this runs, attendees may place nothing anywhere in the event. */
  blocks_open_booking: number;
  title: string;
  description: string;
  /** Free text from before profiles existed. A historical record: nothing
   *  reads it for display — the speakers are `session_speakers`. */
  speaker: string;
  livestream_url: string;
  starts_at: string;
  ends_at: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Who is giving a session. Ordered, because the order is the billing. */
export interface SessionSpeakerRow {
  session_id: number;
  person_id: number;
  sort_order: number;
}

export interface PersonRow {
  id: number;
  event_id: number;
  identity_id: number | null;
  name: string;
  bio: string;
  /** JSON array of { label, url }. */
  links: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProposalRow {
  id: number;
  event_id: number;
  title: string;
  description: string;
  speaker_id: number | null;
  created_by: number;
  placed_session_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TrackRow {
  id: number;
  event_id: number;
  name: string;
  /** The organiser's context for the strand; '' when they gave none. */
  description: string;
  color: string;
  sort_order: number;
  /** Local minutes-of-day the track accepts sessions between. Both null = any
   *  hour; the pair is written together and never half-set. */
  start_min: number | null;
  end_min: number | null;
  deleted_at: string | null;
}

/** One day of the event where a track keeps different hours from its own. */
export interface TrackWindowRow {
  id: number;
  track_id: number;
  date: string;
  start_min: number;
  end_min: number;
  created_at: string;
}

export interface ContributionRow {
  id: number;
  session_id: number;
  kind: 'note' | 'link' | 'question';
  body: string;
  url: string | null;
  created_by: number;
  created_at: string;
  hidden: number;
  deleted_at: string | null;
}

/**
 * Open the SQLite file (creating parent dirs) and bring it up to date.
 * Exactly one process may own a given DB file — see SPEC §10.1.
 */
export function openDb(databasePath: string): Db {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/**
 * Apply numbered .sql files in order, once each, tracked in `migrations`.
 *
 * Hardened for instances that are already running somewhere (SPEC follow-up):
 *
 * - **Downgrade guard.** If the `migrations` table names a file this build
 *   does not ship, the database is from a *newer* version and an older binary
 *   would corrupt semantics silently, one unknown column at a time. Refuse to
 *   start instead.
 * - **Backup first.** When there is pending work on a database that has lived
 *   before, `VACUUM INTO` a timestamped sibling file. Each file still runs in
 *   its own transaction, so a failure is clean to the file boundary — the
 *   backup is for the migration that succeeds and turns out to be wrong.
 * - **Rebuilds allowed.** Migrations run with `foreign_keys` off (SQLite's
 *   documented recipe for the drop-and-recreate dance a CHECK or NOT NULL
 *   change requires — the pragma cannot change inside a transaction, so it
 *   must happen out here). Each file must leave `PRAGMA foreign_key_check`
 *   clean or its transaction is rolled back.
 */
export function migrate(db: Db, migrationsDir = MIGRATIONS_DIR): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db.prepare<[], { name: string }>('SELECT name FROM migrations').all().map((r) => r.name),
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const unknown = [...applied].filter((name) => !files.includes(name)).sort();
  if (unknown.length > 0) {
    throw new Error(
      `This database was migrated by a newer build (unknown migration${
        unknown.length > 1 ? 's' : ''
      }: ${unknown.join(', ')}). Refusing to start — upgrade the app, or restore the backup taken before those migrations ran.`,
    );
  }

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) return;

  // A fresh database has nothing worth copying; an established one does.
  if (applied.size > 0 && !db.memory && db.name !== '') {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
    db.prepare('VACUUM INTO ?').run(`${db.name}.backup-${stamp}`);
  }

  const record = db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)');
  db.pragma('foreign_keys = OFF');
  try {
    for (const file of pending) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        const broken = db.pragma('foreign_key_check') as unknown[];
        if (broken.length > 0) {
          throw new Error(`Migration ${file} left ${broken.length} broken foreign key reference(s)`);
        }
        record.run(file, new Date().toISOString());
      })();
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
