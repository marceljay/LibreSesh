import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db, EventRow } from '../server/src/db.js';
import type { TelegramStatus } from '../server/src/shared/types.js';
import {
  activeTokens,
  announceableSession,
  Announcer,
  daySessions,
  MODES,
  renderDigest,
  renderMoved,
  type Trigger,
  dueSessions,
  escapeHtml,
  groupByStart,
  modeOf,
  parseCommand,
  parseTriggers,
  Poller,
  renderUpNext,
  resolveToken,
  type Sender,
  type TelegramMessage,
} from '../server/src/telegram.js';
import {
  DAY_ONE,
  actorWithRole,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';
import { checkTemplate } from '../server/src/shared/telegramTemplate.js';
import { localDate } from '../server/src/shared/time.js';

const TOKEN = 'test-token';

/** Collects what would have been sent, so nothing here touches the network. */
function recorder(): { sent: TelegramMessage[]; send: Sender } {
  const sent: TelegramMessage[] = [];
  return {
    sent,
    send: async (_token: string, message: TelegramMessage) => {
      sent.push(message);
    },
  };
}

const eventRow = (db: Db, id: number): EventRow =>
  db.prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?').get(id)!;

describe('escaping', () => {
  it('escapes the three characters Telegram HTML reserves, and nothing else', () => {
    expect(escapeHtml('Tabs & <spaces> "quoted"')).toBe('Tabs &amp; &lt;spaces&gt; "quoted"');
  });

  it('escapes an ampersand before the entities it would otherwise break', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('modes', () => {
  it('derives the preset a trigger set matches, whatever the order', () => {
    expect(modeOf(['up_next'])).toBe('light');
    expect(modeOf(['up_next', 'digest', 'placed'])).toBe('medium');
    expect(modeOf(['changed', 'added', 'placed', 'up_next', 'digest'])).toBe('heavy');
    expect(modeOf([])).toBe('off');
  });

  it('names a preset only for triggers the announcer actually fires', () => {
    // Light meaning `digest` while the digest was unwritten made "one message
    // each morning" a setting whose whole effect was silence. Every trigger
    // named by a preset has to be one the tick or the write path acts on.
    const fired = new Set<Trigger>(['up_next', 'digest', 'added', 'changed', 'placed']);
    for (const triggers of Object.values(MODES))
      for (const trigger of triggers) expect(fired.has(trigger)).toBe(true);
  });

  it('puts the per-slot message on the quietest rung, so the stored default has a name', () => {
    // Migration 023 defaults an event to ["up_next"]. If that matched no
    // preset, every panel opened on "Custom" — a state nobody picked.
    expect(MODES.light).toEqual(['up_next']);
    expect(modeOf(parseTriggers('["up_next"]'))).toBe('light');
  });

  it('calls an unmatched set custom rather than mislabelling it', () => {
    expect(modeOf(['digest'])).toBe('custom');
    expect(modeOf(['digest', 'added'])).toBe('custom');
  });

  it('drops anything unrecognised out of stored JSON', () => {
    expect(parseTriggers('["up_next","nonsense"]')).toEqual(['up_next']);
    expect(parseTriggers('not json')).toEqual([]);
    expect(parseTriggers(null)).toEqual([]);
  });
});

describe('a command as it arrives in a group', () => {
  it('strips the @BotName Telegram adds when more than one bot is present', () => {
    expect(parseCommand('/bind@LibreSeshBot abc123')).toEqual({
      command: '/bind',
      args: ['abc123'],
    });
  });

  it('reads a bare command, and ignores ordinary conversation', () => {
    expect(parseCommand('/next')).toEqual({ command: '/next', args: [] });
    expect(parseCommand('what is on next?')).toBeNull();
  });
});

describe('rendering a slot', () => {
  const items = [
    {
      id: 1,
      startsAt: at(DAY_ONE, 600),
      title: 'Scaling <an> unconference',
      room: 'Main Hall',
      track: 'Practice',
      speakers: ['Ada Lovelace'],
      format: 'Workshop',
      tags: ['facilitation', 'open space'],
      livestreams: [{ label: 'Main camera', url: 'https://stream.example/main' }],
    },
    {
      id: 2,
      startsAt: at(DAY_ONE, 600),
      title: 'Hallway track',
      room: 'Room 2',
      track: '',
      speakers: ['Grace Hopper', 'Alan Turing'],
      format: '',
      tags: [],
      livestreams: [],
    },
  ];
  const startsAt = new Date(at(DAY_ONE, 600));

  it('puts every room of one start time in a single message', () => {
    const [text, ...rest] = renderUpNext(startsAt, 'Europe/Berlin', items, () => null);
    expect(rest).toEqual([]);
    expect(text).toContain('10:00');
    expect(text).toContain('Scaling &lt;an&gt; unconference');
    expect(text).toContain('Hallway track');
  });

  it('is the title and its speakers when nobody has written a line', () => {
    const [text] = renderUpNext(startsAt, 'Europe/Berlin', items, () => null);
    expect(text).toContain('<b>Scaling &lt;an&gt; unconference</b>, by Ada Lovelace');
    expect(text.split('\n').filter((l) => l.trim() !== '')).toHaveLength(3);
  });

  it('puts the organiser’s own words around the values', () => {
    // The whole point: this is their sentence, not ours with their words in it.
    const [text] = renderUpNext(
      startsAt,
      'Europe/Berlin',
      items,
      () => null,
      'Annnoooounciiiiiing: {title}!',
    );
    expect(text).toContain('Annnoooounciiiiiing: <b>Scaling &lt;an&gt; unconference</b>!');
  });

  it('fills every placeholder it knows', () => {
    const [text] = renderUpNext(
      startsAt,
      'Europe/Berlin',
      items,
      () => null,
      '{time} {room} {track} {title} {speakers} {format} {tags}',
    );
    expect(text).toContain(
      '10:00 Main Hall Practice <b>Scaling &lt;an&gt; unconference</b> ' +
        'Ada Lovelace Workshop #facilitation #openspace',
    );
  });

  it('drops a bracketed part whose values are all empty', () => {
    // "Hallway track, by " is the failure a plain placeholder string cannot
    // avoid, and the only reason the brackets exist.
    const [text] = renderUpNext(
      startsAt,
      'Europe/Berlin',
      items,
      () => null,
      '{title}[ · {format}]',
    );
    expect(text).toContain('<b>Scaling &lt;an&gt; unconference</b> · Workshop');
    expect(text).toContain('<b>Hallway track</b>');
    expect(text).not.toContain('Hallway track</b> · ');
  });

  it('keeps a bracketed part when any one of its values is there', () => {
    const [text] = renderUpNext(
      startsAt,
      'Europe/Berlin',
      items,
      () => null,
      '{title}[ ({format}{tags})]',
    );
    expect(text).toContain('(Workshop#facilitation #openspace)');
  });

  it('treats everything outside the grammar as literal, and escapes it', () => {
    const [text] = renderUpNext(startsAt, 'Europe/Berlin', items, () => null, '<b>{title}</b>');
    expect(text).toContain('&lt;b&gt;<b>Scaling &lt;an&gt; unconference</b>&lt;/b&gt;');
  });

  it('refuses a template it cannot render, when it is saved and not when it is sent', () => {
    expect(checkTemplate('{title}')).toBeNull();
    expect(checkTemplate('{title}[, by {speakers}]')).toBeNull();
    expect(checkTemplate('{tilte}')).toEqual({ code: 'unknown_placeholder', name: 'tilte' });
    expect(checkTemplate('{title}[, by {speakers}')).toEqual({ code: 'unbalanced' });
    expect(checkTemplate('{title}]')).toEqual({ code: 'unbalanced' });
    expect(checkTemplate('x'.repeat(501))).toEqual({ code: 'too_long' });
  });

  it('splits on a session boundary rather than letting Telegram refuse it', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: i,
      startsAt: at(DAY_ONE, 600),
      title: `A session with a fairly long title, number ${i}`.repeat(2),
      room: `Room ${i}`,
      track: '',
      speakers: ['Someone With A Name'],
      format: '',
      tags: [],
      livestreams: [],
    }));
    const texts = renderUpNext(startsAt, 'Europe/Berlin', many, () => null);
    expect(texts.length).toBeGreaterThan(1);
    for (const text of texts) expect(text.length).toBeLessThanOrEqual(4096);
    expect(texts[1]).toContain('continued');
  });
});

