import type { Db } from './db.js';
import type { ProfileClaimDto } from './shared/types.js';

export interface ClaimRow {
  id: number;
  event_id: number;
  person_id: number;
  identity_id: number;
  requested_at: string;
  declined_at: string | null;
}

/** The one open request this identity has here, if any. */
export function openClaimOf(db: Db, eventId: number, identityId: number): ClaimRow | undefined {
  return db
    .prepare<[number, number], ClaimRow>(
      'SELECT * FROM profile_claims WHERE event_id = ? AND identity_id = ? AND declined_at IS NULL',
    )
    .get(eventId, identityId);
}

export function claimById(db: Db, eventId: number, id: number): ClaimRow | undefined {
  return db
    .prepare<[number, number], ClaimRow>(
      'SELECT * FROM profile_claims WHERE id = ? AND event_id = ?',
    )
    .get(id, eventId);
}

/**
 * What each viewer may see of the queue: an organiser sees every open
 * request, because deciding them is their job; everyone else sees only their
 * own, open or turned down. A request that vanished without an answer would
 * leave the asker refreshing a page forever.
 */
export function loadClaims(
  db: Db,
  eventId: number,
  identityId: number,
  isAdmin: boolean,
): ProfileClaimDto[] {
  const rows = db
    .prepare<
      [number, number, number, number],
      {
        id: number;
        person_id: number;
        person_name: string;
        identity_id: number;
        username: string | null;
        uid: string | null;
        requester_person_id: number | null;
        requested_at: string;
        declined_at: string | null;
      }
    >(
      `SELECT c.id AS id,
              c.person_id AS person_id,
              p.name AS person_name,
              c.identity_id AS identity_id,
              ei.display_name AS username,
              i.public_id AS uid,
              (SELECT mine.id FROM people mine
                WHERE mine.event_id = c.event_id AND mine.identity_id = c.identity_id
                  AND mine.deleted_at IS NULL) AS requester_person_id,
              c.requested_at AS requested_at,
              c.declined_at AS declined_at
         FROM profile_claims c
         JOIN people p ON p.id = c.person_id AND p.deleted_at IS NULL
    LEFT JOIN event_identities ei ON ei.event_id = c.event_id AND ei.identity_id = c.identity_id
    LEFT JOIN identities i ON i.id = c.identity_id
        WHERE c.event_id = ?
          AND (? = 1 OR c.identity_id = ?)
          AND (c.declined_at IS NULL OR c.identity_id = ?)
        ORDER BY c.requested_at`,
    )
    .all(eventId, isAdmin ? 1 : 0, identityId, identityId);

  return rows.map((r) => ({
    id: r.id,
    personId: r.person_id,
    personName: r.person_name,
    username: r.username ?? '',
    ...(isAdmin
      ? { requesterUid: r.uid ?? undefined, requesterPersonId: r.requester_person_id }
      : {}),
    requestedAt: r.requested_at,
    declinedAt: r.declined_at,
    isMine: r.identity_id === identityId,
  }));
}
