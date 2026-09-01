/**
 * Ranked free-text search over sessions.
 *
 * Pure and DOM-free so it can be unit-tested in the node suite, and so the
 * header's popdown, the all-results page and the filter panel's mini-search all
 * agree on what "matches" means. The old search was one `includes` over the
 * three fields joined together, which had two failings worth naming: a
 * two-word query only matched if the words were adjacent *and* in that order
 * ("lovelace ada" found nothing), and every hit ranked the same, so a title
 * match sat below whatever happened to come first in the day.
 */

/** The fields searched. `SessionDto` satisfies this structurally. */
export interface SearchableSession {
  id: number;
  title: string;
  /** Everyone billed, in order. Searching matches any of them: "who is Ada
   *  speaking with?" is the same question as "what is Ada speaking at". */
  speakers: { name: string }[];
  description: string;
}

/**
 * Lower-case and strip the common accents, one output char per input char.
 * Length has to be preserved because {@link matchRanges} hands indices back to
 * the caller to slice the *original* text with; `matchRanges` re-checks and
 * gives up on highlighting rather than mis-highlighting if some exotic input
 * breaks that (Turkish dotted İ lowercases into two chars, for one).
 */
export const fold = (text: string): string =>
  text.replace(/[À-ɏ]/g, (c) => c.normalize('NFD')[0] ?? c).toLowerCase();

/** A query as the words it has to match — all of them, in any order. */
export const searchTerms = (query: string): string[] =>
  fold(query).split(/\s+/).filter(Boolean);

const isBoundary = (text: string, i: number): boolean =>
  i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1] as string);

/** Score one term against one field: word-start beats mid-word, nothing is 0. */
function scoreField(folded: string, term: string, wordStart: number, inside: number): number {
  let best = 0;
  for (let i = folded.indexOf(term); i !== -1; i = folded.indexOf(term, i + 1)) {
    const hit = isBoundary(folded, i) ? wordStart : inside;
    if (hit > best) best = hit;
    if (best === wordStart) break;
  }
  return best;
}

/**
 * How well a session answers a query. 0 means "no", and any term that matches
 * nothing makes the whole session a no — the terms are ANDed, so typing more
 * always narrows.
 *
 * The weights say: the title is what people search for, the speaker is the
 * other thing they know, and the description is a fallback that should never
 * outrank either. A hit on the whole query in the title takes a bonus, so
 * "open space" beats a session that says "open" in the title and "space" in a
 * paragraph.
 */
export function scoreSession(session: SearchableSession, terms: string[]): number {
  if (terms.length === 0) return 0;
  const title = fold(session.title);
  const speaker = fold(session.speakers.map((p) => p.name).join(' '));
  const description = fold(session.description);

  let total = 0;
  for (const term of terms) {
    const best = Math.max(
      title === term ? 60 : scoreField(title, term, 40, 24),
      scoreField(speaker, term, 30, 18),
      scoreField(description, term, 8, 5),
    );
    if (best === 0) return 0;
    total += best;
  }
  const whole = terms.join(' ');
  if (terms.length > 1 && title.includes(whole)) total += 25;
  return total;
}

export const matchesQuery = (session: SearchableSession, query: string): boolean =>
  scoreSession(session, searchTerms(query)) > 0;

/**
 * Sessions that match, best first. The sort is stable, so callers that hand in
 * chronological order get chronological order back within a score — which is
 * what makes two equally good hits read as a programme rather than a jumble.
 */
export function rankSessions<T extends SearchableSession>(
  sessions: T[],
  query: string,
  limit?: number,
): T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const scored: { session: T; score: number }[] = [];
  for (const session of sessions) {
    const score = scoreSession(session, terms);
    if (score > 0) scored.push({ session, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits = scored.map((x) => x.session);
  return limit === undefined ? hits : hits.slice(0, limit);
}

/** Which field the top hit came from — the popdown shows a description hit its
 *  snippet, so a result never looks like it matched for no reason. */
export function bestField(
  session: SearchableSession,
  terms: string[],
): 'title' | 'speaker' | 'description' | null {
  if (terms.length === 0) return null;
  const text = {
    title: session.title,
    speaker: session.speakers.map((p) => p.name).join(' '),
    description: session.description,
  };
  for (const field of ['title', 'speaker', 'description'] as const) {
    const folded = fold(text[field]);
    if (terms.some((t) => folded.includes(t))) return field;
  }
  return null;
}

/** Character ranges in `text` covered by any term, merged and in order. */
export function matchRanges(text: string, terms: string[]): [number, number][] {
  const folded = fold(text);
  if (folded.length !== text.length) return [];
  const spans: [number, number][] = [];
  for (const term of terms) {
    if (!term) continue;
    for (let i = folded.indexOf(term); i !== -1; i = folded.indexOf(term, i + 1)) {
      spans.push([i, i + term.length]);
    }
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/**
 * A window of `text` around its first match, ellipsised at both ends when it is
 * a window into something longer. Used for the description line of a result:
 * the point is to show *why* this turned up, so the match has to be inside it.
 */
export function snippet(text: string, terms: string[], span = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= span) return flat;
  const folded = fold(flat);
  const at = terms.map((t) => folded.indexOf(t)).filter((i) => i !== -1);
  const first = at.length ? Math.min(...at) : 0;
  // Keep a little run-up so the match is not flush against the ellipsis.
  let start = Math.max(0, first - 24);
  if (start > 0) {
    const space = flat.indexOf(' ', start);
    if (space !== -1 && space < start + 16) start = space + 1;
  }
  const end = Math.min(flat.length, start + span);
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trimEnd()}${end < flat.length ? '…' : ''}`;
}