describe('which sessions are due', () => {
  let harness: Harness;
  let admin: Agent;
  let eventId: number;
  let roomId: number;

  beforeEach(async () => {
    harness = makeHarness({ telegramBotToken: TOKEN, publicUrl: 'https://s.example' });
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { name: 'Main Hall' });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    harness.db
      .prepare(
        "UPDATE events SET telegram_chat_id = '-100123', telegram_lead_min = 15 WHERE id = ?",
      )
      .run(eventId);
  });
  afterEach(() => harness.close());

  const makeSession = async (title: string, startMin: number, extra: object = {}) =>
    (
      await admin
        .post('/api/e/testconf/sessions')
        .send({
          roomId,
          title,
          startsAt: at(DAY_ONE, startMin),
          endsAt: at(DAY_ONE, startMin + 30),
          ...extra,
        })
        .expect(201)
    ).body as { id: number };

  it('takes a session inside the lead window and not one beyond it', async () => {
    await makeSession('Soon', 600);
    await makeSession('Later', 700);
    const due = dueSessions(harness.db, eventRow(harness.db, eventId), new Date(at(DAY_ONE, 590)));
    expect(due.map((s) => s.title)).toEqual(['Soon']);
  });

  it('takes a session created inside its own window — the short-notice pitch', async () => {
    // The window opened at 09:45; the session is created at 09:50 for 10:00.
    await makeSession('Placed late', 600);
    const due = dueSessions(harness.db, eventRow(harness.db, eventId), new Date(at(DAY_ONE, 590)));
    expect(due.map((s) => s.title)).toEqual(['Placed late']);
  });

  it('drops a session that has already started', async () => {
    await makeSession('Running', 600);
    const due = dueSessions(harness.db, eventRow(harness.db, eventId), new Date(at(DAY_ONE, 605)));
    expect(due).toEqual([]);
  });

  it('never takes a draft', async () => {
    await makeSession('Hidden', 600, { draft: true });
    const due = dueSessions(harness.db, eventRow(harness.db, eventId), new Date(at(DAY_ONE, 590)));
    expect(due).toEqual([]);
  });

  it('never takes a deleted session', async () => {
    const session = await makeSession('Cancelled', 600);
    await admin.delete(`/api/e/testconf/sessions/${session.id}`).expect(204);
    const due = dueSessions(harness.db, eventRow(harness.db, eventId), new Date(at(DAY_ONE, 590)));
    expect(due).toEqual([]);
  });

  it('groups every room of one start time together', async () => {
    const second = seedRoom(harness.db, eventId, { name: 'Room 2' });
    await makeSession('One', 600);
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId: second,
        title: 'Two',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 630),
      })
      .expect(201);
    const due = dueSessions(harness.db, eventRow(harness.db, eventId), new Date(at(DAY_ONE, 590)));
    expect(groupByStart(due).size).toBe(1);
  });
});

