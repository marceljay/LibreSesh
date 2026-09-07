import { describe, expect, it } from 'vitest';
import {
  buildInviteUrl,
  buildSpeakerLinkUrl,
  normalizeBaseUrl,
  parseInvite,
  parseSpeakerLink,
} from '../web/src/lib/inviteLink.js';

/** Pure and DOM-free, like `format.ts` — the gate hands it a string. */
describe('invite links', () => {
  it('puts the password in the fragment, never the query', () => {
    const url = buildInviteUrl({
      baseUrl: 'https://schedule.example.org',
      slug: 'democonf',
      password: 'let-me-in',
      role: 'user',
    });
    // The whole point: everything secret is after the '#', which a browser
    // does not send. A '?' anywhere would put it in the server's access log.
    expect(url.startsWith('https://schedule.example.org/e/democonf#')).toBe(true);
    expect(url).not.toContain('?');
    expect(url).toBe('https://schedule.example.org/e/democonf#k=let-me-in&r=user');
  });

  it('round-trips a password through the fragment', () => {
    const url = buildInviteUrl({
      baseUrl: 'https://x.test',
      slug: 'c',
      password: 'a b&c=d#e',
      role: 'admin',
    });
    expect(parseInvite(new URL(url).hash)).toEqual({ password: 'a b&c=d#e', role: 'admin' });
  });

  it('tolerates a base with a trailing slash', () => {
    expect(normalizeBaseUrl('https://x.test///')).toBe('https://x.test');
    expect(buildInviteUrl({ baseUrl: ' https://x.test/ ', slug: 'c', password: 'p' })).toBe(
      'https://x.test/e/c#k=p',
    );
  });

  it('ignores a fragment that is not an invite', () => {
    // React Router and in-page anchors both produce these.
    expect(parseInvite('')).toBeUndefined();
    expect(parseInvite('#')).toBeUndefined();
    expect(parseInvite('#section-3')).toBeUndefined();
    expect(parseInvite('#r=admin')).toBeUndefined();
  });

  it('treats the role as a label and drops one it does not recognise', () => {
    // The server derives the real role from the password; `r` only decides
    // what the gate says while you are looking at it, so a forged one is a
    // wrong caption and never a grant.
    expect(parseInvite('#k=p&r=superuser')).toEqual({ password: 'p', role: undefined });
    expect(parseInvite('#k=p')).toEqual({ password: 'p', role: undefined });
  });
});

/**
 * A speaker link is an invite that carries a speaker code instead of a
 * password: same fragment, same reasons, one different key.
 */
describe('speaker links', () => {
  it('puts the code in the fragment under its own key', () => {
    const url = buildSpeakerLinkUrl({
      baseUrl: 'https://schedule.example.org/',
      slug: 'democonf',
      phrase: 'pine-otter-lantern-bell',
    });
    expect(url).toBe('https://schedule.example.org/e/democonf#c=pine-otter-lantern-bell');
    expect(url).not.toContain('?');
    expect(parseSpeakerLink(new URL(url).hash)).toEqual({ phrase: 'pine-otter-lantern-bell' });
  });

  it('is not mistaken for a password invite, and vice versa', () => {
    // The gate reads one and the speaker-link hook the other; a code must not
    // land in the password box, and a password must not be sent to /me/link.
    expect(parseInvite('#c=pine-otter-lantern-bell')).toBeUndefined();
    expect(parseSpeakerLink('#k=let-me-in&r=user')).toBeUndefined();
  });

  it('ignores a fragment that is not one', () => {
    expect(parseSpeakerLink('')).toBeUndefined();
    expect(parseSpeakerLink('#')).toBeUndefined();
    expect(parseSpeakerLink('#section-3')).toBeUndefined();
    expect(parseSpeakerLink('#c=')).toBeUndefined();
    expect(parseSpeakerLink('#c=%20')).toBeUndefined();
  });
});
