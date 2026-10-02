import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pruneAudit, resetPruneCounters } from '../server/src/audit.js';
import type { AuditPageDto } from '../server/src/shared/types.js';
import {
  DAY_ONE,
  DAY_TWO,
  actorWithRole,
  agentFor,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';

describe('the audit log, read back', () => {
  let harness: Harness;
  let admin: Agent;
  let eventId: number;
  let roomId: number;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { name: 'Main hall' });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  const read = async (query = ''): Promise<AuditPageDto> =>
    (await admin.get(`/api/e/testconf/audit${query}`).expect(200)).body as AuditPageDto;

  const makeSession = (title: string, startMin = 600) =>
    admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title,
        startsAt: at(DAY_ONE, startMin),
        endsAt: at(DAY_ONE, startMin + 30),
      })
      .expect(201);

  it('is admin-only', async () => {
    const viewer = await actorWithRole(harness, 'testconf', 'viewer-pw');
    await viewer.get('/api/e/testconf/audit').expect(403);
    const user = await actorWithRole(harness, 'testconf', 'user-pw');
    await user.get('/api/e/testconf/audit').expect(403);
    await admin.get('/api/e/testconf/audit').expect(200);
  });

  it('records who did what, newest first', async () => {
    const created = await makeSession('Opening keynote');
    const sessionId = (created.body as { id: number }).id;
    await admin.delete(`/api/e/testconf/sessions/${sessionId}`).expect(204);

    const page = await read();
    expect(page.entries[0]).toMatchObject({
      action: 'delete',
      entity: 'session',
      entityId: sessionId,
    });
    expect(page.entries[1]).toMatchObject({ action: 'create', entity: 'session' });
    expect(page.entries[0]?.actorName).toBeTruthy();
  });

  /** A row in a table is not a recovery tool; a name is. */
  it('names the thing that was touched, even after it was deleted', async () => {
    const created = await makeSession('Opening keynote');
    await admin
      .delete(`/api/e/testconf/sessions/${(created.body as { id: number }).id}`)
      .expect(204);

    const page = await read();
    expect(page.entries[0]?.entityLabel).toBe('Opening keynote');
  });

  it('covers contributions, rooms, tags and people, not just sessions', async () => {
    const created = await makeSession('Talk');
    const sessionId = (created.body as { id: number }).id;
    const note = await admin
      .post(`/api/e/testconf/sessions/${sessionId}/contributions`)
      .send({ kind: 'note', body: 'Something said in the room' })
      .expect(201);
    await admin
      .delete(`/api/e/testconf/contributions/${(note.body as { id: number }).id}`)
      .expect(204);
    await admin.post('/api/e/testconf/rooms').send({ name: 'Side room' }).expect(201);
    await admin.post('/api/e/testconf/tags').send({ name: 'Workshop' }).expect(201);
    await admin.post('/api/e/testconf/people').send({ name: 'Ada' }).expect(201);

    const page = await read();
    const seen = page.entries.map((e) => `${e.action} ${e.entity}`);
    expect(seen).toContain('delete contribution');
    expect(seen).toContain('create room');
    expect(seen).toContain('create tag');
    expect(seen).toContain('create person');
    // The deleted note is still named, which is the point of a moderation log.
    const deletion = page.entries.find((e) => e.entity === 'contribution');
    expect(deletion?.entityLabel).toBe('Something said in the room');
  });

  it('says who and what well enough for a line to link somewhere', async () => {
    const created = await makeSession('Opening keynote');
    const sessionId = (created.body as { id: number }).id;
    const note = await admin
      .post(`/api/e/testconf/sessions/${sessionId}/contributions`)
      .send({ kind: 'note', body: 'A note' })
      .expect(201);
    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    const me = (bundle.body as { people: { id: number; isMine: boolean }[] }).people.find(
      (p) => p.isMine,
    );

    let page = await read();
    // The actor's profile in this event, and a note's session.
    expect(page.entries[0]).toMatchObject({
      entity: 'contribution',
      actorPersonId: me?.id,
      entityState: 'live',
      entityParentId: sessionId,
    });
    expect(page.entries[1]).toMatchObject({
      entity: 'session',
      entityState: 'live',
      entityParentId: null,
    });

    // Once in the bin the line says so, so it can open Trash instead.
    await admin.delete(`/api/e/testconf/sessions/${sessionId}`).expect(204);
    await admin
      .delete(`/api/e/testconf/contributions/${(note.body as { id: number }).id}`)
      .expect(204);
    page = await read();
    expect(page.entries[0]).toMatchObject({ entity: 'contribution', entityState: 'trashed' });
    expect(page.entries[1]).toMatchObject({ entity: 'session', entityState: 'trashed' });
  });

  it('shows one event and not its neighbour', async () => {
    seedEvent(harness.db, { slug: 'otherconf' });
    const other = await actorWithRole(harness, 'otherconf', 'admin-pw');
    await other.post('/api/e/otherconf/rooms').send({ name: 'Elsewhere' }).expect(201);
    await makeSession('Ours');

    const page = await read();
    expect(page.entries.every((e) => e.entityLabel !== 'Elsewhere')).toBe(true);
  });

  it('pages backwards through a long log without repeating a row', async () => {
    // Straight into the table: this is about paging a long log, and going
    // through the API would only exercise the write rate limiter.
    const insert = harness.db.prepare(
      'INSERT INTO audit (identity_id, event_id, action, entity, entity_id, at) VALUES (NULL, ?, ?, ?, ?, ?)',
    );
    for (let i = 0; i < 55; i += 1) {
      insert.run(eventId, 'create', 'tag', i + 1, new Date(Date.now() + i).toISOString());
    }

    const first = await read();
    expect(first.entries).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();

    const second = await read(`?before=${first.nextCursor}`);
    expect(second.entries.length).toBeGreaterThan(0);

    const ids = new Set([...first.entries, ...second.entries].map((e) => e.id));
    expect(ids.size).toBe(first.entries.length + second.entries.length);
    // Strictly descending, so "newest first" holds across the page boundary.
    const all = [...first.entries, ...second.entries].map((e) => e.id);
    expect(all).toEqual([...all].sort((a, b) => b - a));
    expect(second.nextCursor).toBeNull();
  });

  /**
   * The log is append-only and used to grow without limit. A cap is the
   * housekeeping bound; it is deliberately not a promise about the exact row
   * count at any instant, because pruning on every write would put a DELETE
   * behind every action in the app.
   */
  describe('retention', () => {
    const count = (): number =>
      (
        harness.db
          .prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM audit WHERE event_id = ?')
          .get(eventId) as { n: number }
      ).n;

    const fill = (rows: number): void => {
      const insert = harness.db.prepare(
        'INSERT INTO audit (identity_id, event_id, action, entity, entity_id, at) VALUES (NULL, ?, ?, ?, ?, ?)',
      );
      for (let i = 0; i < rows; i += 1) {
        insert.run(eventId, 'create', 'tag', i + 1, new Date(Date.now() + i).toISOString());
      }
    };

    beforeEach(() => resetPruneCounters());

    it('defaults to keeping a thousand entries', async () => {
      const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
      expect((bundle.body as { event: { auditKeep: number } }).event.auditKeep).toBe(1000);
    });

    it('drops the oldest past the cap and keeps the newest', () => {
      harness.db.prepare('UPDATE events SET audit_keep = 10 WHERE id = ?').run(eventId);
      fill(25);
      const newest = harness.db
        .prepare<[number], { id: number }>(
          'SELECT id FROM audit WHERE event_id = ? ORDER BY id DESC LIMIT 1',
        )
        .get(eventId) as { id: number };

      expect(pruneAudit(harness.db, eventId)).toBe(15);
      expect(count()).toBe(10);
      // The survivors are the *newest* ten, which is the whole point.
      const kept = harness.db
        .prepare<[number], { id: number }>(
          'SELECT id FROM audit WHERE event_id = ? ORDER BY id DESC',
        )
        .all(eventId) as { id: number }[];
      expect(kept[0]?.id).toBe(newest.id);
      expect(kept).toHaveLength(10);
    });

    it('keeps everything at 0', () => {
      harness.db.prepare('UPDATE events SET audit_keep = 0 WHERE id = ?').run(eventId);
      fill(50);
      expect(pruneAudit(harness.db, eventId)).toBe(0);
      expect(count()).toBe(50);
    });

    it('never touches another event, or the instance-level rows', () => {
      const otherId = seedEvent(harness.db, { slug: 'otherconf' });
      harness.db
        .prepare(
          'INSERT INTO audit (identity_id, event_id, action, entity, entity_id, at) VALUES (NULL, ?, ?, ?, NULL, ?)',
        )
        .run(otherId, 'create', 'room', new Date().toISOString());
      harness.db
        .prepare(
          'INSERT INTO audit (identity_id, event_id, action, entity, entity_id, at) VALUES (NULL, NULL, ?, ?, NULL, ?)',
        )
        .run('backup', 'instance', new Date().toISOString());

      harness.db.prepare('UPDATE events SET audit_keep = 5 WHERE id = ?').run(eventId);
      fill(30);
      pruneAudit(harness.db, eventId);

      expect(
        harness.db
          .prepare<[number], { n: number }>('SELECT COUNT(*) AS n FROM audit WHERE event_id = ?')
          .get(otherId),
      ).toEqual({ n: 1 });
      expect(
        harness.db.prepare('SELECT COUNT(*) AS n FROM audit WHERE event_id IS NULL').get(),
      ).toEqual({ n: 1 });
    });

    it('trims as writes come in, without pruning on every one', async () => {
      harness.db.prepare('UPDATE events SET audit_keep = 100 WHERE id = ?').run(eventId);
      fill(400);
      // The first write after a restart checks, so this one prunes to the cap.
      await admin.post('/api/e/testconf/tags').send({ name: 'First' }).expect(201);
      expect(count()).toBeLessThanOrEqual(101);

      // Subsequent writes accumulate against the slack rather than each paying
      // for a DELETE, so the log sits a little above the cap between prunes.
      for (let i = 0; i < 5; i += 1) {
        await admin
          .post('/api/e/testconf/tags')
          .send({ name: `Tag ${i}` })
          .expect(201);
      }
      expect(count()).toBeGreaterThan(100);
      expect(count()).toBeLessThan(200);
    });

    it('applies a tightened cap the moment it is saved', async () => {
      fill(300);
      await admin.patch('/api/e/testconf/settings').send({ auditKeep: 100 }).expect(200);
      // 100 kept, plus the row recording the settings change itself.
      expect(count()).toBeLessThanOrEqual(101);
    });

    it('refuses a cap small enough to make the log a toy', async () => {
      await admin.patch('/api/e/testconf/settings').send({ auditKeep: 5 }).expect(400);
      await admin.patch('/api/e/testconf/settings').send({ auditKeep: -1 }).expect(400);
      await admin.patch('/api/e/testconf/settings').send({ auditKeep: 100 }).expect(200);
      await admin.patch('/api/e/testconf/settings').send({ auditKeep: 0 }).expect(200);
    });
  });

  /**
   * A line said "edited event" and left the reader to guess which setting
   * moved; and because the name on every line is looked up when the page is
   * read, a rename took the old name out of the log altogether — the creation
   * line included. The row now itemises what changed, before and after.
   */
  describe('what an edit changed', () => {
    const patch = (body: object) => admin.patch('/api/e/testconf/settings').send(body);

    it('says what the event was called before a rename, and after', async () => {
      await patch({ name: 'Test Conf Renamed' }).expect(200);
      const [line] = (await read()).entries;
      expect(line).toMatchObject({ action: 'update', entity: 'event' });
      expect(line?.entityLabel).toBe('Test Conf Renamed');
      expect(line?.changes).toEqual([
        { field: 'name', from: 'Test Conf', to: 'Test Conf Renamed' },
      ]);
    });

    it('lists only the settings that moved, in the form’s order', async () => {
      await patch({
        name: 'Test Conf', // sent back unchanged, as the form does
        endDate: '2026-12-31',
        dayStartMin: 540,
        pitchesEnabled: false,
        auditKeep: 0,
      }).expect(200);
      const [line] = (await read()).entries;
      expect(line?.changes).toEqual([
        { field: 'endDate', from: DAY_TWO, to: '2026-12-31' },
        { field: 'dayStartMin', from: 480, to: 540 },
        { field: 'auditKeep', from: 1000, to: 0 },
        { field: 'pitchesEnabled', from: true, to: false },
      ]);
    });

    it('records a slug change as a rename with the old address', async () => {
      await patch({ slug: 'moved-conf', name: 'Moved' }).expect(200);
      const page = (await admin.get('/api/e/moved-conf/audit').expect(200)).body as AuditPageDto;
      expect(page.entries[0]?.action).toBe('rename');
      expect(page.entries[0]?.changes).toEqual([
        { field: 'name', from: 'Test Conf', to: 'Moved' },
        { field: 'slug', from: 'testconf', to: 'moved-conf' },
      ]);
    });

    /** The log must never hold a password, and a hash would say nothing. */
    it('names a changed password and nothing more', async () => {
      await patch({ adminPassword: 'brand-new-pw', viewerPassword: 'viewer-new' }).expect(200);
      const [line] = (await read()).entries;
      expect(line?.changes).toEqual([{ field: 'viewerPassword' }, { field: 'adminPassword' }]);
      expect(JSON.stringify(line)).not.toContain('brand-new-pw');
      expect(JSON.stringify(line)).not.toContain('viewer-new');
    });

    it('says which capability a permissions change touched, and who may now', async () => {
      await admin
        .patch('/api/e/testconf/permissions')
        .send({ 'session.star': ['user', 'speaker', 'admin'], 'proposal.vote': [] })
        .expect(200);
      const [line] = (await read()).entries;
      expect(line).toMatchObject({ action: 'update', entity: 'permissions' });
      expect(line?.changes).toEqual([
        { field: 'proposal.vote', from: 'viewer,user,speaker,admin', to: 'admin' },
        { field: 'session.star', from: 'viewer,user,speaker,admin', to: 'user,speaker,admin' },
      ]);
    });

    it('a creation lists what the event started as', async () => {
      const maker = agentFor(harness);
      await maker.get('/api/me').expect(200);
      await maker
        .post('/api/events')
        .set('X-Instance-Key', 'instance-pw')
        .send({
          slug: 'newconf',
          name: 'New Conf',
          timezone: 'Europe/Berlin',
          startDate: '2027-06-01',
          endDate: '2027-06-02',
          viewerPassword: 'viewer2',
          userPassword: 'user222',
          adminPassword: 'admin22',
        })
        .expect(201);
      await maker.patch('/api/e/newconf/settings').send({ name: 'Renamed Conf' }).expect(200);
      const page = (await maker.get('/api/e/newconf/audit').expect(200)).body as AuditPageDto;
      // The label is the name now; the creation line is where the first one is.
      expect(page.entries[1]).toMatchObject({ action: 'create', entityLabel: 'Renamed Conf' });
      expect(page.entries[1]?.changes).toEqual([
        { field: 'name', to: 'New Conf' },
        { field: 'slug', to: 'newconf' },
        { field: 'timezone', to: 'Europe/Berlin' },
        { field: 'startDate', to: '2027-06-01' },
        { field: 'endDate', to: '2027-06-02' },
      ]);
    });

    it('an action that is not an edit carries an empty list', async () => {
      await makeSession('Talk');
      const [line] = (await read()).entries;
      expect(line?.action).toBe('create');
      expect(line?.changes).toEqual([]);
    });
  });
});
