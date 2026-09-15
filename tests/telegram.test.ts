import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db, EventRow } from '../server/src/db.js';
import {
  Announcer,
  dueSessions,
  escapeHtml,
  groupByStart,
  modeOf,
  parseCommand,
  parseTriggers,
  renderUpNext,
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
    expect(modeOf(['up_next', 'digest'])).toBe('medium');
    expect(modeOf(['digest'])).toBe('light');
    expect(modeOf([])).toBe('off');
  });

  it('calls an unmatched set custom rather than mislabelling it', () => {
    expect(modeOf(['up_next'])).toBe('custom');
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
    { id: 1, title: 'Scaling <an> unconference', room: 'Main Hall', speakers: ['Ada Lovelace'] },
    { id: 2, title: 'Hallway track', room: 'Room 2', speakers: ['Grace Hopper', 'Alan Turing'] },
  ];
  const startsAt = new Date(at(DAY_ONE, 600));

  it('puts every room of one start time in a single message', () => {
    const [text, ...rest] = renderUpNext(startsAt, 'Europe/Berlin', items, () => null);
    expect(rest).toEqual([]);
    expect(text).toContain('10:00');
    expect(text).toContain('Main Hall');
    expect(text).toContain('Room 2');
    expect(text).toContain('Grace Hopper, Alan Turing');
  });

  it('escapes a title rather than letting it become markup', () => {
    const [text] = renderUpNext(startsAt, 'Europe/Berlin', items, () => null);
    expect(text).toContain('Scaling &lt;an&gt; unconference');
    expect(text).not.toContain('<an>');
  });

  it('links the title when the instance knows its own address', () => {
    const [text] = renderUpNext(
      startsAt,
      'Europe/Berlin',
      items,
      (id) => `https://s.example/e/x/s/${id}`,
    );
    expect(text).toContain('<a href="https://s.example/e/x/s/1">');
  });

  it('renders in the event timezone, including a non-whole-hour offset', () => {
    const [berlin] = renderUpNext(startsAt, 'Europe/Berlin', items, () => null);
    const [kathmandu] = renderUpNext(startsAt, 'Asia/Kathmandu', items, () => null);
    expect(berlin).toContain('10:00');
    expect(kathmandu).toContain('13:45');
  });

  it('splits on a session boundary rather than letting Telegram refuse it', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      id: i,
      title: `A session with a fairly long title, number ${i}`.repeat(2),
      room: `Room ${i}`,
      speakers: ['Someone With A Name'],
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
    };
    expect(body.available).toBe(true);
    expect(body.connected).toBe(false);
    expect(body.mode).toBe('custom');
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
    const body = (
      await admin.patch('/api/e/testconf/telegram').send({ mode: 'medium' }).expect(200)
    ).body as { mode: string; triggers: string[] };
    expect(body.mode).toBe('medium');
    expect(body.triggers.sort()).toEqual(['digest', 'up_next']);
    await admin.patch('/api/e/testconf/telegram').send({ mode: 'deafening' }).expect(400);
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
