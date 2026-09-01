/**
 * Reading a schedule document well enough to describe it, before the server is
 * asked anything.
 *
 * The import route already validates properly, and this does not try to repeat
 * it — a second copy of the rules would drift from the first, and the one that
 * drifted would be this one. What it does is answer the two questions a person
 * has while looking at a wall of pasted JSON: *is this even JSON*, and *what is
 * in it*. Both are answerable locally and instantly, and neither is worth a
 * round trip: a missing comma should not need the instance password to find.
 *
 * So the summary here is deliberately shallow and forgiving. Anything it cannot
 * read it reports as absent rather than as an error, because the authority on
 * whether a document is valid is the dry run, and a screen that refused to send
 * a document the server would have accepted would be worse than useless.
 */

/** What the paste box could make of the text, for the panel above the button. */
export interface DocSummary {
  name: string | null;
  slug: string | null;
  timezone: string | null;
  /** `[start, end]` as printed in the document, when both are readable. */
  dates: [string, string] | null;
  rooms: number;
  tracks: number;
  tags: number;
  breaks: number;
  sessions: number;
  /** Distinct speaker names — the profiles an import would look for or make. */
  speakers: number;
}

export type ParseResult =
  | { ok: true; doc: unknown; summary: DocSummary }
  | { ok: false; error: string };

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const len = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

/**
 * `JSON.parse` says "…in JSON at position 4021", which is true and unusable:
 * nobody counts to 4021. Say which line it is instead.
 *
 * The mistakes a paste actually makes — a missing comma, a trailing one, a
 * truncated copy — all carry a position, so they all get a line. V8's other
 * shape ("Unexpected token 'x', …\"…\" is not valid JSON") carries a snippet
 * instead, and passes through untouched: the snippet is the only part that
 * says where, and inventing a line number from it would sometimes be wrong,
 * which is worse than the raw message.
 */
export function explainJsonError(text: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const at = /position (\d+)/.exec(raw);
  if (!at) return raw;
  const position = Math.min(Number(at[1]), text.length);
  const before = text.slice(0, position);
  const line = before.split('\n').length;
  const column = position - before.lastIndexOf('\n');
  // Keep the engine's own words: it is the only part that says *what* is wrong.
  const reason = raw.replace(/\s*(in JSON )?at position \d+.*$/, '');
  return `${reason} — line ${line}, column ${column}`;
}

export function summarise(doc: unknown): DocSummary {
  const root = (doc ?? {}) as Record<string, unknown>;
  const event = (root.event ?? {}) as Record<string, unknown>;
  const startDate = str(event.startDate);
  const endDate = str(event.endDate);

  const speakers = new Set<string>();
  for (const session of Array.isArray(root.sessions) ? root.sessions : []) {
    const row = session as Record<string, unknown> | null;
    // Either spelling: `speaker` for the one-name case, `speakers` for a
    // session given by several people.
    const listed = Array.isArray(row?.speakers) ? row.speakers : [];
    for (const entry of [row?.speaker, ...listed]) {
      const name = str(entry);
      // Matching is case- and whitespace-insensitive on the server, so counting
      // "Ada Lovelace" and "ada  lovelace" as two profiles would be a lie.
      if (name) speakers.add(name.trim().replace(/\s+/g, ' ').toLowerCase());
    }
  }

  return {
    name: str(event.name),
    slug: str(event.slug),
    timezone: str(event.timezone),
    dates: startDate && endDate ? [startDate, endDate] : null,
    rooms: len(root.rooms),
    tracks: len(root.tracks),
    tags: len(root.tags),
    breaks: len(root.breaks),
    sessions: len(root.sessions),
    speakers: speakers.size,
  };
}

export function parseDoc(text: string): ParseResult {
  if (text.trim() === '') return { ok: false, error: 'Nothing pasted yet.' };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: explainJsonError(text, err) };
  }
  // An array or a bare string parses fine and then fails on the server with a
  // message about a missing `event`, which does not describe what happened.
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, error: 'This is valid JSON, but not an object with an `event` in it.' };
  }
  return { ok: true, doc, summary: summarise(doc) };
}
