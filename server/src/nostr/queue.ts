/**
 * The publish queue: how the calendar events on the relays are kept equal to
 * the database (_planning/specs/nostr-publishing.md §Calendar event sync).
 *
 * A write that changes what a calendar event would contain calls `markDirty`
 * beside its `audit()` call: one upsert, no relay I/O, never a throw into the
 * request. A loop every ten seconds builds the current version of each due
 * row, signs it and publishes it, tracking acceptance per relay, so a relay
 * that refuses keeps its rows pending without blocking the others and a
 * relay added later receives everything.
 *
 * Two timestamps make the debounce: `touched_at` moves on every mark and
 * `dirty_since` only on the first, so a burst of drag edits publishes once
 * fifteen seconds after it stops, and a burst that never stops still goes
 * out within a minute. Clearing them compares `touched_at` to the value
 * read, so a mark that lands during a build survives it.
 */
import { finalizeEvent } from 'nostr-tools/pure';
import type { Config } from '../config.js';
import type { Db, EventRow, NostrPublishedRow } from '../db.js';
import {
  buildCalendarEvent,
  buildDeletion,
  buildProfileEvent,
  buildSessionEvent,
  CALENDAR_D,
  KIND_CALENDAR,
  KIND_PROFILE,
  KIND_SESSION,
  loadSessionFacts,
  publishableSessionIds,
  sessionDTag,
  type Template,
} from './build.js';
import { openEventKey } from './keys.js';
import { makePool, type Pool } from './pool.js';

export type { Pool } from './pool.js';

export const QUIET_MS = 15_000;
export const MAX_WAIT_MS = 60_000;
export const BACKOFF_CAP_MS = 60 * 60_000;
export const TICK_MS = 10_000;
export const SWEEP_MS = 5 * 60_000;

const iso = (ms: number): string => new Date(ms).toISOString();
const relaysOf = (event: EventRow): string[] =>
  event.nostr_relays ? (JSON.parse(event.nostr_relays) as string[]) : [];

const UPSERT = `
  INSERT INTO nostr_published (event_id, entity, entity_id, d_tag, dirty_since, touched_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT (event_id, entity, entity_id) DO UPDATE SET
    touched_at = excluded.touched_at,
    dirty_since = COALESCE(dirty_since, excluded.dirty_since),
    next_try = NULL`;

/**
 * Flag what a write changed. With a session id, that session and the
 * calendar; without, every session, the calendar and the profile — a room,
 * tag or format rename, or a change to the event's name, dates or timezone.
 * An event that has never been enabled has no key and gets no rows.
 */
export function markDirty(db: Db, eventId: number, sessionId?: number, nowMs = Date.now()): void {
  try {
    const event = db.prepare(`SELECT nostr_pubkey FROM events WHERE id = ?`).get(eventId) as
      { nostr_pubkey: string | null } | undefined;
    if (!event?.nostr_pubkey) return;
    const now = iso(nowMs);
    const upsert = db.prepare(UPSERT);
    // A session that is not going to a relay and never was there — a draft,
    // an opted-out one — gets no row: with one, every edit to it would send
    // a deletion request for something no relay has.
    const enrolled = `(s.draft = 0 AND s.deleted_at IS NULL AND s.nostr_optout = 0)
      OR EXISTS (SELECT 1 FROM nostr_published p
                  WHERE p.event_id = s.event_id AND p.entity = 'session' AND p.entity_id = s.id)`;
    const ids = (
      sessionId !== undefined
        ? db
            .prepare(
              `SELECT s.id FROM sessions s WHERE s.event_id = ? AND s.id = ? AND (${enrolled})`,
            )
            .all(eventId, sessionId)
        : db
            .prepare(`SELECT s.id FROM sessions s WHERE s.event_id = ? AND (${enrolled})`)
            .all(eventId)
    ).map((r) => (r as { id: number }).id);
    if (sessionId !== undefined && ids.length === 0) return;
    db.transaction(() => {
      for (const id of ids) upsert.run(eventId, 'session', id, sessionDTag(eventId, id), now, now);
      if (sessionId === undefined) upsert.run(eventId, 'profile', eventId, 'profile', now, now);
      upsert.run(eventId, 'calendar', eventId, CALENDAR_D, now, now);
    })();
  } catch (err) {
    // The request must not fail because the queue could not be marked; the
    // five-minute sweep is the net under this.
    console.error('nostr: markDirty failed', err);
  }
}

