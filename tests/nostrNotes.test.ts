import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import type { VerifiedEvent } from 'nostr-tools/pure';
import { Announcer, type Announcement } from '../server/src/announcer.js';
import type { EventRow, ProposalRow, SessionRow } from '../server/src/db.js';
import { encryptEventKey, generateKeys } from '../server/src/nostr/keys.js';
import { dayWord, nostrTransport, renderNote } from '../server/src/nostr/notes.js';
import type { Pool } from '../server/src/nostr/pool.js';
import {
  DAY_ONE,
  DAY_TWO,
  actorWithRole,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';

class FakePool implements Pool {
  sent: VerifiedEvent[] = [];
  refuse = false;
  publish(relays: string[], ev: VerifiedEvent): Promise<string>[] {
    return relays.map(() => {
      this.sent.push(ev);
      return this.refuse ? Promise.reject(new Error('blocked')) : Promise.resolve('ok');
    });
  }
}

describe('kind-1 notes', () => {
  let h: Harness;
  let admin: Agent;
  let eventId: number;
  let roomA: number;
  let roomB: number;
  let pubkey: string;
  const PUB_URL = 'https://sesh.example';
  const RELAYS = ['wss://r.test'];

  const event = (): EventRow =>
    h.db.prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?').get(eventId)!;
  const session = (id: number): SessionRow =>
    h.db.prepare<[number], SessionRow>('SELECT * FROM sessions WHERE id = ?').get(id)!;

  beforeEach(async () => {
    h = makeHarness({ publicUrl: PUB_URL });
    eventId = seedEvent(h.db, { slug: 'longconf', name: 'LongConf' });
    roomA = seedRoom(h.db, eventId, { name: 'Room A' });
    roomB = seedRoom(h.db, eventId, { name: 'Room B' });
    const keys = generateKeys();
    pubkey = keys.pubkey;
    h.db
      .prepare(
        `UPDATE events SET nostr_enabled = 1, nostr_pubkey = ?, nostr_seckey = ?, nostr_relays = ?,
                           nostr_triggers = '["up_next","digest","added","changed","pitched","placed"]'
          WHERE id = ?`,
      )
      .run(
        keys.pubkey,
        encryptEventKey(keys.seckey, h.app.ctx.config),
        JSON.stringify(RELAYS),
        eventId,
      );
    admin = await actorWithRole(h, 'longconf', 'admin-pw');
  });
  afterEach(() => h.close());

  const add = async (
    roomId: number,
    title: string,
    minute: number,
    speakers: string[] = [],
    day = DAY_ONE,
  ) => {
    const res = await admin
      .post('/api/e/longconf/sessions')
      .send({ roomId, title, startsAt: at(day, minute), endsAt: at(day, minute + 30), speakers })
      .expect(201);
    return (res.body as { id: number }).id;
  };

  const announcement = (
    trigger: Announcement['trigger'],
    ids: number[],
    atIso: string,
    proposal?: ProposalRow,
  ): Announcement => ({
    trigger,
    event: event(),
    at: atIso,
    sessions: ids.map(session),
    proposal,
  });

  const naddr = (id: number) =>
    nip19.naddrEncode({ kind: 31923, pubkey, identifier: `e${eventId}-s${id}`, relays: RELAYS });

  it('up next: one line per room, references and the site link', async () => {
    const a = await add(roomA, 'Scaling an unconference', 840, ['Ada']);
    const b = await add(roomB, 'Zines as documentation', 840, ['Grace', 'Linus']);
    const note = renderNote(
      h.db,
      announcement('up_next', [a, b], at(DAY_ONE, 840)),
      pubkey,
      PUB_URL,
    )!;
    expect(note.content).toBe(
      [
        'Up next at 14:00 at LongConf',
        '',
        'Room A — Scaling an unconference (Ada)',
        'Room B — Zines as documentation (Grace, Linus)',
        '',
        `nostr:${naddr(a)} · nostr:${naddr(b)} · https://sesh.example/e/longconf`,
      ].join('\n'),
    );
    expect(note.tags).toEqual([
      ['a', `31923:${pubkey}:e${eventId}-s${a}`],
      ['a', `31923:${pubkey}:e${eventId}-s${b}`],
    ]);
    for (const ref of note.content.match(/nostr:naddr1\w+/g)!) {
      const decoded = nip19.decode(ref.slice('nostr:'.length));
      expect(decoded.type).toBe('naddr');
    }
  });

  it('carries no link without PUBLIC_URL', async () => {
    const a = await add(roomA, 'Scaling an unconference', 840);
    const note = renderNote(h.db, announcement('up_next', [a], at(DAY_ONE, 840)), pubkey, null)!;
    expect(note.content.endsWith(`nostr:${naddr(a)}`)).toBe(true);
    expect(note.content).not.toContain('https://');
  });

  it('placed: the spec example, with the pitch board as the source', async () => {
    const b = await add(roomB, 'Zines as documentation', 660, ['Grace'], DAY_TWO);
    const res = await admin
      .post('/api/e/longconf/proposals')
      .send({ title: 'Zines as documentation', description: 'Bring scissors.' })
      .expect(201);
    const proposal = h.db
      .prepare<[number], ProposalRow>('SELECT * FROM proposals WHERE id = ?')
      .get((res.body as { id: number }).id)!;
    const note = renderNote(
      h.db,
      announcement('placed', [b], at(DAY_ONE, 600), proposal),
      pubkey,
      PUB_URL,
    )!;
    expect(note.content).toBe(
      [
        'Placed from the pitch board: Zines as documentation',
        'Tomorrow 11:00 in Room B · Grace',
        '',
        `nostr:${naddr(b)} · https://sesh.example/e/longconf/s/${b}`,
      ].join('\n'),
    );
    expect(note.tags).toEqual([['a', `31923:${pubkey}:e${eventId}-s${b}`]]);
  });

  it('added and changed name the day and the room', async () => {
    const a = await add(roomA, 'Late one', 900, [], DAY_ONE);
    const added = renderNote(h.db, announcement('added', [a], at(DAY_ONE, 600)), pubkey, PUB_URL)!;
    expect(added.content.split('\n').slice(0, 2)).toEqual([
      'Added to the programme: Late one',
      'Today 15:00 in Room A',
    ]);
    const moved = renderNote(
      h.db,
      announcement('changed', [a], at(DAY_ONE, 600)),
      pubkey,
      PUB_URL,
    )!;
    expect(moved.content.split('\n').slice(0, 3)).toEqual([
      'Moved on the schedule',
      '',
      'Today 15:00 · Room A — Late one',
    ]);
  });

  it('pitched: title, pitcher, a line of the description, the board; no a tags', async () => {
    const res = await admin
      .post('/api/e/longconf/proposals')
      .send({ title: 'Zines', description: '\n\nBring scissors.\nAnd glue.' })
      .expect(201);
    const proposal = h.db
      .prepare<[number], ProposalRow>('SELECT * FROM proposals WHERE id = ?')
      .get((res.body as { id: number }).id)!;
    const note = renderNote(
      h.db,
      announcement('pitched', [], at(DAY_ONE, 600), proposal),
      pubkey,
      PUB_URL,
    )!;
    expect(note.tags).toEqual([]);
    expect(note.content).toMatch(
      /^Pitched: Zines\nby tester_\d+\nBring scissors\.\n\nhttps:\/\/sesh\.example\/e\/longconf\/proposals$/,
    );
  });

  it('digest: one line a session, breaks included, sorted by time, capped at 40', async () => {
    h.db
      .prepare(
        `INSERT INTO breaks (event_id, label, start_min, end_min, date, created_at)
         VALUES (?, 'Lunch', 750, 810, NULL, datetime('now'))`,
      )
      .run(eventId);
    // 45 sessions is past the per-minute write budget, so all but the first
    // go in by SQL, credited to the same identity.
    const ids: number[] = [await add(roomB, 'S0', 540, ['X'])];
    const creator = session(ids[0]!).created_by;
    const insert = h.db.prepare(
      `INSERT INTO sessions (event_id, room_id, type, title, description, starts_at, ends_at,
         created_by, created_at, updated_at)
       VALUES (?, ?, 'official', ?, '', ?, ?, ?, datetime('now'), datetime('now'))`,
    );
    for (let i = 1; i < 45; i++) {
      const minute = 540 + i * 10;
      ids.push(
        Number(
          insert.run(
            eventId,
            i % 2 ? roomA : roomB,
            `S${i}`,
            at(DAY_ONE, minute),
            at(DAY_ONE, minute + 30),
            creator,
          ).lastInsertRowid,
        ),
      );
    }
    const note = renderNote(h.db, announcement('digest', ids, at(DAY_ONE, 540)), pubkey, PUB_URL)!;
    const lines = note.content.split('\n');
    expect(lines[0]).toMatch(/^Monday 1 June at LongConf$/);
    expect(lines[2]).toBe('09:00 · Room B — S0');
    expect(lines).toContain('12:30 · Lunch');
    const body = lines.slice(2, lines.indexOf('', 2));
    expect(body.filter((l) => !l.startsWith('…'))).toHaveLength(40);
    expect(body.at(-1)).toBe('… and 6 more');
    expect(note.content).not.toContain('(X)');
    expect(note.content).not.toContain('S0 (X)');
    expect(note.tags).toHaveLength(45);
  });

  it('an empty digest and an empty slot post nothing', () => {
    expect(
      renderNote(h.db, announcement('digest', [], at(DAY_ONE, 540)), pubkey, PUB_URL),
    ).toBeNull();
    expect(
      renderNote(h.db, announcement('up_next', [], at(DAY_ONE, 540)), pubkey, PUB_URL),
    ).toBeNull();
  });

  it('dayWord', () => {
    expect(dayWord(at(DAY_ONE, 600), at(DAY_ONE, 100), 'Europe/Berlin')).toBe('Today');
    expect(dayWord(at(DAY_TWO, 600), at(DAY_ONE, 100), 'Europe/Berlin')).toBe('Tomorrow');
    expect(dayWord('2026-06-05T09:00:00.000Z', at(DAY_ONE, 100), 'Europe/Berlin')).toBe(
      'Fri 5 Jun',
    );
  });

  it('the transport signs with the event key and publishes to its relays', async () => {
    const a = await add(roomA, 'Scaling an unconference', 840);
    const pool = new FakePool();
    const t = nostrTransport(h.db, h.app.ctx.config, pool);
    expect(t.enabled(event(), 'up_next')).toBe(true);
    await t.send(event(), announcement('up_next', [a], at(DAY_ONE, 840)));
    expect(pool.sent).toHaveLength(1);
    expect(pool.sent[0]!.kind).toBe(1);
    expect(pool.sent[0]!.pubkey).toBe(pubkey);
    expect(pool.sent[0]!.content).toContain('Scaling an unconference');
  });

  it('is off when the event has Nostr off or the trigger unticked', async () => {
    const t = nostrTransport(h.db, h.app.ctx.config, new FakePool());
    h.db.prepare(`UPDATE events SET nostr_triggers = '["digest"]' WHERE id = ?`).run(eventId);
    expect(t.enabled(event(), 'up_next')).toBe(false);
    expect(t.enabled(event(), 'digest')).toBe(true);
    h.db.prepare(`UPDATE events SET nostr_enabled = 0 WHERE id = ?`).run(eventId);
    expect(t.enabled(event(), 'digest')).toBe(false);
  });

  it('throws when no relay accepts, so the announcer logs and keeps its mark', async () => {
    const a = await add(roomA, 'Scaling an unconference', 840);
    const pool = new FakePool();
    pool.refuse = true;
    const t = nostrTransport(h.db, h.app.ctx.config, pool);
    await expect(t.send(event(), announcement('up_next', [a], at(DAY_ONE, 840)))).rejects.toThrow(
      /no relay accepted/,
    );
    const announcer = new Announcer(h.db, [t]);
    await expect(announcer.tick(new Date(at(DAY_ONE, 830)))).resolves.toBeUndefined();
    expect(announcer.wasSent('nostr', eventId, at(DAY_ONE, 840))).toBe(true);
  });
});
