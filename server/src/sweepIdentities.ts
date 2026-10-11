import type { Db } from './db.js';

/** How long an identity that never became anybody is kept (D3 §3). */
export const IDLE_IDENTITY_DAYS = 30;

/** Rows are deleted in batches this size, well under SQLite's variable limit. */
const BATCH = 500;

/**
 * Delete identity rows that never became anybody: no role at any event, no
 * username claimed at any event, no calendar token, no speaker code or device
 * phrase pointing at them, no profile, nothing authored, starred or asked for,
 * no notification addressed to them, and last seen more than 30 days ago.
 *
 * The mint rate limit bounds how fast these appear; this is what stops the ones
 * that do from accumulating forever. A hostile at that limit's ceiling makes
 * 29,000 rows a day, which is a nuisance rather than a problem, and none of
 * them survives a month.
 *
 * Deliberately narrow. An identity that holds a role, a name, a profile or a
 * calendar subscription is a person who may come back after a year, and their
 * display name is still reserved for them; only rows that own nothing at all
 * are touched. `created_at` is the fallback for a row that was minted and
 * never seen again, which is exactly the shape this is for.
 *
 * Two tables point at an identity without making it anybody, and both allow
 * NULL there: the audit log, which records a failed password attempt against
 * the visitor who made it, and a notification's `actor_id`. A row of either
 * kept the delete from running at all — the schema has no cascades, so the
 * foreign key refused it and the boot that ran the sweep went down with it
 * (production, 2026-10-02). Those columns are nulled first; the record stays,
 * minus the pointer to a row that no longer means anyone.
 */
export function sweepIdleIdentities(db: Db, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - IDLE_IDENTITY_DAYS * 24 * 60 * 60_000).toISOString();
  const idle = (
    db
      .prepare(
        `SELECT id FROM identities
          WHERE ics_token IS NULL
            AND COALESCE(last_seen_at, created_at) < ?
            AND id NOT IN (SELECT identity_id FROM roles)
            AND id NOT IN (SELECT identity_id FROM event_identities)
            AND id NOT IN (SELECT identity_id FROM link_codes)
            AND id NOT IN (SELECT identity_id FROM people WHERE identity_id IS NOT NULL)
            AND id NOT IN (SELECT created_by FROM sessions)
            AND id NOT IN (SELECT created_by FROM proposals)
            AND id NOT IN (SELECT created_by FROM contributions)
            AND id NOT IN (SELECT identity_id FROM stars)
            AND id NOT IN (SELECT identity_id FROM proposal_interest)
            AND id NOT IN (SELECT identity_id FROM profile_claims)
            AND id NOT IN (SELECT identity_id FROM notifications)
            AND id NOT IN (SELECT identity_id FROM notification_mutes)`,
      )
      .all(cutoff) as { id: number }[]
  ).map((r) => r.id);
  if (idle.length === 0) return 0;

  let removed = 0;
  db.transaction(() => {
    for (let i = 0; i < idle.length; i += BATCH) {
      const ids = idle.slice(i, i + BATCH);
      const marks = ids.map(() => '?').join(',');
      db.prepare(`UPDATE audit SET identity_id = NULL WHERE identity_id IN (${marks})`).run(...ids);
      db.prepare(`UPDATE notifications SET actor_id = NULL WHERE actor_id IN (${marks})`).run(
        ...ids,
      );
      removed += db.prepare(`DELETE FROM identities WHERE id IN (${marks})`).run(...ids).changes;
    }
  })();
  return removed;
}
