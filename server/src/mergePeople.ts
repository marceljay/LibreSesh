import { audit } from './audit.js';
import type { Db, PersonRow, SessionRow } from './db.js';
import { settleSpeakerCodeAfterMerge } from './deviceLink.js';
import { loadProposalDtos, loadSessionDto } from './mappers.js';
import { rekeyIdentityWork } from './mergeIdentityWork.js';
import type { Broker } from './sse.js';
import type { PersonDto } from './shared/types.js';

export interface MergeResult {
  /** Sessions whose credits changed, so the schedule can be told. */
  movedSessions: number[];
  rekeyed: { sessionIds: number[]; proposalIds: number[] };
}

/**
 * Fold `loser` into `survivor` (identity spec, B2): sessions and pitches are
 * repointed, blanks on the survivor fill from the duplicate, the duplicate is
 * soft-deleted. When only one side is claimed the claim moves to the
 * survivor. When both are claimed, picking the survivor *is* picking whose
 * identity wins: everything the losing identity did in this event — stars,
 * contributions, interest, authorship — is re-keyed onto the survivor's, and
 * the losing device is signed out of the event (decided 2026-08-31; see
 * `rekeyIdentityWork`).
 *
 * Lifted out of the merge route so an approved claim runs the same code. A
 * person asking for the shell an organiser left for them *is* this operation
 * with the shell surviving, and it would be a poor kind of bug if the two
 * paths folded profiles together in two slightly different ways.
 */
export function mergePeople(
  db: Db,
  eventId: number,
  survivor: PersonRow,
  loser: PersonRow,
): MergeResult {
  const now = new Date().toISOString();
  const movedSessions = db
    .prepare<[number], { id: number }>(
      'SELECT session_id AS id FROM session_speakers WHERE person_id = ?',
    )
    .all(loser.id)
    .map((r) => r.id);
  let rekeyed = { sessionIds: [] as number[], proposalIds: [] as number[] };

  db.transaction(() => {
    // A session credited to both halves of a merge must not end up credited to
    // the survivor twice — which the primary key would refuse anyway, taking
    // the whole merge down with it. Drop the duplicate, then move what is
    // left.
    db.prepare(
      `DELETE FROM session_speakers
        WHERE person_id = ?
          AND session_id IN (SELECT session_id FROM session_speakers WHERE person_id = ?)`,
    ).run(loser.id, survivor.id);
    db.prepare('UPDATE session_speakers SET person_id = ? WHERE person_id = ?').run(
      survivor.id,
      loser.id,
    );
    db.prepare('UPDATE proposals SET speaker_id = ? WHERE speaker_id = ?').run(
      survivor.id,
      loser.id,
    );
    // The loser's claim must be nulled before the survivor takes it:
    // (event_id, identity_id) is unique among live rows, and the loser is
    // still live at this point in the transaction.
    db.prepare('UPDATE people SET identity_id = NULL, deleted_at = ? WHERE id = ?').run(
      now,
      loser.id,
    );
    const survivingIdentity = survivor.identity_id ?? loser.identity_id;
    db.prepare(
      'UPDATE people SET identity_id = ?, bio = ?, links = ?, updated_at = ? WHERE id = ?',
    ).run(
      survivingIdentity,
      survivor.bio || loser.bio,
      survivor.links === '[]' ? loser.links : survivor.links,
      now,
      survivor.id,
    );
    // The loser's row is gone from the roster; its speaker code must not
    // outlive it as a phrase nobody can revoke.
    settleSpeakerCodeAfterMerge(db, loser.id, survivor.id, survivingIdentity);
    // Only a both-claimed merge leaves a second identity behind to strip.
    // When the survivor inherited the loser's identity, the work already
    // belongs to the surviving pair and there is nothing to move.
    if (
      loser.identity_id !== null &&
      survivor.identity_id !== null &&
      survivor.identity_id !== loser.identity_id
    ) {
      rekeyed = rekeyIdentityWork(db, eventId, loser.identity_id, survivor.identity_id);
    }
  })();

  return { movedSessions, rekeyed };
}

/** Everything a merge changed, on the wire. `survivor` must be the public
 *  DTO: this reaches every subscriber, organiser or not. */
export function broadcastMerge(
  db: Db,
  broker: Broker,
  slug: string,
  eventId: number,
  viewerIdentityId: number,
  loserId: number,
  survivor: PersonDto,
  result: MergeResult,
): void {
  broker.publish(slug, 'person.deleted', { id: loserId });
  broker.publish(slug, 'person.updated', survivor);
  if (result.rekeyed.proposalIds.length > 0) {
    const changed = new Set(result.rekeyed.proposalIds);
    for (const proposal of loadProposalDtos(db, eventId, viewerIdentityId)) {
      if (changed.has(proposal.id)) broker.publish(slug, 'proposal.updated', proposal);
    }
  }
  for (const sessionId of new Set([...result.movedSessions, ...result.rekeyed.sessionIds])) {
    const row = db.prepare<[number], SessionRow>('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (row && row.deleted_at === null) {
      broker.publish(slug, 'session.updated', loadSessionDto(db, row));
    }
  }
}

/** The audit row a merge leaves: the actor, and the profile that is gone. */
export function auditMerge(
  db: Db,
  identityId: number,
  eventId: number,
  loserId: number,
  action: 'merge' | 'claim_approve',
): void {
  audit(db, { identityId, eventId, action, entity: 'person', entityId: loserId });
}
