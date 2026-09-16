import { describe, expect, it } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import type { EventRow, SessionRow } from '../server/src/db.js';
import {
  buildCalendarEvent,
  buildDeletion,
  buildProfileEvent,
  buildSessionEvent,
  dateRangeText,
  dayStartUnix,
  loadSessionFacts,
  naddrFor,
  publishableSessionIds,
  sessionDTag,
} from '../server/src/nostr/build.js';
import { makeHarness, seedEvent, seedRoom, seedTag } from './helpers.js';

const event = {
  id: 7,
  slug: 'longconf',
  name: 'LongConf',
  timezone: 'Europe/Berlin',
  start_date: '2026-06-01',
  end_date: '2026-06-02',
} as EventRow;

const session = {
  id: 42,
  event_id: 7,
  title: 'Zines as documentation',
  description: 'Bring **scissors**.',
  starts_at: '2026-06-01T09:00:00.000Z', // 11:00 in Berlin
  ends_at: '2026-06-01T10:00:00.000Z',
  livestreams: '[{"label":"Main","url":"https://live.example/a"}]',
  draft: 0,
  deleted_at: null,
  nostr_optout: 0,
} as SessionRow;

const facts = {
  session,
  event,
  room: 'Room B',
  format: 'Workshop',
  tags: ['Docs', 'zines'],
  speakers: ['Grace', 'Linus'],
};
const PUB = 'a'.repeat(64);
const BERLIN_MIDNIGHT = Date.parse('2026-06-01T00:00:00+02:00') / 1000;

describe('buildSessionEvent', () => {
  it('maps every field', () => {
    const t = buildSessionEvent(facts, PUB, 'https://sesh.example', 1_780_000_000);
    expect(t.kind).toBe(31923);
    expect(t.created_at).toBe(1_780_000_000);
    expect(t.tags).toEqual([
      ['d', 'e7-s42'],
      ['title', 'Zines as documentation'],
      ['start', String(Date.parse(session.starts_at) / 1000)],
      ['end', String(Date.parse(session.ends_at) / 1000)],
      ['start_tzid', 'Europe/Berlin'],
      ['end_tzid', 'Europe/Berlin'],
      ['D', String(BERLIN_MIDNIGHT)],
      ['location', 'Room B · LongConf'],
      ['summary', 'Workshop · Room B · Grace, Linus'],
      ['t', 'docs'],
      ['t', 'zines'],
      ['r', 'https://sesh.example/e/longconf/s/42'],
      ['r', 'https://live.example/a'],
      ['a', `31924:${PUB}:programme`],
    ]);
    expect(t.content).toBe(
      'Grace, Linus\n\nBring **scissors**.\n\nhttps://sesh.example/e/longconf/s/42',
    );
  });

  it('omits the site link without PUBLIC_URL, and empty parts', () => {
    const t = buildSessionEvent(
      { ...facts, room: null, format: null, speakers: [], tags: [] },
      PUB,
      undefined,
      0,
    );
    expect(t.tags.filter((x) => x[0] === 'r')).toEqual([['r', 'https://live.example/a']]);
    expect(t.tags.find((x) => x[0] === 'location')).toEqual(['location', 'LongConf']);
    expect(t.tags.find((x) => x[0] === 'summary')).toBeUndefined();
    expect(t.content).toBe('Bring **scissors**.');
  });

  it('keeps d stable across a slug rename', () => {
    const renamed = buildSessionEvent(
      { ...facts, event: { ...event, slug: 'new' } },
      PUB,
      undefined,
      0,
    );
    expect(renamed.tags[0]).toEqual(['d', sessionDTag(7, 42)]);
  });

  it('puts the day on local midnight', () => {
    // 23:30 UTC on 31 May is 01:30 on 1 June in Berlin.
    expect(dayStartUnix('2026-05-31T23:30:00.000Z', 'Europe/Berlin')).toBe(BERLIN_MIDNIGHT);
  });
});

