import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actorWithRole, agentFor, makeHarness, seedEvent, type Harness } from './helpers.js';

/**
 * Where a schedule opens for someone who has not picked a view.
 *
 * It used to be the browser's call — under 640px the list, above it the grid —
 * which answers a question about the device when the question is about the
 * event: a dense multi-room programme is unreadable as a list on a laptop, and
 * a single-track unconference is a column of empty grid on a desktop. It is
 * the organiser's now, and the list until they say otherwise.
 */
describe('an event says which view it opens in', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db, { slug: 'testconf' });
  });
  afterEach(() => harness.close());

  it('opens in the list until an organiser says otherwise', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const res = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(res.body.event.defaultView).toBe('list');
  });

  it("takes the organiser's choice", async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    const saved = await admin
      .patch('/api/e/testconf/settings')
      .send({ defaultView: 'cal' })
      .expect(200);
    expect(saved.body.defaultView).toBe('cal');

    const res = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(res.body.event.defaultView).toBe('cal');
  });

  it('takes nothing else', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.patch('/api/e/testconf/settings').send({ defaultView: 'grid' }).expect(400);
  });

  it('is taken at creation, not only after it', async () => {
    // The schema has always accepted it; the INSERT's column list did not, so
    // the row quietly took the migration's default and the caller got a 201
    // for a setting that never landed.
    const maker = agentFor(harness);
    await maker.get('/api/me').expect(200);
    await maker
      .post('/api/events')
      .set('X-Instance-Key', 'instance-pw')
      .send({
        slug: 'gridconf',
        name: 'Grid Conf',
        timezone: 'Europe/Berlin',
        startDate: '2027-06-01',
        endDate: '2027-06-02',
        defaultView: 'cal',
        viewerPassword: 'viewer2',
        userPassword: 'user222',
        adminPassword: 'admin22',
      })
      .expect(201);
    const res = await maker.get('/api/e/gridconf/bundle').expect(200);
    expect(res.body.event.defaultView).toBe('cal');
  });

  it('carries into a clone, like the rest of the setup', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.patch('/api/e/testconf/settings').send({ defaultView: 'cal' }).expect(200);
    await admin
      .post('/api/events/testconf/clone')
      .send({
        newSlug: 'testconf-copy',
        newName: 'Test Conf Copy',
        startDate: '2027-06-01',
        endDate: '2027-06-02',
        viewerPassword: 'viewer2',
        userPassword: 'user222',
        adminPassword: 'admin22',
      })
      .expect(201);
    await admin.post('/api/e/testconf-copy/auth').send({ password: 'admin22' }).expect(200);
    const res = await admin.get('/api/e/testconf-copy/bundle').expect(200);
    expect(res.body.event.defaultView).toBe('cal');
  });

  it('is in the export, and an import that carries it is honoured', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin.patch('/api/e/testconf/settings').send({ defaultView: 'cal' }).expect(200);
    const doc = await admin.get('/api/e/testconf/export.json').expect(200);
    expect(doc.body.event.defaultView).toBe('cal');

    await admin
      .post('/api/events/import')
      .set('X-Instance-Key', 'instance-pw')
      .send({
        event: {
          name: 'Imported Conf',
          slug: 'importedconf',
          timezone: 'Europe/Berlin',
          startDate: '2027-06-01',
          endDate: '2027-06-02',
          defaultView: 'cal',
          viewerPassword: 'viewer2',
          userPassword: 'user222',
          adminPassword: 'admin22',
        },
        rooms: [{ name: 'Main hall' }],
      })
      .expect(201);
    await admin.post('/api/e/importedconf/auth').send({ password: 'admin22' }).expect(200);
    const res = await admin.get('/api/e/importedconf/bundle').expect(200);
    expect(res.body.event.defaultView).toBe('cal');
  });

  it('is the list for an import that says nothing about it', async () => {
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    await admin
      .post('/api/events/import')
      .set('X-Instance-Key', 'instance-pw')
      .send({
        event: {
          name: 'Quiet Conf',
          slug: 'quietconf',
          timezone: 'Europe/Berlin',
          startDate: '2027-06-01',
          endDate: '2027-06-02',
          adminPassword: 'admin22',
          userPassword: 'user222',
          viewerPassword: 'viewer2',
        },
        rooms: [{ name: 'Main hall' }],
      })
      .expect(201);
    await admin.post('/api/e/quietconf/auth').send({ password: 'admin22' }).expect(200);
    const res = await admin.get('/api/e/quietconf/bundle').expect(200);
    expect(res.body.event.defaultView).toBe('list');
  });
});

describe('the schedule reads the default off the event', () => {
  const schedule = readFileSync(
    join(__dirname, '..', 'web', 'src', 'pages', 'SchedulePage.tsx'),
    'utf8',
  );

  it('no longer guesses from the width of the window', () => {
    expect(schedule).toContain('filters.view ?? event?.defaultView ?? "list"');
    expect(schedule).not.toContain('window.innerWidth < 640');
  });
});
