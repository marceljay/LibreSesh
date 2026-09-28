import { describe, expect, it } from 'vitest';
import type { SessionDto } from '../server/src/shared/types.js';
import { encryptEventKey, generateKeys } from '../server/src/nostr/keys.js';
import { markDirty, syncTick, type Pool } from '../server/src/nostr/queue.js';
import { DAY_ONE, actorWithRole, at, makeHarness, seedEvent, seedRoom } from './helpers.js';

const okPool: Pool = { publish: (relays) => relays.map(() => Promise.resolve('ok')) };

async function setup() {
  const h = makeHarness();
  const eventId = seedEvent(h.db, { slug: 'conf' });
  const roomId = seedRoom(h.db, eventId, { openBooking: 1 });
  const keys = generateKeys();
  h.db
    .prepare(
      `UPDATE events SET nostr_enabled = 1, nostr_pubkey = ?, nostr_seckey = ?, nostr_relays = ? WHERE id = ?`,
    )
    .run(keys.pubkey, encryptEventKey(keys.seckey, h.app.ctx.config), '["wss://r.test"]', eventId);
  const admin = await actorWithRole(h, 'conf', 'admin-pw');
  const author = await actorWithRole(h, 'conf', 'user-pw');
  const stranger = await actorWithRole(h, 'conf', 'user-pw');
  const res = await author
    .post('/api/e/conf/sessions')
    .send({ roomId, title: 'Mine', startsAt: at(DAY_ONE, 600), endsAt: at(DAY_ONE, 630) })
    .expect(201);
  const session = res.body as SessionDto;
  return { h, eventId, roomId, admin, author, stranger, session };
}

const optout = (h: ReturnType<typeof makeHarness>, id: number): number =>
  (h.db.prepare(`SELECT nostr_optout AS v FROM sessions WHERE id = ?`).get(id) as { v: number }).v;

describe('keeping a session off Nostr', () => {
  it('is the author’s and the organiser’s call, nobody else’s', async () => {
    const { h, admin, author, stranger, session } = await setup();
    expect(session.nostrOptOut).toBe(false);
    expect(
      (
        await stranger
          .patch(`/api/e/conf/sessions/${session.id}`)
          .send({ nostrOptOut: true, expectedUpdatedAt: session.updatedAt })
      ).status,
    ).toBe(403);
    expect(optout(h, session.id)).toBe(0);

    const byAuthor = await author
      .patch(`/api/e/conf/sessions/${session.id}`)
      .send({ nostrOptOut: true, expectedUpdatedAt: session.updatedAt })
      .expect(200);
    expect((byAuthor.body as SessionDto).nostrOptOut).toBe(true);
    expect(optout(h, session.id)).toBe(1);

    const byAdmin = await admin
      .patch(`/api/e/conf/sessions/${session.id}`)
      .send({ nostrOptOut: false, expectedUpdatedAt: (byAuthor.body as SessionDto).updatedAt })
      .expect(200);
    expect((byAdmin.body as SessionDto).nostrOptOut).toBe(false);
    h.close();
  });

  it('can be set on create, and is left alone by a patch that does not mention it', async () => {
    const { h, author, roomId } = await setup();
    const res = await author
      .post('/api/e/conf/sessions')
      .send({
        roomId,
        title: 'Private',
        startsAt: at(DAY_ONE, 700),
        endsAt: at(DAY_ONE, 730),
        nostrOptOut: true,
      })
      .expect(201);
    const s = res.body as SessionDto;
    expect(s.nostrOptOut).toBe(true);
    const after = await author
      .patch(`/api/e/conf/sessions/${s.id}`)
      .send({ title: 'Still private', expectedUpdatedAt: s.updatedAt })
      .expect(200);
    expect((after.body as SessionDto).nostrOptOut).toBe(true);
    h.close();
  });

  it('a placed pitch hands its choice to the session it becomes', async () => {
    const { h, admin, author, roomId } = await setup();
    const pitched = await author
      .post('/api/e/conf/proposals')
      .send({ title: 'Quiet pitch', description: '', nostrOptOut: true })
      .expect(201);
    expect(pitched.body.nostrOptOut).toBe(true);
    const placed = await admin
      .post(`/api/e/conf/proposals/${pitched.body.id}/place`)
      .send({ roomId, startsAt: at(DAY_ONE, 800), endsAt: at(DAY_ONE, 830) })
      .expect(201);
    const session = (placed.body as { session: SessionDto }).session;
    expect(session.nostrOptOut).toBe(true);
    expect(optout(h, session.id)).toBe(1);

    const loud = await author
      .post('/api/e/conf/proposals')
      .send({ title: 'Loud pitch', description: '' })
      .expect(201);
    expect(loud.body.nostrOptOut).toBe(false);
    const edited = await author
      .patch(`/api/e/conf/proposals/${loud.body.id}`)
      .send({ nostrOptOut: true })
      .expect(200);
    expect(edited.body.nostrOptOut).toBe(true);
    h.close();
  });

  it('the badge appears once a relay accepted, and goes when the session opts out', async () => {
    const { h, eventId, author, session } = await setup();
    const dto = async () =>
      (
        (await author.get(`/api/e/conf/sessions/${session.id}`).expect(200)).body as {
          session: SessionDto;
        }
      ).session;
    expect((await dto()).nostr).toBeNull();

    markDirty(h.db, eventId, session.id, Date.now() - 120_000);
    await syncTick(h.db, h.app.ctx.config, okPool, Date.now());
    const on = await dto();
    expect(on.nostr?.naddr).toMatch(/^naddr1/);
    const bundle = (await author.get('/api/e/conf/bundle').expect(200)).body as {
      event: { nostrEnabled: boolean };
      sessions: SessionDto[];
    };
    expect(bundle.event.nostrEnabled).toBe(true);
    expect(bundle.sessions.find((s) => s.id === session.id)?.nostr?.naddr).toBe(on.nostr?.naddr);

    await author
      .patch(`/api/e/conf/sessions/${session.id}`)
      .send({ nostrOptOut: true, expectedUpdatedAt: on.updatedAt })
      .expect(200);
    const dirty = h.db
      .prepare(`SELECT dirty_since FROM nostr_published WHERE entity = 'session' AND entity_id = ?`)
      .get(session.id) as { dirty_since: string | null };
    expect(dirty.dirty_since).not.toBeNull();
    await syncTick(h.db, h.app.ctx.config, okPool, Date.now() + 120_000);
    expect((await dto()).nostr).toBeNull();
    h.close();
  });

  it('travels with an export, and the event flag does not', async () => {
    const { h, admin, author, session } = await setup();
    await author
      .patch(`/api/e/conf/sessions/${session.id}`)
      .send({ nostrOptOut: true, expectedUpdatedAt: session.updatedAt })
      .expect(200);
    const doc = (await admin.get('/api/e/conf/export.json').expect(200)).body as {
      event: Record<string, unknown>;
      sessions: { title: string; nostrOptOut?: true }[];
    };
    expect(doc.sessions.find((s) => s.title === 'Mine')?.nostrOptOut).toBe(true);
    expect('nostrEnabled' in doc.event).toBe(false);
    h.close();
  });
});
