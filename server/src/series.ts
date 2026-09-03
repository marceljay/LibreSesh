/**
 * Linked sessions: the soft `series_id` grouping and the rules around it.
 *
 * A link never forces anything. It lets an edit *offer* to apply to the rest
 * (see the PATCH route) and it powers "unlink this one"; each member stays an
 * independent, draggable, last-write-wins row. The one rule with teeth is the
 * security invariant: linking and propagation grant no edit right the actor did
 * not already have. `canMutate` is the boolean form of `assertMayMutate`, and
 * every path here is gated on it.
 *
 * There is no series table. `series_id` is an opaque id shared by the members
 * and nothing else, so there is never a row to answer "does moving Tuesday move
 * all of them?" — that is answered per edit, and its default answer is no.
 */
import { randomUUID } from 'node:crypto';
import type { Db, SessionRow } from './db.js';
import { can, type PermissionMatrix } from './permissions.js';
import type { Role } from './shared/types.js';
import { speaksFor } from './speakers.js';

/**
 * The key two sessions must share to be *offered* as a link: their title, with
 * surrounding and repeated whitespace ignored and case folded. "Morning Yoga",
 * " morning  yoga " and "MORNING YOGA" are one programme placed on three days.
 */
export function seriesTitleKey(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Whether `identityId` may change `session` — the boolean twin of
 * `assertMayMutate`, kept in step with it line for line. Being on the bill
 * qualifies whatever role you hold; otherwise you need `session.edit_own`, to
 * own the row, and the row to be an open session.
 */
export function canMutate(
  db: Db,
  matrix: PermissionMatrix,
  role: Role,
  identityId: number,
  session: SessionRow,
): boolean {
  if (role === 'admin') return true;
  if (speaksFor(db, identityId, session)) return true;
  if (!can(matrix, role, 'session.edit_own')) return false;
  if (session.created_by !== identityId) return false;
  return session.type === 'open';
}

/**
 * The sessions the actor could link to `anchor`: same event, not deleted, same
 * title key, the actor may mutate them, and not the anchor itself. The candidate
 * list is exactly the linkable set, so a well-behaved client never offers a
 * session the link route would then refuse.
 */
export function linkCandidates(
  db: Db,
  eventId: number,
  identityId: number,
  role: Role,
  matrix: PermissionMatrix,
  anchor: SessionRow,
): SessionRow[] {
  const key = seriesTitleKey(anchor.title);
  const rows = db
    .prepare<[number, number, number], SessionRow>(
      `SELECT DISTINCT s.* FROM sessions s
         LEFT JOIN session_speakers ss ON ss.session_id = s.id
         LEFT JOIN people p ON p.id = ss.person_id AND p.deleted_at IS NULL
        WHERE s.event_id = ? AND s.deleted_at IS NULL
          AND (s.created_by = ? OR p.identity_id = ?)
        ORDER BY s.starts_at, s.id`,
    )
    .all(eventId, identityId, identityId);
  return rows.filter(
    (r) =>
      r.id !== anchor.id &&
      seriesTitleKey(r.title) === key &&
      canMutate(db, matrix, role, identityId, r),
  );
}

/** Every live member of a series, in schedule order. */
export function seriesMembers(db: Db, seriesId: string): SessionRow[] {
  return db
    .prepare<[string], SessionRow>(
      `SELECT * FROM sessions WHERE series_id = ? AND deleted_at IS NULL ORDER BY starts_at, id`,
    )
    .all(seriesId);
}

/**
 * Stamp every session in `sessions` with one shared `series_id` and return it.
 * If any already belong to a series that id is reused, so re-linking a set that
 * overlaps an existing series merges into it rather than forking a new one.
 * Callers wrap this in a transaction.
 */
export function linkSessions(db: Db, sessions: SessionRow[], now: string): string {
  const seriesId = sessions.find((s) => s.series_id)?.series_id ?? randomUUID();
  const stmt = db.prepare('UPDATE sessions SET series_id = ?, updated_at = ? WHERE id = ?');
  for (const s of sessions) stmt.run(seriesId, now, s.id);
  return seriesId;
}

/**
 * Drop `session` out of its series and return every id that changed. When that
 * leaves a single member behind, it is unlinked too: a series of one is just a
 * session. Callers wrap this in a transaction.
 */
export function unlinkSession(db: Db, session: SessionRow, now: string): number[] {
  const affected = [session.id];
  db.prepare('UPDATE sessions SET series_id = NULL, updated_at = ? WHERE id = ?').run(
    now,
    session.id,
  );
  if (session.series_id) {
    const remaining = seriesMembers(db, session.series_id);
    if (remaining.length === 1) {
      db.prepare('UPDATE sessions SET series_id = NULL, updated_at = ? WHERE id = ?').run(
        now,
        remaining[0].id,
      );
      affected.push(remaining[0].id);
    }
  }
  return affected;
}