/** Every session a person is credited on: their name is in each one's content. */
export function markDirtyForPerson(db: Db, eventId: number, personId: number): void {
  const rows = db
    .prepare(
      `SELECT ss.session_id AS id FROM session_speakers ss
         JOIN sessions s ON s.id = ss.session_id
        WHERE ss.person_id = ? AND s.event_id = ?`,
    )
    .all(personId, eventId) as { id: number }[];
  for (const r of rows) markDirty(db, eventId, r.id);
}

export function markResync(db: Db, eventId: number): void {
  markDirty(db, eventId);
}

/**
 * Retract everything: every row becomes a deletion on the next tick and the
 * event is turned off. The loop keeps draining deletions for an event that is
 * off, so this does not need to wait on a relay in the request.
 */
export function markRetract(db: Db, eventId: number, nowMs = Date.now()): void {
  const now = iso(nowMs);
  db.transaction(() => {
    db.prepare(
      `UPDATE nostr_published
          SET deleted = 1, dirty_since = COALESCE(dirty_since, ?), touched_at = ?, next_try = NULL
        WHERE event_id = ?`,
    ).run(now, now, eventId);
    db.prepare(`UPDATE events SET nostr_enabled = 0 WHERE id = ?`).run(eventId);
  })();
}

/** A relay added to the list has none of the programme: give it every published row. */
export function appendPending(db: Db, eventId: number, relays: string[]): void {
  if (relays.length === 0) return;
  const rows = db
    .prepare(
      `SELECT entity, entity_id, pending FROM nostr_published
        WHERE event_id = ? AND published_at IS NOT NULL`,
    )
    .all(eventId) as Pick<NostrPublishedRow, 'entity' | 'entity_id' | 'pending'>[];
  const update = db.prepare(
    `UPDATE nostr_published SET pending = ?, next_try = NULL
      WHERE event_id = ? AND entity = ? AND entity_id = ?`,
  );
  db.transaction(() => {
    for (const r of rows) {
      const set = new Set<string>([...(JSON.parse(r.pending) as string[]), ...relays]);
      update.run(JSON.stringify([...set]), eventId, r.entity, r.entity_id);
    }
  })();
}

/**
 * A relay taken off the list is owed nothing: drop it from every row's
 * `pending`, or the row would be retried against it hourly for good and
 * Delivery on the Publish tab would never reach zero.
 */
export function removePending(db: Db, eventId: number, relays: string[]): void {
  if (relays.length === 0) return;
  const rows = db
    .prepare(
      `SELECT entity, entity_id, pending, last_error FROM nostr_published
        WHERE event_id = ? AND pending != '[]'`,
    )
    .all(eventId) as Pick<NostrPublishedRow, 'entity' | 'entity_id' | 'pending' | 'last_error'>[];
  const narrow = db.prepare(
    `UPDATE nostr_published SET pending = ?, last_error = ?
      WHERE event_id = ? AND entity = ? AND entity_id = ?`,
  );
  const clear = db.prepare(
    `UPDATE nostr_published
        SET pending = '[]', tries = 0, next_try = NULL, last_error = NULL
      WHERE event_id = ? AND entity = ? AND entity_id = ?`,
  );
  db.transaction(() => {
    for (const r of rows) {
      const left = (JSON.parse(r.pending) as string[]).filter((u) => !relays.includes(u));
      if (left.length === 0) {
        clear.run(eventId, r.entity, r.entity_id);
        continue;
      }
      const errorGone = relays.some((u) => r.last_error?.startsWith(`${u}: `));
      narrow.run(
        JSON.stringify(left),
        errorGone ? null : r.last_error,
        eventId,
        r.entity,
        r.entity_id,
      );
    }
  })();
}