describe('the announcer', () => {
  let harness: Harness;
  let admin: Agent;
  let eventId: number;
  let roomId: number;

  beforeEach(async () => {
    harness = makeHarness({ telegramBotToken: TOKEN, publicUrl: 'https://s.example' });
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { name: 'Main Hall' });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    harness.db
      .prepare(
        `UPDATE events SET telegram_chat_id = '-100123', telegram_lead_min = 15,
                           telegram_triggers = '["up_next","digest"]' WHERE id = ?`,
      )
      .run(eventId);
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Scaling an unconference',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 630),
      })
      .expect(201);
  });
  afterEach(() => harness.close());

  it('announces a slot once and never again', async () => {
    const { sent, send } = recorder();
    const announcer = new Announcer(harness.db, TOKEN, 'https://s.example', send);
    await announcer.tick(new Date(at(DAY_ONE, 590)));
    await announcer.tick(new Date(at(DAY_ONE, 591)));
    await announcer.tick(new Date(at(DAY_ONE, 592)));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe('-100123');
    expect(sent[0]!.text).toContain('Scaling an unconference');
  });

  it('marks a slot before sending, so a failed send cannot repost it', async () => {
    const announcer = new Announcer(harness.db, TOKEN, null, async () => {
      throw new Error('Telegram is having a bad day');
    });
    await announcer.tick(new Date(at(DAY_ONE, 590)));
    expect(announcer.hasSent(eventId, at(DAY_ONE, 600))).toBe(true);
  });

  it('survives a throwing sender without breaking the tick', async () => {
    const announcer = new Announcer(harness.db, TOKEN, null, async () => {
      throw new Error('nope');
    });
    await expect(announcer.tick(new Date(at(DAY_ONE, 590)))).resolves.toBeUndefined();
  });

  it('says nothing for an event whose triggers do not include up_next', async () => {
    harness.db
      .prepare(`UPDATE events SET telegram_triggers = '["digest"]' WHERE id = ?`)
      .run(eventId);
    const { sent, send } = recorder();
    await new Announcer(harness.db, TOKEN, null, send).tick(new Date(at(DAY_ONE, 590)));
    expect(sent).toEqual([]);
  });

  it('says nothing for an archived event', async () => {
    harness.db.prepare('UPDATE events SET archived = 1 WHERE id = ?').run(eventId);
    const { sent, send } = recorder();
    await new Announcer(harness.db, TOKEN, null, send).tick(new Date(at(DAY_ONE, 590)));
    expect(sent).toEqual([]);
  });

  it('says nothing for an event with no group bound', async () => {
    harness.db.prepare('UPDATE events SET telegram_chat_id = NULL WHERE id = ?').run(eventId);
    const { sent, send } = recorder();
    await new Announcer(harness.db, TOKEN, null, send).tick(new Date(at(DAY_ONE, 590)));
    expect(sent).toEqual([]);
  });
});

