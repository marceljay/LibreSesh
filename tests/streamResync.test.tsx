// @vitest-environment jsdom
import { act, cleanup, configure, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../web/src/App';
import { emitStream, installBrowserShims, routeFetchTo, settled } from './dom';
import {
  actorWithRole,
  at,
  DAY_ONE,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers';

/**
 * Which reconnects cost a bundle, from the page's side.
 *
 * Every reconnect used to: the stream retries three seconds after a drop, and
 * a room of phones on one wobbling access point turned that into a full event
 * refetch per device per wobble. The server replays the gap now, and asks for
 * a refetch only when it cannot — so the page must do exactly that, and no
 * more. Both halves are worth pinning: refetching too little leaves a schedule
 * quietly out of date, and refetching on every reconnect is the storm this set
 * out to stop.
 */

configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 20_000 });

const SLUG = 'testconf';
let harness: Harness;
let admin: Agent;
let roomId: number;
let errors: unknown[][];

beforeEach(async () => {
  installBrowserShims();
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  harness = makeHarness();
  const eventId = seedEvent(harness.db);
  roomId = seedRoom(harness.db, eventId, { name: 'Main Hall' });
  admin = await actorWithRole(harness, SLUG, 'admin-pw');
  await admin
    .post(`/api/e/${SLUG}/sessions`)
    .send({ roomId, title: 'Keynote', startsAt: at(DAY_ONE, 600), endsAt: at(DAY_ONE, 660) })
    .expect(201);
});

afterEach(async () => {
  cleanup();
  await settled();
  harness.close();
  vi.restoreAllMocks();
  expect(errors, 'console.error was called').toEqual([]);
});

/** A change the open page is never told about: written straight to the server,
 *  with no frame pushed to the stand-in stream. It appears only if the page
 *  fetches the bundle again. */
const behindThePagesBack = (title: string) =>
  admin
    .post(`/api/e/${SLUG}/sessions`)
    .send({ roomId, title, startsAt: at(DAY_ONE, 700), endsAt: at(DAY_ONE, 760) })
    .expect(201);

const openSchedule = async () => {
  routeFetchTo(admin);
  window.history.pushState({}, '', `/e/${SLUG}`);
  render(<App />);
  await screen.findAllByText(/Keynote/);
  await settled();
};

describe('a stream that could not be replayed', () => {
  it('refetches the bundle when the server says so', async () => {
    await openSchedule();
    await behindThePagesBack('Missed while away');

    act(() => emitStream('resync'));

    await waitFor(() => expect(screen.getAllByText(/Missed while away/).length).toBeGreaterThan(0));
  });
});

describe('a reconnect the server caught up', () => {
  it('costs no bundle fetch', async () => {
    await openSchedule();
    await behindThePagesBack('Should stay unseen');

    // The whole sequence a drop produces: the stream errors, then comes back.
    // That pair is what used to trigger the refetch, and the page has since
    // been handed the frames it missed, so asking for the whole event again is
    // exactly the traffic this set out to remove.
    act(() => emitStream('error'));
    act(() => emitStream('open'));
    // Settle twice over, with a turn of the event loop between: a refetch this
    // test is trying to catch would be in flight, and asserting on the screen
    // before it has landed would pass whether it happened or not.
    await settled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await settled();

    expect(screen.queryByText(/Should stay unseen/)).toBeNull();
  });
});
