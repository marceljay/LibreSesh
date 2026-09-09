// @vitest-environment jsdom
import { act, cleanup, configure, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../web/src/App';
import { emitChange, installBrowserShims, routeFetchTo, settled } from './dom';
import {
  actorWithRole,
  at,
  DAY_ONE,
  makeHarness,
  seedEvent,
  seedRoom,
  type Harness,
} from './helpers';

/**
 * An open page follows its own role change without a reload. The stream
 * frame is pushed through the test's stand-in EventSource; what is under
 * test is that the page applies it and re-derives its controls.
 * Phase 3 of _planning/plans/2026-09-08-permission-integrity.md.
 */

configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 20_000 });

const SLUG = 'testconf';
let harness: Harness;
let errors: unknown[][];

beforeEach(async () => {
  installBrowserShims();
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
  harness = makeHarness();
  const eventId = seedEvent(harness.db);
  // No room open for booking: only an organiser gets Add session.
  const room = seedRoom(harness.db, eventId, { name: 'Main Hall' });
  const admin = await actorWithRole(harness, SLUG, 'admin-pw');
  await admin
    .post(`/api/e/${SLUG}/sessions`)
    .send({ roomId: room, title: 'Keynote', startsAt: at(DAY_ONE, 600), endsAt: at(DAY_ONE, 660) })
    .expect(201);
});

afterEach(async () => {
  cleanup();
  await settled();
  harness.close();
  vi.restoreAllMocks();
  expect(errors, 'console.error was called').toEqual([]);
});

const addSession = () => screen.queryAllByRole('button', { name: 'Add session' });

describe('a page follows its own role change', () => {
  it('gains the organiser controls on promotion, and loses them on demotion', async () => {
    routeFetchTo(await actorWithRole(harness, SLUG, 'viewer-pw'));
    window.history.pushState({}, '', `/e/${SLUG}`);
    render(<App />);
    await screen.findAllByText(/Keynote/);
    await settled();
    expect(addSession()).toHaveLength(0);

    act(() => emitChange({ type: 'role.updated', entity: { role: 'admin' } }));
    await waitFor(() => expect(addSession()).toHaveLength(1));

    act(() => emitChange({ type: 'role.updated', entity: { role: 'viewer' } }));
    await waitFor(() => expect(addSession()).toHaveLength(0));
  });
});
