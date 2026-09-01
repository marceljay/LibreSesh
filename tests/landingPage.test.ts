import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `/` used to be the list of every event on the instance. That said nothing
 * about what LibreSesh is — the explanation was in the About dialog, behind a
 * "?" you only reach once you are inside an event — and it published the whole
 * event list to anyone who loaded the root of a public box.
 *
 * There is no DOM in this suite, so what is pinned here is the shape of the
 * arrangement: which component answers `/`, that the list kept an address of
 * its own, that nothing still points at `/` meaning "the list", and that the
 * landing page answers the four questions it exists to answer. The regression
 * this guards is a quiet one — a route table is easy to revert by hand, and
 * the page would still render.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const app = readFileSync(join(WEB_SRC, 'App.tsx'), 'utf8');
const landing = readFileSync(join(WEB_SRC, 'pages', 'LandingPage.tsx'), 'utf8');
const preview = readFileSync(join(WEB_SRC, 'pages', 'BoardPreview.tsx'), 'utf8');

describe('the root is a landing page, not the event list', () => {
  it('answers `/` with the landing page', () => {
    expect(app).toMatch(/<Route path="\/" element=\{<LandingPage \/>\} \/>/);
  });

  it('gives the event list its own address', () => {
    expect(app).toMatch(/<Route path="\/events" element=\{<EventListPage \/>\} \/>/);
  });

  it('sends the catch-all home to `/`', () => {
    // Home is one place, and it is where the logo goes. A URL that no longer
    // resolves is most often a stale or mistyped event link, which the page
    // explaining what to do with an event link answers better than a list of
    // events that are not yours.
    expect(app).toMatch(/<Route path="\*" element=\{<Navigate to="\/" replace \/>\} \/>/);
  });
});

describe('the logo goes home, and the list keeps its own way back', () => {
  it('sends every logo to `/`, under one label', () => {
    // Four of them: the schedule, the agenda, search, and the list itself.
    // They used to mean "all events"; they mean "home" now, and the label has
    // to move with the target or it describes the old destination.
    const logos = tsxFiles(WEB_SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/<Link[\s\S]{0,200}?aria-label="LibreSesh home"/g)].map(
        (match) => ({ file, to: /to="([^"]+)"/.exec(match[0])?.[1] }),
      );
    });
    expect(logos).toHaveLength(4);
    expect(logos.every((logo) => logo.to === '/')).toBe(true);
  });

  it('leaves no link still labelled for the list it no longer opens', () => {
    const stale = tsxFiles(WEB_SRC).filter((file) =>
      /aria-label="All events"/.test(readFileSync(file, 'utf8')),
    );
    expect(stale).toEqual([]);
  });

  it('keeps the "back to the list" links pointing at the list', () => {
    // These are not the logo: they are the way back to where you came from,
    // and they were correct before the logo moved. Six of them, counting the
    // landing page's own call to action.
    const backLinks = tsxFiles(WEB_SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/to="\/events"/g)].map(() => file),
    );
    expect(backLinks).toHaveLength(6);
  });

  it('keeps the list one click from `/`', () => {
    // After the logo moved, this is the only way into `/events` from inside
    // the app. Lose it and the list is reachable only by typing the URL.
    expect(landing).toContain('to="/events"');
  });
});

describe('the landing page says what this is', () => {
  it('names what the thing is for', () => {
    expect(landing).toContain('(un)conferences');
  });

  it('carries the licence, which is most of the point of it being open source', () => {
    expect(landing).toContain('MIT licensed');
    expect(landing).toContain('github.com/marceljay/LibreSesh');
  });

  it('tells someone holding an event link that the link is the whole way in', () => {
    // The commonest visitor by far. Without this they hunt for their event in
    // a list they have no business in — or, on an instance that hides it,
    // conclude the link was wrong.
    expect(landing).toMatch(/Holding a link to an event/);
  });

  it('gives its call to action the flex the shared button class must not carry', () => {
    // `primaryButtonClass` stays free of `inline-flex`, because a <button>
    // that becomes a flex container left-aligns its own label — which would
    // hit all eight full-width PrimaryButtons, the gate's included. An <a> is
    // inline and does need it, so it asks for it here.
    expect(landing).toContain('inline-flex items-center ${primaryButtonClass}');
  });

  it('does not fetch the event list', () => {
    // The second reason `/` stopped being the list: loading the root of a
    // public instance should not enumerate every event on the box.
    expect(landing).not.toContain('listEvents');
    expect(landing).not.toContain('api.');
  });
});

describe('the board preview is markup, not a screenshot', () => {
  it('carries both themes', () => {
    // The reason it is not the design draft's PNG: a screenshot has one theme
    // and the app has two, so a single image is wrong half the time.
    expect(preview).toContain('dark:bg-stone-900');
    expect(preview).toContain('dark:border-stone-700');
  });

  it('is hidden from assistive tech, and captioned instead', () => {
    // These are not real sessions. Announcing them as if they were — times,
    // rooms, speakers, a star that does nothing — is worse than the picture.
    expect(preview).toContain('aria-hidden="true"');
    expect(preview).toContain('<figcaption');
  });

  it('shows an unclaimed slot, which is the thing being claimed about', () => {
    expect(preview).toContain('anyone can claim this');
  });

  it('draws its tag colours from the shared palette', () => {
    // Not hand-picked hex: the Okabe-Ito palette is what the tag picker uses,
    // and `readableInk` is what keeps the label legible on it.
    expect(preview).toContain("from '@shared/tagColors'");
    expect(preview).toContain('readableInk');
  });
});

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}
