import { describe, expect, it } from 'vitest';
import type { VerifiedEvent } from 'nostr-tools/pure';
import type { NostrPublishedRow } from '../server/src/db.js';
import { encryptEventKey, generateKeys } from '../server/src/nostr/keys.js';
import {
  appendPending,
  markDirty,
  markRetract,
  publishProfileNow,
  removePending,
  sweep,
  syncTick,
  type Pool,
} from '../server/src/nostr/queue.js';
import { makeHarness, seedEvent, seedRoom } from './helpers.js';

class FakePool implements Pool {
  sent: { relay: string; kind: number; d?: string; a?: string }[] = [];
  refuse = new Set<string>();
  onPublish: (() => void) | null = null;
  publish(relays: string[], ev: VerifiedEvent): Promise<string>[] {
    this.onPublish?.();
    return relays.map((relay) => {
      this.sent.push({
        relay,
        kind: ev.kind,
        d: ev.tags.find((t) => t[0] === 'd')?.[1],
        a: ev.tags.find((t) => t[0] === 'a')?.[1],
      });
      return this.refuse.has(relay)
        ? Promise.reject(new Error('blocked: not welcome'))
        : Promise.resolve('ok');
    });
  }
  kinds(kind: number) {
    return this.sent.filter((s) => s.kind === kind);
  }
}

const T0 = Date.parse('2026-06-01T00:00:00Z');
const QUIET = 15_000;
const s = (n: number) => n * 1000;

function setup(relays = ['wss://a', 'wss://b']) {
  const h = makeHarness();
  const eventId = seedEvent(h.db, { slug: 'conf' });
  const keys = generateKeys();
  h.db
    .prepare(
      `UPDATE events SET nostr_enabled = 1, nostr_pubkey = ?, nostr_seckey = ?, nostr_relays = ? WHERE id = ?`,
    )
    .run(
      keys.pubkey,
      encryptEventKey(keys.seckey, h.app.ctx.config),
      JSON.stringify(relays),
      eventId,
    );
  const roomId = seedRoom(h.db, eventId);
  const creator = Number(
    h.db
      .prepare(
        `INSERT INTO identities (public_id, token, display_name, created_at, last_seen_at)
         VALUES ('p1', 't1', 'Creator', datetime('now'), datetime('now'))`,
      )
      .run().lastInsertRowid,
  );
  const insertSession = (title = 'S'): number =>
    Number(
      h.db
        .prepare(
          `INSERT INTO sessions (event_id, room_id, type, title, description, starts_at, ends_at,
             created_by, created_at, updated_at)
           VALUES (?, ?, 'official', ?, '', '2026-06-01T09:00:00.000Z', '2026-06-01T10:00:00.000Z',
             ?, ?, ?)`,
        )
        .run(
          eventId,
          roomId,
          title,
          creator,
          new Date(T0 - s(1)).toISOString(),
          new Date(T0 - s(1)).toISOString(),
        ).lastInsertRowid,
    );
  const pool = new FakePool();
  const tick = (at: number) => syncTick(h.db, h.app.ctx.config, pool, at);
  const row = (entity: string, entityId: number): NostrPublishedRow =>
    h.db
      .prepare(`SELECT * FROM nostr_published WHERE event_id = ? AND entity = ? AND entity_id = ?`)
      .get(eventId, entity, entityId) as NostrPublishedRow;
  return { h, eventId, pubkey: keys.pubkey, insertSession, pool, tick, row };
}

describe('markDirty', () => {
  it('does nothing for an event that was never enabled', () => {
    const h = makeHarness();
    const eventId = seedEvent(h.db);
    markDirty(h.db, eventId);
    expect(h.db.prepare(`SELECT COUNT(*) AS n FROM nostr_published`).get()).toEqual({ n: 0 });
    h.close();
  });

  it('keeps the first mark and moves the latest', () => {
    const { h, eventId, insertSession, row } = setup();
    const sid = insertSession();
    markDirty(h.db, eventId, sid, T0);
    markDirty(h.db, eventId, sid, T0 + s(5));
    const r = row('session', sid);
    expect(r.dirty_since).toBe(new Date(T0).toISOString());
    expect(r.touched_at).toBe(new Date(T0 + s(5)).toISOString());
    expect(row('calendar', eventId).dirty_since).toBe(new Date(T0).toISOString());
    h.close();
  });

  it('a whole-event mark covers every session, the calendar and the profile', () => {
    const { h, eventId, insertSession } = setup();
    insertSession('one');
    insertSession('two');
    markDirty(h.db, eventId, undefined, T0);
    const rows = h.db
      .prepare(
        `SELECT entity FROM nostr_published WHERE dirty_since IS NOT NULL ORDER BY entity, entity_id`,
      )
      .all() as { entity: string }[];
    expect(rows.map((r) => r.entity)).toEqual(['calendar', 'profile', 'session', 'session']);
    h.close();
  });
});

