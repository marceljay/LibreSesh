// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../web/src/App';
import { installBrowserShims, routeFetchTo, settled } from './dom';
import {
  actorWithRole,
  at,
  DAY_ONE,
  DAY_TWO,
  makeHarness,
  seedEvent,
  seedRoom,
  seedTag,
  type Agent,
  type Harness,
} from './helpers';

/**
 * The review queue, walked by machine as far as jsdom will carry it.
 *
 * `routes.test.tsx` proves every route mounts; this file goes a step further
 * and walks the flows the browser queue in STATUS.md asks a human to click
 * through — the hand-off from the filter panel to the search page, the export
 * checkboxes, the leave guard — against the real server. What is left for a
 * human afterwards is what jsdom genuinely cannot answer: layout, paint,
 * pointer drag, and anything measured in pixels.
 *
 * Each describe names the review item it stands in for, so a verdict on the
 * sheet can say what was machine-checked and what was not.
 */

// Generous: every one of these walks several server round trips through
// supertest, and a step that is merely slow must not read as a step that
// never happened.
configure({ asyncUtilTimeout: 15_000 });
vi.setConfig({ testTimeout: 60_000 });

const SLUG = 'testconf';

let harness: Harness;
let admin: Agent;
let eventId: number;
let roomId: number;
let tagId: number;
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
  eventId = seedEvent(harness.db);
  roomId = seedRoom(harness.db, eventId, { name: 'Main Hall' });
  tagId = seedTag(harness.db, eventId, 'design');
  admin = await actorWithRole(harness, SLUG, 'admin-pw');
});

afterEach(async () => {
  cleanup();
  await settled();
  harness.close();
  vi.restoreAllMocks();
  expect(errors, 'console.error was called').toEqual([]);
});

/** A session, through the API the form posts to. */
async function makeSession(
  title: string,
  date: string,
  startMin: number,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const res = await admin
    .post(`/api/e/${SLUG}/sessions`)
    .send({
      roomId,
      title,
      startsAt: at(date, startMin),
      endsAt: at(date, startMin + 60),
      ...extra,
    })
    .expect(201);
  return res.body.id as number;
}

describe('R21 · Search everywhere', () => {
  it('takes the day’s filters to the whole event, and lets them go there', async () => {
    await makeSession('Typography', DAY_ONE, 600, { tagIds: [tagId] });
    await makeSession('Colour', DAY_TWO, 600, { tagIds: [tagId] });
    await makeSession('Budgets', DAY_ONE, 720);
    routeFetchTo(admin);

    open(`/e/${SLUG}`);
    expect(await screen.findByText('Typography')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(await screen.findByRole('button', { name: 'design' }));
    fireEvent.click(screen.getByRole('button', { name: /Search everywhere/ }));

    expect(await screen.findByRole('link', { name: /Back to the schedule/ })).toBeTruthy();
    expect(window.location.pathname).toBe(`/e/${SLUG}/search`);
    expect(new URLSearchParams(window.location.search).get('tag')).toBe(String(tagId));

    // Both days answer the question; the untagged session does not.
    expect(screen.getByText('Typography')).toBeTruthy();
    expect(screen.getByText('Colour')).toBeTruthy();
    expect(screen.queryByText('Budgets')).toBeNull();

    // The chip is still on, and can come off here — which leaves nothing
    // asked, and a page that says so rather than listing the whole event.
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter design' }));
    expect(await screen.findByText('Search the programme')).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get('tag')).toBeNull();
  });
});

describe('R22 · Default view', () => {
  it('is a labelled field on Settings, showing the long option in full', async () => {
    routeFetchTo(admin);
    open(`/e/${SLUG}/admin?tab=settings`);

    const trigger = await screen.findByRole('combobox', { name: 'Default view' });
    expect(trigger.textContent).toContain('List — one column, in time order');
    // The width that stopped the label running under the chevron. jsdom has no
    // layout, so the class is the only thing here a machine can hold.
    expect(trigger.className).toContain('w-72');
    expect(screen.getByText(/What someone sees before they pick a view\./).textContent).toContain(
      'a chosen view travels in the link they share',
    );
  });
});

