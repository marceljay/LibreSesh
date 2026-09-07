import { describe, expect, it } from 'vitest';
import { buildInviteUrl, normalizeBaseUrl, parseInvite } from '../web/src/lib/inviteLink.js';

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
