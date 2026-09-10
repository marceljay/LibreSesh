import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WORDS,
  hashPhrase,
  mintLinkCode,
  newLinkPhrase,
  normalizePhrase,
  redeemLinkCode,
} from '../server/src/deviceLink.js';
import { actorWithRole, agentFor, makeHarness, seedEvent, type Harness } from './helpers.js';

describe('link phrases', () => {
  it('draws from a large, duplicate-free wordlist', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(500);
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  /**
   * Every entry, not a sampled phrase. A word carrying a space or a capital
   * would produce a phrase that cannot be typed at a login page, read aloud
   * or carried in a URL fragment — and minting is random, so a sampled test
   * catches it about once in two hundred runs. One such word did reach this
   * list, from a careless find-and-replace across the repository.
   */
  it('holds only plain lowercase words', () => {
    const bad = WORDS.filter((w) => !/^[a-z]+$/.test(w));
    expect(bad).toEqual([]);
  });

  it('mints three words joined by dashes', () => {
    expect(newLinkPhrase()).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it('normalises case, spacing and separators', () => {
    expect(normalizePhrase('  House DOG,  erratic ')).toBe('house-dog-erratic');
    expect(hashPhrase('House Dog Erratic')).toBe(hashPhrase('house-dog-erratic'));
  });
});

describe('device linking', () => {
  let harness: Harness;
  beforeEach(() => {
    harness = makeHarness();
    seedEvent(harness.db);
  });
  afterEach(() => harness.close());

  it('lets a second device adopt the first one’s identity, role included', async () => {
    const phone = await actorWithRole(harness, 'testconf', 'user-pw');
    const { body: mine } = await phone.get('/api/me').expect(200);
    const { body: code } = await phone.post('/api/me/link-code').expect(200);
    expect(code.phrase).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
    expect(Date.parse(code.expiresAt)).toBeGreaterThan(Date.now());

    const laptop = agentFor(harness);
    const { body: stranger } = await laptop.get('/api/me').expect(200);
    expect(stranger.id).not.toBe(mine.id);

    const { body: linked } = await laptop
      .post('/api/me/link')
      .send({ phrase: code.phrase })
      .expect(200);
    expect(linked.id).toBe(mine.id);
    expect(linked.roles.testconf).toBe('user');

    // The cookie really switched: the next plain request is the same person.
    const { body: after } = await laptop.get('/api/me').expect(200);
    expect(after.id).toBe(mine.id);
  });

  it('accepts sloppy typing of the phrase', async () => {
    const phone = agentFor(harness);
    const { body: mine } = await phone.get('/api/me').expect(200);
    const { body: code } = await phone.post('/api/me/link-code').expect(200);

    const laptop = agentFor(harness);
    const shouted = (code.phrase as string).toUpperCase().replaceAll('-', '  ');
    const { body: linked } = await laptop
      .post('/api/me/link')
      .send({ phrase: shouted })
      .expect(200);
    expect(linked.id).toBe(mine.id);
  });

  it('burns a phrase on first use', async () => {
    const phone = agentFor(harness);
    await phone.get('/api/me').expect(200);
    const { body: code } = await phone.post('/api/me/link-code').expect(200);

    await agentFor(harness).post('/api/me/link').send({ phrase: code.phrase }).expect(200);
    await agentFor(harness).post('/api/me/link').send({ phrase: code.phrase }).expect(403);
  });

  it('rejects an expired phrase', async () => {
    const phone = agentFor(harness);
    const { body: mine } = await phone.get('/api/me').expect(200);
    const code = mintLinkCode(harness.db, mine.id);
    harness.db
      .prepare('UPDATE link_codes SET expires_at = ?')
      .run(new Date(Date.now() - 1000).toISOString());
    expect(redeemLinkCode(harness.db, code.phrase)).toBeUndefined();
  });

  it('re-minting replaces the previous phrase', async () => {
    const phone = agentFor(harness);
    await phone.get('/api/me').expect(200);
    const { body: first } = await phone.post('/api/me/link-code').expect(200);
    const { body: second } = await phone.post('/api/me/link-code').expect(200);

    await agentFor(harness).post('/api/me/link').send({ phrase: first.phrase }).expect(403);
    await agentFor(harness).post('/api/me/link').send({ phrase: second.phrase }).expect(200);
  });

  it('rejects a wrong phrase without burning anything', async () => {
    await agentFor(harness).post('/api/me/link').send({ phrase: 'no-such-code' }).expect(403);
  });
});
