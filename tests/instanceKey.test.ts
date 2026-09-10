import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentFor, makeHarness, type Agent, type Harness } from './helpers.js';

/**
 * D3 §2. The instance password opens event creation, import and the
 * whole-database backup on every instance that shares it. Before this it sat
 * behind the `write` budget — 30 a minute, 43,000 guesses a day per address.
 * It now sits behind `auth`: five wrong keys a quarter hour, a refund on
 * success, and an audit row with no event id for every miss.
 */
describe('the instance password is behind the auth budget', () => {
  let harness: Harness;
  let agent: Agent;

  const create = (key: string | null) => {
    const req = agent.post('/api/events').send({
      slug: `e-${Math.random().toString(36).slice(2, 8)}`,
      name: 'An event',
      timezone: 'Europe/Berlin',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
    });
    return key === null ? req : req.set('X-Instance-Key', key);
  };

  beforeEach(() => {
    harness = makeHarness();
    agent = agentFor(harness);
  });
  afterEach(() => harness.close());

  it('refuses the sixth wrong key with 429 and Retry-After', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await create('wrong');
      expect(res.status).toBe(403);
    }
    const res = await create('wrong');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('refunds on success, so a working client is never throttled by its own use', async () => {
    // Ten creations in a row would exhaust a five-token budget without the
    // refund. This is the case that makes the tighter budget safe.
    for (let i = 0; i < 10; i += 1) {
      expect((await create('instance-pw')).status).toBe(201);
    }
  });

  it('leaves an audit row with no event id for every miss', async () => {
    await create('wrong');
    await create(null);
    const rows = harness.db
      .prepare<[], { action: string; event_id: number | null; entity: string }>(
        "SELECT action, event_id, entity FROM audit WHERE action = 'instance_key_failed'",
      )
      .all();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.event_id === null)).toBe(true);
    expect(rows[0].entity).toBe('instance');
  });

  it('guards import and backup by the same budget', async () => {
    for (let i = 0; i < 5; i += 1) {
      await agent.post('/api/events/import').set('X-Instance-Key', 'wrong').send({});
    }
    const importRes = await agent
      .post('/api/events/import')
      .set('X-Instance-Key', 'wrong')
      .send({});
    expect(importRes.status).toBe(429);
    const backupRes = await agent
      .post('/api/backup')
      .set('X-Instance-Key', 'instance-pw')
      .send({ passphrase: 'a-long-enough-passphrase' });
    // Same budget, and it is spent: even the right key waits.
    expect(backupRes.status).toBe(429);
  });
});
