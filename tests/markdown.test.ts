import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../web/src/lib/markdown.js';

/**
 * The output of `renderMarkdown` goes straight into `dangerouslySetInnerHTML`
 * in three places — a session description, a pitch description, a profile bio —
 * all of them written by whoever is in the room. It had no tests at all, which
 * is a poor place for a four-major jump of the markdown parser to land.
 *
 * The contract is SPEC §7.4: raw HTML is escaped *before* parsing rather than
 * sanitised after, so there is no markup an author can write that reaches the
 * DOM. These pin that contract, not marked's formatting — assertions are about
 * what must never appear, plus the link handling the renderer adds itself.
 */

const ORIGIN = 'https://schedule.example.org';

beforeAll(() => {
  // `safeHref` resolves relative links against the page. No DOM here, and it
  // only ever reads this one field.
  vi.stubGlobal('window', { location: { origin: ORIGIN } });
});
afterAll(() => vi.unstubAllGlobals());

/** Every tag in the output, so assertions can be about markup that actually
 *  renders rather than about escaped text that merely looks like it. Author
 *  markup comes back as `&lt;…&gt;` and has no `<` left to match. */
const tagsIn = (html: string): string[] => html.match(/<[^>]*>/g) ?? [];

/** A tag with the contents of its quoted attributes blanked out, leaving only
 *  its real attribute names. `onmouseover=` sitting *inside* `title="…"` is
 *  text the browser shows; the same characters outside one are a handler it
 *  runs, and only this tells the two apart. */
const attributeNames = (tag: string): string => tag.replace(/"[^"]*"/g, '""');

describe('rendering what an author wrote', () => {
  describe('no markup survives', () => {
    const attempts: Array<[string, string]> = [
      ['a script tag', '<script>alert(1)</script>'],
      ['an event handler', '<img src=x onerror="alert(1)">'],
      ['an iframe', '<iframe src="https://evil.example"></iframe>'],
      ['a style block', '<style>body{display:none}</style>'],
      ['an svg payload', '<svg><script>alert(1)</script></svg>'],
      ['a bare attribute', '<div onmouseover=alert(1)>hover</div>'],
      ['an html comment hiding a tag', '<!-- <script>alert(1)</script> -->'],
    ];

    for (const [name, source] of attempts) {
      it(name, () => {
        const html = renderMarkdown(source);
        for (const tag of tagsIn(html)) {
          expect(tag, `tag from: ${source}`).not.toMatch(/^<\/?(script|iframe|style|svg|img)\b/i);
          expect(attributeNames(tag), `tag from: ${source}`).not.toMatch(/\son\w+\s*=/i);
        }
        // The angle brackets the author typed come back as text.
        expect(html).toContain('&lt;');
      });
    }
  });

  describe('links', () => {
    it('opens an http link in a new tab, without handing over the opener', () => {
      const html = renderMarkdown('[docs](https://example.org/a)');
      expect(html).toContain('href="https://example.org/a"');
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
    });

    it('drops a javascript: link to plain text, keeping the words', () => {
      const html = renderMarkdown('[click me](javascript:alert(1))');
      expect(html).not.toMatch(/javascript:/i);
      expect(html).not.toContain('<a ');
      expect(html).toContain('click me');
    });

    it('drops a data: link the same way', () => {
      const html = renderMarkdown('[x](data:text/html;base64,PHNjcmlwdD4=)');
      expect(html).not.toMatch(/<a /);
      expect(html).not.toMatch(/data:/i);
    });

    it('resolves a relative link against the page it is read on', () => {
      const html = renderMarkdown('[room](/e/conf/rooms)');
      expect(html).toContain(`href="${ORIGIN}/e/conf/rooms"`);
    });

    it('keeps the schemes the link fields allow', () => {
      // Same rule as the link fields, so a link in a bio and a link in a field
      // cannot disagree about what is allowed.
      expect(renderMarkdown('[m](magnet:?xt=urn:btih:abc)')).toContain('<a ');
      expect(renderMarkdown('[i](ipfs://bafy)')).toContain('<a ');
    });

    it('does not let a title close its own attribute', () => {
      // marked 14 escaped a title's quotes for us and marked 18 does not, so
      // this exact string was a live onmouseover handler in anyone's bio.
      const html = renderMarkdown(`[x](https://example.org 'a" onmouseover="alert(1)')`);
      for (const tag of tagsIn(html)) expect(attributeNames(tag)).not.toMatch(/\son\w+\s*=/i);
      expect(html).toContain('&quot;');
    });
  });

  it('renders an image as its alt text, never an <img>', () => {
    const html = renderMarkdown('![a caption](https://example.org/x.png)');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('a caption');
  });

  describe('the markdown that is meant to work still does', () => {
    it('keeps gfm and hard breaks on', () => {
      expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
      expect(renderMarkdown('a\nb')).toContain('<br>');
      expect(renderMarkdown('- one\n- two')).toContain('<li>');
    });

    it('returns a string, not a promise', () => {
      expect(typeof renderMarkdown('plain')).toBe('string');
    });

    it('survives an empty string', () => {
      expect(renderMarkdown('')).toBe('');
    });
  });
});
