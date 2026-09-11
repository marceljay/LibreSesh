// @vitest-environment jsdom
import { cleanup, configure, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../web/src/App';
import { installBrowserShims, routeFetchTo, settled } from './dom';
import { agentFor, makeHarness, seedEvent, type Harness } from './helpers';

/**
 * The About box's demo line, on a demo instance.
 *
 * A demo instance hosts the demo fixtures and real events side by side. The
 * line used to follow the instance-wide `demoMode`, so every real event on a
 * demo instance told its visitors "the data here is reset" — which is untrue
 * of any event but a fixture, and nothing reseeds even those on a schedule.
 */

configure({ asyncUtilTimeout: 15_000 });
vi.setConfig({ testTimeout: 60_000 });

const DEMO = 'testconf';
const REAL = 'realconf';
const LINE = 'demo event — the data here may be reset';

let harness: Harness;

beforeEach(() => {
  installBrowserShims();
  // `demoMode: true` makes `testconf` the demo fixture; `realconf` is a real
  // event on the same instance, with passwords.
  harness = makeHarness({ demoMode: true });
  seedEvent(harness.db, { slug: DEMO });
  seedEvent(harness.db, { slug: REAL });
});

afterEach(async () => {
  cleanup();
  await settled();
  harness.close();
});

/**
 * The account chip is named by its text — the username and the role. `/me`
 * arrives on its own request, and the About box reads the demo slugs from it,
 * so the menu is opened and the identity line awaited in it — it renders only
 * once `/me` has — before About is. Pressed any sooner, a missing demo line
 * would prove only that `/me` was late.
 */
async function openAbout(slug: string, name: string): Promise<void> {
  window.history.pushState({}, '', `/e/${slug}`);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}`) }));
  await screen.findByTitle(/Your identity on this instance/);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'About LibreSesh' }));
  await screen.findByRole('heading', { name: 'About LibreSesh' });
}

describe('the demo line in About, on a demo instance', () => {
  it('is absent on a real event', async () => {
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    await agent
      .post(`/api/e/${REAL}/auth`)
      .send({ password: 'viewer-pw', displayName: 'reader' })
      .expect(200);
    routeFetchTo(agent);

    await openAbout(REAL, 'reader');
    expect(screen.queryByText(LINE)).toBeNull();
  });

  it('is shown on a demo event', async () => {
    const agent = agentFor(harness);
    await agent.get('/api/me').expect(200);
    // A demo event's login is a role picker: no password to send.
    await agent
      .post(`/api/e/${DEMO}/auth`)
      .send({ role: 'viewer', displayName: 'visitor' })
      .expect(200);
    routeFetchTo(agent);

    await openAbout(DEMO, 'visitor');
    expect(screen.getByText(LINE)).toBeTruthy();
  });
});