describe('calendar, profile, deletion, naddr', () => {
  it('builds the calendar', () => {
    const t = buildCalendarEvent(event, ['e7-s42', 'e7-s43'], PUB, 'https://sesh.example', 1);
    expect(t.kind).toBe(31924);
    expect(t.tags).toEqual([
      ['d', 'programme'],
      ['title', 'LongConf'],
      ['a', `31923:${PUB}:e7-s42`],
      ['a', `31923:${PUB}:e7-s43`],
    ]);
    expect(t.content).toBe('LongConf, 1–2 June 2026. https://sesh.example/e/longconf');
  });

  it('builds the profile', () => {
    const t = buildProfileEvent(event, undefined, 1);
    expect(t.kind).toBe(0);
    expect(t.tags).toEqual([]);
    expect(JSON.parse(t.content)).toEqual({ name: 'LongConf', about: '1–2 June 2026' });
    const withLink = buildProfileEvent(event, 'https://sesh.example', 1);
    expect(JSON.parse(withLink.content).about).toBe(
      '1–2 June 2026. https://sesh.example/e/longconf',
    );
  });

  it('builds a deletion with a and k', () => {
    const t = buildDeletion(31923, PUB, 'e7-s42', 5);
    expect(t.kind).toBe(5);
    expect(t.tags).toEqual([
      ['a', `31923:${PUB}:e7-s42`],
      ['k', '31923'],
    ]);
    expect(t.content).toBe('');
  });

  it('encodes an naddr that decodes to the coordinate', () => {
    const naddr = naddrFor(31923, PUB, 'e7-s42', ['wss://r.test']);
    const decoded = nip19.decode(naddr);
    expect(decoded.type).toBe('naddr');
    expect(decoded.data).toEqual({
      kind: 31923,
      pubkey: PUB,
      identifier: 'e7-s42',
      relays: ['wss://r.test'],
    });
  });

  it('formats date ranges', () => {
    expect(dateRangeText('2026-06-01', '2026-06-01')).toBe('1 June 2026');
    expect(dateRangeText('2026-06-01', '2026-06-02')).toBe('1–2 June 2026');
    expect(dateRangeText('2026-06-30', '2026-07-02')).toBe('30 June – 2 July 2026');
    expect(dateRangeText('2026-12-30', '2027-01-02')).toBe('30 December 2026 – 2 January 2027');
  });
});

describe('facts from the database', () => {
  it('joins room, format, tags and speakers, and lists publishable sessions', () => {
    const h = makeHarness();
    const eventId = seedEvent(h.db, { slug: 'conf' });
    const roomId = seedRoom(h.db, eventId, { name: 'Room A' });
    const tagId = seedTag(h.db, eventId, 'Docs');
    const creator = Number(
      h.db
        .prepare(
          `INSERT INTO identities (public_id, token, display_name, created_at, last_seen_at)
           VALUES ('p1', 't1', 'Creator', datetime('now'), datetime('now'))`,
        )
        .run().lastInsertRowid,
    );
    const insert = (title: string, extra: Partial<SessionRow> = {}) =>
      Number(
        h.db
          .prepare(
            `INSERT INTO sessions (event_id, room_id, type, title, description, starts_at, ends_at,
               created_by, created_at, updated_at, draft, deleted_at, nostr_optout, format_id)
             VALUES (?, ?, 'official', ?, '', '2026-06-01T09:00:00.000Z', '2026-06-01T10:00:00.000Z',
               ?, datetime('now'), datetime('now'), ?, ?, ?, ?)`,
          )
          .run(
            eventId,
            roomId,
            title,
            creator,
            extra.draft ?? 0,
            extra.deleted_at ?? null,
            extra.nostr_optout ?? 0,
            extra.format_id ?? null,
          ).lastInsertRowid,
      );
    const formatId = Number(
      h.db.prepare(`INSERT INTO session_formats (event_id, name) VALUES (?, 'Talk')`).run(eventId)
        .lastInsertRowid,
    );
    const live = insert('Live', { format_id: formatId });
    insert('Draft', { draft: 1 });
    insert('Gone', { deleted_at: '2026-01-01T00:00:00.000Z' });
    insert('Private', { nostr_optout: 1 });
    h.db.prepare(`INSERT INTO session_tags (session_id, tag_id) VALUES (?, ?)`).run(live, tagId);
    const person = Number(
      h.db
        .prepare(
          `INSERT INTO people (event_id, name, created_at, updated_at) VALUES (?, 'Ada', datetime('now'), datetime('now'))`,
        )
        .run(eventId).lastInsertRowid,
    );
    h.db
      .prepare(`INSERT INTO session_speakers (session_id, person_id, sort_order) VALUES (?, ?, 0)`)
      .run(live, person);

    const f = loadSessionFacts(h.db, live)!;
    expect(f.room).toBe('Room A');
    expect(f.format).toBe('Talk');
    expect(f.tags).toEqual(['Docs']);
    expect(f.speakers).toEqual(['Ada']);
    expect(f.event.id).toBe(eventId);
    expect(loadSessionFacts(h.db, 999_999)).toBeNull();
    expect(publishableSessionIds(h.db, eventId)).toEqual([live]);
    h.close();
  });
});