describe('the morning digest', () => {
  let harness: Harness;
  let admin: Agent;
  let eventId: number;
  let roomId: number;

  const event = () => eventRow(harness.db, eventId);

  beforeEach(async () => {
    harness = makeHarness({ telegramBotToken: TOKEN, publicUrl: 'https://s.example' });
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { name: 'Main Hall' });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    harness.db
      .prepare(
        `UPDATE events SET telegram_chat_id = '-100123', telegram_digest_min = 480,
                           telegram_triggers = '["digest"]' WHERE id = ?`,
      )
      .run(eventId);
    for (const [title, minute] of [
      ['Scaling an unconference', 600],
      ['Hallway track', 690],
    ] as const) {
      await admin
        .post('/api/e/testconf/sessions')
        .send({ roomId, title, startsAt: at(DAY_ONE, minute), endsAt: at(DAY_ONE, minute + 30) })
        .expect(201);
    }
  });
  afterEach(() => harness.close());

  /** 08:15 at the venue on day one, comfortably inside the digest window. */
  const morning = (minute: number) => new Date(at(DAY_ONE, minute));

  it('takes the whole day, not one slot', () => {
    const rows = daySessions(harness.db, event(), localDate(morning(490), event().timezone));
    expect(rows).toHaveLength(2);
  });

  it('goes out once a day, at the hour the event chose', async () => {
    const { sent, send } = recorder();
    const a = new Announcer(harness.db, TOKEN, 'https://s.example', send);
    await a.tick(morning(490));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('📋');
    expect(sent[0]!.text).toContain('Scaling an unconference');
    expect(sent[0]!.text).toContain('Hallway track');
    // Same day, later: already said.
    await a.tick(morning(500));
    expect(sent).toHaveLength(1);
  });

  it('stays quiet before its hour', async () => {
    const { sent, send } = recorder();
    await new Announcer(harness.db, TOKEN, 'https://s.example', send).tick(morning(470));
    expect(sent).toEqual([]);
  });

  it('skips the day rather than announcing a morning that is over', async () => {
    // A process restarted at 14:00 must not open with "today's programme".
    const { sent, send } = recorder();
    await new Announcer(harness.db, TOKEN, 'https://s.example', send).tick(morning(840));
    expect(sent).toEqual([]);
  });

  it('says nothing on a day with nothing on it', async () => {
    harness.db.prepare('UPDATE sessions SET draft = 1 WHERE event_id = ?').run(eventId);
    const { sent, send } = recorder();
    await new Announcer(harness.db, TOKEN, 'https://s.example', send).tick(morning(490));
    expect(sent).toEqual([]);
  });

  it('renders one line a session, with no speakers and no stream links', () => {
    const [text] = renderDigest(
      new Date(at(DAY_ONE, 600)),
      'Europe/Berlin',
      [
        {
          id: 1,
          startsAt: at(DAY_ONE, 600),
          title: 'Scaling an unconference',
          room: 'Main Hall',
          track: '',
          speakers: ['Ada Lovelace'],
          format: '',
          tags: [],
          livestreams: [{ label: 'Main camera', url: 'https://stream.example/main' }],
          startsAt: at(DAY_ONE, 600),
        },
      ],
      () => null,
    );
    expect(text).toContain('10:00 · Main Hall — Scaling an unconference');
    expect(text).not.toContain('Ada Lovelace');
    expect(text).not.toContain('stream.example');
  });
});

