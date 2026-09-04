import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actorWithRole,
  makeHarness,
  seedEvent,
  type Agent,
  type Harness,
} from './helpers.js';

/**
 * The pitch board is the unconference half of the app, and an event with a
 * fixed programme has no use for it — a link in the header to a page that will
 * stay empty all week. It is the organiser's call now.
 *
 * The rule that matters: **off is a hide, never a delete.** An organiser who
 * shuts the board mid-event and changes their mind gets it back untouched.
 */
describe('the pitch board is an event setting', () => {
  let harness: Harness;
  let admin: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    seedEvent(harness.db);
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
  });
  afterEach(() => harness.close());

  it('starts on, because that is what every event already had', async () => {
    const res = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(res.body.event.pitchesEnabled).toBe(true);
  });

  it('turns off and stays off', async () => {
    await admin.patch('/api/e/testconf/settings').send({ pitchesEnabled: false }).expect(200);
    expect((await admin.get('/api/e/testconf/bundle')).body.event.pitchesEnabled).toBe(false);

    // A settings save that says nothing about it leaves it alone — the form
    // posts the whole settings object, so this is the ordinary case.
    await admin.patch('/api/e/testconf/settings').send({ name: 'Renamed' }).expect(200);
    expect((await admin.get('/api/e/testconf/bundle')).body.event.pitchesEnabled).toBe(false);

    await admin.patch('/api/e/testconf/settings').send({ pitchesEnabled: true }).expect(200);
    expect((await admin.get('/api/e/testconf/bundle')).body.event.pitchesEnabled).toBe(true);
  });

  it('is an organiser setting, not an attendee one', async () => {
    const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    await attendee.patch('/api/e/testconf/settings').send({ pitchesEnabled: false }).expect(403);
  });

  it('keeps the pitches already on the board, and hands them back', async () => {
    const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    await attendee
      .post('/api/e/testconf/proposals')
      .send({ title: 'Lightning talks', description: 'Five minutes each' })
      .expect(201);

    await admin.patch('/api/e/testconf/settings').send({ pitchesEnabled: false }).expect(200);
    const off = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(off.body.proposals).toHaveLength(1);
    expect(off.body.proposals[0].title).toBe('Lightning talks');

    await admin.patch('/api/e/testconf/settings').send({ pitchesEnabled: true }).expect(200);
    const on = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(on.body.proposals).toHaveLength(1);
  });

  it('stops taking new pitches while it is off', async () => {
    // The UI hides the form, but a tab left open from before the switch would
    // otherwise still post to a board nobody can reach.
    const attendee = await actorWithRole(harness, 'testconf', 'user-pw');
    await admin.patch('/api/e/testconf/settings').send({ pitchesEnabled: false }).expect(200);
    await attendee.post('/api/e/testconf/proposals').send({ title: 'Too late' }).expect(403);

    await admin.patch('/api/e/testconf/settings').send({ pitchesEnabled: true }).expect(200);
    await attendee.post('/api/e/testconf/proposals').send({ title: 'In time' }).expect(201);
  });

  it('carries into a clone, which runs the same shape of event', async () => {
    await admin.patch('/api/e/testconf/settings').send({ pitchesEnabled: false }).expect(200);
    await admin
      .post('/api/events/testconf/clone')
      .send({
        newSlug: 'testconf-2',
        newName: 'Testconf 2',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        viewerPassword: 'viewer-pw-2',
        userPassword: 'user-pw-2',
        adminPassword: 'admin-pw-2',
      })
      .expect(201);

    const clone = await actorWithRole(harness, 'testconf-2', 'admin-pw-2');
    const bundle = await clone.get('/api/e/testconf-2/bundle').expect(200);
    expect(bundle.body.event.pitchesEnabled).toBe(false);
  });
});

/** No DOM in this suite, so the client half is pinned by shape. */
describe('the board’s way in', () => {
  const read = (...parts: string[]) =>
    readFileSync(join(__dirname, '..', 'web', 'src', ...parts), 'utf8');
  const schedule = read('pages', 'SchedulePage.tsx');
  const board = read('components', 'ProposalBoard.tsx');

  it('says what you can do there, not what the place is called', () => {
    expect(schedule).toMatch(/<span className="hidden sm:inline">Pitch a session<\/span>/);
    expect(schedule).toMatch(/aria-label="Pitch a session"/);
    expect(schedule).not.toMatch(/>\s*Pitches\s*$/m);
  });

  it('keeps the words on the button when only the icon shows', () => {
    // Below `sm` the label is hidden and the bulb carries it, so the accessible
    // name has to live on the link itself.
    expect(schedule).toMatch(/<PitchIcon className="h-3\.5 w-3\.5" \/>/);
  });

  it('hides the button and the page when the board is off', () => {
    expect(schedule).toMatch(/\{event\.pitchesEnabled && \(/);
    expect(board).toMatch(/if \(!event\.pitchesEnabled\) \{/);
  });
});
