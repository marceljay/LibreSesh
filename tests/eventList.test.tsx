// @vitest-environment jsdom
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../web/src/App';
import { installBrowserShims, routeFetchTo, settled } from './dom';
import { agentFor, makeHarness, seedEvent, type Harness } from './helpers';

/**
 * `/events` used to be one flat list in start-date order, which put three
 * unlike things side by side: the conference someone is running, the seeded
 * fixtures that exist to be clicked around in, and every event that has
 * already finished. On a demo instance the fixtures outnumbered the real
 * events; on a long-lived one the archive buried them.
 *
 * What is pinned here is the arrangement, rendered for real: which pile each
 * event lands in, that the archive is behind a button and closed by default,
 * and that an ordinary instance — where nothing is a demo — still gets the
 * plain unlabelled list it had.
 */
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 20_000 });

let harness: Harness;

const open = () => {
  window.history.pushState({}, '', '/events');
  return render(<App />);
};

/** The card is a link to the event, so its href is what identifies it —
 *  `seedEvent` gives them all the same shape otherwise. */
const card = (slug: string) => document.querySelector(`a[href="/e/${slug}"]`);

const start = (config: Parameters<typeof makeHarness>[0] = {}) => {
  harness = makeHarness(config);
  routeFetchTo(agentFor(harness));
};

beforeEach(() => {
  installBrowserShims();
});

afterEach(async () => {
  cleanup();
  await settled();
  harness.close();
  vi.restoreAllMocks();
});

describe('a demo instance separates its fixtures from the real events', () => {
  beforeEach(() => {
    start({ demoMode: true, demoEventSlugs: ['democonf'] });
    seedEvent(harness.db, { slug: 'realconf', name: 'Real Conf' });
    seedEvent(harness.db, { slug: 'democonf', name: 'Demo Conf' });
  });

  it('puts each event under its own heading', async () => {
    open();
    await screen.findByRole('heading', { name: 'Live events' });
    await screen.findByRole('heading', { name: /Demo events/ });

    const headings = [...document.querySelectorAll('h2, a[href^="/e/"]')].map((el) =>
      el.tagName === 'H2' ? el.textContent : el.getAttribute('href'),
    );
    // Order matters: the real events come first, because they are what
    // somebody who is not evaluating the product came here for.
    expect(headings).toEqual([
      'Live events',
      '/e/realconf',
      expect.stringContaining('Demo events'),
      '/e/democonf',
    ]);
  });

  it('says what a demo event is, which is that it asks for no password', async () => {
    open();
    await screen.findByRole('heading', { name: /Demo events/ });
    expect(screen.getByText(/login asks for no password/)).toBeTruthy();
    // And the blanket claim under the list stops being blanket, or the page
    // contradicts itself two paragraphs apart.
    expect(screen.getByText(/Apart from the demo events/)).toBeTruthy();
  });
});

describe('an ordinary instance gets the plain list it had', () => {
  it('labels nothing, because there is nothing to tell apart', async () => {
    // Same slug, no demo mode: `demoEventSlugs` is empty off a demo instance,
    // and an event there really does check a password. Naming it a demo would
    // say the opposite of what its login does.
    start();
    seedEvent(harness.db, { slug: 'democonf', name: 'Demo Conf' });
    seedEvent(harness.db, { slug: 'realconf', name: 'Real Conf' });

    open();
    await waitFor(() => expect(card('democonf')).toBeTruthy());
    expect(card('realconf')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Demo events/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Live events' })).toBeNull();
  });
});

describe('the archive is a button, not a pile on the page', () => {
  beforeEach(() => {
    start();
    seedEvent(harness.db, { slug: 'thisyear', name: 'This Year' });
    seedEvent(harness.db, { slug: 'lastyear', name: 'Last Year', archived: 1 });
    seedEvent(harness.db, { slug: 'yearbefore', name: 'Year Before', archived: 1 });
  });

  it('counts the archived events and keeps them out of the list', async () => {
    open();
    const button = await screen.findByRole('button', { name: 'Archived (2)' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(card('thisyear')).toBeTruthy();
    expect(card('lastyear')).toBeNull();
  });

  it('shows them on a click and puts them away again', async () => {
    open();
    const button = await screen.findByRole('button', { name: 'Archived (2)' });

    fireEvent.click(button);
    await waitFor(() => expect(card('lastyear')).toBeTruthy());
    expect(card('yearbefore')).toBeTruthy();
    const open_ = screen.getByRole('button', { name: 'Hide archived' });
    expect(open_.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(open_);
    await waitFor(() => expect(card('lastyear')).toBeNull());
    expect(screen.getByRole('button', { name: 'Archived (2)' })).toBeTruthy();
  });
});

describe('an instance whose events are all archived is not an empty one', () => {
  it('says so, and still offers the archive', async () => {
    // Otherwise the page reads as a box with nothing on it to somebody who
    // has simply finished every conference they ran.
    start();
    seedEvent(harness.db, { slug: 'lastyear', name: 'Last Year', archived: 1 });

    open();
    await screen.findByText('Every event here is archived.');
    expect(screen.queryByText(/No events yet/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Archived (1)' })).toBeTruthy();
  });
});
