import { describe, expect, it } from 'vitest';
import type { PersonDto } from '../server/src/shared/types.js';
import { mergeConsequence, personLabel, suggestDuplicates } from '../web/src/lib/people.js';

/**
 * Merging is irreversible, and the dialog's job is to make the right pick the
 * easy one without ever making it for you. These are the two judgements it
 * offers: which rows look like the same human, and what this particular merge
 * is about to do.
 */
const person = (over: Partial<PersonDto> & { id: number; name: string }): PersonDto => ({
  bio: '',
  links: [],
  isMine: false,
  claimed: false,
  username: null,
  creditable: true,
  updatedAt: '2026-09-01T10:00:00.000Z',
  ...over,
});

const claimed = (over: Partial<PersonDto> & { id: number; name: string }): PersonDto =>
  person({ claimed: true, holderUid: 'a1b2c', username: 'someone', ...over });

describe('suggesting duplicates', () => {
  const ada = person({ id: 1, name: 'Ada Lovelace' });

  const namesFor = (candidates: PersonDto[]) =>
    suggestDuplicates(ada, candidates).map((s) => [s.person.name, s.why]);

  it('finds the same name whatever the case, spacing or punctuation', () => {
    expect(namesFor([person({ id: 2, name: '  ada   LOVELACE ' })])).toEqual([
      ['  ada   LOVELACE ', 'same name'],
    ]);
  });

  it('finds an initial standing in for a first name', () => {
    expect(namesFor([person({ id: 2, name: 'A. Lovelace' })])).toEqual([
      ['A. Lovelace', 'initials match'],
    ]);
  });

  it('finds one name inside the other', () => {
    expect(namesFor([person({ id: 2, name: 'Ada' })])).toEqual([
      ['Ada', 'one name contains the other'],
    ]);
  });

  it('offers a shared surname, but ranks it below the rest', () => {
    expect(namesFor([person({ id: 2, name: 'Byron Lovelace' })])).toEqual([
      ['Byron Lovelace', 'same surname'],
    ]);
    const both = suggestDuplicates(ada, [
      person({ id: 2, name: 'Byron Lovelace' }),
      person({ id: 3, name: 'A Lovelace' }),
    ]);
    expect(both.map((s) => s.person.id)).toEqual([3, 2]);
  });

  it('matches a username against a full name, and the other way', () => {
    expect(namesFor([claimed({ id: 2, name: 'Someone Else', username: 'ada lovelace' })])).toEqual([
      ['Someone Else', 'same name'],
    ]);
  });

  it('says nothing about two people who merely share an initial letter', () => {
    expect(namesFor([person({ id: 2, name: 'Alan Turing' })])).toEqual([]);
    expect(namesFor([person({ id: 2, name: 'Grace Hopper' })])).toEqual([]);
  });

  it('never suggests the survivor, and stops at three', () => {
    const candidates = [
      ada,
      person({ id: 2, name: 'ada lovelace' }),
      person({ id: 3, name: 'A. Lovelace' }),
      person({ id: 4, name: 'Ada' }),
      person({ id: 5, name: 'Byron Lovelace' }),
    ];
    const out = suggestDuplicates(ada, candidates);
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.person.id)).not.toContain(1);
  });
});

describe('what a merge is about to do', () => {
  const survivorClaimed = claimed({
    id: 1,
    name: 'Ada Lovelace',
    username: 'ada',
    holderUid: 'a1b2c',
  });
  const survivorShell = person({ id: 1, name: 'Ada Lovelace' });

  it('folding in a profile nobody holds moves the sessions and nothing else', () => {
    const out = mergeConsequence(survivorClaimed, person({ id: 2, name: 'A. Lovelace' }));
    expect(out.kind).toBe('sessions-only');
    expect(out.text).toMatch(/Nothing else changes/);
  });

  it('folding a held profile into a shell moves the claim, and names who takes it', () => {
    const out = mergeConsequence(
      survivorShell,
      claimed({ id: 2, name: 'A. Lovelace', username: 'ada', holderUid: 'f9e8d' }),
    );
    expect(out.kind).toBe('claim-moves');
    expect(out.text).toContain('@ada (F9E8D)');
    expect(out.text).toMatch(/becomes the holder/);
  });

  /** The case a wrong pick costs the most, so the sentence has to say the two
   *  things that are easy to miss: the work moves, and a device goes out. */
  it('folding two held profiles together moves the work and signs a device out', () => {
    const out = mergeConsequence(
      survivorClaimed,
      claimed({ id: 2, name: 'Ada L', username: 'ada2', holderUid: 'f9e8d' }),
    );
    expect(out.kind).toBe('work-moves');
    expect(out.text).toContain('@ada2 (F9E8D)');
    expect(out.text).toContain('@ada (A1B2C)');
    expect(out.text).toMatch(/signed out/);
  });

  it('labels somebody by their username and UID, or by name when nobody holds them', () => {
    expect(personLabel(claimed({ id: 3, name: 'X', username: 'jo', holderUid: '11111' }))).toBe(
      '@jo (11111)',
    );
    expect(personLabel(person({ id: 4, name: 'Alan Turing' }))).toBe('Alan Turing');
  });
});
