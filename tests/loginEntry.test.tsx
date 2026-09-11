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
 * Pressing the way in, in a real DOM: one question at a time, and a sentence
 * for every refusal.
 *
 * The login page asks for the event password alone, and turns over to the
 * username once the server has agreed with the password. What it used to do was
 * ask for both at once, with the name box below the button and behind a rule —
 * and with the button disabled until that box held something. Since a browser's
 * implicit submission works by clicking the default button, disabling it
 * swallowed Enter from the password box as well as the press, and "Pick a
 * username to enter" was a string in a handler that nothing could reach. It was
 * pinned, and passing, as exactly that: a string in the source.
 *
 * The lesson is the test rather than the fix. A message nobody can reach is
 * not a message, and only a rendered press tells the two apart.
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

/** A browser that has been to the instance and holds no role here: the
 *  identity cookie is minted before the page mounts, the way a real visit to
 *  `/` or `/events` would have done it. */
async function visitor(): Promise<void> {
  const agent = agentFor(harness);
  await agent.get('/api/me').expect(200);
  routeFetchTo(agent);
}

describe('the login page, pressed', () => {
  it('asks the password first, and the username only once it is right', async () => {
    await visitor();
    open(`/e/${SLUG}`);

    // One box to start with, and nothing typed in it: the press still lands,
    // and says what it is waiting for.
    expect(await screen.findByLabelText('Event password')).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Type the event password to enter')).toBeTruthy();

    // A wrong password does not get as far as asking for a name.
    fireEvent.change(screen.getByLabelText('Event password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('That password doesn’t match this event.')).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();

    // A right one turns the card over: the username box, on its own, with the
    // password box hidden rather than dropped — a manager needs both in the
    // form at the moment it submits — and the other ways in put away.
    fireEvent.change(screen.getByLabelText('Event password'), { target: { value: 'user-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Pick a username' })).toBeTruthy();
    expect(screen.getByLabelText('Username')).toBeTruthy();
    // The event is settled by now, so it leaves the card — and the three facts
    // about usernames go with it, behind the header's "?". One press brings
    // both back, for whoever put the phone down halfway through naming himself.
    expect(screen.queryByText(SLUG)).toBeNull();
    expect(screen.queryByText(/What you’ll be called in this event/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Explain usernames' }));
    expect(await screen.findByText(/What you’ll be called in this event/)).toBeTruthy();
    expect(screen.getByText(SLUG)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Explain usernames' }));
    expect(screen.queryByText(/What you’ll be called in this event/)).toBeNull();
    expect(screen.getByLabelText('Event password').closest('[hidden]')).not.toBeNull();
    expect(screen.queryByText('This schedule needs the event password.')).toBeNull();
    expect(
      screen
        .getByRole('button', { name: /I have a speaker code/, hidden: true })
        .closest('[hidden]'),
    ).not.toBeNull();

    // An emptied name box still gets a sentence rather than a dead button.
    fireEvent.click(screen.getByRole('button', { name: 'Enter schedule' }));
    expect(await screen.findByText('Pick a username to enter')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'grace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter schedule' }));
    expect(await screen.findByRole('button', { name: 'Filter' })).toBeTruthy();
    expect(screen.queryByLabelText('Event password')).toBeNull();
  });

  it('warns before the wait, then counts it down', async () => {
    await visitor();
    open(`/e/${SLUG}`);

    const box = await screen.findByLabelText('Event password');
    // The press, and then the wait for the button to come back from
    // "Checking…" — which is what says the answer has been rendered.
    const miss = async () => {
      fireEvent.change(box, { target: { value: 'nope' } });
      fireEvent.click(await screen.findByRole('button', { name: /Continue|Try again in/ }));
      await screen.findByRole('button', { name: /Continue|Try again in/ });
    };

    // The first two misses say only that the password is wrong: there are
    // still three attempts in hand, and naming a wait that far out is noise.
    await miss();
    expect(await screen.findByText('That password doesn’t match this event.')).toBeTruthy();
    await miss();
    expect(screen.queryByText(/more tr(y|ies) before/)).toBeNull();

    // The third leaves two, which is where the warning starts.
    await miss();
    expect(
      await screen.findByText(
        'That password doesn’t match this event. Two more tries before a two-minute wait.',
      ),
    ).toBeTruthy();
    await miss();
    expect(
      await screen.findByText(
        'That password doesn’t match this event. One more try before a two-minute wait.',
      ),
    ).toBeTruthy();

    // The fifth buys the wait, and the clock starts on that same answer
    // rather than on the next press.
    await miss();
    expect(
      await screen.findByText('That password doesn’t match this event. You can try again in 2:00.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again in 2:00' })).toBeTruthy();

    // And it ticks. The interval is a real one, so this waits for it rather
    // than sleeping a fixed second and hoping the machine kept up.
    expect(await screen.findByText(/You can try again in 1:5\d\./)).toBeTruthy();
  });

  it('shows a device that already holds a name here the same first card', async () => {
    // Entered once, then signed out of the event: the identity keeps the name
    // it claimed. That is a reason to skip the *second* step, never a reason to
    // put both questions back on the first one.
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    await agent
      .post(`/api/e/${SLUG}/auth`)
      .send({ password: 'user-pw', displayName: 'grace' })
      .expect(200);
    await agent.post(`/api/e/${SLUG}/logout`).expect(204);
    routeFetchTo(agent);

    open(`/e/${SLUG}`);
    expect(await screen.findByLabelText('Event password')).toBeTruthy();
    await settled();
    // The held name is known by now — and still not on the card.
    expect(screen.queryByLabelText('Username')).toBeNull();

    fireEvent.change(screen.getByLabelText('Event password'), { target: { value: 'user-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // In under the name it holds: the server falls back to it, so there is
    // nothing left to ask.
    expect(await screen.findByRole('button', { name: 'Filter' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: 'Pick a username' })).toBeNull();
  });

  it('asks before handing over the profile of a namesake on the programme', async () => {
    await admin
      .post(`/api/e/${SLUG}/sessions`)
      .send({
        roomId,
        title: 'Keynote',
        speakers: ['Ada Lovelace'],
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201);
    await visitor();
    open(`/e/${SLUG}`);

    fireEvent.change(await screen.findByLabelText('Event password'), {
      target: { value: 'user-pw' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.change(await screen.findByLabelText('Username'), {
      target: { value: 'Ada Lovelace' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enter schedule' }));
    await settled();

    // The same name can be a different person, so entry is refused and the
    // question asked — answering it claims the profile and enters.
    expect(await screen.findByRole('group', { name: 'Is that you?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, that’s me' }));

    expect((await screen.findAllByText('Keynote')).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Event password')).toBeNull();
  });
});
