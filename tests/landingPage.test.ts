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
const ui = readFileSync(join(WEB_SRC, 'components', 'ui.tsx'), 'utf8');

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

describe('the shared button class keeps the shape a <button> needs', () => {
  it('leaves `inline-flex` off the primary class', () => {
    // A <button> centres its label by the UA's `text-align: center`; make it a
    // flex container and the label becomes a flex item at `flex-start`, which
    // silently left-aligns all eight full-width PrimaryButtons — the gate's
    // "Enter schedule" among them. This used to be pinned through the landing
    // page, which was the only <a> borrowing the class; the landing page has
    // its own, larger buttons now, so the rule is pinned where it lives.
    const primary = /export const primaryButtonClass =([\s\S]*?);\n/.exec(ui)?.[1] ?? '';
    expect(primary).not.toBe('');
    expect(primary).not.toContain('inline-flex');
  });

  it('keeps it on the secondary class, which only ever dresses an <a> or a <button>', () => {
    const secondary = /export const secondaryButtonClass =([\s\S]*?);\n/.exec(ui)?.[1] ?? '';
    expect(secondary).toContain('inline-flex');
  });
});

describe('the landing page does not borrow the app\'s inline controls', () => {
  it('draws its own buttons instead', () => {
    // The app's buttons are 38px, `text-xs`, sized to sit beside a field in a
    // toolbar. On the one page whose buttons *are* the content that reads as
    // an afterthought, which is what "new event and import are almost
    // invisible" was really about. The landing page owns its sizing.
    // What it imports from `ui`, not what it mentions — the comment above the
    // page's own classes names the two it deliberately does not use.
    const uiImport = /import \{([\s\S]*?)\} from '\.\.\/components\/ui'/.exec(landing)?.[1] ?? '';
    expect(uiImport).not.toBe('');
    expect(uiImport).not.toContain('primaryButtonClass');
    expect(uiImport).not.toContain('secondaryButtonClass');
    expect(landing).toContain('const ctaPrimaryClass');
    expect(landing).toContain('const ctaSecondaryClass');
  });

  it('turns the hover lift off for anyone who asked for less motion', () => {
    expect(landing).toContain('motion-reduce:transform-none');
  });
});

describe('creating and importing are offered as what they are: gated', () => {
  it('says the instance password is the condition, before the click', () => {
    // Both routes want the *instance* password (SPEC §3.3) — the server
    // owner's, not an event's. As two link-coloured words in the footer they
    // were an unqualified offer that almost every visitor cannot take, and
    // could not know they could not take until they had filled in a form.
    expect(landing).toMatch(/instance&rsquo;s password/);
    expect(landing).toContain('It is not an\n              event password');
  });

  it('keeps both routes reachable, because the person who deployed this needs them', () => {
    expect(landing).toContain('to="/new"');
    expect(landing).toContain('to="/import"');
  });

  it('no longer hides them in the footer', () => {
    // The footer is where they were, and where they were invisible. It now
    // ends at the licence and the source.
    const footer = /<footer[\s\S]*?<\/footer>/.exec(landing)?.[0] ?? '';
    expect(footer).not.toBe('');
    expect(footer).not.toContain('to="/new"');
    expect(footer).not.toContain('to="/import"');
  });
});

describe('the source link wears the mark', () => {
  it('puts GitHub in the footer, where provenance is looked for', () => {
    const footer = /<footer[\s\S]*?<\/footer>/.exec(landing)?.[0] ?? '';
    expect(footer).toContain('MIT licensed');
    expect(footer).toContain('<GitHubMark');
  });

  it('draws the mark filled, not as one of the app\'s stroke glyphs', () => {
    // It is somebody else's logo: reproduced as issued, taking `currentColor`
    // so it inherits the link's hover and dark-mode colours, which is the one
    // liberty GitHub's guidelines allow.
    const icons = readFileSync(join(WEB_SRC, 'components', 'icons.tsx'), 'utf8');
    const mark = /export function GitHubMark[\s\S]*?\n}/.exec(icons)?.[0] ?? '';
    expect(mark).toContain('fill="currentColor"');
    expect(mark).not.toContain('stroke=');
  });
});

describe('the preview is framed as a picture, not offered as a board', () => {
  it('puts it in a browser window', () => {
    // It is built from the app's own classes, so its cards and its star look
    // exactly like the real ones — because they are. People clicked at them.
    // Chrome around a thing is read as "here is that thing, pictured".
    expect(preview).toContain('function WindowFrame');
    expect(preview).toContain('<WindowFrame>');
  });

  it('names a host nobody should try to visit', () => {
    expect(preview).toContain('example.libresesh.org');
  });

  it('does not answer the cursor', () => {
    // No hover state lights up, and no text selects: the two ways a picture
    // made of markup betrays that it is not one.
    expect(preview).toContain('[&_*]:pointer-events-none');
    expect(preview).toContain('select-none');
  });
});

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}
