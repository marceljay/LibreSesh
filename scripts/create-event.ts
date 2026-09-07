/**
 * Interactive CLI to create an event and its three passwords.
 *
 *   npm run create-event
 *
 * Writes straight to the database, so run it on the machine that owns the
 * DB file — and not while the server is mid-write (SQLite allows it, but one
 * owner is the rule of thumb).
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { getEventBySlug, hashPassword } from '../server/src/auth.js';
import { loadConfig } from '../server/src/config.js';
import { openDb } from '../server/src/db.js';
import { isValidTimezone } from '../server/src/shared/time.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9-]{3,40}$/;

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.databasePath);
  const rl = createInterface({ input: stdin, output: stdout });

  const ask = async (
    label: string,
    validate: (value: string) => string | undefined,
    fallback?: string,
  ): Promise<string> => {
    for (;;) {
      const raw = (await rl.question(fallback ? `${label} [${fallback}]: ` : `${label}: `)).trim();
      const value = raw === '' && fallback !== undefined ? fallback : raw;
      const problem = validate(value);
      if (!problem) return value;
      console.log(`  ${problem}`);
    }
  };

  try {
    const name = await ask('Event name', (v) =>
      v.length >= 1 && v.length <= 120 ? undefined : 'Required, up to 120 characters',
    );
    const slug = await ask('Slug (URL segment)', (v) => {
      if (!SLUG_RE.test(v)) return '3–40 characters of a–z, 0–9 or -';
      if (getEventBySlug(db, v)) return 'That slug is already taken';
      return undefined;
    });
    const timezone = await ask(
      'Timezone (IANA)',
      (v) => (isValidTimezone(v) ? undefined : 'Unknown timezone, e.g. Europe/Berlin'),
      'Europe/Berlin',
    );
    const startDate = await ask('Start date (YYYY-MM-DD)', (v) =>
      DATE_RE.test(v) ? undefined : 'Expected YYYY-MM-DD',
    );
    const endDate = await ask(
      'End date (YYYY-MM-DD)',
      (v) => {
        if (!DATE_RE.test(v)) return 'Expected YYYY-MM-DD';
        if (v < startDate) return 'Must not be before the start date';
        return undefined;
      },
      startDate,
    );

    const pw = (label: string) =>
      ask(label, (v) => (v.length >= 6 ? undefined : 'At least 6 characters'));
    const viewerPassword = await pw('Viewer password');
    const userPassword = await pw('User password');
    const adminPassword = await pw('Admin password');

    db.prepare(
      `INSERT INTO events
        (slug, name, timezone, start_date, end_date, day_start_min, day_end_min,
         viewer_pw_hash, user_pw_hash, admin_pw_hash, archived, created_at)
       VALUES (?, ?, ?, ?, ?, 480, 1320, ?, ?, ?, 0, ?)`,
    ).run(
      slug,
      name,
      timezone,
      startDate,
      endDate,
      hashPassword(viewerPassword),
      hashPassword(userPassword),
      hashPassword(adminPassword),
      new Date().toISOString(),
    );

    console.log(`\nCreated "${name}".`);
    console.log(`Open /e/${slug} and enter the admin password to add rooms and sessions.`);
  } finally {
    rl.close();
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
