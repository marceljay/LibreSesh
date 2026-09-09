import { describe, expect, it } from 'vitest';
import { passwordWarning, TIER_NOTE } from '../server/src/shared/passwordAdvice.js';

/**
 * D3 §1d as decided 2026-09-09: advice, never a refusal. These pin the
 * *shape* of that decision — that nothing here can reject a password — as
 * much as the wording.
 */
describe('password advice', () => {
  it('says nothing about a blank field, which is the recommended answer', () => {
    expect(passwordWarning('')).toBeNull();
    expect(passwordWarning('   ')).toBeNull();
  });

  it('flags the passwords anyone guessing tries first', () => {
    for (const common of ['password', 'Welcome1', 'letmein', 'qwerty', 'admin']) {
      expect(passwordWarning(common)).toContain('first passwords');
    }
  });

  it('flags the event’s own name and slug, case and spacing aside', () => {
    const event = { name: 'Berlin Unconf', slug: 'berlin-unconf' };
    expect(passwordWarning('berlinunconf', event)).toContain('own name');
    expect(passwordWarning(' Berlin Unconf ', event)).toContain('own name');
    expect(passwordWarning('berlin-unconf', event)).toContain('own name');
    expect(passwordWarning('something-else', event)).toBeNull();
  });

  it('mentions length below eight characters, and stops there', () => {
    expect(passwordWarning('abcdefg')).toContain('guess in bulk');
    expect(passwordWarning('abcdefgh')).toBeNull();
  });

  it('never refuses: every answer is a string or null, never a throw', () => {
    for (const value of ['123456', 'x', 'a'.repeat(500), '🎈🎈']) {
      const result = passwordWarning(value);
      expect(result === null || typeof result === 'string').toBe(true);
    }
  });

  it('has a note for each tier, and the admin one asks for the most', () => {
    expect(TIER_NOTE.viewer).toContain('read out');
    expect(TIER_NOTE.user).toContain('Shared');
    expect(TIER_NOTE.admin).toContain('changes the event');
  });
});
