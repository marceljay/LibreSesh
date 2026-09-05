/**
 * Splitting text on `@username` mentions, shared so a mention written in a
 * comment, a description or a bio cannot disagree about what parses. The rule
 * leans on the set of names that actually exist in the event rather than on a
 * character class, because a username is `trimmed(40)` and so may hold spaces
 * ("Ada Lovelace") — there is no regexp for "a name" here, only "a known name".
 *
 * The tokenizer is pure and framework-free: it returns segments, and the caller
 * turns a `mention` segment into a link (the client, today) or a stored
 * notification target (the server, once delivery exists). See
 * `_planning/specs/mentions-and-notifications.md`.
 */

export type MentionSegment =
  | { type: 'text'; text: string }
  /** `text` is the literal matched run including the `@`; `name` is the
   *  canonical username it resolved to, in the casing the directory holds. */
  | { type: 'mention'; text: string; name: string };

/** A word character for boundary purposes: what may not sit either side of a
 *  mention. `@` after a letter is an email local part, not a mention; a name
 *  followed by a letter has not ended yet. Unicode-aware so accented names and
 *  non-Latin scripts are treated as words too. */
const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/**
 * Split `text` into text and mention segments. `knownNames` is the set of
 * usernames in the event; matching is case-insensitive and longest-match, so
 * `@ann` does not claim the front of `@anna` when both exist, and the longer
 * of two names wins when one is a prefix of the other.
 */
export function tokenizeMentions(
  text: string,
  knownNames: Iterable<string>,
): MentionSegment[] {
  // Canonical casing keyed by lowercase, longest first so the first prefix hit
  // is also the longest — a stable, allocation-free way to longest-match.
  const names = [...knownNames].sort((a, b) => b.length - a.length);
  const segments: MentionSegment[] = [];
  let plain = '';
  let i = 0;

  const flush = () => {
    if (plain) {
      segments.push({ type: 'text', text: plain });
      plain = '';
    }
  };

  while (i < text.length) {
    const atBoundary = !isWordChar(text[i - 1]);
    if (text[i] === '@' && atBoundary) {
      const rest = text.slice(i + 1);
      const restLower = rest.toLowerCase();
      const match = names.find(
        (name) =>
          name.length > 0 &&
          restLower.startsWith(name.toLowerCase()) &&
          // The name must end here, not run into a longer word.
          !isWordChar(rest[name.length]),
      );
      if (match) {
        flush();
        segments.push({ type: 'mention', text: text.slice(i, i + 1 + match.length), name: match });
        i += 1 + match.length;
        continue;
      }
    }
    plain += text[i];
    i += 1;
  }

  flush();
  return segments;
}

/** The longest a username can be (`displayNameSchema = trimmed(40)`), and so
 *  the furthest back from the caret an unfinished mention can start. */
export const MAX_MENTION_QUERY = 40;

/** An `@…` the caret is sitting inside: where the `@` is, and what has been
 *  typed after it so far. */
export interface MentionQuery {
  /** Index of the `@` in the text. */
  start: number;
  /** Everything between the `@` and the caret, verbatim — it may hold spaces,
   *  because a username may ("Ada Lovelace"). */
  query: string;
}

/**
 * The mention being typed at `caret`, if any — the composer's half of the
 * tokenizer. It answers "is the caret inside an `@…`", never "is that a real
 * name": `matchMentionNames` decides that, so the two questions stay separable
 * and the menu can close by simply running out of candidates.
 *
 * The `@` must sit at a word boundary, the same rule `tokenizeMentions` uses,
 * so typing an email address never opens a menu. A newline ends the search: a
 * name cannot span lines, and without this a stray `@` keeps a whole paragraph
 * under suspicion.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const limit = Math.max(0, caret - (MAX_MENTION_QUERY + 1));
  for (let i = caret - 1; i >= limit; i--) {
    const ch = text[i];
    if (ch === '\n') return null;
    if (ch === '@') {
      // `a@b.com` is an email local part, not the start of a mention.
      if (isWordChar(text[i - 1])) return null;
      return { start: i, query: text.slice(i + 1, caret) };
    }
  }
  return null;
}

/**
 * The usernames worth offering for `query`, best first: names that start with
 * what was typed, then names where it starts a later word ("@lovelace" finds
 * "Ada Lovelace"). Matching mid-word is deliberately not offered — it makes the
 * menu jumpy and the hit unexplainable.
 *
 * An empty query returns the head of the directory, so a bare `@` is a way to
 * browse. A query that opens with whitespace returns nothing, which is what
 * closes the menu when someone types `@` and moves on.
 */
export function matchMentionNames(
  query: string,
  knownNames: Iterable<string>,
  limit = 6,
): string[] {
  if (/^\s/.test(query)) return [];
  const q = query.toLowerCase();
  const prefix: string[] = [];
  const wordStart: string[] = [];

  for (const name of knownNames) {
    const lower = name.toLowerCase();
    if (lower.startsWith(q)) prefix.push(name);
    else if (q.length > 0 && startsAWordIn(lower, q)) wordStart.push(name);
  }

  const byName = (a: string, b: string) => a.localeCompare(b);
  return [...prefix.sort(byName), ...wordStart.sort(byName)].slice(0, limit);
}

/** Does `q` occur in `haystack` at the start of a word? Both are lowercase. */
function startsAWordIn(haystack: string, q: string): boolean {
  for (let i = haystack.indexOf(q); i !== -1; i = haystack.indexOf(q, i + 1)) {
    if (!isWordChar(haystack[i - 1])) return true;
  }
  return false;
}
