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

/** B2 of the identity spec: folding duplicate people into one. */
describe('merging people', () => {
  let harness: Harness;
  let eventId: number;
  let roomId: number;
  let admin: Agent;
  let user: Agent;

  beforeEach(async () => {
    harness = makeHarness();
    eventId = seedEvent(harness.db);
    roomId = seedRoom(harness.db, eventId, { openBooking: 1 });
    admin = await actorWithRole(harness, 'testconf', 'admin-pw');
    user = await actorWithRole(harness, 'testconf', 'user-pw');
  });
  afterEach(() => harness.close());

  const makeSession = (speakerName: string, startMin = 600) =>
    admin
      .post('/api/e/testconf/sessions')
      .send({
        roomId,
        title: `Talk by ${speakerName}`,
        speakers: [speakerName],
        startsAt: at(DAY_ONE, startMin),
        endsAt: at(DAY_ONE, startMin + 30),
      })
      .expect(201);

  it('repoints sessions and pitches, then soft-deletes the duplicate', async () => {
    const a = await makeSession('Ada Lovelace');
    const b = await makeSession('A. Lovelace', 700);
    const survivorId = a.body.speakers[0].id as number;
    const loserId = b.body.speakers[0].id as number;
    await admin
      .post('/api/e/testconf/proposals')
      .send({ title: 'Pitch', speakerId: loserId })
      .expect(201);

    const res = await admin
      .post(`/api/e/testconf/people/${survivorId}/merge`)
      .send({ from: loserId })
      .expect(200);
    expect(res.body.id).toBe(survivorId);

    const bundle = await admin.get('/api/e/testconf/bundle').expect(200);
    expect(bundle.body.people.map((p: { id: number }) => p.id)).toEqual([survivorId]);
    for (const s of bundle.body.sessions) {
      expect(s.speakers.map((p: { id: number }) => p.id)).toEqual([survivorId]);
    }
    const proposal = harness.db
      .prepare<[], { speaker_id: number }>('SELECT speaker_id FROM proposals')
      .get();
    expect(proposal?.speaker_id).toBe(survivorId);
  });

  it('moves the claim when only the duplicate is claimed', async () => {
    // The organiser typed "Ada" on a session; later Ada claims her own profile
    // under a variant name. The merge should hand her the surviving record.
    const a = await makeSession('Ada Lovelace');
    const survivorId = a.body.speakers[0].id as number;
    const claimed = await user
      .patch('/api/e/testconf/me/profile')
      .send({ name: 'Ada L.', bio: 'hi' })
      .expect(201);

    await admin
      .post(`/api/e/testconf/people/${survivorId}/merge`)
      .send({ from: claimed.body.id })
      .expect(200);

    const bundle = await user.get('/api/e/testconf/bundle').expect(200);
    const survivor = bundle.body.people.find((p: { id: number }) => p.id === survivorId);
    expect(survivor.isMine).toBe(true);
    // Blank bio on the survivor filled from the duplicate.
    const detail = await user.get(`/api/e/testconf/people/${survivorId}`).expect(200);
    expect(detail.body.person.bio).toBe('hi');
  });

  it('keeps the survivor’s claim when both sides are claimed', async () => {
    const mine = await user.patch('/api/e/testconf/me/profile').send({ name: 'Ada' }).expect(201);
    const viewer = await actorWithRole(harness, 'testconf', 'viewer-pw');
    const theirs = await viewer
      .patch('/api/e/testconf/me/profile')
      .send({ name: 'Ada 2' })
      .expect(201);

    await admin
      .post(`/api/e/testconf/people/${mine.body.id}/merge`)
      .send({ from: theirs.body.id })
      .expect(200);

    const bundle = await user.get('/api/e/testconf/bundle').expect(200);
    const survivor = bundle.body.people.find((p: { id: number }) => p.id === mine.body.id);
    expect(survivor.isMine).toBe(true);
  });

  it('refuses self-merge, unknown profiles, and non-admins', async () => {
    const a = await makeSession('Solo');
    const id = a.body.speakers[0].id as number;
    await admin.post(`/api/e/testconf/people/${id}/merge`).send({ from: id }).expect(400);
    await admin.post(`/api/e/testconf/people/${id}/merge`).send({ from: 9999 }).expect(404);
    await user.post(`/api/e/testconf/people/${id}/merge`).send({ from: id }).expect(403);
  });

  /**
   * A speaker code grants an *identity*, and the merge decides which identity
   * the surviving profile carries — so the loser's code follows the survivor
   * or dies, and never lingers as a phrase pointing at a profile that is no
   * longer on the roster.
   */

  describe('a both-claimed merge re-keys the loser\u2019s work (decided 2026-08-31)', () => {
    it('moves stars, contributions, interest and authorship onto the survivor, deduping overlaps', async () => {
      const dupe = await actorWithRole(harness, 'testconf', 'user-pw');
      await user.patch('/api/e/testconf/me/profile').send({ name: 'Ada' }).expect(201);
      const theirs = await dupe
        .patch('/api/e/testconf/me/profile')
        .send({ name: 'Ada 2' })
        .expect(201);
      const mine = await user.get('/api/e/testconf/bundle').expect(200);
      const myProfileId = mine.body.people.find((p: { isMine: boolean }) => p.isMine).id as number;
      const { body: userMe } = await user.get('/api/me').expect(200);

      // The loser's body of work: a session of their own, a star each on the
      // admin's session (shared with the survivor), a contribution, a pitch,
      // and interest on that pitch from both sides.
      const adminSession = (await makeSession('Keynote')).body.id as number;
      const ownSession = (
        await dupe
          .post('/api/e/testconf/sessions')
          .send({
            roomId,
            title: 'Hallway chat',
            startsAt: at(DAY_ONE, 800),
            endsAt: at(DAY_ONE, 830),
          })
          .expect(201)
      ).body.id as number;
      await dupe.put(`/api/e/testconf/sessions/${adminSession}/star`).expect(204);
      await user.put(`/api/e/testconf/sessions/${adminSession}/star`).expect(204);
      const note = (
        await dupe
          .post(`/api/e/testconf/sessions/${adminSession}/contributions`)
          .send({ kind: 'note', body: 'great talk' })
          .expect(201)
      ).body.id as number;
      const pitch = (
        await dupe
          .post('/api/e/testconf/proposals')
          .send({ title: 'Lightning round', description: '' })
          .expect(201)
      ).body.id as number;
      await dupe.put(`/api/e/testconf/proposals/${pitch}/interest`).expect(204);
      await user.put(`/api/e/testconf/proposals/${pitch}/interest`).expect(204);

      await admin
        .post(`/api/e/testconf/people/${myProfileId}/merge`)
        .send({ from: theirs.body.id })
        .expect(200);

      const bundle = (await user.get('/api/e/testconf/bundle').expect(200)).body;
      // The shared star collapsed to one; the loser's own star is now mine.
      expect(bundle.starCounts[adminSession]).toBe(1);
      expect(bundle.starredSessionIds).toContain(adminSession);
      // Authorship moved: the loser's session and pitch read as the survivor's.
      const moved = bundle.sessions.find((x: { id: number }) => x.id === ownSession);
      expect(moved.createdBy).toBe(userMe.id);
      const movedPitch = bundle.proposals.find((x: { id: number }) => x.id === pitch);
      expect(movedPitch.createdBy).toBe(userMe.id);
      // The two interests deduped to one, and it is the survivor's.
      expect(movedPitch.interestCount).toBe(1);
      expect(movedPitch.interested).toBe(true);

      // The losing device is signed out of the event, not left as a zombie
      // that is present but owns nothing: its role is revoked, so the event
      // is gone from under it until it re-enters through the gate as a
      // fresh participant. The survivor owns the note now.
      await dupe.get('/api/e/testconf/bundle').expect(401);
      await dupe.delete(`/api/e/testconf/contributions/${note}`).expect(401);
      await user.delete(`/api/e/testconf/contributions/${note}`).expect(204);
      // Re-entering works — the identity was signed out, not destroyed.
      await dupe.post('/api/e/testconf/auth').send({ password: 'user-pw' }).expect(200);
      const back = (await dupe.get('/api/e/testconf/bundle').expect(200)).body;
      expect(back.starredSessionIds).toEqual([]);
    });

    it('is scoped to the event being merged \u2014 the same identity elsewhere keeps its work', async () => {
      seedEvent(harness.db, { slug: 'otherconf' });
      const dupe = await actorWithRole(harness, 'testconf', 'user-pw');
      await actorWithRole({ ...harness, app: harness.app }, 'otherconf', 'user-pw');

      await user.patch('/api/e/testconf/me/profile').send({ name: 'Ada' }).expect(201);
      const theirs = await dupe
        .patch('/api/e/testconf/me/profile')
        .send({ name: 'Ada 2' })
        .expect(201);
      const mine = (await user.get('/api/e/testconf/bundle').expect(200)).body;
      const myProfileId = mine.people.find((p: { isMine: boolean }) => p.isMine).id as number;

      // The losing identity also lives at another event, with a star there.
      await dupe.post('/api/e/otherconf/auth').send({ password: 'user-pw' }).expect(200);
      const otherAdmin = await actorWithRole(harness, 'otherconf', 'admin-pw');
      const otherRoom = (
        await otherAdmin.post('/api/e/otherconf/rooms').send({ name: 'Side room' }).expect(201)
      ).body.id as number;
      const farSession = (
        await otherAdmin
          .post('/api/e/otherconf/sessions')
          .send({
            roomId: otherRoom,
            title: 'Far away',
            startsAt: at(DAY_ONE, 600),
            endsAt: at(DAY_ONE, 630),
          })
          .expect(201)
      ).body.id as number;
      await dupe.put(`/api/e/otherconf/sessions/${farSession}/star`).expect(204);

      await admin
        .post(`/api/e/testconf/people/${myProfileId}/merge`)
        .send({ from: theirs.body.id })
        .expect(200);

      // Signed out of the merged event only; the other event still knows them.
      const farBundle = (await dupe.get('/api/e/otherconf/bundle').expect(200)).body;
      expect(farBundle.starredSessionIds).toContain(farSession);
    });
  });

  describe('the loser’s speaker code', () => {
    const mint = (personId: number) =>
      admin.post(`/api/e/testconf/people/${personId}/speaker-code`).expect(200);

    it('dies when the survivor keeps an identity of its own', async () => {
      const a = await makeSession('Ada Lovelace');
      const b = await makeSession('A. Lovelace', 700);
      const survivorId = a.body.speakers[0].id as number;
      const loserId = b.body.speakers[0].id as number;

      // Both profiles have been claimed — the survivor by its own code.
      await mint(survivorId);
      const { body: loserCode } = await mint(loserId);

      await admin
        .post(`/api/e/testconf/people/${survivorId}/merge`)
        .send({ from: loserId })
        .expect(200);

      const stranger = agentFor(harness);
      await stranger.get('/api/me').expect(200);
      await stranger.post('/api/me/link').send({ phrase: loserCode.phrase }).expect(403);
      await stranger.get('/api/e/testconf/bundle').expect(401);
    });

    it('follows the survivor when the survivor inherits that identity', async () => {
      const a = await makeSession('Ada Lovelace');
      const b = await makeSession('A. Lovelace', 700);
      const survivorId = a.body.speakers[0].id as number;
      const loserId = b.body.speakers[0].id as number;

      // Only the duplicate was ever claimed, so the merge hands the survivor
      // that identity — and the phrase already emailed to that speaker still
      // names the person who is left.
      const { body: loserCode } = await mint(loserId);

      await admin
        .post(`/api/e/testconf/people/${survivorId}/merge`)
        .send({ from: loserId })
        .expect(200);

      const phone = agentFor(harness);
      await phone.get('/api/me').expect(200);
      const { body: linked } = await phone
        .post('/api/me/link')
        .send({ phrase: loserCode.phrase })
        .expect(200);
      expect(linked.roles.testconf).toBe('speaker');

      const bundle = await phone.get('/api/e/testconf/bundle').expect(200);
      const mine = bundle.body.people.find((p: { isMine: boolean }) => p.isMine) as {
        id: number;
      };
      expect(mine.id).toBe(survivorId);

      // And it is the survivor's code now, so an organiser can revoke it.
      await admin.delete(`/api/e/testconf/people/${survivorId}/speaker-code`).expect(204);
    });
  });
});
