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
 * A speaker editing the session they are credited on, in a real DOM.
 *
 * `sessionPerms.test.ts` says the server lets them: their words, not their
 * slot. The form did not. Rooms were filtered to the ones open for booking,
 * because that is the rule for *placing* a session — so a speaker on an
 * organiser's stage opened the editor to an empty Room box, the "no room here
 * is open for booking yet, so there is nowhere for you to add a session"
 * notice, and a Save button disabled for want of a room to book. The one thing
 * that was theirs to change could not be saved.
 */

configure({ asyncUtilTimeout: 15_000 });
vi.setConfig({ testTimeout: 60_000 });

const SLUG = 'testconf';

let harness: Harness;
let admin: Agent;
let roomId: number;
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
  // Not open for booking: an organiser's stage, which is the usual case and
  // the one that broke.
  roomId = seedRoom(harness.db, eventId, { name: 'Main Hall' });
  admin = await actorWithRole(harness, SLUG, 'admin-pw');
});

afterEach(async () => {
  cleanup();
  await settled();
  harness.close();
  vi.restoreAllMocks();
  expect(errors, 'console.error was called').toEqual([]);
});

describe('a credited speaker in the session form', () => {
  it('may change the words, not the slot, and cannot delete it', async () => {
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
    const id = created.body.id as number;

    // Ada arrives and claims the profile the organiser named her on.
    const ada = agentFor(harness);
    await ada.get('/api/me').expect(200);
    await ada
      .post(`/api/e/${SLUG}/auth`)
      .send({ password: 'user-pw', displayName: 'Ada Lovelace', claimProfile: true })
      .expect(200);
    routeFetchTo(ada);

    open(`/e/${SLUG}/s/${id}`);
    fireEvent.click(await screen.findByRole('button', { name: /Edit session/ }));

    expect(
      await screen.findByText(/You are credited on this session, so you can edit what it says/),
    ).toBeTruthy();
    expect(screen.queryByText(/nowhere for you to add a session/)).toBeNull();
    // The room it is in is named, and is not hers to change.
    expect(screen.getByRole('combobox', { name: 'Room' }).textContent).toBe('Main Hall');
    for (const field of ['Room', 'Day', 'Duration']) {
      expect(screen.getByRole('combobox', { name: field }).hasAttribute('disabled')).toBe(true);
    }
    expect((screen.getByLabelText('Start') as HTMLInputElement).disabled).toBe(true);
    // Delete belongs to whoever owns the session, and this is not hers.
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Now with slides.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settled();

    const saved = harness.db
      .prepare('SELECT description, starts_at, room_id FROM sessions WHERE id = ?')
      .get(id) as { description: string; starts_at: string; room_id: number };
    expect(saved.description).toBe('Now with slides.');
    expect(saved.starts_at).toBe(at(DAY_ONE, 600));
    expect(saved.room_id).toBe(roomId);
  });
});