describe('a session added and a session moved', () => {
  let harness: Harness;
  let admin: Agent;
  let eventId: number;
  let roomId: number;

  const event = () => eventRow(harness.db, eventId);

  beforeEach(async () => {
    harness = makeHarness({ telegramBotToken: TOKEN, publicUrl: 'https://s.example' });
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { name: 'Main Hall' });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    harness.db
      .prepare(
        `UPDATE events SET telegram_chat_id = '-100123', telegram_lead_min = 15,
                           telegram_triggers = '["up_next","digest","added","changed","placed"]'
          WHERE id = ?`,
      )
      .run(eventId);
  });
  afterEach(() => harness.close());

  const addSession = async (minute: number, title = 'A late pitch') => {
    const res = await admin
      .post('/api/e/testconf/sessions')
      .send({ roomId, title, startsAt: at(DAY_ONE, minute), endsAt: at(DAY_ONE, minute + 30) })
      .expect(201);
    return (res.body as { id: number }).id;
  };

  it('names a session that has just appeared', async () => {
    const id = await addSession(600);
    const { sent, send } = recorder();
    const a = new Announcer(harness.db, TOKEN, 'https://s.example', send);
    await a.announceAdded(event(), id, new Date(at(DAY_ONE, 480)));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Just added');
    expect(sent[0]!.text).toContain('A late pitch');
  });

  it('never announces a draft as added', async () => {
    const res = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Secret plans',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 630),
        draft: true,
      })
      .expect(201);
    const id = (res.body as { id: number }).id;
    expect(announceableSession(harness.db, event(), id)).toBeNull();
    const { sent, send } = recorder();
    const a = new Announcer(harness.db, TOKEN, 'https://s.example', send);
    await a.announceAdded(event(), id, new Date(at(DAY_ONE, 480)));
    expect(sent).toEqual([]);
  });

  it('a session added inside the lead window becomes that slot, said once', async () => {
    // The pitch placed at 13:40 to run at 13:45 — the case the feature is for.
    // Two messages seconds apart saying the same thing is the failure here.
    await addSession(600, 'Already on the grid');
    const late = await addSession(600, 'Squeezed in');
    const { sent, send } = recorder();
    const a = new Announcer(harness.db, TOKEN, 'https://s.example', send);

    const now = new Date(at(DAY_ONE, 590));
    await a.announceAdded(event(), late, now);
    expect(sent).toHaveLength(1);
    // The whole slot, so the room that was already there is not hidden by the
    // suppression this performs.
    expect(sent[0]!.text).toContain('up next');
    expect(sent[0]!.text).toContain('Already on the grid');
    expect(sent[0]!.text).toContain('Squeezed in');

    await a.tick(now);
    expect(sent).toHaveLength(1);
  });

  it('a session added after its slot went out is still named, without repeating the slot', async () => {
    // The 13:50 slot was announced at 13:35; a pitch lands in it at 13:47.
    // The slot must not go out twice — but silence here is the one failure
    // the feature exists to prevent.
    await addSession(600, 'Already on the grid');
    const { sent, send } = recorder();
    const a = new Announcer(harness.db, TOKEN, 'https://s.example', send);
    await a.tick(new Date(at(DAY_ONE, 586)));
    expect(sent).toHaveLength(1);

    const late = await addSession(600, 'Squeezed in');
    await a.announceAdded(event(), late, new Date(at(DAY_ONE, 597)), true);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toContain('Just pitched');
    expect(sent[1]!.text).toContain('Squeezed in');
    expect(sent[1]!.text).not.toContain('Already on the grid');

    // And a later tick does not say the slot again.
    await a.tick(new Date(at(DAY_ONE, 598)));
    expect(sent).toHaveLength(2);
  });

  it('holds a move for the tick, and sends one message for a reshuffle', async () => {
    const first = await addSession(600, 'First');
    const second = await addSession(660, 'Second');
    const { sent, send } = recorder();
    const a = new Announcer(harness.db, TOKEN, 'https://s.example', send);

    // Announced, so a correction about them is owed to the group.
    await a.announceAdded(event(), first, new Date(at(DAY_ONE, 400)));
    await a.announceAdded(event(), second, new Date(at(DAY_ONE, 400)));
    sent.length = 0;

    a.noteMoved(event(), first);
    a.noteMoved(event(), second);
    a.noteMoved(event(), first);
    expect(sent).toEqual([]);

    await a.tick(new Date(at(DAY_ONE, 400)));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Moved on the schedule');
    expect(sent[0]!.text).toContain('First');
    expect(sent[0]!.text).toContain('Second');
  });

  it('announces a pitch as it reaches the grid, and calls it a pitch', async () => {
    // U5, and the case the whole feature exists for. `POST /proposals/:id/place`
    // builds its own session rather than going through `POST /sessions`, so for
    // a while it announced nothing at all however loud the setting was.
    const id = await addSession(600, 'From the board');
    const { sent, send } = recorder();
    const a = new Announcer(harness.db, TOKEN, 'https://s.example', send);
    await a.announceAdded(event(), id, new Date(at(DAY_ONE, 400)), true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Just pitched');
    expect(sent[0]!.text).not.toContain('Just added');
  });

  it('separates the two: an event may hear pitches and not every session added', async () => {
    harness.db
      .prepare(`UPDATE events SET telegram_triggers = '["up_next","placed"]' WHERE id = ?`)
      .run(eventId);
    const id = await addSession(600);
    const { sent, send } = recorder();
    const a = new Announcer(harness.db, TOKEN, 'https://s.example', send);

    await a.announceAdded(event(), id, new Date(at(DAY_ONE, 400)), false);
    expect(sent).toEqual([]);

    await a.announceAdded(event(), id, new Date(at(DAY_ONE, 400)), true);
    expect(sent).toHaveLength(1);
  });

  it('places a pitch through the route and the group hears about it', async () => {
    harness.db
      .prepare(`UPDATE events SET telegram_triggers = '["placed"]' WHERE id = ?`)
      .run(eventId);
    const posted: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request, init?) => {
      posted.push(String((init?.body as string) ?? ''));
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, result: {} }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    });

    const pitch = await admin
      .post('/api/e/testconf/proposals')
      .send({ title: 'Repair café', description: '' })
      .expect(201);
    await admin
      .post(`/api/e/testconf/proposals/${(pitch.body as { id: number }).id}/place`)
      .send({ roomId, startsAt: at(DAY_ONE, 600), endsAt: at(DAY_ONE, 660) })
      .expect(201);

    // The route detaches the send, so it lands a turn after the response.
    await new Promise((r) => setTimeout(r, 0));
    expect(posted.some((body) => body.includes('Just pitched'))).toBe(true);
    vi.restoreAllMocks();
  });

  it('says nothing about a move of a session the group never heard of', async () => {
    const id = await addSession(600);
    const { sent, send } = recorder();
    const a = new Announcer(harness.db, TOKEN, 'https://s.example', send);
    a.noteMoved(event(), id);
    await a.tick(new Date(at(DAY_ONE, 400)));
    // Announcing the move would disclose a session that was never announced.
    expect(sent).toEqual([]);
  });

  it('renders a move as one line a session', () => {
    const text = renderMoved(
      'Europe/Berlin',
      [
        {
          id: 1,
          startsAt: at(DAY_ONE, 600),
          title: 'First',
          room: 'Main Hall',
          track: '',
          speakers: [],
          format: '',
          tags: [],
          livestreams: [],
          startsAt: at(DAY_ONE, 600),
        },
      ],
      () => null,
    );
    expect(text).toContain('🔄');
    expect(text).toContain('10:00 · Main Hall — First');
  });
});

