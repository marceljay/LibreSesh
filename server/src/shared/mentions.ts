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
