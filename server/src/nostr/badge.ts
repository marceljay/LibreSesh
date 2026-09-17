import type { Db, EventRow } from '../db.js';
import { KIND_SESSION, naddrFor, sessionDTag } from './build.js';

/**
 * The address of each session that is on Nostr right now: a row in the
 * publish queue that a relay has accepted and that was not last sent as a
 * deletion. Empty for an event with no key. The relays ride along as hints,
 * so a client that has never heard of the event knows where to look.
 */
export function naddrBySession(
  db: Db,
  event: EventRow,
  sessionIds: number[],
): Map<number, { naddr: string }> {
  const out = new Map<number, { naddr: string }>();
  if (!event.nostr_pubkey || sessionIds.length === 0) return out;
  const relays = event.nostr_relays ? (JSON.parse(event.nostr_relays) as string[]) : [];
  const rows = db
    .prepare(
      `SELECT entity_id AS id FROM nostr_published
        WHERE event_id = ? AND entity = 'session' AND published_at IS NOT NULL AND deleted = 0
          AND entity_id IN (${sessionIds.map(() => '?').join(',')})`,
    )
    .all(event.id, ...sessionIds) as { id: number }[];
  for (const r of rows) {
    out.set(r.id, {
      naddr: naddrFor(KIND_SESSION, event.nostr_pubkey, sessionDTag(event.id, r.id), relays),
    });
  }
  return out;
}
