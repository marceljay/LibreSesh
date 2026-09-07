import { marked } from 'marked';
import { safeLink } from '@shared/links';
import { tokenizeMentions } from '@shared/mentions';

/**
 * Render session descriptions. Raw HTML is escaped before parsing rather than
 * sanitised after, so no markup an author writes can ever reach the DOM
 * (SPEC §7.4). Links are forced to open in a new tab with `noopener`.
 */
const escapeHtml = (raw: string): string =>
  raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Inside a double-quoted attribute the quote itself has to go too. */
const escapeAttr = (raw: string): string => escapeHtml(raw).replace(/"/g, '&quot;');

/** The same rule the link fields are held to, so a link written in a bio and
 *  a link typed into a field cannot disagree about what is allowed. Relative
 *  links resolve against the page, which is why markdown passes a base. */
const safeHref = (href: string): string | undefined =>
  safeLink(href, window.location.origin) ?? undefined;

const renderer = new marked.Renderer();
renderer.link = ({ href, title, tokens }) => {
  const text = renderer.parser.parseInline(tokens);
  const safe = safeHref(href);
  if (!safe) return text;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(safe)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};
renderer.image = ({ text }) => escapeHtml(text);

marked.setOptions({ renderer, gfm: true, breaks: true });

export interface MentionLinks {
  /** Every username the event holds. */
  usernames: string[];
  /** Where a mention of this name goes, or `null` to leave it as text. */
  hrefFor: (username: string) => string | null;
}

/** Tags whose text is not prose: a link inside a link is not HTML, and a
 *  `@handle` in a code span is being quoted, not said. */
const QUIET = new Set(['a', 'code', 'pre']);

/**
 * Turn `@username` into profile links in rendered HTML, wherever the text is
 * prose. Done over marked's output rather than as one of its extensions
 * because an inline extension cannot see the character before its match, and
 * the boundary rule — `a@b.com` is not a mention — needs it; the shared
 * tokenizer already has that rule, so it runs here over the text between tags.
 *
 * The text arrives escaped, so the names are compared escaped too: a username
 * holding `&` reads as `&amp;` on both sides. A mention link carries
 * `data-mention` so the page can hand it to the router instead of reloading.
 */
export function linkMentionsInHtml(html: string, mentions: MentionLinks): string {
  const original = new Map(mentions.usernames.map((u) => [escapeHtml(u), u]));
  if (original.size === 0) return html;
  let quiet = 0;
  return html
    .split(/(<\/?[a-zA-Z][^>]*>)/)
    .map((part) => {
      const tag = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(part);
      if (tag) {
        if (QUIET.has(tag[2]!.toLowerCase())) quiet += tag[1] ? -1 : 1;
        return part;
      }
      if (quiet > 0 || !part.includes('@')) return part;
      return tokenizeMentions(part, original.keys())
        .map((seg) => {
          if (seg.type !== 'mention') return seg.text;
          const href = mentions.hrefFor(original.get(seg.name) ?? seg.name);
          if (!href) return seg.text;
          return `<a href="${escapeAttr(href)}" data-mention="${escapeAttr(original.get(seg.name) ?? seg.name)}">${seg.text}</a>`;
        })
        .join('');
    })
    .join('');
}

export function renderMarkdown(source: string, mentions?: MentionLinks): string {
  const html = marked.parse(escapeHtml(source), { async: false });
  return mentions ? linkMentionsInHtml(html, mentions) : html;
}
