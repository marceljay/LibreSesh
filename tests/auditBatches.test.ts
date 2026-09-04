import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuditPageDto, SessionDto } from '../server/src/shared/types.js';
import {
  actorWithRole,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';

/**
 * One press, one line in the log.
 *
 * Placing a repeat across a week writes seven audit rows, and it must: each is
 * a session with its own id, and the edit that moves one of them next week will
 * name it alone. What was wrong is the reading — seven lines for one action
 * buried the rest of the morning's history, and a long run could push earlier
 * actions past the retention cap on its own. So the rows stay and share a
 * batch, and the log pages by *action*.
 */
describe('a bulk action is one entry in the audit log', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;

  const MONDAY = '2026-06-01';
  const SUNDAY = '2026-06-07';

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db, { startDate: MONDAY, endDate: SUNDAY });
    roomId = seedRoom(harness.db, eventId, { name: 'Main Hall', openBooking: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  const log = async (before?: number): Promise<AuditPageDto> =>
    (
      await admin
        .get(`/api/e/testconf/audit${before === undefined ? '' : `?before=${before}`}`)
        .expect(200)
    ).body as AuditPageDto;

  const repeat = async (until: string, title = 'Morning circle'): Promise<SessionDto[]> =>
    (
      await admin
        .post('/api/e/testconf/sessions/repeat')
        .send({
          roomId,
          title,
          startsAt: at(MONDAY, 9 * 60),
          endsAt: at(MONDAY, 9 * 60 + 30),
          repeat: { until },
          link: true,
        })
        .expect(201)
    ).body.sessions as SessionDto[];

  it('folds a repeat into one entry that still holds every id', async () => {
    const sessions = await repeat(SUNDAY);
    expect(sessions).toHaveLength(7);

    const page = await log();
    const created = page.entries.filter((e) => e.action === 'create');
    expect(created).toHaveLength(1);

    const entry = created[0]!;
    expect(entry.members).toHaveLength(7);
    // Nothing is hidden — every session's id is in there, newest first.
    expect(entry.members?.map((m) => m.entityId).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
      sessions.map((s) => s.id).sort((a, b) => a - b),
    );
    // The collapsed line stands for the newest row in the batch.
    expect(entry.entityId).toBe(entry.members?.[0]?.entityId);
  });

  it('leaves an ordinary action alone', async () => {
    // `members` absent, not a list of one: "is this a batch" must never be a
    // count the reader has to check.
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'One-off',
        startsAt: at(MONDAY, 14 * 60),
        endsAt: at(MONDAY, 15 * 60),
      })
      .expect(201);

    const page = await log();
    const entry = page.entries.find((e) => e.entityLabel === 'One-off');
    expect(entry).toBeDefined();
    expect(entry?.members).toBeUndefined();
  });

  it('folds an edit applied across a series', async () => {
    const sessions = await repeat(SUNDAY, 'Yoga');
    const first = sessions[0]!;
    await admin
      .patch(`/api/e/testconf/sessions/${first.id}`)
      .send({ description: 'Bring a mat', applyTo: 'all', expectedUpdatedAt: first.updatedAt })
      .expect(200);

    const page = await log();
    const updates = page.entries.filter((e) => e.action === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.members).toHaveLength(7);
  });

  it('pages by action, and never splits a batch across a page', async () => {
    // Two runs of seven, plus the single session below, is 15 rows — but only
    // three entries, so one page holds them all and the cursor is spent.
    await repeat(SUNDAY, 'Run one');
    await repeat(SUNDAY, 'Run two');
    await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: 'Alone',
        startsAt: at(MONDAY, 16 * 60),
        endsAt: at(MONDAY, 17 * 60),
      })
      .expect(201);

    const page = await log();
    expect(page.entries.filter((e) => e.entity === 'session')).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
    for (const entry of page.entries) {
      if (entry.members === undefined) continue;
      // A batch arrives whole or not at all.
      expect(entry.members).toHaveLength(7);
    }
  });

  it('walks the whole log when it is paged', async () => {
    // The cursor is a group head, so asking for what is older than the last
    // entry on a page returns the rest and repeats nothing.
    await repeat(SUNDAY, 'Run one');
    const first = await log();
    const oldest = first.entries[first.entries.length - 1]!;
    const older = await log(oldest.id);
    const ids = new Set(first.entries.map((e) => e.id));
    for (const entry of older.entries) expect(ids.has(entry.id)).toBe(false);
  });
});
