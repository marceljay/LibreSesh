// @vitest-environment jsdom
import { cleanup, configure, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../web/src/App';
import { installBrowserShims, routeFetchTo, settled } from './dom';
import {
  actorWithRole,
  agentFor,
  at,
  DAY_ONE,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers';

/**
 * Every route in App.tsx, mounted for real: React renders into jsdom, the page
 * fetches from the real server, and whatever it draws is what a browser would
 * draw minus layout. Nothing else in the suite renders a component — the rest
 * pins behaviour through source text — so this is the only place a React or
 * router major can fail visibly rather than pass green and break in a browser.
 *
 * The bar is deliberately low and the net wide: each page mounts, shows the
 * one thing that proves it fetched and rendered, and writes nothing to
 * console.error. React reports a bad ref, a missing key, an update outside
 * act() and a hydration mismatch there, and jsdom reports an API it lacks — so
 * a clean console is most of the assertion.
 */

// Generous: under the full suite's load a lazy route chunk can take seconds
// to compile, and a timeout here says nothing about the page.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 20_000 });

const SLUG = 'testconf';

let harness: Harness;
let admin: Agent;
let sessionId: number;
let personId: number;
let errors: unknown[][];

const open = (path: string) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};

beforeEach(async () => {
  installBrowserShims();
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });

  harness = makeHarness();
  const eventId = seedEvent(harness.db);
  const roomId = seedRoom(harness.db, eventId, { name: 'Main Hall' });
  admin = await actorWithRole(harness, SLUG, 'admin-pw');
  const created = await admin
    .post(`/api/e/${SLUG}/sessions`)
    .send({
      roomId,
      title: 'Keynote',
      speakers: ['Ada Lovelace'],
      startsAt: at(DAY_ONE, 600),
      endsAt: at(DAY_ONE, 660),
    })
    .expect(201);
  sessionId = created.body.id;
  const person = harness.db
    .prepare('SELECT id FROM people WHERE event_id = ? AND name = ?')
    .get(eventId, 'Ada Lovelace') as { id: number };
  personId = person.id;
});

afterEach(async () => {
  cleanup();
  await settled();
  harness.close();
  vi.restoreAllMocks();
  expect(errors, 'console.error was called').toEqual([]);
});

/** A browser that already holds a role at the event. */
const viewer = async (): Promise<void> =>
  routeFetchTo(await actorWithRole(harness, SLUG, 'viewer-pw'));

describe('instance pages', () => {
  it('/ is the landing page', async () => {
    routeFetchTo(agentFor(harness));
    open('/');
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('/events lists the instance', async () => {
    routeFetchTo(agentFor(harness));
    open('/events');
    expect(await screen.findByRole('heading', { level: 1, name: /LibreSesh/ })).toBeTruthy();
  });

  it('/new is the create form', async () => {
    routeFetchTo(agentFor(harness));
    open('/new');
    expect(await screen.findByText('Create an event')).toBeTruthy();
  });

  it('/import is the import form', async () => {
    routeFetchTo(agentFor(harness));
    open('/import');
    expect(await screen.findByText('Import a schedule')).toBeTruthy();
  });

  it('an unknown path lands on /', async () => {
    routeFetchTo(agentFor(harness));
    open('/no/such/page');
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });
});

describe('the login page', () => {
  it('asks for the password, then shows the schedule', async () => {
    routeFetchTo(agentFor(harness));
    open(`/e/${SLUG}`);
    fireEvent.change(await screen.findByLabelText('Event password'), {
      target: { value: 'viewer-pw' },
    });
    // The password is asked on its own; the username box follows it.
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'grace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter schedule' }));
    expect((await screen.findAllByText(/Keynote/)).length).toBeGreaterThan(0);
  });
});

describe('event pages', () => {
  it('/e/:slug shows the schedule', async () => {
    await viewer();
    open(`/e/${SLUG}`);
    expect((await screen.findAllByText(/Keynote/)).length).toBeGreaterThan(0);
  });

  it('/e/:slug/s/:id opens the session over the schedule', async () => {
    await viewer();
    open(`/e/${SLUG}/s/${sessionId}`);
    expect((await screen.findAllByText(/Ada Lovelace/)).length).toBeGreaterThan(0);
  });

  it('/e/:slug/s/:id/full shows the session full-width', async () => {
    await viewer();
    open(`/e/${SLUG}/s/${sessionId}/full`);
    expect((await screen.findAllByText(/Ada Lovelace/)).length).toBeGreaterThan(0);
  });

  it('/e/:slug/search', async () => {
    await viewer();
    open(`/e/${SLUG}/search`);
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
  });

  it('/e/:slug/agenda', async () => {
    await viewer();
    open(`/e/${SLUG}/agenda`);
    expect(await screen.findByText('My agenda')).toBeTruthy();
  });

  it('/e/:slug/proposals', async () => {
    await viewer();
    open(`/e/${SLUG}/proposals`);
    expect(await screen.findByText(/pitch board|Proposal pool/)).toBeTruthy();
  });

  it('/e/:slug/p/:personId', async () => {
    await viewer();
    open(`/e/${SLUG}/p/${personId}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeTruthy();
  });

  it('/e/:slug/t/:trackId lists the track across every day', async () => {
    const track = await admin.post(`/api/e/${SLUG}/tracks`).send({ name: 'Build' }).expect(201);
    await admin
      .patch(`/api/e/${SLUG}/sessions/${sessionId}`)
      .send({ trackId: track.body.id })
      .expect(200);
    await viewer();
    open(`/e/${SLUG}/t/${track.body.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Build' })).toBeTruthy();
    expect(await screen.findByText('Keynote')).toBeTruthy();
    expect(screen.getByText('1 session')).toBeTruthy();
  });

  it('/e/:slug/t/:trackId says so when the track is gone', async () => {
    await viewer();
    open(`/e/${SLUG}/t/999`);
    expect(await screen.findByText(/No such track/)).toBeTruthy();
  });

  it('shows a viewer the composer once the organiser grants contribution.create', async () => {
    // The production bug: the composer was gated on the role's name, so the
    // grant the organiser made in the Permissions tab changed nothing on the
    // page while the server had already started accepting the viewer's notes.
    await admin
      .patch(`/api/e/${SLUG}/permissions`)
      .send({ 'contribution.create': ['viewer', 'user', 'speaker'] })
      .expect(200);
    await viewer();
    open(`/e/${SLUG}/s/${sessionId}`);
    expect(await screen.findByPlaceholderText(/Add a question/)).toBeTruthy();
  });

  it('tells a viewer which password unlocks the composer while it is closed', async () => {
    await viewer();
    open(`/e/${SLUG}/s/${sessionId}`);
    expect(await screen.findByText(/Enter the .* password/)).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Add a question/)).toBeNull();
  });

  it('/e/:slug/admin', async () => {
    routeFetchTo(admin);
    open(`/e/${SLUG}/admin`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Manage Test Conf' })).toBeTruthy();
  });
});