/** The current version of a row: what to sign, and whether it is a deletion. */
function buildRow(
  db: Db,
  config: Config,
  event: EventRow,
  row: NostrPublishedRow,
  nowSec: number,
): { template: Template; deleted: boolean } {
  const pubkey = event.nostr_pubkey!;
  const on = event.nostr_enabled === 1;
  if (row.entity === 'profile') {
    return on
      ? { template: buildProfileEvent(event, config.publicUrl, nowSec), deleted: false }
      : { template: buildDeletion(KIND_PROFILE, pubkey, '', nowSec), deleted: true };
  }
  if (row.entity === 'calendar') {
    if (!on)
      return { template: buildDeletion(KIND_CALENDAR, pubkey, CALENDAR_D, nowSec), deleted: true };
    const dTags = publishableSessionIds(db, event.id).map((id) => sessionDTag(event.id, id));
    return {
      template: buildCalendarEvent(event, dTags, pubkey, config.publicUrl, nowSec),
      deleted: false,
    };
  }
  const facts = loadSessionFacts(db, row.entity_id);
  const gone =
    !on ||
    !facts ||
    facts.session.deleted_at !== null ||
    facts.session.draft === 1 ||
    facts.session.nostr_optout === 1;
  return gone
    ? { template: buildDeletion(KIND_SESSION, pubkey, row.d_tag, nowSec), deleted: true }
    : { template: buildSessionEvent(facts, pubkey, config.publicUrl, nowSec), deleted: false };
}

function dueRows(db: Db, event: EventRow, nowMs: number): NostrPublishedRow[] {
  return db
    .prepare(
      `SELECT * FROM nostr_published
        WHERE event_id = ?
          AND (next_try IS NULL OR next_try <= ?)
          AND (? = 1 OR deleted = 1)
          AND (
            (dirty_since IS NOT NULL AND (touched_at <= ? OR dirty_since <= ?))
            OR (dirty_since IS NULL AND pending != '[]')
          )
        ORDER BY (entity = 'calendar'), entity_id`,
    )
    .all(
      event.id,
      iso(nowMs),
      event.nostr_enabled,
      iso(nowMs - QUIET_MS),
      iso(nowMs - MAX_WAIT_MS),
    ) as NostrPublishedRow[];
}

const errorText = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

async function processRow(
  db: Db,
  config: Config,
  pool: Pool,
  event: EventRow,
  seckey: Uint8Array,
  relays: string[],
  row: NostrPublishedRow,
  nowMs: number,
): Promise<void> {
  const { template, deleted } = buildRow(db, config, event, row, Math.floor(nowMs / 1000));
  const signed = finalizeEvent(template, seckey);
  const where = `WHERE event_id = ? AND entity = ? AND entity_id = ?`;
  const key = [row.event_id, row.entity, row.entity_id] as const;
  let pending: string[];
  if (row.dirty_since !== null) {
    pending = relays;
    // Clear the marks only if nothing marked the row again during the build;
    // otherwise it stays dirty and the next tick publishes the newer state.
    db.prepare(
      `UPDATE nostr_published
          SET last_event_id = ?, pending = ?, deleted = ?, published_at = NULL,
              dirty_since = NULL, touched_at = NULL
        ${where} AND touched_at = ?`,
    ).run(signed.id, JSON.stringify(pending), deleted ? 1 : 0, ...key, row.touched_at);
  } else {
    pending = JSON.parse(row.pending) as string[];
  }
  if (pending.length === 0) {
    db.prepare(`UPDATE nostr_published SET tries = 0, next_try = NULL ${where}`).run(...key);
    return;
  }
  const results = await Promise.allSettled(pool.publish(pending, signed));
  const refused = pending.filter((_, i) => results[i].status === 'rejected');
  const firstError =
    results
      .map((r, i) => (r.status === 'rejected' ? `${pending[i]}: ${errorText(r.reason)}` : null))
      .find((m) => m !== null) ?? null;
  const acceptedAny = refused.length < pending.length;
  if (refused.length === 0) {
    db.prepare(
      `UPDATE nostr_published
          SET pending = '[]', tries = 0, next_try = NULL, last_error = NULL,
              published_at = COALESCE(published_at, ?)
        ${where}`,
    ).run(iso(nowMs), ...key);
    return;
  }
  const delay = Math.min(60_000 * 2 ** row.tries, BACKOFF_CAP_MS);
  db.prepare(
    `UPDATE nostr_published
        SET pending = ?, tries = ?, next_try = ?, last_error = ?,
            published_at = CASE WHEN ? THEN COALESCE(published_at, ?) ELSE published_at END
      ${where}`,
  ).run(
    JSON.stringify(refused),
    row.tries + 1,
    iso(nowMs + delay),
    firstError,
    acceptedAny ? 1 : 0,
    iso(nowMs),
    ...key,
  );
}