describe('R33 · Leave without saving', () => {
  it('holds you on Settings, and drops the edit only when you say so', async () => {
    routeFetchTo(admin);
    open(`/e/${SLUG}/admin?tab=settings`);

    const name = (await screen.findByLabelText('Name')) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Renamed Conf' } });
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));

    expect(await screen.findByText('Leave without saving?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Still here, still edited.
    expect(await screen.findByLabelText('Name')).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Renamed Conf');

    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave without saving' }));
    expect(await screen.findByRole('tab', { name: 'People', selected: true })).toBeTruthy();

    // And back on Settings the saved name is what is in the box.
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect((await screen.findByLabelText('Name')) as HTMLInputElement).toHaveProperty(
      'value',
      'Test Conf',
    );
  });

  it('does not ask once the settings are saved', async () => {
    routeFetchTo(admin);
    open(`/e/${SLUG}/admin?tab=settings`);

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Saved Conf' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    // The toast is the form's own word that the save landed; clicking away
    // before it is a race, not a review.
    expect(await screen.findByText('Settings saved')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(await screen.findByRole('tab', { name: 'People', selected: true })).toBeTruthy();
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });
});

describe('R5 · Link after the fact, and the edit reach', () => {
  it('offers the other times you run it, with a select-all above them', async () => {
    const first = await makeSession('Standup', DAY_ONE, 540);
    await makeSession('Standup', DAY_TWO, 540);
    await makeSession('Retro', DAY_TWO, 600);
    routeFetchTo(admin);

    open(`/e/${SLUG}/s/${first}`);
    fireEvent.click(await screen.findByRole('button', { name: /Edit session/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Link matching sessions…' }));

    // The picker asks the server which sessions qualify, so wait for the
    // answer rather than for the list to appear on its own.
    await settled();
    expect(await screen.findByRole('checkbox', { name: 'Select all' })).toBeTruthy();
    // The other run of the same title, by when it is — and nothing else.
    const boxes = screen
      .getAllByRole('checkbox')
      .map((b) => b.getAttribute('aria-label') ?? b.parentElement?.textContent);
    expect(boxes).toContain('Select all');
    expect(boxes.filter((b) => b?.includes('Jun 2 · 09:00'))).toHaveLength(1);
    expect(boxes.some((b) => b?.includes('10:00'))).toBe(false);
  });

  it('defaults to this-one-only, and applying to all never moves the others', async () => {
    const first = await makeSession('Standup', DAY_ONE, 540);
    const second = await makeSession('Standup', DAY_TWO, 540);
    // Linked through the same endpoint the picker posts to: what this is about
    // is the editor's reach afterwards.
    await admin
      .post(`/api/e/${SLUG}/sessions/link`)
      .send({ sessionIds: [first, second] })
      .expect(200);
    routeFetchTo(admin);

    open(`/e/${SLUG}/s/${first}`);
    fireEvent.click(await screen.findByRole('button', { name: /Edit session/ }));

    const thisOnly = await screen.findByRole('button', { name: 'This session only' });
    expect(thisOnly.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'All in the series' }).getAttribute('aria-pressed'),
    ).toBe('false');
    expect(screen.getByRole('button', { name: 'Unlink this one' })).toBeTruthy();

    // Applied to all: the words travel, the times do not.
    fireEvent.click(screen.getByRole('button', { name: 'All in the series' }));
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Every morning, ten minutes.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settled();

    const sibling = harness.db
      .prepare('SELECT description, starts_at FROM sessions WHERE id = ?')
      .get(second) as { description: string; starts_at: string };
    expect(sibling.description).toBe('Every morning, ten minutes.');
    expect(sibling.starts_at).toBe(at(DAY_TWO, 540));
  });
});

describe('R26 · Export what you choose', () => {
  it('greys out Contributions without Sessions, and drops both from the link', async () => {
    routeFetchTo(admin);
    open(`/e/${SLUG}/admin?tab=backup`);

    const link = await screen.findByRole('link', { name: /Download Test Conf as JSON/ });
    expect(link.getAttribute('href')).toContain('include=sessions,people,proposals,contributions');

    fireEvent.click(screen.getByRole('checkbox', { name: /Sessions/ }));

    const contributions = screen.getByRole('checkbox', {
      name: /Contributions/,
    }) as HTMLInputElement;
    expect(contributions.disabled).toBe(true);
    expect(contributions.checked).toBe(false);
    expect(screen.getByText('Only with the sessions they were posted on.')).toBeTruthy();
    expect(link.getAttribute('href')).toContain('include=people,proposals');

    // And it comes back the moment the sessions do.
    fireEvent.click(screen.getByRole('checkbox', { name: /Sessions/ }));
    expect(
      (screen.getByRole('checkbox', { name: /Contributions/ }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});

describe('R7 · Star on the grid', () => {
  it('stars from the block without opening the session', async () => {
    await makeSession('Keynote', DAY_ONE, 600);
    routeFetchTo(admin);

    open(`/e/${SLUG}?view=cal&day=${DAY_ONE}`);
    const star = await screen.findByRole('button', { name: /^Star Keynote/ });
    expect(star.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(star);

    expect(await screen.findByRole('button', { name: /^Unstar Keynote/ })).toBeTruthy();
    // The press stayed on the star: no sheet, no navigation.
    expect(window.location.pathname).toBe(`/e/${SLUG}`);
    expect(screen.queryByRole('button', { name: /Edit session/ })).toBeNull();
  });
});

describe('R10 · People table', () => {
  it('marks the sorted column, and the Columns menu adds one', async () => {
    await makeSession('Keynote', DAY_ONE, 600, { speakers: ['Ada Lovelace'] });
    routeFetchTo(admin);

    open(`/e/${SLUG}/admin?tab=people`);

    // The list opens alphabetical, and the header it is sorted by says so —
    // pressing it reverses it, and another column takes it over.
    fireEvent.click(
      await screen.findByRole('button', { name: 'Name, sorted ascending. Reverse it' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Name, sorted descending. Reverse it' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Username' }));
    expect(
      await screen.findByRole('button', { name: 'Username, sorted ascending. Reverse it' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sort by Name' })).toBeTruthy();

    // UID is off at this width; the menu puts it on, header and all.
    expect(screen.queryByRole('button', { name: 'Sort by UID' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /UID/ }));
    expect(await screen.findByRole('button', { name: 'Sort by UID' })).toBeTruthy();
  });
});

describe('R13 · Claim and queue', () => {
  it('asks for an unclaimed profile, and the organiser hands it over', async () => {
    await makeSession('Keynote', DAY_ONE, 600, { speakers: ['Ada Lovelace'] });
    const person = harness.db
      .prepare('SELECT id FROM people WHERE event_id = ? AND name = ?')
      .get(eventId, 'Ada Lovelace') as { id: number };
    const attendee = await actorWithRole(harness, SLUG, 'user-pw', 'grace');

    routeFetchTo(attendee);
    open(`/e/${SLUG}/p/${person.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'This is me' }));
    await settled();

    cleanup();
    routeFetchTo(admin);
    open(`/e/${SLUG}/admin?tab=people`);

    expect(await screen.findByText('Waiting for you (1)')).toBeTruthy();
    expect(screen.getAllByText('@grace').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await settled();

    // The profile is theirs: the queue empties and the identity holds it.
    await waitFor(() => expect(screen.queryAllByText('Waiting for you (1)')).toHaveLength(0));
    const held = harness.db
      .prepare('SELECT identity_id FROM people WHERE id = ?')
      .get(person.id) as { identity_id: number | null };
    expect(held.identity_id).not.toBeNull();
  });
});

describe('R32 · Dark mode catches up', () => {
  it('re-themes when the page comes back on screen, with no menu open', async () => {
    let osDark = false;
    const changeListeners = new Set<() => void>();
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        get matches() {
          return query.includes('prefers-color-scheme: dark') ? osDark : false;
        },
        onchange: null,
        addEventListener: (_: string, fn: () => void) => changeListeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => changeListeners.delete(fn),
        addListener: (fn: () => void) => changeListeners.add(fn),
        removeListener: (fn: () => void) => changeListeners.delete(fn),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;

    routeFetchTo(admin);
    open(`/e/${SLUG}`);
    expect(await screen.findByRole('button', { name: 'Filter' })).toBeTruthy();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    // The OS went dark while the tab was in the background, so no `change`
    // event was delivered: coming back on screen is the only signal there is.
    osDark = true;
    fireEvent(document, new Event('visibilitychange'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // And back from the bfcache, which delivers no `change` either.
    osDark = false;
    fireEvent(window, new Event('pageshow'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('R34 · A mention in a description', () => {
  it('offers the same menu as the comment box, and the saved name is a link', async () => {
    await actorWithRole(harness, SLUG, 'user-pw', 'grace');
    const id = await makeSession('Keynote', DAY_ONE, 600);
    routeFetchTo(admin);

    open(`/e/${SLUG}/s/${id}`);
    fireEvent.click(await screen.findByRole('button', { name: /Edit session/ }));

    const description = await screen.findByLabelText('Description');
    fireEvent.change(description, { target: { value: 'Ask @gra' } });

    const menu = await screen.findByRole('listbox', { name: 'People you can mention' });
    const option = within(menu).getByRole('option', { name: /@grace/ });
    // Pointer-down, not click: a click would blur the field and take the caret
    // with it, which is why the menu picks on pointer-down.
    fireEvent.pointerDown(option);
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Ask @grace ');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settled();

    // On the panel the name is a link to the profile, not plain text.
    const link = await screen.findByRole('link', { name: '@grace' });
    expect(link.getAttribute('href')).toMatch(new RegExp(`^/e/${SLUG}/p/\\d+$`));
  });
});

describe('R11 · Role badge', () => {
  it('is a pill that opens a menu of every role, ticking the one they hold', async () => {
    await actorWithRole(harness, SLUG, 'user-pw', 'grace');
    routeFetchTo(admin);
    open(`/e/${SLUG}/admin?tab=people`);

    const badge = await screen.findByRole('button', {
      name: /^Role for grace: attendee\. Change it$/,
    });
    fireEvent.click(badge);

    // Named by the badge it hangs off, which floating-ui points at with
    // `aria-labelledby` — so the label to match is the trigger's own.
    const menu = await screen.findByRole('menu', { name: /Role for grace/ });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.length).toBeGreaterThan(2);
    expect(items.filter((i) => i.getAttribute('aria-checked') === 'true')).toHaveLength(1);
  });
});

describe('R37 · The audit log links', () => {
  it('opens a live session from its title, and the actor from their name', async () => {
    const id = await makeSession('Keynote', DAY_ONE, 600);
    routeFetchTo(admin);
    open(`/e/${SLUG}/admin?tab=audit`);

    // The tab fetches its own page of the log; the titles it links are quoted.
    const title = await screen.findByRole('link', { name: /Keynote/ });
    expect(title.getAttribute('href')).toBe(`/e/${SLUG}/s/${id}`);
    // The actor is whoever made the row — this organiser, who has a profile here.
    const person = harness.db
      .prepare('SELECT id FROM people WHERE event_id = ? AND identity_id IS NOT NULL LIMIT 1')
      .get(eventId) as { id: number };
    const actor = await screen.findByRole('link', { name: /^tester_/ });
    expect(actor.getAttribute('href')).toBe(`/e/${SLUG}/p/${person.id}`);
  });
});
