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

import { EXPORT_PART_NEEDS } from '@shared/exportParts';

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
  /** When this is an export the app made rather than a typed document: the
   *  `exportedAt` stamp. The server translates one at the door; saying so
   *  here is what tells the person pasting it that it was recognised. */
  exportedAt: string | null;
}

export type ParseResult =
  { ok: true; doc: unknown; summary: DocSummary } | { ok: false; error: string };

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
    exportedAt: str(root.exportedAt),
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

/** The fields of `event` the page offers to replace, all optional. */
export interface DocOverrides {
  slug?: string;
  name?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * The document with the fields the page overrides replaced — what is sent
 * when any of Address, Name or the dates is filled in. Blank means "as
 * written", so an untouched field changes nothing; the server still validates
 * whatever ends up in `event`. The address is the one edit a restore always
 * needs: an export names the event it came from, and that address is taken on
 * the instance it came from. The name and dates are what running an event
 * again needs on top: the same frame, next year.
 */
export function withOverrides(doc: unknown, overrides: DocOverrides): unknown {
  const root = (doc ?? {}) as Record<string, unknown>;
  const event = (root.event ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...event };
  let changed = false;
  for (const [key, value] of Object.entries(overrides)) {
    const wanted = value?.trim() ?? '';
    if (wanted === '') continue;
    next[key] = wanted;
    changed = true;
  }
  return changed ? { ...root, event: next } : doc;
}

/**
 * The parts of a document an import can be asked to leave out, in the order
 * they are offered. The importer itself reads nothing else — profiles,
 * pitches and contributions in an export are dropped at the door and the
 * first warning says so — so those are not choices here.
 */
export const IMPORT_PARTS = [
  'settings',
  'permissions',
  'rooms',
  'tracks',
  'tags',
  'formats',
  'breaks',
  'sessions',
] as const;
export type ImportPart = (typeof IMPORT_PARTS)[number];

export const IMPORT_PART_LABELS: Record<ImportPart, string> = {
  settings: 'Settings',
  permissions: 'Permissions',
  rooms: 'Rooms',
  tracks: 'Tracks',
  tags: 'Tags',
  formats: 'Formats',
  breaks: 'Breaks',
  sessions: 'Sessions',
};

/** The keys of `event` that are Settings rather than identity. The passwords
 *  are neither: they are how the new event is entered, not a preference. */
const SETTINGS_KEYS = [
  'dayStartMin',
  'dayEndMin',
  'weekRailFrom',
  'userRoleLabel',
  'defaultView',
  'auditKeep',
  'showOfficialBadge',
  'pitchesEnabled',
] as const;

/** What a session row says about a part, in either spelling: the authoring
 *  document names things, an export numbers them. */
const SESSION_REFS: Partial<Record<ImportPart, readonly string[]>> = {
  tracks: ['track', 'trackId'],
  tags: ['tags', 'tagIds'],
  formats: ['format', 'formatId'],
};

const hasItems = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/** The parts this document actually carries — the ones worth a checkbox. */
export function partsIn(doc: unknown): ImportPart[] {
  const root = (doc ?? {}) as Record<string, unknown>;
  const event = (root.event ?? {}) as Record<string, unknown>;
  const present: ImportPart[] = [];
  if (SETTINGS_KEYS.some((key) => event[key] !== undefined && event[key] !== null)) {
    present.push('settings');
  }
  if (root.permissions !== undefined && root.permissions !== null) present.push('permissions');
  for (const part of ['rooms', 'tracks', 'tags', 'formats', 'breaks', 'sessions'] as const) {
    if (hasItems(root[part])) present.push(part);
  }
  return present;
}

/**
 * The document with `omit` taken out — what the page sends when a box in the
 * rehearsal is unticked. Mirrors the export's rule that what is left out is
 * pointed at by nothing that stays: a session keeps its room but loses its
 * track, tags or format when that part goes, so the importer never meets a
 * name it was not given. Sessions need rooms, so leaving the rooms out leaves
 * the sessions out with them. Nothing omitted returns the same object.
 */
export function withParts(doc: unknown, omit: ReadonlySet<ImportPart>): unknown {
  if (omit.size === 0) return doc;
  const root = { ...((doc ?? {}) as Record<string, unknown>) };
  const gone = new Set(omit);
  for (const part of IMPORT_PARTS) {
    const needs = EXPORT_PART_NEEDS[part];
    if (needs && gone.has(needs as ImportPart)) gone.add(part);
  }
  if (gone.has('settings')) {
    const event = { ...((root.event ?? {}) as Record<string, unknown>) };
    for (const key of SETTINGS_KEYS) delete event[key];
    root.event = event;
  }
  for (const part of gone) {
    if (part !== 'settings') delete root[part];
  }
  if (Array.isArray(root.sessions)) {
    const strip = IMPORT_PARTS.filter((part) => gone.has(part) && SESSION_REFS[part]);
    if (strip.length > 0) {
      root.sessions = root.sessions.map((row) => {
        const next = { ...((row ?? {}) as Record<string, unknown>) };
        for (const part of strip) for (const key of SESSION_REFS[part] ?? []) delete next[key];
        return next;
      });
    }
  }
  return root;
}
