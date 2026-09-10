import type { Db, PersonRow } from './db.js';

/**
 * Every identity that enters an event is a person (spec
 * `self-as-speaker-and-merge-ux`, Step 0): one live `people` row per
 * `(event, identity)`. A row without an identity is someone an organiser
 * expects who has not arrived. These helpers keep that invariant at the two
 * places it is made — the login page and the profile editor.
 */

/** The live profile this identity holds in this event, if any. */
export function ownProfile(db: Db, eventId: number, identityId: number): PersonRow | undefined {
  return db
    .prepare<[number, number], PersonRow>(
      'SELECT * FROM people WHERE event_id = ? AND identity_id = ? AND deleted_at IS NULL',
    )
    .get(eventId, identityId);
}

/**
 * The profile this identity holds here, created if it has none. The full name
 * starts as the username so a newcomer can be credited straight away; it does
 * not follow the username afterwards. Idempotent, so a retry costs nothing.
 */
export function ensureOwnProfile(
  db: Db,
  eventId: number,
  identityId: number,
  username: string,
): PersonRow {
  const existing = ownProfile(db, eventId, identityId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = Number(
    db
      .prepare(
        `INSERT INTO people (event_id, identity_id, name, bio, links, created_at, updated_at)
         VALUES (?, ?, ?, '', '[]', ?, ?)`,
      )
      .run(eventId, identityId, username, now, now).lastInsertRowid,
  );
  return db.prepare<[number], PersonRow>('SELECT * FROM people WHERE id = ?').get(id) as PersonRow;
}

export interface Namesake {
  id: number;
  name: string;
  sessionCount: number;
}

/**
 * An unclaimed profile whose full name matches `name` case-insensitively —
 * the "Ada Lovelace" an organiser typed onto her talk before she arrived.
 * The login page offers it rather than adopting it silently: the same name could
 * be a different Ada.
 */
export function findUnclaimedNamesake(db: Db, eventId: number, name: string): Namesake | undefined {
  return db
    .prepare<[number, string], Namesake>(
      `SELECT p.id AS id, p.name AS name,
              (SELECT COUNT(*) FROM session_speakers ss
                 JOIN sessions s ON s.id = ss.session_id
                WHERE ss.person_id = p.id AND s.deleted_at IS NULL) AS sessionCount
         FROM people p
        WHERE p.event_id = ? AND p.identity_id IS NULL AND p.deleted_at IS NULL
          AND lower(p.name) = lower(?)
        ORDER BY sessionCount DESC, p.id
        LIMIT 1`,
    )
    .get(eventId, name);
}

/**
 * Coming back is the appeal against being archived.
 *
 * An organiser tidying up at the end of a day cannot tell a profile that is
 * finished with from one whose person is coming back tomorrow — only the
 * person can, and the way they say it is by turning up. So entering the event
 * takes your profile out of the archive, and an organiser who archived a room
 * full of people at midnight finds the ones who came back in the list again,
 * without either side having to remember that a filing decision was made.
 *
 * Only entering does this. Archiving does not sign anybody out, so somebody
 * still holding a session from before stays filed until they next come in
 * through the login page, which is the moment that means "I am here again".
 *
 * Returns the row when it actually changed, so the caller can tell a
 * restoration from an ordinary entry and only announce the former.
 */
export function restoreOnEntry(db: Db, personId: number): PersonRow | undefined {
  const changed = db
    .prepare('UPDATE people SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL')
    .run(personId).changes;
  if (changed === 0) return undefined;
  return db.prepare<[number], PersonRow>('SELECT * FROM people WHERE id = ?').get(personId);
}

/** Make an unclaimed profile this identity's own. */
export function adoptProfile(db: Db, personId: number, identityId: number): void {
  db.prepare('UPDATE people SET identity_id = ?, updated_at = ? WHERE id = ?').run(
    identityId,
    new Date().toISOString(),
    personId,
  );
}
