import type { Db } from './db.js';
import { badRequest } from './errors.js';

/** Collapse the whitespace people paste in: `" ada   lovelace "` → `"ada lovelace"`. */
export const normalizeSpeakerName = (raw: string): string => raw.trim().replace(/\s+/g, ' ');

/**
 * Turn a form's speaker input into a person id, shared by sessions and
 * proposals. A name that matches nobody creates a fresh unclaimed profile —
 * the tap is deliberately open so you can pitch a session for someone who has
 * not arrived yet — but the match is forgiving first: case-insensitive on the
 * normalised name, preferring a claimed profile over an unclaimed one, so
 * "ada lovelace" stops spawning a twin of "Ada Lovelace". (SQLite's lower()
 * folds ASCII only; "Ada" ≠ "ADÁ" is a shrug, not a bug — the admin merge
 * tool exists for the leftovers.)
 */
export function resolveSpeaker(
  db: Db,
  eventId: number,
  body: { speakerId?: number | null; speakerName?: string },
  current: number | null,
): number | null {
  if (body.speakerId !== undefined) {
    if (body.speakerId === null) return null;
    const found = db
      .prepare<[number, number], { id: number }>(
        'SELECT id FROM people WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(body.speakerId, eventId);
    if (!found) throw badRequest('Unknown speaker');
    return found.id;
  }

  if (body.speakerName === undefined) return current;
  const name = normalizeSpeakerName(body.speakerName);
  if (name === '') return null;

  const existing = db
    .prepare<[number, string], { id: number }>(
      `SELECT id FROM people
        WHERE event_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)
        ORDER BY (identity_id IS NULL), id LIMIT 1`,
    )
    .get(eventId, name);
  if (existing) return existing.id;

  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        `INSERT INTO people (event_id, identity_id, name, bio, links, created_at, updated_at)
         VALUES (?, NULL, ?, '', '[]', ?, ?)`,
      )
      .run(eventId, name, now, now).lastInsertRowid,
  );
}

/**
 * Everyone a session credits, as person ids in billing order.
 *
 * An entry is either a person id — someone the form picked out of the roster —
 * or a name typed in for someone who is not on it yet, which
 * `resolveSpeaker`'s rules then match or create. Order is kept and duplicates
 * are dropped: the same person twice on one session is a slip of the form, not
 * a billing.
 */
export function resolveSpeakers(
  db: Db,
  eventId: number,
  entries: readonly (number | string)[],
): number[] {
  const out: number[] = [];
  for (const entry of entries) {
    const id =
      typeof entry === 'number'
        ? resolveSpeaker(db, eventId, { speakerId: entry }, null)
        : resolveSpeaker(db, eventId, { speakerName: entry }, null);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Replace who a session credits. The rows are the billing, so they are
 *  rewritten wholesale rather than diffed — the order is part of the value. */
export function setSessionSpeakers(db: Db, sessionId: number, personIds: number[]): void {
  db.prepare('DELETE FROM session_speakers WHERE session_id = ?').run(sessionId);
  const insert = db.prepare(
    'INSERT INTO session_speakers (session_id, person_id, sort_order) VALUES (?, ?, ?)',
  );
  personIds.forEach((personId, i) => insert.run(sessionId, personId, i));
}

/** Is this identity's claimed profile among the session's speakers? Any of
 *  them, not the first: a second name on the poster is giving the session as
 *  much as the first one is, and edits it on the same terms. */
export function speaksFor(db: Db, identityId: number, session: { id: number }): boolean {
  const row = db
    .prepare<[number, number], { n: number }>(
      `SELECT COUNT(*) AS n
         FROM session_speakers ss
         JOIN people p ON p.id = ss.person_id
        WHERE ss.session_id = ? AND p.identity_id = ? AND p.deleted_at IS NULL`,
    )
    .get(session.id, identityId);
  return (row?.n ?? 0) > 0;
}
