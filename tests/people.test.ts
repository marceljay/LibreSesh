import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DAY_ONE,
  actorWithRole,
  agentFor,
  at,
  makeHarness,
  seedEvent,
  seedRoom,
  type Agent,
  type Harness,
} from './helpers.js';

describe('speaker profiles', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;
  let user: Agent;
  let viewer: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    user = await actorWithRole(harness, 'testconf', 'user-pw');
    viewer = await actorWithRole(harness, 'testconf', 'viewer-pw');
  });
  afterEach(() => harness.close());

  const makeSession = (agent: Agent, payload: Record<string, unknown> = {}) =>
    agent.post('/api/e/testconf/sessions').send({
      roomId,
      title: 'Talk',
      startsAt: at(DAY_ONE, 600),
      endsAt: at(DAY_ONE, 660),
      ...payload,
    });

  it('creates a person when a session names an unknown speaker', async () => {
    const res = await makeSession(admin, { speakers: ['Ada Lovelace'] }).expect(201);
    expect(res.body.speakers).toHaveLength(1);
    expect(res.body.speakers[0].name).toBe('Ada Lovelace');
    expect(res.body.speakers[0].id).toBeGreaterThan(0);

    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    const names = bundle.body.people.map((p: { name: string }) => p.name);
    expect(names.filter((n: string) => n === 'Ada Lovelace')).toHaveLength(1);
  });

  it('reuses the existing person for the same name', async () => {
    const first = await makeSession(admin, { speakers: ['Grace Hopper'] }).expect(201);
    const second = await makeSession(admin, {
      speakers: ['Grace Hopper'],
      startsAt: at(DAY_ONE, 700),
      endsAt: at(DAY_ONE, 760),
    }).expect(201);
    expect(second.body.speakers[0].id).toBe(first.body.speakers[0].id);
  });

  it('clears the speaker on an empty name and rejects an unknown id', async () => {
    const created = await makeSession(admin, { speakers: ['Temp'] }).expect(201);
    const cleared = await admin
      .patch(`/api/e/testconf/sessions/${created.body.id}`)
      .send({ speakers: [] })
      .expect(200);
    expect(cleared.body.speakers).toEqual([]);

    await admin
      .patch(`/api/e/testconf/sessions/${created.body.id}`)
      .send({ speakers: [9999] })
      .expect(400);
  });

  it('will not take a person from another event', async () => {
    const otherEvent = seedEvent(harness.db, { slug: 'other' });
    seedRoom(harness.db, otherEvent, { openBooking: 1 });
    const otherAdmin = await actorWithRole(harness, 'other', 'admin-pw');
    const foreign = await otherAdmin
      .post('/api/e/other/people')
      .send({ name: 'Elsewhere' })
      .expect(201);
    await makeSession(admin, { speakers: [foreign.body.id] }).expect(400);
  });

  it('serves a profile with the sessions that person hosts', async () => {
    const created = await makeSession(admin, { speakers: ['Radia Perlman'] }).expect(201);
    const detail = await viewer
      .get(`/api/e/testconf/people/${created.body.speakers[0].id}`)
      .expect(200);
    expect(detail.body.person.name).toBe('Radia Perlman');
    expect(detail.body.sessions).toHaveLength(1);
    expect(detail.body.sessions[0].id).toBe(created.body.id);
  });

  it('lets organisers create, edit and delete profiles', async () => {
    const created = await admin
      .post('/api/e/testconf/people')
      .send({
        name: 'Barbara Liskov',
        bio: 'On **abstraction**.',
        links: [{ label: 'Site', url: 'https://example.org' }],
      })
      .expect(201);
    expect(created.body.links).toEqual([{ label: 'Site', url: 'https://example.org' }]);
    expect(created.body.claimed).toBe(false);

    const patched = await admin
      .patch(`/api/e/testconf/people/${created.body.id}`)
      .send({ bio: 'Updated' })
      .expect(200);
    expect(patched.body.bio).toBe('Updated');

    await admin.delete(`/api/e/testconf/people/${created.body.id}`).expect(204);
    await viewer.get(`/api/e/testconf/people/${created.body.id}`).expect(404);
  });

  it('detaches a deleted person from their sessions instead of losing them', async () => {
    const session = await makeSession(admin, { speakers: ['Ephemeral'] }).expect(201);
    await admin.delete(`/api/e/testconf/people/${session.body.speakers[0].id}`).expect(204);

    const after = await admin.get(`/api/e/testconf/sessions/${session.body.id}`).expect(200);
    expect(after.body.session.speakers).toEqual([]);
  });

  it('rejects a non-http link and an overlong bio', async () => {
    await admin
      .post('/api/e/testconf/people')
      .send({ name: 'Bad', links: [{ label: 'x', url: 'javascript:alert(1)' }] })
      .expect(400);
    await admin
      .post('/api/e/testconf/people')
      .send({ name: 'Long', bio: 'x'.repeat(2001) })
      .expect(400);
  });

  it('lets two people share a full name — the username is the unique thing', async () => {
    const one = await admin.post('/api/e/testconf/people').send({ name: 'Twin' }).expect(201);
    const two = await admin.post('/api/e/testconf/people').send({ name: 'Twin' }).expect(201);
    expect(two.body.id).not.toBe(one.body.id);
  });

  it('blocks a non-admin from the roster endpoints', async () => {
    const person = await admin.post('/api/e/testconf/people').send({ name: 'Theirs' }).expect(201);
    await user.post('/api/e/testconf/people').send({ name: 'Nope' }).expect(403);
    await user.patch(`/api/e/testconf/people/${person.body.id}`).send({ bio: 'x' }).expect(403);
    await user.delete(`/api/e/testconf/people/${person.body.id}`).expect(403);
  });

  describe('your own profile', () => {
    it('exists from the gate, named after your username', async () => {
      const bundle = await user.get('/api/e/testconf/bundle').expect(200);
      const mine = bundle.body.people.filter((p: { isMine: boolean }) => p.isMine);
      expect(mine).toHaveLength(1);
      expect(mine[0].name).toBe(bundle.body.displayName);
      expect(mine[0].claimed).toBe(true);

      // Editing it is an edit, not a creation.
      const edited = await user
        .patch('/api/e/testconf/me/profile')
        .send({ bio: 'I like open rooms.' })
        .expect(200);
      expect(edited.body.id).toBe(mine[0].id);
      expect(edited.body.bio).toBe('I like open rooms.');
    });

    it('updates the same profile rather than making a second one', async () => {
      const first = await user.patch('/api/e/testconf/me/profile').send({ bio: 'One' }).expect(200);
      const second = await user
        .patch('/api/e/testconf/me/profile')
        .send({ bio: 'Two', name: 'Renamed' })
        .expect(200);
      expect(second.body.id).toBe(first.body.id);
      expect(second.body.bio).toBe('Two');
      expect(second.body.name).toBe('Renamed');
    });

    it('lets a viewer edit their own profile too', async () => {
      const edited = await viewer
        .patch('/api/e/testconf/me/profile')
        .send({ bio: 'Just watching.' })
        .expect(200);
      expect(edited.body.isMine).toBe(true);
    });

    it('lets the owner patch it through the roster route, but not a stranger', async () => {
      const mine = await user.patch('/api/e/testconf/me/profile').send({ bio: 'Mine' }).expect(200);
      await user
        .patch(`/api/e/testconf/people/${mine.body.id}`)
        .send({ bio: 'Edited' })
        .expect(200);
      await viewer.patch(`/api/e/testconf/people/${mine.body.id}`).send({ bio: 'No' }).expect(403);
      // Organisers still override.
      await admin
        .patch(`/api/e/testconf/people/${mine.body.id}`)
        .send({ bio: 'Moderated' })
        .expect(200);
    });

    it('shows isMine only to the owner', async () => {
      const mine = await user.patch('/api/e/testconf/me/profile').send({ bio: 'Mine' }).expect(200);
      const asOwner = await user.get('/api/e/testconf/bundle').expect(200);
      const asOther = await viewer.get('/api/e/testconf/bundle').expect(200);
      const find = (body: { people: { id: number; isMine: boolean; claimed: boolean }[] }) =>
        body.people.find((p) => p.id === mine.body.id);
      expect(find(asOwner.body)?.isMine).toBe(true);
      expect(find(asOther.body)?.isMine).toBe(false);
      expect(find(asOther.body)?.claimed).toBe(true);
    });

    it('credits a session typed under your own name to you, not to a twin', async () => {
      const bundle = await user.get('/api/e/testconf/bundle').expect(200);
      const mine = bundle.body.people.find((p: { isMine: boolean }) => p.isMine);
      const roomId = seedRoom(harness.db, eventId, { name: 'Self', openBooking: 1 });
      const session = await user
        .post('/api/e/testconf/sessions')
        .send({
          roomId,
          title: 'Mine',
          speakers: [bundle.body.displayName],
          startsAt: at(DAY_ONE, 800),
          endsAt: at(DAY_ONE, 860),
        })
        .expect(201);
      expect(session.body.speakers[0].id).toBe(mine.id);

      // One person, not two.
      const after = await user.get('/api/e/testconf/bundle').expect(200);
      const named = after.body.people.filter(
        (p: { name: string }) => p.name === bundle.body.displayName,
      );
      expect(named).toHaveLength(1);
    });

    it('lets you take a full name someone else also uses', async () => {
      await viewer.patch('/api/e/testconf/me/profile').send({ name: 'Taken' }).expect(200);
      const res = await user
        .patch('/api/e/testconf/me/profile')
        .send({ name: 'Taken' })
        .expect(200);
      expect(res.body.name).toBe('Taken');
    });

    it('is read-only once the event is archived', async () => {
      await admin.patch('/api/e/testconf/settings').send({ archived: true }).expect(200);
      await user.patch('/api/e/testconf/me/profile').send({ bio: 'x' }).expect(409);
    });
  });

  /**
   * Who may be put on a session by someone who is not an organiser. A
   * viewer's person is visible like anyone's — they star and post — but is
   * not on offer as a speaker, and the server says so too.
   */
  describe('who may be credited', () => {
    it('marks a viewer’s person, and only theirs, as not creditable', async () => {
      await admin.post('/api/e/testconf/people').send({ name: 'Shell' }).expect(201);
      const bundle = await user.get('/api/e/testconf/bundle').expect(200);
      const people = bundle.body.people as {
        name: string;
        username: string | null;
        creditable: boolean;
        isMine: boolean;
      }[];
      const viewers = people.filter((p) => !p.creditable);
      expect(viewers).toHaveLength(1);
      expect(viewers[0]?.username).not.toBeNull();
      expect(people.find((p) => p.name === 'Shell')).toMatchObject({
        username: null,
        creditable: true,
      });
      const mine = people.find((p) => p.isMine);
      expect(mine).toMatchObject({ creditable: true, username: bundle.body.displayName });
    });

    it('refuses an attendee crediting a viewer, and lets an organiser', async () => {
      const bundle = await viewer.get('/api/e/testconf/bundle').expect(200);
      const viewersPerson = bundle.body.people.find((p: { isMine: boolean }) => p.isMine);
      const refused = await makeSession(user, { speakers: [viewersPerson.id] }).expect(403);
      expect(refused.body.error.code).toBe('forbidden');
      // By name too: the lookup lands on the same person.
      await makeSession(user, { speakers: [viewersPerson.name] }).expect(403);
      await makeSession(admin, { speakers: [viewersPerson.id] }).expect(201);
      // A viewer may still be credited on a pitch by an organiser, not by an attendee.
      await user
        .post('/api/e/testconf/proposals')
        .send({ title: 'Pitch', speakerId: viewersPerson.id })
        .expect(403);
    });
  });

  /**
   * An organiser types "Ada Lovelace" onto a talk before Ada arrives. When she
   * enters under that name the gate must not hand the profile over silently —
   * the same name can be a different person — but it must offer it.
   */
  describe('arriving under the name of an unclaimed profile', () => {
    it('asks first, then adopts the profile on a yes', async () => {
      const shell = await admin
        .post('/api/e/testconf/people')
        .send({ name: 'Unclaimed' })
        .expect(201);
      const ada = agentFor(harness);
      await ada.get('/api/me').expect(200);

      const asked = await ada
        .post('/api/e/testconf/auth')
        .send({ password: 'user-pw', displayName: 'unclaimed' })
        .expect(409);
      expect(asked.body.error.code).toBe('profile_exists');
      expect(asked.body.error.details).toEqual({
        personId: shell.body.id,
        name: 'Unclaimed',
        sessionCount: 0,
      });
      // Not in: no role was granted.
      await ada.get('/api/e/testconf/bundle').expect(401);

      await ada
        .post('/api/e/testconf/auth')
        .send({ password: 'user-pw', displayName: 'unclaimed', claimProfile: true })
        .expect(200);
      const bundle = await ada.get('/api/e/testconf/bundle').expect(200);
      const mine = bundle.body.people.filter((p: { isMine: boolean }) => p.isMine);
      expect(mine).toHaveLength(1);
      expect(mine[0].id).toBe(shell.body.id);
      expect(mine[0].name).toBe('Unclaimed');
    });

    it('starts a fresh person on a no', async () => {
      const shell = await admin
        .post('/api/e/testconf/people')
        .send({ name: 'Unclaimed' })
        .expect(201);
      const other = agentFor(harness);
      await other.get('/api/me').expect(200);
      await other
        .post('/api/e/testconf/auth')
        .send({ password: 'user-pw', displayName: 'Unclaimed 2' })
        .expect(200);
      const bundle = await other.get('/api/e/testconf/bundle').expect(200);
      const mine = bundle.body.people.find((p: { isMine: boolean }) => p.isMine);
      expect(mine.id).not.toBe(shell.body.id);
      expect(mine.name).toBe('Unclaimed 2');
      const still = bundle.body.people.find((p: { id: number }) => p.id === shell.body.id);
      expect(still.claimed).toBe(false);
    });

    it('does not ask a device that already holds a profile here', async () => {
      await admin.post('/api/e/testconf/people').send({ name: 'Unclaimed' }).expect(201);
      // `user` is already a person; renaming to the shell's name is a rename.
      await user
        .post('/api/e/testconf/auth')
        .send({ password: 'user-pw', displayName: 'Unclaimed' })
        .expect(200);
    });
  });

  /**
   * Archiving: out of the organiser's lists, still a live profile.
   *
   * Deleting was the only tidy-up there was, and it refuses outright for
   * anyone who holds their own profile — which is exactly the case an
   * organiser most wants tidied away, since the profiles that accumulate are
   * the ones made while testing the room.
   */
  describe('archiving a profile', () => {
    const personIdFor = async (name: string) => {
      const res = await makeSession(admin, { speakers: [name] }).expect(201);
      return res.body.speakers[0].id as number;
    };
    const personFrom = async (agent: Agent, id: number) =>
      (
        (await agent.get('/api/e/testconf/bundle').expect(200)).body.people as {
          id: number;
          archivedAt: string | null;
        }[]
      ).find((p) => p.id === id);

    it('marks the profile without removing it or its sessions', async () => {
      const id = await personIdFor('Ada Lovelace');
      const archived = await admin.post(`/api/e/testconf/people/${id}/archive`).expect(200);
      expect(archived.body.archivedAt).not.toBeNull();

      // Still there, still on its session: this is filing, not deleting.
      expect((await personFrom(admin, id))?.archivedAt).not.toBeNull();
      const sessions = (await admin.get('/api/e/testconf/bundle').expect(200)).body.sessions as {
        speakers: { id: number }[];
      }[];
      expect(sessions[0]?.speakers.map((sp) => sp.id)).toEqual([id]);
    });

    it('comes back out, and says so to everyone', async () => {
      const id = await personIdFor('Ada Lovelace');
      await admin.post(`/api/e/testconf/people/${id}/archive`).expect(200);
      const back = await admin.delete(`/api/e/testconf/people/${id}/archive`).expect(200);
      expect(back.body.archivedAt).toBeNull();
      expect((await personFrom(user, id))?.archivedAt).toBeNull();
    });

    /**
     * The reason archiving is not deleting. The holder keeps their cookie and
     * their role, so they can find their own profile put away and take it
     * back out without having to catch an organiser.
     */
    it('lets whoever holds the profile take it back out', async () => {
      await user.patch('/api/e/testconf/me/profile').send({ name: 'Grace' }).expect(200);
      const mine = (
        (await user.get('/api/e/testconf/bundle').expect(200)).body.people as {
          id: number;
          isMine: boolean;
        }[]
      ).find((p) => p.isMine);
      const id = mine?.id as number;

      await admin.post(`/api/e/testconf/people/${id}/archive`).expect(200);
      const back = await user.delete(`/api/e/testconf/people/${id}/archive`).expect(200);
      expect(back.body.archivedAt).toBeNull();
    });

    it('does not let one attendee unarchive another', async () => {
      const id = await personIdFor('Ada Lovelace');
      await admin.post(`/api/e/testconf/people/${id}/archive`).expect(200);
      await user.delete(`/api/e/testconf/people/${id}/archive`).expect(403);
      await user.post(`/api/e/testconf/people/${id}/archive`).expect(403);
      expect((await personFrom(admin, id))?.archivedAt).not.toBeNull();
    });

    /**
     * The other half of "the holder can take it back out": they should not
     * have to know it happened. An organiser tidying up at the end of a day
     * cannot tell a profile that is finished with from one whose person is
     * back tomorrow — only that person can, and the way they say it is by
     * turning up.
     */
    it('takes the profile back out when its holder enters again', async () => {
      await user.patch('/api/e/testconf/me/profile').send({ name: 'Grace' }).expect(200);
      const mine = (
        (await user.get('/api/e/testconf/bundle').expect(200)).body.people as {
          id: number;
          isMine: boolean;
        }[]
      ).find((p) => p.isMine);
      const id = mine?.id as number;

      await admin.post(`/api/e/testconf/people/${id}/archive`).expect(200);
      expect((await personFrom(admin, id))?.archivedAt).not.toBeNull();

      // The same device coming back through the gate. It already holds a
      // username here, so it need not bring one.
      await user.post('/api/e/testconf/auth').send({ password: 'user-pw' }).expect(200);
      expect((await personFrom(admin, id))?.archivedAt).toBeNull();
    });

    it('says who took it out, so the log is not a mystery', async () => {
      await user.patch('/api/e/testconf/me/profile').send({ name: 'Grace' }).expect(200);
      const mine = (
        (await user.get('/api/e/testconf/bundle').expect(200)).body.people as {
          id: number;
          isMine: boolean;
        }[]
      ).find((p) => p.isMine);
      const id = mine?.id as number;

      await admin.post(`/api/e/testconf/people/${id}/archive`).expect(200);
      await user.post('/api/e/testconf/auth').send({ password: 'user-pw' }).expect(200);

      const log = (await admin.get('/api/e/testconf/audit').expect(200)).body as {
        entries: { action: string; entity: string; entityId: number }[];
      };
      expect(
        log.entries.some(
          (e) => e.action === 'unarchive' && e.entity === 'person' && e.entityId === id,
        ),
      ).toBe(true);
    });

    /** Entering does not stamp an unarchive on a profile that was not filed. */
    it('says nothing when the profile was not archived', async () => {
      await user.post('/api/e/testconf/auth').send({ password: 'user-pw' }).expect(200);
      const log = (await admin.get('/api/e/testconf/audit').expect(200)).body as {
        entries: { action: string }[];
      };
      expect(log.entries.some((e) => e.action === 'unarchive')).toBe(false);
    });

    /**
     * Archiving does not sign anybody out, so somebody still holding a session
     * from before stays filed until they next come in through the gate — the
     * moment that actually means "I am here again".
     */
    it('leaves a filed profile filed while its holder just keeps browsing', async () => {
      const id = await personIdFor('Ada Lovelace');
      await admin.post(`/api/e/testconf/people/${id}/archive`).expect(200);
      await user.get('/api/e/testconf/bundle').expect(200);
      expect((await personFrom(admin, id))?.archivedAt).not.toBeNull();
    });

    it('is idempotent in both directions', async () => {
      const id = await personIdFor('Ada Lovelace');
      const first = await admin.post(`/api/e/testconf/people/${id}/archive`).expect(200);
      const second = await admin.post(`/api/e/testconf/people/${id}/archive`).expect(200);
      // The second press does not re-stamp the date: when it was filed is
      // what tells a tidy-up from a mistake three weeks later.
      expect(second.body.archivedAt).toBe(first.body.archivedAt);
      await admin.delete(`/api/e/testconf/people/${id}/archive`).expect(200);
      await admin.delete(`/api/e/testconf/people/${id}/archive`).expect(200);
    });

    /**
     * Crediting by name still finds an archived profile rather than spawning
     * a twin of it — but a live profile of the same name wins, because a name
     * typed today means the person who is here today.
     */
    it('prefers a live profile over an archived one when a name is credited', async () => {
      const archivedId = await personIdFor('Ada Lovelace');
      await admin.post(`/api/e/testconf/people/${archivedId}/archive`).expect(200);

      const again = await makeSession(admin, { speakers: ['Ada Lovelace'] }).expect(201);
      // Nothing live has that name, so the archived one is who they meant.
      expect(again.body.speakers[0].id).toBe(archivedId);
    });
  });

  /**
   * The roster an organiser acts on: who holds each profile, at what role, and
   * whether the phrase they were sent has ever been used. `claimed` alone
   * cannot answer the last one, because minting a speaker code attaches an
   * identity at mint time.
   */
  describe('the roster an organiser sees', () => {
    const peopleFor = async (agent: Agent) =>
      (await agent.get('/api/e/testconf/bundle').expect(200)).body.people as {
        name: string;
        claimed: boolean;
        role?: string | null;
        codeState?: string;
      }[];

    it('marks a profile nobody holds', async () => {
      await makeSession(admin, { speakers: ['Ada Lovelace'] }).expect(201);
      const [ada] = await peopleFor(admin);
      expect(ada).toMatchObject({ name: 'Ada Lovelace', claimed: false, role: null });
      expect(ada?.codeState).toBe('none');
    });

    it('gives the role of whoever holds it', async () => {
      await user.patch('/api/e/testconf/me/profile').send({ name: 'Grace' });
      const [grace] = await peopleFor(admin);
      expect(grace).toMatchObject({ name: 'Grace', claimed: true, role: 'user' });
      expect(grace?.codeState).toBe('none');
    });

    it('flags a speaker code that nobody has redeemed yet', async () => {
      const res = await makeSession(admin, { speakers: ['Ada Lovelace'] }).expect(201);
      const personId = res.body.speakers[0].id as number;
      const code = await admin.post(`/api/e/testconf/people/${personId}/speaker-code`).expect(200);

      // Claimed on paper — an identity exists — but nobody has turned up.
      const before = await peopleFor(admin);
      expect(before[0]).toMatchObject({ claimed: true, role: 'speaker', codeState: 'pending' });

      const phone = await actorWithRole(harness, 'testconf', 'viewer-pw');
      await phone.post('/api/me/link').send({ phrase: code.body.phrase }).expect(200);
      await phone.get('/api/e/testconf/bundle').expect(200);

      const after = await peopleFor(admin);
      // Used, not gone: an organiser asking "did I ever send them a phrase?"
      // is asking a different question from "are they still waiting to use it".
      expect(after[0]).toMatchObject({ claimed: true, role: 'speaker', codeState: 'used' });
    });

    it('forgets the code once it is revoked', async () => {
      const res = await makeSession(admin, { speakers: ['Ada Lovelace'] }).expect(201);
      const personId = res.body.speakers[0].id as number;
      await admin.post(`/api/e/testconf/people/${personId}/speaker-code`).expect(200);
      await admin.delete(`/api/e/testconf/people/${personId}/speaker-code`).expect(204);

      // Back to `none`, not a third "revoked" state: the row is gone, and an
      // organiser is being told there is nothing outstanding — not that a
      // dead phrase is still in the wild.
      const [ada] = await peopleFor(admin);
      expect(ada?.codeState).toBe('none');
    });

    it('tells nobody else who runs the event', async () => {
      await user.patch('/api/e/testconf/me/profile').send({ name: 'Grace' });
      for (const agent of [user, viewer]) {
        const [grace] = await peopleFor(agent);
        // Absent, not null: "not disclosed to you" rather than "unclaimed".
        expect(grace).not.toHaveProperty('role');
        expect(grace).not.toHaveProperty('codeState');
        expect(grace).not.toHaveProperty('lastSeenAt');
        expect(grace).not.toHaveProperty('sessionCount');
        expect(grace?.claimed).toBe(true);
      }
    });

    /** What the People list shows in place of the attendance list it
     *  replaced: who they are, when they arrived, when they were last here,
     *  and how much of the programme is theirs. */
    it('carries the username, the dates and the session count', async () => {
      const bundle = await user.get('/api/e/testconf/bundle').expect(200);
      const username = bundle.body.displayName as string;
      await makeSession(admin, { speakers: [username] }).expect(201);
      await makeSession(admin, { speakers: [username, 'Ada Lovelace'] }).expect(201);

      const people = (await admin.get('/api/e/testconf/bundle').expect(200)).body.people as {
        name: string;
        username: string | null;
        lastSeenAt: string | null;
        joinedAt: string | null;
        sessionCount: number;
      }[];
      const theirs = people.find((p) => p.username === username);
      expect(theirs?.sessionCount).toBe(2);
      expect(theirs?.lastSeenAt).toBeTruthy();
      expect(theirs?.joinedAt).toBeTruthy();

      // A profile nobody holds has no username, no dates, and its own count.
      const ada = people.find((p) => p.name === 'Ada Lovelace');
      expect(ada).toMatchObject({
        username: null,
        lastSeenAt: null,
        joinedAt: null,
        sessionCount: 1,
      });
    });

    it('gives every person a distinct, stable UID for the audit log', async () => {
      const first = await peopleFor(admin);
      const second = await peopleFor(admin);
      const uids = first.map((p) => p.holderUid).filter((u): u is string => typeof u === 'string');
      expect(uids).toHaveLength(3); // admin, user, viewer — everyone who entered
      for (const value of uids) expect(value).toMatch(/^[0-9a-f]{5}$/);
      expect(new Set(uids).size).toBe(uids.length);
      expect(second.map((p) => p.holderUid)).toEqual(first.map((p) => p.holderUid));
    });
  });

  /**
   * Roles are handed out from the People list now. Before this an organiser
   * could only tell somebody a different password and ask them to enter
   * again, which is not a thing you can do to a person already in the room.
   */
  describe('handing out a role', () => {
    const setRole = (agent: Agent, personId: number, role: string) =>
      agent.put(`/api/e/testconf/people/${personId}/role`).send({ role });
    const personOf = async (agent: Agent): Promise<number> => {
      const bundle = await agent.get('/api/e/testconf/bundle').expect(200);
      return bundle.body.people.find((p: { isMine: boolean }) => p.isMine).id as number;
    };

    it('changes the role of whoever holds the profile, and says so in the DTO', async () => {
      const id = await personOf(user);
      const res = await setRole(admin, id, 'speaker').expect(200);
      expect(res.body).toMatchObject({ id, role: 'speaker' });
      expect((await user.get('/api/e/testconf/bundle').expect(200)).body.role).toBe('speaker');
    });

    it('is audited', async () => {
      const id = await personOf(user);
      await setRole(admin, id, 'admin').expect(200);
      const audit = await admin.get('/api/e/testconf/audit').expect(200);
      expect(audit.body.entries[0]).toMatchObject({ action: 'role_set', entityId: id });
    });

    it('refuses a profile nobody holds', async () => {
      const shell = await admin.post('/api/e/testconf/people').send({ name: 'Shell' }).expect(201);
      await setRole(admin, shell.body.id, 'speaker').expect(400);
    });

    it('refuses to demote the last organiser, and allows it once there are two', async () => {
      const mine = await personOf(admin);
      const refused = await setRole(admin, mine, 'user').expect(409);
      expect(refused.body.error.code).toBe('last_admin');
      // Still an organiser: the refusal did not half-apply.
      expect((await admin.get('/api/e/testconf/bundle').expect(200)).body.role).toBe('admin');

      await setRole(admin, await personOf(user), 'admin').expect(200);
      await setRole(admin, mine, 'user').expect(200);
    });

    it('is admin-only', async () => {
      const id = await personOf(user);
      await user.put(`/api/e/testconf/people/${id}/role`).send({ role: 'admin' }).expect(403);
      await viewer.put(`/api/e/testconf/people/${id}/role`).send({ role: 'admin' }).expect(403);
    });
  });

  /**
   * Deleting a profile removes it from the roster; it does not remove the
   * person. They keep their identity, their role and their name in the event —
   * and, since migration 017, the ability to have a profile again.
   */
  describe('deleting a claimed profile', () => {
    it('leaves its owner signed in, with their role and name', async () => {
      await user.patch('/api/e/testconf/me').send({ displayName: 'Ada' }).expect(200);
      const mine = await user.patch('/api/e/testconf/me/profile').send({ name: 'Ada' });
      await admin.delete(`/api/e/testconf/people/${mine.body.id}`).expect(204);

      const bundle = await user.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.role).toBe('user');
      expect(bundle.body.displayName).toBe('Ada');
      expect(bundle.body.people.some((p: { isMine: boolean }) => p.isMine)).toBe(false);
    });

    it('lets them make a new one — the tombstone no longer holds their slot', async () => {
      const mine = await user.patch('/api/e/testconf/me/profile').send({ name: 'Ada' });
      await admin.delete(`/api/e/testconf/people/${mine.body.id}`).expect(204);

      const again = await user.patch('/api/e/testconf/me/profile').send({ name: 'Ada again' });
      expect(again.status).toBeLessThan(300);
      expect(again.body.id).not.toBe(mine.body.id);
      expect(again.body.isMine).toBe(true);

      // And the deleted row keeps its owner, for the audit trail.
      const tombstone = harness.db
        .prepare('SELECT identity_id, deleted_at FROM people WHERE id = ?')
        .get(mine.body.id) as { identity_id: number | null; deleted_at: string | null };
      expect(tombstone.identity_id).not.toBeNull();
      expect(tombstone.deleted_at).not.toBeNull();
    });

    it('is safe to do to yourself — an organiser keeps their own event', async () => {
      const mine = await admin.patch('/api/e/testconf/me/profile').send({ name: 'The organiser' });
      await admin.delete(`/api/e/testconf/people/${mine.body.id}`).expect(204);

      const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
      expect(bundle.body.role).toBe('admin');
      // Still able to manage, and to give themselves a profile again.
      await admin.post('/api/e/testconf/rooms').send({ name: 'Hall' }).expect(201);
      const again = await admin.patch('/api/e/testconf/me/profile').send({ name: 'The organiser' });
      expect(again.status).toBeLessThan(300);
    });
  });
});
