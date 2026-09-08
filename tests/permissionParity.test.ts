import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Role } from '../server/src/shared/types.js';
import type { Capability } from '../server/src/shared/capabilities.js';
import {
  canContribute,
  canCreateSession,
  canEditProfile,
  canModerateContributions,
  canPitch,
  canRemoveContribution,
  canStarSessions,
  canVote,
  type Viewer,
} from '../web/src/lib/sessionPerms.js';
import {
  actorWithRole,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';

/**
 * The page and the server must agree on every capability, for every role, in
 * both settings of the switch. This walks all of them: set the matrix, read
 * the bundle back as that role the way the page does, ask the page's predicate,
 * then make the real request and see whether the server refuses it. The two
 * answers must match.
 *
 * The bug this exists for: the page decided "can this person comment?" from
 * the role's *name*, so a viewer an organiser had granted the capability to
 * never saw the composer, in production, while the server — and its tests —
 * were right all along. Nothing compared the two. This does.
 */

type Actor = { agent: Agent; role: Role; id: number };

interface Case {
  capability: Capability;
  /** What the page would decide from the bundle. */
  page: (v: Viewer, ctx: Ctx) => boolean;
  /** The request; returns the status. Set-up that itself needs the capability
   *  happens with it switched on, before the case flips it. */
  server: (a: Actor, ctx: Ctx) => Promise<number>;
}

interface Ctx {
  harness: Harness;
  admin: Agent;
  sessionId: number;
  openRoom: number;
  rooms: { openBooking: boolean }[];
  /** A contribution the actor made while allowed to, for the delete case. */
  own: Map<number, number>;
  proposalId: number;
  adminContributionId: number;
}

const OK = (status: number) => status >= 200 && status < 300;

const CASES: Case[] = [
  {
    capability: 'contribution.create',
    page: (v) => canContribute(v, false),
    server: async (a, ctx) =>
      (
        await a.agent
          .post(`/api/e/testconf/sessions/${ctx.sessionId}/contributions`)
          .send({ kind: 'note', body: 'hello' })
      ).status,
  },
  {
    capability: 'contribution.delete_own',
    page: (v) => canRemoveContribution({ createdBy: v.identityId ?? -1 }, v, false),
    server: async (a, ctx) =>
      (await a.agent.delete(`/api/e/testconf/contributions/${ctx.own.get(a.id)}`)).status,
  },
  {
    capability: 'contribution.moderate',
    page: (v) => canModerateContributions(v, false),
    server: async (a, ctx) =>
      (
        await a.agent
          .patch(`/api/e/testconf/contributions/${ctx.adminContributionId}/hidden`)
          .send({ hidden: true })
      ).status,
  },
  {
    capability: 'session.star',
    page: (v) => canStarSessions(v),
    server: async (a, ctx) =>
      (await a.agent.put(`/api/e/testconf/sessions/${ctx.sessionId}/star`)).status,
  },
  {
    capability: 'session.create_open',
    page: (v, ctx) => canCreateSession(v, ctx.rooms, false),
    server: async (a, ctx) =>
      (
        await a.agent.post('/api/e/testconf/sessions').send({
          roomId: ctx.openRoom,
          title: `By ${a.role}`,
          startsAt: '2026-06-01T10:00:00.000Z',
          endsAt: '2026-06-01T10:30:00.000Z',
        })
      ).status,
  },
  {
    capability: 'proposal.create',
    page: (v) => canPitch(v, false),
    server: async (a) =>
      (await a.agent.post('/api/e/testconf/proposals').send({ title: `Pitch by ${a.role}` }))
        .status,
  },
  {
    capability: 'proposal.vote',
    page: (v) => canVote(v),
    server: async (a, ctx) =>
      (await a.agent.put(`/api/e/testconf/proposals/${ctx.proposalId}/interest`)).status,
  },
  {
    capability: 'person.edit_own',
    page: (v) => canEditProfile({ isMine: true }, v),
    server: async (a) =>
      (await a.agent.patch('/api/e/testconf/me/profile').send({ bio: 'hi' })).status,
  },
];

const ROLES: Role[] = ['viewer', 'user', 'speaker'];

describe('the page and the server agree on every capability', () => {
  let ctx: Ctx;
  let actors: Actor[];

  const setPerm = (capability: Capability, roles: Role[]) =>
    ctx.admin
      .patch('/api/e/testconf/permissions')
      .send({ [capability]: roles })
      .expect(200);

  const viewerFor = async (a: Actor): Promise<Viewer> => {
    const bundle = (await a.agent.get('/api/e/testconf/bundle').expect(200)).body;
    return {
      role: bundle.role,
      identityId: a.id,
      myPersonIds: new Set(),
      permissions: bundle.permissions,
    };
  };

  beforeEach(async () => {
    const harness = makeHarness();
    const eventId = seedEvent(harness.db);
    seedRoom(harness.db, eventId, { name: 'Main Hall' });
    const openRoom = seedRoom(harness.db, eventId, { name: 'Open', openBooking: 1, sortOrder: 1 });
    const admin = await actorWithRole(harness, 'testconf', 'admin-pw');

    const asRole = async (role: Role): Promise<Actor> => {
      const agent = await actorWithRole(
        harness,
        'testconf',
        role === 'viewer' ? 'viewer-pw' : 'user-pw',
      );
      const id = (await agent.get('/api/me').expect(200)).body.id as number;
      if (role === 'speaker') {
        harness.db
          .prepare('UPDATE roles SET role = ? WHERE identity_id = ? AND event_id = ?')
          .run('speaker', id, eventId);
      }
      return { agent, role, id };
    };
    actors = [await asRole('viewer'), await asRole('user'), await asRole('speaker')];

    const session = await admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId: openRoom,
        title: 'Keynote',
        startsAt: '2026-06-01T08:00:00.000Z',
        endsAt: '2026-06-01T09:00:00.000Z',
      })
      .expect(201);
    const adminContribution = await admin
      .post(`/api/e/testconf/sessions/${session.body.id}/contributions`)
      .send({ kind: 'note', body: 'by the organiser' })
      .expect(201);
    const proposal = await admin
      .post('/api/e/testconf/proposals')
      .send({ title: 'A pitch to register interest in' })
      .expect(201);

    ctx = {
      harness,
      admin,
      sessionId: session.body.id,
      openRoom,
      rooms: [{ openBooking: false }, { openBooking: true }],
      own: new Map(),
      proposalId: proposal.body.id,
      adminContributionId: adminContribution.body.id,
    };

    // Everyone gets one contribution of their own while allowed to make it,
    // so the delete case has something to delete whichever way it is set.
    await setPerm('contribution.create', ['viewer', 'user', 'speaker']);
    for (const a of actors) {
      const res = await a.agent
        .post(`/api/e/testconf/sessions/${ctx.sessionId}/contributions`)
        .send({ kind: 'note', body: `mine, ${a.role}` })
        .expect(201);
      ctx.own.set(a.id, res.body.id);
    }
  });
  afterEach(() => ctx.harness.close());

  for (const c of CASES) {
    for (const role of ROLES) {
      for (const allowed of [true, false]) {
        it(`${c.capability} · ${role} · ${allowed ? 'granted' : 'withheld'}`, async () => {
          await setPerm(c.capability, allowed ? [role] : []);
          const actor = actors.find((a) => a.role === role) as Actor;
          const page = c.page(await viewerFor(actor), ctx);
          const status = await c.server(actor, ctx);
          expect(status, `server said ${status}`).not.toBe(401);
          expect(page, `page says ${page}, server said ${status}`).toBe(OK(status));
          expect(page).toBe(allowed);
        });
      }
    }
  }
});
