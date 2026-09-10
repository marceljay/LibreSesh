// @vitest-environment jsdom
import { cleanup, configure, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '../server/src/shared/capabilities.js';
import type { Role } from '../server/src/shared/types.js';
import { App } from '../web/src/App';
import { installBrowserShims, routeFetchTo, settled } from './dom';
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
 * Every control the permission matrix governs, rendered for every role with
 * the capability granted and withheld, and looked for in the DOM by its
 * accessible name.
 *
 * The parity sweep proves each page predicate agrees with the server. This
 * proves the predicate reaches the pixel: that the star, the composer, Hide,
 * Remove, Add session, Edit session, Pitch a session, the interest button and
 * Edit full name actually appear and vanish. A predicate wired to the wrong
 * control, or to none, passes the parity sweep and fails here.
 *
 * Phase 2 of _planning/plans/2026-09-08-permission-integrity.md.
 */

configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const SLUG = 'testconf';
/** Adding and pitching share one button; its name says which ways in it has. */
const ADD_SESSION = /^Add (session|or pitch a session)$/;
const ROLES: Role[] = ['viewer', 'user', 'speaker'];

interface Actor {
  role: Role;
  agent: Agent;
  id: number;
  /** An open session they created, a contribution they wrote, a pitch they
   *  made and the profile they hold — each made while allowed to. */
  sessionId: number;
  contributionId: number;
  proposalId: number;
  personId: number;
}

interface Control {
  capability: Capability;
  /** Where to look; `a` is the actor being rendered. */
  path: (a: Actor) => string;
  /** Something on that page that is there whatever the matrix says, so the
   *  absent case waits for the page and not for a timeout. */
  anchor: () => Promise<unknown>;
  /** How many matching controls are on the page. */
  count: () => number;
}

let harness: Harness;
let admin: Agent;
let adminSessionId: number;
let actors: Actor[];
let errors: unknown[][];

const CONTROLS: Control[] = [
  {
    capability: 'session.star',
    path: () => `/e/${SLUG}/s/${adminSessionId}`,
    anchor: () => screen.findByText('Keynote', { selector: 'h1, h2' }),
    count: () => screen.queryAllByRole('button', { name: /^(Star|Unstar) Keynote$/ }).length,
  },
  {
    capability: 'contribution.create',
    path: () => `/e/${SLUG}/s/${adminSessionId}`,
    anchor: () => screen.findByText('Keynote', { selector: 'h1, h2' }),
    count: () => screen.queryAllByPlaceholderText(/Add a (question|note|link)/).length,
  },
  {
    // The sheet collapses contributions past a count; the full page shows
    // them all, which is where every note, the organiser's included, is.
    capability: 'contribution.delete_own',
    path: () => `/e/${SLUG}/s/${adminSessionId}/full`,
    anchor: () => screen.findByText(/by the organiser/),
    count: () => screen.queryAllByRole('button', { name: 'Remove this contribution' }).length,
  },
  {
    capability: 'contribution.moderate',
    path: () => `/e/${SLUG}/s/${adminSessionId}/full`,
    anchor: () => screen.findByText(/by the organiser/),
    count: () =>
      screen.queryAllByRole('button', { name: /^(Hide|Unhide) this contribution$/ }).length,
  },
  {
    capability: 'session.create_open',
    path: () => `/e/${SLUG}`,
    anchor: () => screen.findAllByText(/Keynote/),
    // One control now, and its name says how many ways in it offers: "Add
    // session" alone, "Add or pitch a session" when the board is open too.
    count: () => screen.queryAllByRole('button', { name: ADD_SESSION }).length,
  },
  {
    capability: 'session.edit_own',
    path: (a) => `/e/${SLUG}/s/${a.sessionId}`,
    anchor: () => screen.findByText(/^Mine, /, { selector: 'h1, h2' }),
    count: () => screen.queryAllByRole('button', { name: 'Edit session' }).length,
  },
  {
    capability: 'proposal.create',
    path: () => `/e/${SLUG}/proposals`,
    anchor: () => screen.findByText('Proposal pool'),
    count: () =>
      screen.queryAllByRole('button', { name: 'Pitch a session' }).length +
      screen.queryAllByRole('button', { name: 'Withdraw' }).length,
  },
  {
    capability: 'proposal.vote',
    path: () => `/e/${SLUG}/proposals`,
    anchor: () => screen.findByText('Proposal pool'),
    count: () =>
      screen.queryAllByRole('button', { name: /I'd come to this|I'm no longer interested/ }).length,
  },
  {
    capability: 'person.edit_own',
    path: (a) => `/e/${SLUG}/p/${a.personId}`,
    anchor: () => screen.findByRole('heading', { level: 1 }),
    count: () => screen.queryAllByRole('button', { name: 'Edit full name' }).length,
  },
];

const setPerm = (capability: Capability, roles: Role[]) =>
  admin
    .patch(`/api/e/${SLUG}/permissions`)
    .send({ [capability]: roles })
    .expect(200);

const open = (path: string) => {
  window.history.pushState({}, '', path);
  return render(<App />);
};

beforeAll(async () => {
  installBrowserShims();
  harness = makeHarness();
  const eventId = seedEvent(harness.db);
  const openRoom = seedRoom(harness.db, eventId, { name: 'Open', openBooking: 1 });
  admin = await actorWithRole(harness, SLUG, 'admin-pw');
  adminSessionId = (
    await admin
      .post(`/api/e/${SLUG}/sessions`)
      .send({
        roomId: openRoom,
        title: 'Keynote',
        startsAt: at(DAY_ONE, 600),
        endsAt: at(DAY_ONE, 660),
      })
      .expect(201)
  ).body.id;
  await admin
    .post(`/api/e/${SLUG}/sessions/${adminSessionId}/contributions`)
    .send({ kind: 'note', body: 'A note by the organiser' })
    .expect(201);
  await admin.post(`/api/e/${SLUG}/proposals`).send({ title: 'The organiser’s pitch' }).expect(201);

  // Everything an actor owns is made with every switch on; the tests then
  // set the one switch they are about.
  for (const c of CONTROLS) await setPerm(c.capability, ROLES);
  actors = [];
  let start = 700;
  for (const role of ROLES) {
    const agent = await actorWithRole(harness, SLUG, role === 'viewer' ? 'viewer-pw' : 'user-pw');
    const id = (await agent.get('/api/me').expect(200)).body.id as number;
    if (role === 'speaker') {
      harness.db
        .prepare('UPDATE roles SET role = ? WHERE identity_id = ? AND event_id = ?')
        .run('speaker', id, eventId);
    }
    const sessionId = (
      await agent
        .post(`/api/e/${SLUG}/sessions`)
        .send({
          roomId: openRoom,
          title: `Mine, ${role}`,
          startsAt: at(DAY_ONE, start),
          endsAt: at(DAY_ONE, start + 30),
        })
        .expect(201)
    ).body.id;
    start += 60;
    const contributionId = (
      await agent
        .post(`/api/e/${SLUG}/sessions/${adminSessionId}/contributions`)
        .send({ kind: 'note', body: `A note by the ${role}` })
        .expect(201)
    ).body.id;
    const proposalId = (
      await agent
        .post(`/api/e/${SLUG}/proposals`)
        .send({ title: `Pitch by the ${role}` })
        .expect(201)
    ).body.id;
    const personId = (
      await agent
        .patch(`/api/e/${SLUG}/me/profile`)
        .send({ bio: `${role} here` })
        .expect(200)
    ).body.id;
    actors.push({ role, agent, id, sessionId, contributionId, proposalId, personId });
  }
});

afterAll(async () => {
  await settled();
  harness.close();
});

beforeEach(() => {
  // One server for the whole file, so the per-address read budget would run
  // out halfway through; a page refused a bundle is not a permission finding.
  harness.app.ctx.limiter.reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  expect(errors, 'console.error was called').toEqual([]);
});

describe('every matrix-governed control, rendered per role', () => {
  for (const control of CONTROLS) {
    for (const role of ROLES) {
      for (const granted of [true, false]) {
        it(`${control.capability} · ${role} · ${granted ? 'granted → shown' : 'withheld → absent'}`, async () => {
          errors = [];
          vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
            errors.push(args);
          });
          await setPerm(control.capability, granted ? [role] : []);
          const actor = actors.find((a) => a.role === role) as Actor;
          routeFetchTo(actor.agent);
          open(control.path(actor));
          await control.anchor();
          if (granted) {
            await waitFor(() => expect(control.count()).toBeGreaterThan(0));
          } else {
            // The anchor is up; give any late render a moment, then look.
            await settled();
            expect(control.count()).toBe(0);
          }
          await settled();
        });
      }
    }
  }

  it('session.create_open · granted, but no room open for booking → absent', async () => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const actor = actors[1] as Actor; // the attendee
    await setPerm('session.create_open', ROLES);
    const rooms = (await admin.get(`/api/e/${SLUG}/bundle`).expect(200)).body.rooms as {
      id: number;
    }[];
    for (const r of rooms)
      await admin.patch(`/api/e/${SLUG}/rooms/${r.id}`).send({ openBooking: false }).expect(200);
    try {
      routeFetchTo(actor.agent);
      open(`/e/${SLUG}`);
      await screen.findAllByText(/Keynote/);
      await settled();
      expect(screen.queryAllByRole('button', { name: ADD_SESSION })).toHaveLength(0);
    } finally {
      for (const r of rooms)
        await admin.patch(`/api/e/${SLUG}/rooms/${r.id}`).send({ openBooking: true }).expect(200);
    }
  });
});
