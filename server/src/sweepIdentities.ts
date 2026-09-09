import type { Db } from './db.js';

/** How long an identity that never became anybody is kept (D3 §3). */
export const IDLE_IDENTITY_DAYS = 30;

/**
 * Delete identity rows that never became anybody: no role at any event, no
 * username claimed at any event, no calendar token, no speaker code or device
 * phrase pointing at them, no profile, and last seen more than 30 days ago.
 *
 * The mint budget bounds how fast these appear; this is what stops the ones
 * that do from accumulating forever. A hostile at the budget's ceiling makes
 * 29,000 rows a day, which is a nuisance rather than a problem, and none of
 * them survives a month.
 *
 * Deliberately narrow. An identity that holds a role, a name, a profile or a
 * calendar subscription is a person who may come back after a year, and their
 * display name is still reserved for them; only rows that own nothing at all
 * are touched. `created_at` is the fallback for a row that was minted and
 * never seen again, which is exactly the shape this is for.
 */
export function sweepIdleIdentities(db: Db, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - IDLE_IDENTITY_DAYS * 24 * 60 * 60_000).toISOString();
  return db
    .prepare(
      `DELETE FROM identities
        WHERE ics_token IS NULL
          AND COALESCE(last_seen_at, created_at) < ?
          AND id NOT IN (SELECT identity_id FROM roles)
          AND id NOT IN (SELECT identity_id FROM event_identities)
          AND id NOT IN (SELECT identity_id FROM link_codes)
          AND id NOT IN (SELECT identity_id FROM people WHERE identity_id IS NOT NULL)`,
    )
    .run(cutoff).changes;
}
