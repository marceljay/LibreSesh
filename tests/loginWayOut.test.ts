import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The login page — the page that asks for an event's password — was a card alone on
 * a blank page: no logo, no link, nothing to say what site this was or where
 * the other events were (reported 2026-09-07). Someone holding the wrong link
 * or the wrong password had nowhere to go but the address bar. There is no
 * DOM in this suite, so what is pinned is that the way out exists and where
 * it leads.
 */
const source = readFileSync(join(__dirname, '..', 'web', 'src', 'components', 'Login.tsx'), 'utf8');

describe('the login page has a way off it', () => {
  it('wears the logo, and the logo goes home', () => {
    expect(source).toMatch(
      /<Link to="\/"[^>]*aria-label="LibreSesh home">\s*<Logo variant="oneline"/,
    );
  });

  it('links to the list of events', () => {
    expect(source).toMatch(/<Link\s+to="\/events"[\s\S]{0,300}All events/);
  });

  it('puts them above the card, not inside the form', () => {
    expect(source.indexOf('<header')).toBeLessThan(source.indexOf('{eventName ?? slug}'));
  });
});
