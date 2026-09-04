import { randomUUID } from 'node:crypto';

import type { Db } from './db.js';

/**
 * A key shared by every row one bulk action writes — placing a repeat across
 * five days, or applying an edit to a whole series.
 *
 * The rows stay one per session, because each is a separate session with its
 * own id and every later edit will name exactly one of them. The batch is only
 * how they are *read*: the log shows them as one line that expands. Mint one
 * per action, and only when the action really did write more than one row — a
 * batch of one is a lie the reader would have to undo.
 */
export const newBatch = (): string => randomUUID();

/**
 * How far past its cap an event's log is allowed to drift before a write pays
 * to trim it. Pruning on every insert would put a DELETE behind every action
 * in the app for no benefit — the cap is a housekeeping bound, not a promise
 * about the exact row count at any instant.
 */
const SLACK = 100;

/**
 * Writes since this process last pruned each event, so the common case costs
 * nothing at all. In memory on purpose: it is a counter, not a fact about the
 * conference, and losing it on restart merely means the next write checks.
 */
const sinceLastPrune = new Map<number, number>();

/** Append-only write log for post-hoc cleanup after vandalism (SPEC §8). */
export function audit(
  db: Db,
  entry: {
    identityId: number | null;
    eventId: number | null;
    action: string;
    entity: string;
    entityId: number | null;
    /** The bulk action this row belongs to; see {@link newBatch}. */
    batch?: string;
  },
): void {
  db.prepare(
    `INSERT INTO audit (identity_id, event_id, action, entity, entity_id, at, batch)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.identityId,
    entry.eventId,
    entry.action,
    entry.entity,
    entry.entityId,
    new Date().toISOString(),
    entry.batch ?? null,
  );

  if (entry.eventId === null) return;
  const due = (sinceLastPrune.get(entry.eventId) ?? SLACK) + 1;
  if (due <= SLACK) {
    sinceLastPrune.set(entry.eventId, due);
    return;
  }
  sinceLastPrune.set(entry.eventId, 0);
  pruneAudit(db, entry.eventId);
}

/**
 * Drop everything past this event's cap, oldest first. Returns how many rows
 * went, so a caller doing it deliberately can say.
 *
 * The cap is a bound on storage, not a tamper-proof archive: an organiser who
 * sets it low and then makes a thousand edits *can* push an earlier action off
 * the end. Nothing here pretends otherwise, and lowering the cap is itself an
 * audited event update — which is the honest version of the trade, given the
 * alternative is a log that grows without limit forever.
 */
export function pruneAudit(db: Db, eventId: number): number {
  const keep = db
    .prepare<[number], { audit_keep: number }>('SELECT audit_keep FROM events WHERE id = ?')
    .get(eventId)?.audit_keep;
  if (keep === undefined || keep <= 0) return 0;

  // The id of the newest row that is *past* the cap; everything at or below it
  // goes. One indexed seek, rather than counting the whole log first.
  const boundary = db
    .prepare<[number, number], { id: number }>(
      'SELECT id FROM audit WHERE event_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?',
    )
    .get(eventId, keep)?.id;
  if (boundary === undefined) return 0;

  return db
    .prepare('DELETE FROM audit WHERE event_id = ? AND id <= ?')
    .run(eventId, boundary).changes;
}

/** Test seam: the prune counters are per process, not per database. */
export function resetPruneCounters(): void {
  sinceLastPrune.clear();
}
