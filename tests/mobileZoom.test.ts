import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Safari on iOS zooms the page in when you focus a field whose text is under
 * 16px, and it does not zoom back out when you leave it. The password gate is
 * a text field on an otherwise empty page, so signing in on an iPhone left you
 * on a magnified layout with the right-hand side of everything off screen —
 * and no obvious way back but a pinch.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const css = readFileSync(join(WEB_SRC, 'index.css'), 'utf8');
const html = readFileSync(join(__dirname, '..', 'web', 'index.html'), 'utf8');

describe('a phone never zooms itself into a field', () => {
  it('floors text entry at 16px where the zoom exists', () => {
    const rule = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(rule).toContain('font-size: 16px');
    expect(rule).toContain('textarea');
    expect(rule).toContain('select');
  });

  it('beats the utility class it has to override', () => {
    // Our fields are `text-sm` — a class, so an element selector alone loses.
    // The `:not()`s are what lift the specificity; without them the rule is
    // dead CSS that still looks right in review.
    expect(css).toMatch(/input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)/);
    expect(css).toMatch(/textarea:not\(\[hidden\]\)/);
  });

  it('leaves pinch zoom to the reader', () => {
    // The cheap cure for focus zoom is `maximum-scale=1`, which takes zooming
    // away from everyone who needs it to read at all.
    expect(html).toContain('width=device-width, initial-scale=1');
    expect(html).not.toContain('maximum-scale');
    expect(html).not.toContain('user-scalable');
  });
});
