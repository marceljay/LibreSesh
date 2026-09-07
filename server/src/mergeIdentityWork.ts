import type { Db } from './db.js';

/**
 * The second half of a both-claimed merge (decided 2026-08-31): everything the
 * losing identity did *in this event* — stars, contributions, proposal
 * interest, and the authorship of sessions and pitches — is re-keyed onto the
 * surviving identity, so one human's history reads as one person.
 *
 * The losing identity is then signed out of this event — its role revoked,
 * the same thing /logout does — rather than left as a zombie that is present
 * but owns nothing. Deleting the identity itself would not be safe: it may be
 * a real person at other events on this instance, and the audit log points at
 * it. Its event display name row stays, so the attendance list and old audit
 * entries keep their label (and the name stays reserved rather than freed for
 * a stranger to claim).
 *
 * Scoped to one event on purpose. The losing identity may be a real person at
 * three other events on this instance; an organiser merging duplicates at
 * theirs has no business moving stars anywhere else, or signing them out
 * anywhere else.
 *
 * Where both identities did the same thing (starred one session, felt interest
 * in one pitch), the loser's copy is dropped first — the primary key is
 * (identity, thing), and one person does a thing once.
 */
export function rekeyIdentityWork(
  db: Db,
  eventId: number,
  fromIdentity: number,
  toIdentity: number,
): { sessionIds: number[]; proposalIds: number[] } {
  db.prepare(
    `DELETE FROM stars
      WHERE identity_id = ?
        AND session_id IN (SELECT id FROM sessions WHERE event_id = ?)
        AND session_id IN (SELECT session_id FROM stars WHERE identity_id = ?)`,
  ).run(fromIdentity, eventId, toIdentity);
  db.prepare(
    `UPDATE stars SET identity_id = ?
      WHERE identity_id = ?
        AND session_id IN (SELECT id FROM sessions WHERE event_id = ?)`,
  ).run(toIdentity, fromIdentity, eventId);

  // Where both marked interest, the count is about to shrink by one — those
  // proposals need re-broadcasting just like the re-authored ones below.
  const dedupedInterest = db
    .prepare<[number, number, number], { proposal_id: number }>(
      `SELECT proposal_id FROM proposal_interest
        WHERE identity_id = ?
          AND proposal_id IN (SELECT id FROM proposals WHERE event_id = ? AND deleted_at IS NULL)
          AND proposal_id IN (SELECT proposal_id FROM proposal_interest WHERE identity_id = ?)`,
    )
    .all(fromIdentity, eventId, toIdentity)
    .map((r) => r.proposal_id);
  db.prepare(
    `DELETE FROM proposal_interest
      WHERE identity_id = ?
        AND proposal_id IN (SELECT id FROM proposals WHERE event_id = ?)
        AND proposal_id IN (SELECT proposal_id FROM proposal_interest WHERE identity_id = ?)`,
  ).run(fromIdentity, eventId, toIdentity);
  db.prepare(
    `UPDATE proposal_interest SET identity_id = ?
      WHERE identity_id = ?
        AND proposal_id IN (SELECT id FROM proposals WHERE event_id = ?)`,
  ).run(toIdentity, fromIdentity, eventId);

  db.prepare(
    `UPDATE contributions SET created_by = ?
      WHERE created_by = ?
        AND session_id IN (SELECT id FROM sessions WHERE event_id = ?)`,
  ).run(toIdentity, fromIdentity, eventId);

  // Captured before the update so the route can broadcast the rows whose
  // `createdByName` just changed under everyone's feet.
  const sessionIds = db
    .prepare<[number, number], { id: number }>(
      'SELECT id FROM sessions WHERE created_by = ? AND event_id = ? AND deleted_at IS NULL',
    )
    .all(fromIdentity, eventId)
    .map((r) => r.id);
  db.prepare('UPDATE sessions SET created_by = ? WHERE created_by = ? AND event_id = ?').run(
    toIdentity,
    fromIdentity,
    eventId,
  );

  const proposalIds = db
    .prepare<[number, number], { id: number }>(
      'SELECT id FROM proposals WHERE created_by = ? AND event_id = ? AND deleted_at IS NULL',
    )
    .all(fromIdentity, eventId)
    .map((r) => r.id);
  db.prepare('UPDATE proposals SET created_by = ? WHERE created_by = ? AND event_id = ?').run(
    toIdentity,
    fromIdentity,
    eventId,
  );

  db.prepare('DELETE FROM roles WHERE identity_id = ? AND event_id = ?').run(fromIdentity, eventId);

  return { sessionIds, proposalIds: [...new Set([...proposalIds, ...dedupedInterest])] };
}
