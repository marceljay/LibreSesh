import type { Db } from './db.js';

/**
 * Which slugs are spoken for, and what happens to the old one on a rename.
 *
 * An event's current slug lives on `events`; every slug it used to have lives
 * in `event_slugs` and still resolves to it (see the migration for why). The
 * two together are the namespace, so both questions below have to look at both
 * tables — a slug that still redirects is not free to hand to a new event.
 */

/**
 * Is `slug` already an event's name, or a former name still pointing at one?
 *
 * `exceptEventId` excludes one event's own entries, so an event reclaiming a
 * slug it used to have is not told the name is taken by itself.
 */
export function slugTaken(db: Db, slug: string, exceptEventId?: number): boolean {
  const except = exceptEventId ?? -1;
  const row = db
    .prepare<[string, number, string, number], { n: number }>(
      `SELECT 1 AS n FROM events WHERE slug = ? AND id != ?
       UNION ALL
       SELECT 1 AS n FROM event_slugs WHERE slug = ? AND event_id != ?
       LIMIT 1`,
    )
    .get(slug, except, slug, except);
  return row !== undefined;
}

/**
 * Move an event to `to`, leaving `from` pointing at it.
 *
 * Caller wraps this in a transaction and has already checked `slugTaken`.
 * Reclaiming an earlier slug is allowed and tidies up after itself: `to` stops
 * being a redirect to the event the moment it becomes the event's own name,
 * because a slug that is both would resolve twice and read as a loop.
 */
export function renameEvent(db: Db, eventId: number, from: string, to: string): void {
  db.prepare('DELETE FROM event_slugs WHERE slug = ? AND event_id = ?').run(to, eventId);
  db.prepare(
    'INSERT OR REPLACE INTO event_slugs (slug, event_id, created_at) VALUES (?, ?, ?)',
  ).run(from, eventId, new Date().toISOString());
  db.prepare('UPDATE events SET slug = ? WHERE id = ?').run(to, eventId);
}
