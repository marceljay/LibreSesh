import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventRow } from '../server/src/db.js';
import {
  Announcer,
  type Announcement,
  type Transport,
  type TransportName,
  type Trigger,
} from '../server/src/announcer.js';
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

/**
 * A transport that records what it was handed. The announcer is tested
 * through this, not through Telegram: the rules in announcements.md are
 * transport-neutral, and this is the proof that they live in the announcer.
 */
class FakeTransport implements Transport {
  readonly got: Announcement[] = [];
  triggers = new Set<Trigger>(['up_next', 'digest', 'added', 'changed', 'pitched', 'placed']);
  fail = false;
  constructor(
    readonly name: TransportName,
    private readonly leadMin = 15,
    private readonly digestMin = 480,
  ) {}
  enabled(_event: EventRow, trigger: Trigger): boolean {
    return this.triggers.has(trigger);
  }
  timing(): { leadMin: number; digestMin: number } {
    return { leadMin: this.leadMin, digestMin: this.digestMin };
  }
  async send(_event: EventRow, a: Announcement): Promise<void> {
    if (this.fail) throw new Error('down');
    this.got.push(a);
  }
  of(trigger: Trigger): Announcement[] {
    return this.got.filter((a) => a.trigger === trigger);
  }
}

describe('the announcer', () => {
  let h: Harness;
  let admin: Agent;
  let eventId: number;
  let roomId: number;
  const event = (): EventRow =>
    h.db.prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?').get(eventId)!;
  const when = (minute: number) => new Date(at(DAY_ONE, minute));

  beforeEach(async () => {
    h = makeHarness();
    eventId = seedEvent(h.db);
    roomId = seedRoom(h.db, eventId, { name: 'Main Hall' });
    admin = await actorWithRole(h, 'testconf', 'admin-pw');
  });
  afterEach(() => h.close());

  const addSession = async (minute: number, title = 'A session', extra = {}) => {
    const res = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title,
        startsAt: at(DAY_ONE, minute),
        endsAt: at(DAY_ONE, minute + 30),
        ...extra,
      })
      .expect(201);
    return (res.body as { id: number }).id;
  };

  it('announces a slot inside the window, once, and not at its edge only', async () => {
    await addSession(600);
    const t = new FakeTransport('telegram');
    const a = new Announcer(h.db, [t]);
    await a.tick(when(580)); // outside the 15-minute lead
    expect(t.got).toEqual([]);
    await a.tick(when(590));
    await a.tick(when(591));
    await a.tick(when(599));
    expect(t.of('up_next')).toHaveLength(1);
    expect(t.of('up_next')[0]!.at).toBe(at(DAY_ONE, 600));
    expect(a.wasSent('telegram', eventId, at(DAY_ONE, 600))).toBe(true);
  });

  it('groups a slot: five rooms at ten is one announcement', async () => {
    for (let i = 0; i < 5; i++) {
      const room = seedRoom(h.db, eventId, { name: `Room ${i}` });
      await admin
        .post('/api/e/testconf/sessions')
        .send({
          roomId: room,
          title: `S${i}`,
          startsAt: at(DAY_ONE, 600),
          endsAt: at(DAY_ONE, 630),
        })
        .expect(201);
    }
    const t = new FakeTransport('telegram');
    await new Announcer(h.db, [t]).tick(when(590));
    expect(t.got).toHaveLength(1);
    expect(t.got[0]!.sessions).toHaveLength(5);
  });

  it('marks before sending, so a failed send is not repeated', async () => {
    await addSession(600);
    const t = new FakeTransport('telegram');
    t.fail = true;
    const a = new Announcer(h.db, [t]);
    await expect(a.tick(when(590))).resolves.toBeUndefined();
    expect(a.wasSent('telegram', eventId, at(DAY_ONE, 600))).toBe(true);
    t.fail = false;
    await a.tick(when(591));
    expect(t.got).toEqual([]);
  });

  it('keeps transports apart: one failing or off does not silence the other', async () => {
    await addSession(600);
    const tg = new FakeTransport('telegram');
    const nostr = new FakeTransport('nostr');
    tg.fail = true;
    const a = new Announcer(h.db, [tg, nostr]);
    await a.tick(when(590));
    expect(nostr.of('up_next')).toHaveLength(1);
    expect(a.wasSent('nostr', eventId, at(DAY_ONE, 600))).toBe(true);

    tg.triggers.delete('up_next');
    nostr.got.length = 0;
    await addSession(700);
    await a.tick(when(690));
    expect(tg.got).toEqual([]);
    expect(nostr.of('up_next')).toHaveLength(1);
  });

  it('each transport has its own lead time', async () => {
    await addSession(600);
    const short = new FakeTransport('telegram', 5);
    const long = new FakeTransport('nostr', 30);
    const a = new Announcer(h.db, [short, long]);
    await a.tick(when(580));
    expect(short.got).toEqual([]);
    expect(long.of('up_next')).toHaveLength(1);
  });

  it('says nothing for drafts, deleted sessions and archived events', async () => {
    await addSession(600, 'Draft', { draft: true });
    const gone = await addSession(600, 'Gone');
    await admin.delete(`/api/e/testconf/sessions/${gone}`).expect(204);
    const t = new FakeTransport('telegram');
    const a = new Announcer(h.db, [t]);
    await a.tick(when(590));
    expect(t.got).toEqual([]);

    await addSession(700, 'Real');
    h.db.prepare('UPDATE events SET archived = 1 WHERE id = ?').run(eventId);
    await a.tick(when(690));
    expect(t.got).toEqual([]);
  });

  it('sends the digest once a day inside its window, and never an empty one', async () => {
    const t = new FakeTransport('telegram', 15, 480);
    const a = new Announcer(h.db, [t]);
    await a.tick(when(490));
    expect(t.of('digest')).toEqual([]); // nothing on the day

    // An empty day is marked as said, the same as a sent one: a fresh
    // announcer here, since the one above already spoke for the day.
    await addSession(600, 'One');
    await addSession(660, 'Two');
    const b = new Announcer(h.db, [t]);
    await b.tick(when(470)); // before the hour
    expect(t.of('digest')).toEqual([]);
    await b.tick(when(490));
    await b.tick(when(500));
    expect(t.of('digest')).toHaveLength(1);
    expect(t.of('digest')[0]!.sessions.map((s) => s.title)).toEqual(['One', 'Two']);

    const late = new FakeTransport('nostr', 15, 480);
    await new Announcer(h.db, [late]).tick(when(840)); // the window is long over
    expect(late.of('digest')).toEqual([]);
  });

  it('added names the session; placed carries the pitch', async () => {
    const id = await addSession(600, 'Late');
    const t = new FakeTransport('telegram');
    const a = new Announcer(h.db, [t]);
    await a.announceAdded(event(), id, when(480));
    expect(t.of('added')).toHaveLength(1);
    expect(t.of('added')[0]!.sessions[0]!.title).toBe('Late');
    expect(t.of('added')[0]!.proposal).toBeUndefined();

    const pitched = await admin
      .post('/api/e/testconf/proposals')
      .send({ title: 'Zines', description: 'Bring scissors' })
      .expect(201);
    const proposalId = (pitched.body as { id: number }).id;
    await a.announcePlaced(event(), proposalId, id, when(480));
    expect(t.of('placed')).toHaveLength(1);
    expect(t.of('placed')[0]!.proposal?.title).toBe('Zines');
  });

  it('added inside the lead window becomes the slot, said once', async () => {
    await addSession(600, 'Already there');
    const late = await addSession(600, 'Squeezed in');
    const t = new FakeTransport('telegram');
    const a = new Announcer(h.db, [t]);
    await a.announceAdded(event(), late, when(590));
    expect(t.of('added')).toEqual([]);
    expect(t.of('up_next')).toHaveLength(1);
    expect(t.of('up_next')[0]!.sessions.map((s) => s.title)).toEqual([
      'Already there',
      'Squeezed in',
    ]);
    await a.tick(when(590));
    expect(t.got).toHaveLength(1);
  });

  it('added is not announced when the transport has it off', async () => {
    const id = await addSession(600);
    const t = new FakeTransport('telegram');
    t.triggers.delete('added');
    await new Announcer(h.db, [t]).announceAdded(event(), id, when(480));
    expect(t.got).toEqual([]);
  });

  it('coalesces moves over a tick, and only for announced sessions', async () => {
    const first = await addSession(600, 'First');
    const second = await addSession(660, 'Second');
    const unknown = await addSession(720, 'Unknown');
    const t = new FakeTransport('telegram');
    const a = new Announcer(h.db, [t]);
    await a.announceAdded(event(), first, when(400));
    await a.announceAdded(event(), second, when(400));
    t.got.length = 0;

    a.noteMoved(event(), first);
    a.noteMoved(event(), second);
    a.noteMoved(event(), first);
    a.noteMoved(event(), unknown);
    expect(t.got).toEqual([]);
    await a.tick(when(400));
    expect(t.of('changed')).toHaveLength(1);
    expect(t.of('changed')[0]!.sessions.map((s) => s.title)).toEqual(['First', 'Second']);
    await a.tick(when(401));
    expect(t.of('changed')).toHaveLength(1);
  });

  it('a move is owed only by the transport that announced the session', async () => {
    const id = await addSession(600, 'Only Telegram heard');
    const tg = new FakeTransport('telegram');
    const nostr = new FakeTransport('nostr');
    nostr.triggers.delete('added');
    const a = new Announcer(h.db, [tg, nostr]);
    await a.announceAdded(event(), id, when(400));
    a.noteMoved(event(), id);
    await a.tick(when(400));
    expect(tg.of('changed')).toHaveLength(1);
    expect(nostr.of('changed')).toEqual([]);
  });

  it('pitched hands the pitch to every transport with the trigger on', async () => {
    const res = await admin
      .post('/api/e/testconf/proposals')
      .send({ title: 'Zines', description: 'Bring scissors' })
      .expect(201);
    const proposalId = (res.body as { id: number }).id;
    const tg = new FakeTransport('telegram');
    const nostr = new FakeTransport('nostr');
    tg.triggers.delete('pitched');
    await new Announcer(h.db, [tg, nostr]).announcePitched(event(), proposalId, when(400));
    expect(tg.got).toEqual([]);
    expect(nostr.of('pitched')).toHaveLength(1);
    expect(nostr.of('pitched')[0]!.proposal?.title).toBe('Zines');
    expect(nostr.of('pitched')[0]!.sessions).toEqual([]);
  });

  it('the routes call it: a pitch, and placing it', async () => {
    const t = new FakeTransport('telegram');
    h.app.ctx.announcer = new Announcer(h.db, [t]);
    const res = await admin
      .post('/api/e/testconf/proposals')
      .send({ title: 'Zines', description: 'Bring scissors' })
      .expect(201);
    const proposalId = (res.body as { id: number }).id;
    await new Promise((r) => setImmediate(r));
    expect(t.of('pitched')).toHaveLength(1);
    await admin
      .post(`/api/e/testconf/proposals/${proposalId}/place`)
      .send({ roomId, startsAt: at(DAY_ONE, 600), endsAt: at(DAY_ONE, 630) })
      .expect(201);
    await new Promise((r) => setImmediate(r));
    expect(t.of('placed')).toHaveLength(1);
    expect(t.of('placed')[0]!.proposal?.id).toBe(proposalId);
  });
});
