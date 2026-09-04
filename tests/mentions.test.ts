import { describe, expect, it } from 'vitest';
import { tokenizeMentions } from '../server/src/shared/mentions.js';

/**
 * `@username` mentions resolve against the names that exist in the event, not a
 * character class — a username may hold spaces. These pin the boundary rules
 * (an email is not a mention), longest-match (one name is a prefix of another),
 * and the plain-text fallback (an `@` that resolves to nothing stays literal).
 */
describe('tokenizeMentions', () => {
  const names = ['ada', 'ada lovelace', 'grace'];

  const mentions = (text: string) =>
    tokenizeMentions(text, names)
      .filter((s) => s.type === 'mention')
      .map((s) => s.name);

  it('links a bare mention', () => {
    expect(tokenizeMentions("let's ask @ada", names)).toEqual([
      { type: 'text', text: "let's ask " },
      { type: 'mention', text: '@ada', name: 'ada' },
    ]);
  });

  it('is case-insensitive but keeps the canonical name', () => {
    expect(mentions('poke @Grace')).toEqual(['grace']);
  });

  it('takes the longest match when one name prefixes another', () => {
    expect(mentions('@ada lovelace will present')).toEqual(['ada lovelace']);
  });

  it('does not let a shorter name steal the front of a longer word', () => {
    expect(mentions('@adamant is not a person')).toEqual([]);
  });

  it('ignores an @ mid-word, so an email is not a mention', () => {
    expect(mentions('mail ada@grace.example')).toEqual([]);
  });

  it('leaves an unknown handle as literal text', () => {
    expect(tokenizeMentions('@nobody here', names)).toEqual([
      { type: 'text', text: '@nobody here' },
    ]);
  });

  it('handles several mentions and trailing punctuation', () => {
    expect(mentions('cc @ada, @grace!')).toEqual(['ada', 'grace']);
  });

  it('returns a single text segment when there is nothing to link', () => {
    expect(tokenizeMentions('plain words', names)).toEqual([
      { type: 'text', text: 'plain words' },
    ]);
  });
});
