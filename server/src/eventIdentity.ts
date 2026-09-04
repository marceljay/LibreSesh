import type { Db } from './db.js';
import { conflict } from './errors.js';

/**
 * A display name belongs to (event, identity), not to the identity (migration
 * 009). `identities.display_name` is only the seed a newcomer is offered.
 */

/** The name this identity goes by inside this event, if they have claimed one. */
export function eventDisplayName(
  db: Db,
  eventId: number,
  identityId: number,
): string | undefined {
  return db
    .prepare<[number, number], { display_name: string }>(
      'SELECT display_name FROM event_identities WHERE event_id = ? AND identity_id = ?',
    )
    .get(eventId, identityId)?.display_name;
}

/** Whoever holds this name in this event, if anyone. */
function holderOf(db: Db, eventId: number, name: string): number | undefined {
  return db
    .prepare<[number, string], { identity_id: number }>(
      'SELECT identity_id FROM event_identities WHERE event_id = ? AND display_name = ?',
    )
    .get(eventId, name)?.identity_id;
}

/**
 * Take `desired` inside this event, or throw 409 if someone else already has
 * it. Idempotent: re-claiming the name you already hold is a no-op, so a
 * returning attendee is never told their own name is taken.
 */
export function claimEventName(
  db: Db,
  eventId: number,
  identityId: number,
  desired: string,
): void {
  const holder = holderOf(db, eventId, desired);
  if (holder === identityId) return;
  if (holder !== undefined) {
    throw conflict(`Someone at this event is already called “${desired}”`, 'name_taken', {
      name: desired,
    });
  }
  db.prepare(
    `INSERT INTO event_identities (event_id, identity_id, display_name, claimed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id, identity_id) DO UPDATE SET display_name = excluded.display_name`,
  ).run(eventId, identityId, desired, new Date().toISOString());

  // The seed follows the last name you chose, so the next event you enter
  // offers that rather than the random one you were minted with.
  db.prepare('UPDATE identities SET display_name = ? WHERE id = ?').run(desired, identityId);
}

/**
 * Resolves author names within one event. Cheap per-request cache, so a bundle
 * resolves each author once. Falls back to the instance seed for an identity
 * that never claimed a name here — an event created before migration 009 can
 * hold contributions from someone who has since been removed from `roles` —
 * and to the UID when there is no seed either, since a fresh identity has no
 * name until it types one at a gate.
 */
export class NameResolver {
  private readonly cache = new Map<number, string>();
  private readonly stmt;

  constructor(
    db: Db,
    private readonly eventId: number,
  ) {
    this.stmt = db.prepare<[number, number], { display_name: string }>(
      `SELECT COALESCE(ei.display_name, NULLIF(i.display_name, ''), i.public_id) AS display_name
         FROM identities i
         LEFT JOIN event_identities ei
           ON ei.identity_id = i.id AND ei.event_id = ?
        WHERE i.id = ?`,
    );
  }

  get(identityId: number): string {
    const hit = this.cache.get(identityId);
    if (hit !== undefined) return hit;
    const name = this.stmt.get(this.eventId, identityId)?.display_name ?? 'unknown';
    this.cache.set(identityId, name);
    return name;
  }
}