describe('the Telegram settings routes', () => {
  let harness: Harness;
  let admin: Agent;
  let eventId: number;

  beforeEach(async () => {
    harness = makeHarness({ telegramBotToken: TOKEN });
    eventId = seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  it('is admin-only', async () => {
    const viewer = await actorWithRole(harness, 'testconf', 'viewer-pw');
    await viewer.get('/api/e/testconf/telegram').expect(403);
    await viewer.post('/api/e/testconf/telegram/code').expect(403);
  });

  it('reports the instance has a bot, and that no group is connected yet', async () => {
    const body = (await admin.get('/api/e/testconf/telegram').expect(200)).body as {
      available: boolean;
      connected: boolean;
      mode: string;
      livestreams: boolean;
    };
    expect(body.available).toBe(true);
    expect(body.connected).toBe(false);
    // The migration's default is a preset with a name, not an unnameable set.
    expect(body.mode).toBe('light');
  });

  it('mints a bind code that expires', async () => {
    const body = (await admin.post('/api/e/testconf/telegram/code').expect(200)).body as {
      bindCode: string;
      bindExpires: string;
    };
    expect(body.bindCode).toMatch(/^[0-9a-f]{10}$/);
    expect(new Date(body.bindExpires).getTime()).toBeGreaterThan(Date.now());
  });

  it('sets the mode by name and refuses one it does not know', async () => {
    const body = (await admin.patch('/api/e/testconf/telegram').send({ mode: 'heavy' }).expect(200))
      .body as { mode: string; triggers: string[] };
    expect(body.mode).toBe('heavy');
    expect(body.triggers.sort()).toEqual(['added', 'changed', 'digest', 'placed', 'up_next']);
    await admin.patch('/api/e/testconf/telegram').send({ mode: 'deafening' }).expect(400);
  });

  it('takes a digest time as a local minute of day, and refuses one off the clock', async () => {
    const body = (
      await admin.patch('/api/e/testconf/telegram').send({ digestMin: 450 }).expect(200)
    ).body as { digestMin: number };
    expect(body.digestMin).toBe(450);
    await admin.patch('/api/e/testconf/telegram').send({ digestMin: 1440 }).expect(400);
    await admin.patch('/api/e/testconf/telegram').send({ digestMin: -1 }).expect(400);
  });

  it('starts at the line nobody wrote, which is the one it always sent', async () => {
    const before = (await admin.get('/api/e/testconf/telegram').expect(200)).body as {
      template: string;
    };
    expect(before.template).toBe('{title}[, by {speakers}]');
  });

  it('stores a line of the organiser’s own, and refuses one it cannot render', async () => {
    const body = (
      await admin
        .patch('/api/e/testconf/telegram')
        .send({ template: 'Annnoooounciiiiiing: {title}!' })
        .expect(200)
    ).body as { template: string };
    expect(body.template).toBe('Annnoooounciiiiiing: {title}!');

    // Refused on save, with the reason as a code the client turns into English.
    const bad = (
      await admin.patch('/api/e/testconf/telegram').send({ template: '{tilte}' }).expect(400)
    ).body as { error: { code: string; details?: { name?: string } } };
    expect(bad.error.code).toBe('template_unknown_placeholder');
    expect(bad.error.details?.name).toBe('tilte');

    await admin
      .patch('/api/e/testconf/telegram')
      .send({ template: '{title}[, by {speakers}' })
      .expect(400);

    // And the refusal changed nothing.
    const after = (await admin.get('/api/e/testconf/telegram').expect(200)).body as {
      template: string;
    };
    expect(after.template).toBe('Annnoooounciiiiiing: {title}!');
  });

  it('sets the mode by name and refuses one it does not know', async () => {
    const body = (await admin.patch('/api/e/testconf/telegram').send({ mode: 'heavy' }).expect(200))
      .body as { mode: string; triggers: string[] };
    expect(body.mode).toBe('heavy');
    expect(body.triggers.sort()).toEqual(['added', 'changed', 'digest', 'placed', 'up_next']);
    await admin.patch('/api/e/testconf/telegram').send({ mode: 'deafening' }).expect(400);
  });

  it('takes a digest time as a local minute of day, and refuses one off the clock', async () => {
    const body = (
      await admin.patch('/api/e/testconf/telegram').send({ digestMin: 450 }).expect(200)
    ).body as { digestMin: number };
    expect(body.digestMin).toBe(450);
    await admin.patch('/api/e/testconf/telegram').send({ digestMin: 1440 }).expect(400);
    await admin.patch('/api/e/testconf/telegram').send({ digestMin: -1 }).expect(400);
  });

  it('refuses a lead time outside the sane range', async () => {
    await admin.patch('/api/e/testconf/telegram').send({ leadMin: 0 }).expect(400);
    await admin.patch('/api/e/testconf/telegram').send({ leadMin: 999 }).expect(400);
    await admin.patch('/api/e/testconf/telegram').send({ leadMin: 30 }).expect(200);
  });

  it('disconnecting clears the group and any pending code', async () => {
    harness.db.prepare("UPDATE events SET telegram_chat_id = '-100123' WHERE id = ?").run(eventId);
    const body = (await admin.delete('/api/e/testconf/telegram').expect(200)).body as {
      connected: boolean;
      bindCode: string | null;
    };
    expect(body.connected).toBe(false);
    expect(body.bindCode).toBeNull();
  });

  it('refuses a test message when no group is connected', async () => {
    await admin.post('/api/e/testconf/telegram/test').expect(400);
  });

  it('hands Telegram’s own refusal back in the shape the client parses', async () => {
    // The whole point of the button. Answered as `{ error: '<prose>' }` it
    // reached the client as an unknown code and read "Something went wrong",
    // which is the one thing that is no help at 09:45 on day one.
    harness.db.prepare("UPDATE events SET telegram_chat_id = '-100123' WHERE id = ?").run(eventId);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: false, description: 'bot was kicked from the group chat' }),
        {
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const body = (await admin.post('/api/e/testconf/telegram/test').expect(502)).body as {
      error: { code: string; details?: { reason?: string } };
    };
    expect(body.error.code).toBe('telegram_refused');
    expect(body.error.details?.reason).toBe('bot was kicked from the group chat');
    vi.restoreAllMocks();
  });
});

describe('an event that brings its own bot', () => {
  const OWN = '987654321:AA-a-token-long-enough-to-pass';
  let harness: Harness;
  let admin: Agent;
  let eventId: number;

  beforeEach(async () => {
    // No instance token: the whole point is that an organiser needs nobody.
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  const setToken = (botToken: string | null) =>
    admin.patch('/api/e/testconf/telegram').send({ botToken });

  it('lets an organiser turn Telegram on with no help from the operator', async () => {
    const body = (await setToken(OWN).expect(200)).body as TelegramStatus;
    expect(body.available).toBe(true);
    expect(body.ownBot).toBe(true);
    expect(body.instanceBot).toBe(false);
  });

  it('never sends the token back, only enough to recognise it', async () => {
    const res = await setToken(OWN).expect(200);
    expect(JSON.stringify(res.body)).not.toContain(OWN);
    expect((res.body as TelegramStatus).ownBotHint).toBe('…pass');
  });

  it('refuses something that is plainly not a token', async () => {
    await setToken('hunter2').expect(400);
    await setToken('123:short').expect(400);
  });

  it('clearing it falls back to nothing when the instance has no bot', async () => {
    await setToken(OWN).expect(200);
    const body = (await setToken(null).expect(200)).body as TelegramStatus;
    expect(body.ownBot).toBe(false);
    expect(body.available).toBe(false);
  });

  it('changing the bot drops the binding, because the new bot is not in that group', async () => {
    await setToken(OWN).expect(200);
    harness.db.prepare("UPDATE events SET telegram_chat_id = '-100123' WHERE id = ?").run(eventId);
    const body = (await setToken('111111111:BB-another-token-long-enough').expect(200))
      .body as TelegramStatus;
    expect(body.connected).toBe(false);
  });

  it('announces through its own bot, not the instance one', async () => {
    await setToken(OWN).expect(200);
    const roomId = seedRoom(harness.db, eventId, { name: 'Main Hall' });
    harness.db
      .prepare(
        `UPDATE events SET telegram_chat_id = '-100999', telegram_triggers = '["up_next"]',
                           telegram_lead_min = 15 WHERE id = ?`,
      )
      .run(eventId);
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Own bot session',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 630),
      })
      .expect(201);

    const seen: string[] = [];
    const announcer = new Announcer(harness.db, 'instance-token', null, async (token) => {
      seen.push(token);
    });
    await announcer.tick(new Date(at(DAY_ONE, 590)));
    expect(seen).toEqual([OWN]);
  });

  it('is one poller per distinct bot, and none when there are none', () => {
    expect(activeTokens(harness.db, null)).toEqual([]);
    harness.db.prepare('UPDATE events SET telegram_bot_token = ? WHERE id = ?').run(OWN, eventId);
    expect(activeTokens(harness.db, null)).toEqual([OWN]);
    // The instance bot is only listened to once somebody is actually using it.
    expect(activeTokens(harness.db, 'instance-token')).toEqual([OWN]);
    seedEvent(harness.db, { slug: 'second' });
    expect(activeTokens(harness.db, 'instance-token').sort()).toEqual(
      [OWN, 'instance-token'].sort(),
    );
  });

  it('resolves the event bot ahead of the instance one', () => {
    const event = eventRow(harness.db, eventId);
    expect(resolveToken(event, 'instance-token')).toBe('instance-token');
    expect(resolveToken({ ...event, telegram_bot_token: OWN }, 'instance-token')).toBe(OWN);
  });
});

describe('commands arriving in a group', () => {
  const OWN = '987654321:AA-a-token-long-enough-to-pass';
  const OTHER = '111111111:BB-another-token-long-enough';
  let harness: Harness;
  let eventId: number;

  const update = (text: string, chatId = -100123) => ({
    update_id: 1,
    message: { text, chat: { id: chatId, type: 'supergroup' } },
  });

  const row = () => eventRow(harness.db, eventId);

  beforeEach(() => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    harness.db.prepare('UPDATE events SET telegram_bot_token = ? WHERE id = ?').run(OWN, eventId);
  });
  afterEach(() => harness.close());

  const pollerFor = (token: string) =>
    new Poller(
      harness.db,
      token,
      null,
      new Announcer(harness.db, null, null, async () => {}),
      async () => {},
    );

  const mintCode = (code: string, minutes = 15) =>
    harness.db
      .prepare('UPDATE events SET telegram_bind_code = ?, telegram_bind_expires = ? WHERE id = ?')
      .run(code, new Date(Date.now() + minutes * 60_000).toISOString(), eventId);

  it('binds the group the message came from, and spends the code', async () => {
    mintCode('abc123');
    await pollerFor(OWN).handle(update('/bind abc123'));
    expect(row().telegram_chat_id).toBe('-100123');
    expect(row().telegram_bind_code).toBeNull();
  });

  it('refuses a code that has expired', async () => {
    mintCode('abc123', -1);
    await pollerFor(OWN).handle(update('/bind abc123'));
    expect(row().telegram_chat_id).toBeNull();
  });

  it('refuses a code that is simply wrong', async () => {
    mintCode('abc123');
    await pollerFor(OWN).handle(update('/bind nope'));
    expect(row().telegram_chat_id).toBeNull();
  });

  it('will not let one event’s bot redeem another event’s code', async () => {
    mintCode('abc123');
    // A different bot, serving no event here, must not be able to bind this one.
    await pollerFor(OTHER).handle(update('/bind abc123'));
    expect(row().telegram_chat_id).toBeNull();
  });

  it('ignores a command from a group that was never bound', async () => {
    harness.db.prepare("UPDATE events SET telegram_chat_id = '-100999' WHERE id = ?").run(eventId);
    await pollerFor(OWN).handle(update('/unbind', -100123));
    expect(row().telegram_chat_id).toBe('-100999');
  });

  it('unbinds from the group itself', async () => {
    harness.db.prepare("UPDATE events SET telegram_chat_id = '-100123' WHERE id = ?").run(eventId);
    await pollerFor(OWN).handle(update('/unbind'));
    expect(row().telegram_chat_id).toBeNull();
  });

  it('will not bind an archived event, which is over', async () => {
    mintCode('abc123');
    harness.db.prepare('UPDATE events SET archived = 1 WHERE id = ?').run(eventId);
    await pollerFor(OWN).handle(update('/bind abc123'));
    expect(row().telegram_chat_id).toBeNull();
  });

  it('ignores ordinary conversation', async () => {
    mintCode('abc123');
    await pollerFor(OWN).handle(update('so what is on next then'));
    expect(row().telegram_chat_id).toBeNull();
  });
});

describe('an instance with no bot', () => {
  let harness: Harness;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  it('says so, rather than offering a form that cannot work', async () => {
    const body = (await admin.get('/api/e/testconf/telegram').expect(200)).body as {
      available: boolean;
    };
    expect(body.available).toBe(false);
  });

  it('refuses to mint a code', async () => {
    await admin.post('/api/e/testconf/telegram/code').expect(400);
  });
});
