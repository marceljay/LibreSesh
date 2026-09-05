import type { Db } from './db.js';
import { badRequest, forbidden } from './errors.js';
import type { Role } from './shared/types.js';

/**
 * Who is doing the crediting. Organisers may credit anyone; everyone else is
 * held to `creditable` (see `PersonDto`) and, without the
 * `session.credit_others` capability, to themselves — plus whoever is
 * already on the session, so an attendee editing their own talk does not
 * lose the co-host an organiser added.
 */
export interface Actor {
  identityId: number;
  role: Role;
  creditOthers: boolean;
  alreadyCredited?: readonly number[];
}

const onlySelf = () => forbidden('You can only credit yourself as a speaker here');

/**
 * May this actor put this person on a session? Not a viewer's person: a
 * livestream audience did not come to give a talk, and the picker never
 * offers them — this is the server saying the same thing. And not anyone
 * but themselves when the matrix says so.
 */
function assertCreditable(db: Db, eventId: number, personId: number, actor?: Actor): void {
  if (!actor || actor.role === 'admin') return;
  const row = db
    .prepare<[number, number], { identity_id: number | null; role: Role | null }>(
      `SELECT p.identity_id, r.role
         FROM people p
    LEFT JOIN roles r ON r.identity_id = p.identity_id AND r.event_id = p.event_id
        WHERE p.id = ? AND p.event_id = ?`,
    )
    .get(personId, eventId);
  if (row?.identity_id === actor.identityId) return;
  if (actor.alreadyCredited?.includes(personId)) return;
  if (!actor.creditOthers) throw onlySelf();
  if (row?.role === 'viewer') throw forbidden('That person is here to watch, not to speak');
}

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
  actor?: Actor,
): number | null {
  if (body.speakerId !== undefined) {
    if (body.speakerId === null) return null;
    const found = db
      .prepare<[number, number], { id: number }>(
        'SELECT id FROM people WHERE id = ? AND event_id = ? AND deleted_at IS NULL',
      )
      .get(body.speakerId, eventId);
    if (!found) throw badRequest('Unknown speaker');
    assertCreditable(db, eventId, found.id, actor);
    return found.id;
  }

  if (body.speakerName === undefined) return current;
  const name = normalizeSpeakerName(body.speakerName);
  if (name === '') return null;

  const existing = db
    .prepare<[number, string], { id: number }>(
      // Live profiles before archived ones: an archived profile is still a
      // real profile and a name that only matches one still finds it, but a
      // name typed today means the person who is here today.
      `SELECT id FROM people
        WHERE event_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)
        ORDER BY (archived_at IS NOT NULL), (identity_id IS NULL), id LIMIT 1`,
    )
    .get(eventId, name);
  if (existing) {
    assertCreditable(db, eventId, existing.id, actor);
    return existing.id;
  }

  // A name nobody has is somebody else by definition.
  if (actor && actor.role !== 'admin' && !actor.creditOthers) throw onlySelf();
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
 * Everyone a session credits, as person ids in credit order.
 *
 * An entry is either a person id — someone the form picked out of the roster —
 * or a name typed in for someone who is not on it yet, which
 * `resolveSpeaker`'s rules then match or create. Order is kept and duplicates
 * are dropped: the same person twice on one session is a slip of the form, not
 * a credit list.
 */
export function resolveSpeakers(
  db: Db,
  eventId: number,
  entries: readonly (number | string)[],
  actor?: Actor,
): number[] {
  const out: number[] = [];
  for (const entry of entries) {
    const id =
      typeof entry === 'number'
        ? resolveSpeaker(db, eventId, { speakerId: entry }, null, actor)
        : resolveSpeaker(db, eventId, { speakerName: entry }, null, actor);
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Replace who a session credits. The rows are the credit order, so they are
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