describe('sync loop', () => {
  it('a drag storm publishes once per row, after the quiet window', async () => {
    const { h, eventId, insertSession, pool, tick, row, pubkey } = setup();
    const sid = insertSession();
    for (let i = 0; i < 20; i++) markDirty(h.db, eventId, sid, T0 + i * 100);
    await tick(T0 + s(10));
    expect(pool.sent).toHaveLength(0);
    await tick(T0 + s(2) + QUIET);
    expect(pool.kinds(31923)).toHaveLength(2); // one per relay
    expect(pool.kinds(31924)).toHaveLength(2);
    expect(pool.kinds(31924)[0].a).toBe(`31923:${pubkey}:e${eventId}-s${sid}`);
    const r = row('session', sid);
    expect(r.dirty_since).toBeNull();
    expect(r.pending).toBe('[]');
    expect(r.published_at).not.toBeNull();
    expect(r.last_event_id).toMatch(/^[0-9a-f]{64}$/);
    await tick(T0 + s(120));
    expect(pool.sent).toHaveLength(4); // nothing more
    h.close();
  });

  it('a storm that never pauses still goes out within a minute', async () => {
    const { h, eventId, insertSession, pool, tick } = setup();
    const sid = insertSession();
    for (let t = 0; t <= s(70); t += s(5)) {
      markDirty(h.db, eventId, sid, T0 + t);
      await tick(T0 + t);
    }
    expect(pool.kinds(31923).length).toBeGreaterThan(0);
    h.close();
  });

  it('a mark during the build is not lost', async () => {
    const { h, eventId, insertSession, pool, tick, row } = setup();
    const sid = insertSession();
    markDirty(h.db, eventId, sid, T0);
    pool.onPublish = () => {
      markDirty(h.db, eventId, sid, T0 + s(30));
      pool.onPublish = null;
    };
    await tick(T0 + s(20));
    expect(row('session', sid).dirty_since).not.toBeNull();
    await tick(T0 + s(50));
    expect(row('session', sid).dirty_since).toBeNull();
    expect(pool.kinds(31923)).toHaveLength(4);
    h.close();
  });

  it('a refusing relay keeps the row pending for that relay only, and backs off', async () => {
    const { h, eventId, insertSession, pool, tick, row } = setup();
    const sid = insertSession();
    pool.refuse.add('wss://b');
    markDirty(h.db, eventId, sid, T0);
    await tick(T0 + s(20));
    let r = row('session', sid);
    expect(JSON.parse(r.pending)).toEqual(['wss://b']);
    expect(r.published_at).not.toBeNull();
    expect(r.tries).toBe(1);
    expect(r.next_try).toBe(new Date(T0 + s(20) + s(60)).toISOString());
    expect(r.last_error).toBe('wss://b: blocked: not welcome');

    pool.sent = [];
    await tick(T0 + s(30)); // before next_try
    expect(pool.sent).toHaveLength(0);
    await tick(T0 + s(81)); // still refusing: tries 2, delay 120 s
    r = row('session', sid);
    expect(r.tries).toBe(2);
    expect(r.next_try).toBe(new Date(T0 + s(81) + s(120)).toISOString());
    expect(pool.sent.every((x) => x.relay === 'wss://b')).toBe(true);

    pool.refuse.clear();
    pool.sent = [];
    await tick(T0 + s(300));
    r = row('session', sid);
    expect(r.pending).toBe('[]');
    expect(r.tries).toBe(0);
    expect(r.last_error).toBeNull();
    expect(pool.sent.map((x) => x.relay)).toEqual(['wss://b', 'wss://b']);
    h.close();
  });

  it('a fresh mark does not wait out the backoff', async () => {
    const { h, eventId, insertSession, pool, tick, row } = setup(['wss://a']);
    const sid = insertSession();
    pool.refuse.add('wss://a');
    markDirty(h.db, eventId, sid, T0);
    await tick(T0 + s(20));
    expect(row('session', sid).next_try).toBe(new Date(T0 + s(80)).toISOString());
    pool.refuse.clear();
    pool.sent = [];
    markDirty(h.db, eventId, sid, T0 + s(25));
    await tick(T0 + s(45));
    expect(pool.kinds(31923)).toHaveLength(1);
    expect(row('session', sid).pending).toBe('[]');
    expect(row('session', sid).next_try).toBeNull();
    h.close();
  });

  it('caps the backoff at an hour', async () => {
    const { h, eventId, insertSession, pool, tick, row } = setup(['wss://a']);
    const sid = insertSession();
    pool.refuse.add('wss://a');
    markDirty(h.db, eventId, sid, T0);
    h.db.prepare(`UPDATE nostr_published SET tries = 9`).run();
    await tick(T0 + s(20));
    expect(row('session', sid).next_try).toBe(new Date(T0 + s(20) + s(3600)).toISOString());
    h.close();
  });

  it('delete yields a kind 5 with a and k and a calendar rebuild; restore re-enters', async () => {
    const { h, eventId, insertSession, pool, tick, row, pubkey } = setup();
    const sid = insertSession();
    markDirty(h.db, eventId, sid, T0);
    await tick(T0 + s(20));
    h.db
      .prepare(`UPDATE sessions SET deleted_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), sid);
    markDirty(h.db, eventId, sid, T0 + s(60));
    pool.sent = [];
    await tick(T0 + s(80));
    expect(pool.kinds(5)).toHaveLength(2);
    expect(pool.kinds(5)[0].a).toBe(`31923:${pubkey}:e${eventId}-s${sid}`);
    expect(pool.kinds(31924)).toHaveLength(2);
    expect(pool.kinds(31924)[0].a).toBeUndefined(); // the calendar is empty now
    expect(row('session', sid).deleted).toBe(1);

    h.db.prepare(`UPDATE sessions SET deleted_at = NULL WHERE id = ?`).run(sid);
    markDirty(h.db, eventId, sid, T0 + s(120));
    pool.sent = [];
    await tick(T0 + s(140));
    expect(pool.kinds(31923)).toHaveLength(2);
    expect(row('session', sid).deleted).toBe(0);
    h.close();
  });

  it('a draft or opted-out session gets no row until it was published; then a deletion', async () => {
    const { h, eventId, insertSession, pool, tick, row } = setup(['wss://a']);
    const draft = insertSession('draft');
    const optout = insertSession('optout');
    const live = insertSession('live');
    h.db.prepare(`UPDATE sessions SET draft = 1 WHERE id = ?`).run(draft);
    h.db.prepare(`UPDATE sessions SET nostr_optout = 1 WHERE id = ?`).run(optout);
    markDirty(h.db, eventId, undefined, T0);
    markDirty(h.db, eventId, draft, T0);
    await tick(T0 + s(20));
    expect(pool.kinds(31923)).toHaveLength(1);
    expect(pool.kinds(5)).toHaveLength(0);
    expect(pool.kinds(0)).toHaveLength(1);
    expect(row('session', draft)).toBeUndefined();
    expect(row('session', optout)).toBeUndefined();

    h.db.prepare(`UPDATE sessions SET nostr_optout = 1 WHERE id = ?`).run(live);
    markDirty(h.db, eventId, live, T0 + s(30));
    await tick(T0 + s(50));
    expect(pool.kinds(5)).toHaveLength(1);
    expect(row('session', live).deleted).toBe(1);
    h.close();
  });

  it('retract sends deletions while off, and enabling again republishes', async () => {
    const { h, eventId, insertSession, pool, tick, row, pubkey } = setup(['wss://a']);
    const sid = insertSession();
    markDirty(h.db, eventId, undefined, T0);
    await tick(T0 + s(20));
    expect(pool.kinds(31923)).toHaveLength(1);

    markRetract(h.db, eventId, T0 + s(40));
    expect(
      (
        h.db.prepare(`SELECT nostr_enabled AS enabled FROM events WHERE id = ?`).get(eventId) as {
          enabled: number;
        }
      ).enabled,
    ).toBe(0);
    pool.sent = [];
    await tick(T0 + s(60));
    expect(
      pool
        .kinds(5)
        .map((x) => x.a)
        .sort(),
    ).toEqual(
      [`0:${pubkey}:`, `31923:${pubkey}:e${eventId}-s${sid}`, `31924:${pubkey}:programme`].sort(),
    );
    expect(row('session', sid).deleted).toBe(1);

    // Off: a mark can only ever resend a deletion, never a calendar event.
    markDirty(h.db, eventId, sid, T0 + s(70));
    pool.sent = [];
    await tick(T0 + s(200));
    expect(pool.kinds(31923)).toHaveLength(0);
    expect(pool.kinds(31924)).toHaveLength(0);

    h.db.prepare(`UPDATE events SET nostr_enabled = 1 WHERE id = ?`).run(eventId);
    markDirty(h.db, eventId, undefined, T0 + s(210));
    await tick(T0 + s(230));
    expect(pool.kinds(31923)).toHaveLength(1);
    expect(row('session', sid).deleted).toBe(0);
    h.close();
  });

  it('a relay added later receives every published row', async () => {
    const { h, eventId, insertSession, pool, tick, row } = setup(['wss://a']);
    const sid = insertSession();
    markDirty(h.db, eventId, undefined, T0);
    await tick(T0 + s(20));
    h.db
      .prepare(`UPDATE events SET nostr_relays = ? WHERE id = ?`)
      .run(JSON.stringify(['wss://a', 'wss://c']), eventId);
    appendPending(h.db, eventId, ['wss://c']);
    expect(JSON.parse(row('session', sid).pending)).toEqual(['wss://c']);
    pool.sent = [];
    await tick(T0 + s(30));
    expect(pool.sent.map((x) => x.relay)).toEqual(['wss://c', 'wss://c', 'wss://c']);
    expect(row('session', sid).pending).toBe('[]');
    h.close();
  });

  it('a relay taken off the list is dropped from every pending row', async () => {
    const { h, eventId, insertSession, pool, tick, row } = setup(['wss://a', 'wss://b']);
    const sid = insertSession();
    pool.refuse.add('wss://b');
    markDirty(h.db, eventId, undefined, T0);
    await tick(T0 + s(20));
    expect(JSON.parse(row('session', sid).pending)).toEqual(['wss://b']);
    expect(row('session', sid).tries).toBe(1);
    h.db.prepare(`UPDATE events SET nostr_relays = '["wss://a"]' WHERE id = ?`).run(eventId);
    removePending(h.db, eventId, ['wss://b']);
    for (const r of [row('session', sid), row('calendar', eventId), row('profile', eventId)]) {
      expect(r.pending).toBe('[]');
      expect(r.tries).toBe(0);
      expect(r.next_try).toBeNull();
      expect(r.last_error).toBeNull();
    }
    pool.sent = [];
    await tick(T0 + s(400));
    expect(pool.sent).toHaveLength(0);
    h.close();
  });

  it('skips an event whose key does not decrypt', async () => {
    const { h, eventId, insertSession, pool, tick } = setup(['wss://a']);
    insertSession();
    markDirty(h.db, eventId, undefined, T0);
    h.app.ctx.config.atRestSecret = 'other';
    await tick(T0 + s(20));
    expect(pool.sent).toHaveLength(0);
    h.close();
  });

  it('the sweep catches a session updated without a mark, and one with no row', async () => {
    const { h, eventId, insertSession, tick, row } = setup(['wss://a']);
    const marked = insertSession('marked');
    markDirty(h.db, eventId, marked, T0);
    await tick(T0 + s(20));
    h.db
      .prepare(`UPDATE sessions SET title = 'renamed', updated_at = ? WHERE id = ?`)
      .run(new Date(T0 + s(30)).toISOString(), marked);
    const unmarked = insertSession('unmarked');
    sweep(h.db, T0 + s(40));
    expect(row('session', marked).dirty_since).not.toBeNull();
    expect(row('session', unmarked).dirty_since).not.toBeNull();
    h.close();
  });

  it('send a test publishes the profile and reports each relay', async () => {
    const { h, eventId, pool } = setup();
    pool.refuse.add('wss://b');
    const answers = await publishProfileNow(h.db, h.app.ctx.config, pool, eventId);
    expect(answers).toEqual([
      { url: 'wss://a', ok: true, message: 'ok' },
      { url: 'wss://b', ok: false, message: 'blocked: not welcome' },
    ]);
    expect(pool.kinds(0)).toHaveLength(2);
    h.close();
  });
});
