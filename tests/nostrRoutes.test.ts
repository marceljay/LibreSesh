import { describe, expect, it } from 'vitest';
import { generateKeys, toNsec } from '../server/src/nostr/keys.js';
import { actorWithRole, makeHarness, seedEvent, type Harness } from './helpers.js';

const NEVER = /nostr_seckey|nostr_pubkey|nsec1|"v1\./;

async function enabledEvent(overrides: Parameters<typeof makeHarness>[0] = {}) {
  const h = makeHarness({ nostrDefaultRelays: ['wss://relay.test'], ...overrides });
  const eventId = seedEvent(h.db, { slug: 'conf' });
  const admin = await actorWithRole(h, 'conf', 'admin-pw');
  const enabled = await admin.post('/api/e/conf/nostr/enable').send({ acknowledged: true });
  expect(enabled.status).toBe(200);
  return { h, eventId, admin };
}

const column = (h: Harness, name: string): string | null =>
  (
    h.db.prepare(`SELECT ${name} AS v FROM events WHERE slug = 'conf'`).get() as {
      v: string | null;
    }
  ).v;

describe('nostr routes', () => {
  it('refuses enable without acknowledgement', async () => {
    const h = makeHarness();
    seedEvent(h.db, { slug: 'conf' });
    const admin = await actorWithRole(h, 'conf', 'admin-pw');
    expect((await admin.post('/api/e/conf/nostr/enable').send({})).status).toBe(400);
    expect(
      (await admin.post('/api/e/conf/nostr/enable').send({ acknowledged: false })).status,
    ).toBe(400);
    expect(column(h, 'nostr_enabled')).toBe(0);
    h.close();
  });

  it('enable generates a key once and seeds the relays; disable keeps both', async () => {
    const { h, admin } = await enabledEvent();
    const first = (await admin.get('/api/e/conf/nostr')).body;
    expect(first.enabled).toBe(true);
    expect(first.npub).toMatch(/^npub1/);
    expect(first.relays).toEqual(['wss://relay.test']);
    expect(first.triggers).toEqual(['placed', 'up_next', 'digest']);
    expect(column(h, 'nostr_seckey')).toMatch(/^v1\./);

    await admin
      .patch('/api/e/conf/nostr')
      .send({ relays: ['wss://mine.test'] })
      .expect(200);
    expect((await admin.post('/api/e/conf/nostr/disable')).status).toBe(204);
    expect((await admin.get('/api/e/conf/nostr')).body.enabled).toBe(false);

    await admin.post('/api/e/conf/nostr/enable').send({ acknowledged: true }).expect(200);
    const again = (await admin.get('/api/e/conf/nostr')).body;
    expect(again.npub).toBe(first.npub);
    expect(again.relays).toEqual(['wss://mine.test']);
    h.close();
  });

  it('import replaces the key, export returns it, both audited', async () => {
    const { h, admin } = await enabledEvent();
    const before = (await admin.get('/api/e/conf/nostr')).body.npub as string;
    const mine = generateKeys();
    const nsec = toNsec(mine.seckey);
    const imported = await admin.post('/api/e/conf/nostr/import-key').send({ nsec });
    expect(imported.status).toBe(200);
    expect(imported.body.npub).not.toBe(before);
    expect(column(h, 'nostr_pubkey')).toBe(mine.pubkey);

    const exported = await admin.post('/api/e/conf/nostr/export-key');
    expect(exported.status).toBe(200);
    expect(exported.body.nsec).toBe(nsec);

    const actions = (
      h.db.prepare(`SELECT action FROM audit ORDER BY id`).all() as { action: string }[]
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(['nostr_enable', 'nostr_key_imported', 'nostr_key_exported']),
    );
    h.close();
  });

  it('rejects a malformed nsec', async () => {
    const { h, admin } = await enabledEvent();
    expect(
      (await admin.post('/api/e/conf/nostr/import-key').send({ nsec: 'nsec1nope' })).status,
    ).toBe(400);
    expect(
      (await admin.post('/api/e/conf/nostr/import-key').send({ nsec: 'npub1' + 'q'.repeat(58) }))
        .status,
    ).toBe(400);
    h.close();
  });

  it('export fails cleanly when the at-rest secret has changed', async () => {
    const { h, admin } = await enabledEvent();
    h.app.ctx.config.atRestSecret = 'rotated-without-previous';
    const res = await admin.post('/api/e/conf/nostr/export-key');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/secret has changed/);
    h.close();
  });

  it('never serialises the key columns, and settings stay out of the export', async () => {
    const { h, admin } = await enabledEvent();
    const status = JSON.stringify((await admin.get('/api/e/conf/nostr').expect(200)).body);
    const bundle = JSON.stringify((await admin.get('/api/e/conf/bundle').expect(200)).body);
    const exported = JSON.stringify((await admin.get('/api/e/conf/export.json').expect(200)).body);
    for (const text of [status, bundle, exported]) expect(text).not.toMatch(NEVER);
    expect(exported).not.toMatch(/nostrEnabled|nostrRelays|nostrTriggers|nostr_/);
    h.close();
  });

  it('validates the relay list', async () => {
    const { h, admin } = await enabledEvent();
    const patch = (relays: unknown) => admin.patch('/api/e/conf/nostr').send({ relays });
    expect((await patch(['https://x.test'])).status).toBe(400);
    expect((await patch(['wss://'])).status).toBe(400);
    expect((await patch(Array<string>(11).fill('wss://r.test'))).status).toBe(400);
    const ok = await patch(['wss://a.test', ' wss://b.test ', 'wss://a.test']);
    expect(ok.status).toBe(200);
    expect(ok.body.relays).toEqual(['wss://a.test', 'wss://b.test']);
    expect(
      (await admin.patch('/api/e/conf/nostr').send({ triggers: ['digest', 'nope'] })).status,
    ).toBe(400);
    const t = await admin.patch('/api/e/conf/nostr').send({ triggers: ['digest'] });
    expect(t.body.triggers).toEqual(['digest']);
    h.close();
  });

  it('renders an example note per trigger, even before the first enable', async () => {
    const h = makeHarness({ publicUrl: 'https://sesh.example' });
    seedEvent(h.db, { slug: 'conf', name: 'Conf' });
    const admin = await actorWithRole(h, 'conf', 'admin-pw');
    const empty = await admin.get('/api/e/conf/nostr/example?trigger=up_next').expect(200);
    expect(empty.body.content).toBeNull();
    expect((await admin.get('/api/e/conf/nostr/example?trigger=nope')).status).toBe(400);
    const roomId = Number(
      h.db
        .prepare(
          `INSERT INTO rooms (event_id, name, description, capacity, open_booking, sort_order) VALUES (?, 'Room A', '', NULL, 0, 0)`,
        )
        .run((h.db.prepare(`SELECT id FROM events WHERE slug = 'conf'`).get() as { id: number }).id)
        .lastInsertRowid,
    );
    await admin
      .post('/api/e/conf/sessions')
      .send({
        roomId,
        title: 'Scaling an unconference',
        startsAt: '2099-06-01T12:00:00.000Z',
        endsAt: '2099-06-01T12:30:00.000Z',
      })
      .expect(201);
    for (const trigger of ['up_next', 'digest', 'added', 'changed', 'placed', 'pitched']) {
      const res = await admin.get(`/api/e/conf/nostr/example?trigger=${trigger}`).expect(200);
      expect(res.body.content, trigger).toContain('Scaling an unconference');
    }
    h.close();
  });

  it('export-key is refused below organiser', async () => {
    const { h } = await enabledEvent();
    const attendee = await actorWithRole(h, 'conf', 'user-pw');
    expect((await attendee.post('/api/e/conf/nostr/export-key')).status).toBe(403);
    expect((await attendee.get('/api/e/conf/nostr')).status).toBe(403);
    h.close();
  });
});
