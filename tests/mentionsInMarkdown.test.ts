import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { linkMentionsInHtml } from '../web/src/lib/markdown.js';

/**
 * A mention in a comment linked and landed; the same `@ada` in a session's
 * description was plain text, and the description box had no `@` menu to
 * pick her from (reported 2026-09-07). The description is markdown, so the
 * mention is found in the rendered prose rather than the source — which is
 * what keeps one inside a code span or a link as written.
 */
const mentions = {
  usernames: ['ada', 'Grace Hopper', 'R&D'],
  hrefFor: (u: string) => (u === 'R&D' ? null : `/e/conf/p/${u === 'ada' ? 1 : 2}`),
};
const link = (html: string) => linkMentionsInHtml(html, mentions);

describe('mentions in rendered markdown', () => {
  it('links a mention in a paragraph, keeping the text as written', () => {
    expect(link('<p>ask @Ada first</p>')).toBe(
      '<p>ask <a href="/e/conf/p/1" data-mention="ada">@Ada</a> first</p>',
    );
  });

  it('reads a two-word username and leaves the punctuation after it', () => {
    expect(link('<p>with @grace hopper.</p>')).toBe(
      '<p>with <a href="/e/conf/p/2" data-mention="Grace Hopper">@grace hopper</a>.</p>',
    );
  });

  it('leaves a mention inside code or inside a link alone', () => {
    const html = '<p><code>@ada</code> and <a href="https://x.test">@ada</a> but @ada</p>';
    expect(link(html)).toBe(
      '<p><code>@ada</code> and <a href="https://x.test">@ada</a> but <a href="/e/conf/p/1" data-mention="ada">@ada</a></p>',
    );
  });

  it('applies the tokenizer’s boundary rule, so an email is not a mention', () => {
    expect(link('<p>mail ada@example.com</p>')).toBe('<p>mail ada@example.com</p>');
  });

  it('compares escaped against escaped, and leaves a name with nowhere to go', () => {
    // `R&D` reaches the HTML as `R&amp;D`; it is recognised, and since it has
    // no profile it stays text rather than becoming a dead link.
    expect(link('<p>@R&amp;D owns this</p>')).toBe('<p>@R&amp;D owns this</p>');
  });

  it('does nothing when the event has no usernames', () => {
    expect(linkMentionsInHtml('<p>@ada</p>', { usernames: [], hrefFor: () => null })).toBe(
      '<p>@ada</p>',
    );
  });
});

describe('the session form and panel are wired to it', () => {
  const src = (name: string) =>
    readFileSync(join(__dirname, '..', 'web', 'src', 'components', name), 'utf8');

  it('the description box is the same @ composer as the comment box', () => {
    const modal = src('SessionModal.tsx');
    expect(modal).toMatch(/<MentionTextArea\s+people=\{people\}\s+value=\{description\}/);
    expect(modal).toContain('Type @ to mention someone.');
  });

  it('the panel renders the description with the event’s names, and routes the click', () => {
    const detail = src('SessionDetail.tsx');
    expect(detail).toMatch(/renderMarkdown\(session\.description, \{\s*usernames:/);
    expect(detail).toContain("closest('a[data-mention]')");
    expect(detail).toContain('onClick={followMention}');
  });
});
