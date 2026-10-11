import { randomUUID } from 'node:crypto';

import type { Db } from './db.js';
import type { AuditChangeDto, AuditValue } from './shared/types.js';

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

/**
 * Where each entity's name lives, for the label a row stores and the lookup
 * the reader falls back to for rows written before it was stored.
 *
 * Soft deletes are what make either possible: the title of a deleted session
 * is still there to look up. A hard-deleted or never-existed id resolves to
 * nothing and the line falls back to its id.
 */
export const LABEL_SOURCES: Record<
  string,
  {
    table: string;
    column: string;
    /** The table soft-deletes, so "is it in the bin" is a column away. */
    bin: boolean;
    /** The column naming what this belongs to, when it has no page of its own. */
    parent?: string;
  }
> = {
  session: { table: 'sessions', column: 'title', bin: true },
  room: { table: 'rooms', column: 'name', bin: true },
  tag: { table: 'tags', column: 'name', bin: true },
  track: { table: 'tracks', column: 'name', bin: true },
  format: { table: 'session_formats', column: 'name', bin: true },
  person: { table: 'people', column: 'name', bin: true },
  proposal: { table: 'proposals', column: 'title', bin: true },
  contribution: { table: 'contributions', column: 'body', bin: true, parent: 'session_id' },
  event: { table: 'events', column: 'name', bin: false },
};

/** Labels are stored and shown cut to this; a title is a line, not a page. */
export const LABEL_LENGTH = 80;

/**
 * What the thing is called right now, for the row being written. Null for an
 * entity with no name to look up, or one that is already gone.
 *
 * Looked up at write time and stored, so a later rename leaves the line
 * saying what the thing was called when this happened. Call sites write
 * their row after the change, so a rename's own line carries the new name
 * and the old one is in its `changes`.
 */
function labelNow(db: Db, entity: string, entityId: number | null): string | null {
  const source = LABEL_SOURCES[entity];
  if (!source || entityId === null) return null;
  const row = db
    .prepare<[number], { label: string | null }>(
      // Table and column come from the constant map above, never from input.
      `SELECT ${source.column} AS label FROM ${source.table} WHERE id = ?`,
    )
    .get(entityId);
  return row?.label == null ? null : row.label.slice(0, LABEL_LENGTH);
}

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
    /** What the action changed, field by field; see {@link diffFields}. An
     *  empty list is stored as nothing — a row with no changes is not an edit
     *  that changed nothing, it is an action the log does not itemise. */
    changes?: AuditChangeDto[];
  },
): void {
  db.prepare(
    `INSERT INTO audit (identity_id, event_id, action, entity, entity_id, at, batch, changes, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.identityId,
    entry.eventId,
    entry.action,
    entry.entity,
    entry.entityId,
    new Date().toISOString(),
    entry.batch ?? null,
    entry.changes === undefined || entry.changes.length === 0
      ? null
      : JSON.stringify(entry.changes),
    labelNow(db, entry.entity, entry.entityId),
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
 * The fields that differ between two readings of the same thing, in the order
 * `fields` lists them — which should be the order the form shows them, so the
 * line reads the way the organiser remembers making the edit.
 *
 * A reading is the API shape (`startDate`, not `start_date`): the row's column
 * names are the server's business, and the log is read by the same people who
 * see the settings form. Pass a reading with every field for the before and
 * after; the request body is no good for the before, and no good for the after
 * either, because the form sends every field whether it moved or not.
 */
export function diffFields<K extends string>(
  fields: readonly K[],
  before: Record<K, AuditValue>,
  after: Record<K, AuditValue>,
): AuditChangeDto[] {
  const out: AuditChangeDto[] = [];
  for (const field of fields) {
    if (before[field] !== after[field]) out.push({ field, from: before[field], to: after[field] });
  }
  return out;
}

/** The values a thing started with — a creation's line, so the log says what
 *  it was called even after every later rename. Nulls are left out: an unset
 *  field is not a fact the line needs. */
export function initialFields<K extends string>(
  fields: readonly K[],
  values: Record<K, AuditValue>,
): AuditChangeDto[] {
  return fields.flatMap((field) => (values[field] === null ? [] : [{ field, to: values[field] }]));
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

  return db.prepare('DELETE FROM audit WHERE event_id = ? AND id <= ?').run(eventId, boundary)
    .changes;
}

/** Test seam: the prune counters are per process, not per database. */
export function resetPruneCounters(): void {
  sinceLastPrune.clear();
}