/** One pass: every due row of every event that is on or still has deletions to send. */
export async function syncTick(
  db: Db,
  config: Config,
  pool: Pool,
  nowMs = Date.now(),
): Promise<void> {
  const events = db
    .prepare(
      `SELECT * FROM events
        WHERE nostr_seckey IS NOT NULL
          AND (nostr_enabled = 1 OR EXISTS (
            SELECT 1 FROM nostr_published p
             WHERE p.event_id = events.id AND p.deleted = 1
               AND (p.dirty_since IS NOT NULL OR p.pending != '[]')))`,
    )
    .all() as EventRow[];
  for (const event of events) {
    const seckey = openEventKey(event, config);
    if (!seckey) {
      console.error(
        `nostr: event ${event.id} (${event.slug}): the key does not decrypt — was the at-rest secret rotated without SECRETS_AT_REST_KEY_PREVIOUS?`,
      );
      continue;
    }
    const relays = relaysOf(event);
    for (const row of dueRows(db, event, nowMs)) {
      try {
        await processRow(db, config, pool, event, seckey, relays, row, nowMs);
      } catch (err) {
        console.error(`nostr: ${row.entity} ${row.entity_id} of event ${event.id} failed`, err);
      }
    }
  }
}

/** The net under a missed `markDirty` call site: anything newer than its publish. */
export function sweep(db: Db, nowMs = Date.now()): void {
  const events = db.prepare(`SELECT id FROM events WHERE nostr_enabled = 1`).all() as {
    id: number;
  }[];
  for (const { id } of events) {
    const stale = db
      .prepare(
        `SELECT s.id FROM sessions s
           LEFT JOIN nostr_published p
             ON p.event_id = s.event_id AND p.entity = 'session' AND p.entity_id = s.id
          WHERE s.event_id = ? AND s.draft = 0 AND s.deleted_at IS NULL AND s.nostr_optout = 0
            AND (p.entity_id IS NULL
                 OR (p.dirty_since IS NULL AND p.pending = '[]'
                     AND (p.published_at IS NULL OR p.published_at < s.updated_at)))`,
      )
      .all(id) as { id: number }[];
    for (const s of stale) markDirty(db, id, s.id, nowMs);
  }
}

export interface RelayAnswer {
  url: string;
  ok: boolean;
  message: string;
}

/** Send a test: the profile again, now, and what each relay said about it. */
export async function publishProfileNow(
  db: Db,
  config: Config,
  pool: Pool,
  eventId: number,
): Promise<RelayAnswer[]> {
  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(eventId) as EventRow;
  const seckey = openEventKey(event, config);
  if (!seckey) throw new Error('the key does not decrypt');
  const relays = relaysOf(event);
  const signed = finalizeEvent(
    buildProfileEvent(event, config.publicUrl, Math.floor(Date.now() / 1000)),
    seckey,
  );
  const results = await Promise.allSettled(pool.publish(relays, signed));
  return relays.map((url, i) => {
    const r = results[i];
    return r.status === 'fulfilled'
      ? { url, ok: true, message: String(r.value) }
      : { url, ok: false, message: errorText(r.reason) };
  });
}

/** Start the loop and the sweep; both `unref`'d. Returns a stop function. */
export function startNostrSync(db: Db, config: Config, pool: Pool = makePool()): () => void {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await syncTick(db, config, pool);
    } catch (err) {
      console.error('nostr: sync tick failed', err);
    } finally {
      running = false;
    }
  };
  const loop = setInterval(() => void tick(), TICK_MS);
  loop.unref();
  const net = setInterval(() => sweep(db), SWEEP_MS);
  net.unref();
  void tick();
  return () => {
    clearInterval(loop);
    clearInterval(net);
  };
}
