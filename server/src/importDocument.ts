/**
 * The front door of the importer: whatever arrived, hand back a document the
 * importer understands, and say what was lost on the way in.
 *
 * Two shapes come through it. The authoring document — names and wall-clock
 * times, the one a person types — goes straight to `eventImportSchema`. An
 * *export*, the file Manage Event → Backup downloads, does not: it is a record
 * of a database, keyed by id, with minutes where the importer wants `HH:MM` and
 * `null` where it wants an absent key. Both carry `format: "libresesh.event"`,
 * and for a long time the importer said it recognised the second and then
 * refused it — 103 errors on a 96-session programme, the first of them
 * `breaks.0.start: Required`.
 *
 * The fix is a translation at the door rather than a second importer or a
 * second export format. The export stays what it is — an archive that has to
 * keep opening, with the profiles and pitches and comments a programme does
 * not have — and every export ever downloaded becomes importable, not just
 * the ones made after today. What the translation cannot carry it says in a
 * warning, so the dry run reads it back before anything is written.
 */
import { z } from 'zod';
import { badRequest } from './errors.js';
import { type EventImport, eventImportSchema } from './importEvent.js';
import { parse } from './validation.js';

/**
 * As much of an export as the translation reads. Deliberately loose — every
 * value it passes through is checked by the import schema afterwards, so this
 * only has to be sure of the ids it resolves and the minutes it formats.
 * `passthrough` keeps the export-only fields (`createdAt`, `starCount`…) from
 * being errors; they are simply not read.
 */
const id = z.number().int();
const minutes = z.number().int();
const named = z.object({ id, name: z.unknown() }).passthrough();

const exportDocumentSchema = z
  .object({
    exportedAt: z.string().optional(),
    event: z.object({}).passthrough(),
    rooms: z.array(named.extend({ sortOrder: z.number().optional() })).optional(),
    tracks: z
      .array(
        named.extend({
          startMin: minutes.nullable().optional(),
          endMin: minutes.nullable().optional(),
          windows: z
            .array(z.object({ date: z.unknown(), startMin: minutes, endMin: minutes }))
            .optional(),
          sortOrder: z.number().optional(),
        }),
      )
      .optional(),
    tags: z.array(named).optional(),
    formats: z.array(named).optional(),
    breaks: z
      .array(
        z
          .object({ startMin: minutes, endMin: minutes, date: z.unknown().optional() })
          .passthrough(),
      )
      .optional(),
    people: z.array(z.unknown()).optional(),
    sessions: z
      .array(
        z
          .object({
            roomId: id,
            trackId: id.nullable().optional(),
            formatId: id.nullable().optional(),
            tagIds: z.array(id).optional(),
            title: z.unknown(),
            speakers: z.array(z.unknown()).optional(),
            speaker: z.unknown().optional(),
            livestreams: z.array(z.unknown()).optional(),
            starCount: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
    proposals: z.array(z.unknown()).optional(),
    contributions: z.array(z.unknown()).optional(),
  })
  .passthrough();

type ExportDocument = z.infer<typeof exportDocumentSchema>;
type Loose = Record<string, unknown>;

/**
 * Is this an export rather than an authoring document? An export always
 * carries `exportedAt`; failing that — someone trimmed it by hand — a room
 * with a numeric id or a session naming one is the shape only an export has.
 * An authoring document is `.strict()` at the top level and has no ids
 * anywhere, so neither test can mistake one.
 */
export function isEventExport(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const doc = body as Loose;
  if (typeof doc.exportedAt === 'string') return true;
  const first = (list: unknown): Loose | undefined =>
    Array.isArray(list) && list.length > 0 && typeof list[0] === 'object' && list[0] !== null
      ? (list[0] as Loose)
      : undefined;
  return typeof first(doc.rooms)?.id === 'number' || typeof first(doc.sessions)?.roomId === 'number';
}

/** Minutes of the day as the importer prints them; 1440 is `24:00`. */
const hhmm = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** The keys the importer's `event` knows; the rest of an export's are its own. */
const EVENT_KEYS = [
  'name',
  'slug',
  'timezone',
  'startDate',
  'endDate',
  'dayStartMin',
  'dayEndMin',
  'userRoleLabel',
  'defaultView',
] as const;

/** Copy the keys that are set: the importer's optional fields want an absent
 *  key, not the `null` or `''` an export writes for "none". */
const present = (source: Loose, keys: readonly string[]): Loose => {
  const out: Loose = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') out[key] = value;
  }
  return out;
};

const bySortOrder = <T extends { sortOrder?: number }>(list: T[]): T[] =>
  [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

const plural = (n: number, one: string, other: string): string =>
  `${n} ${n === 1 ? one : other}`;

/**
 * An export as the importer would have it written. Ids become the names they
 * stood for — resolved against the export's own lists, so an id naming nothing
 * is refused with the row that carried it, the way an undeclared room name is.
 * Instants stay instants: the importer takes `startsAt`/`endsAt` as they are,
 * so no timezone arithmetic happens here and none can go wrong.
 */
export function fromExport(body: unknown): { doc: unknown; warnings: string[] } {
  const src: ExportDocument = parse(exportDocumentSchema, body);
  const rooms = bySortOrder(src.rooms ?? []);
  const tracks = bySortOrder(src.tracks ?? []);
  const tags = src.tags ?? [];
  const formats = src.formats ?? [];
  const sessions = src.sessions ?? [];

  const nameOf = (list: { id: number; name?: unknown }[]): Map<number, unknown> =>
    new Map(list.map((item) => [item.id, item.name]));
  const roomName = nameOf(rooms);
  const trackName = nameOf(tracks);
  const tagName = nameOf(tags);
  const formatName = nameOf(formats);

  const doc: Loose = {
    format: 'libresesh.event',
    version: 1,
    event: present(src.event as Loose, EVENT_KEYS),
  };

  // Array order is column order, so `sortOrder` travels as position.
  if (rooms.length > 0) {
    doc.rooms = rooms.map((room) => ({
      name: room.name,
      ...present(room, ['description', 'capacity', 'color', 'openBooking']),
    }));
  }
  if (tracks.length > 0) {
    doc.tracks = tracks.map((track) => {
      const row: Loose = { name: track.name, ...present(track, ['description', 'color']) };
      if (typeof track.startMin === 'number' && typeof track.endMin === 'number') {
        row.start = hhmm(track.startMin);
        row.end = hhmm(track.endMin);
      }
      if (track.windows && track.windows.length > 0) {
        row.windows = track.windows.map((w) => ({
          date: w.date,
          start: hhmm(w.startMin),
          end: hhmm(w.endMin),
        }));
      }
      return row;
    });
  }
  if (tags.length > 0) {
    doc.tags = tags.map((tag) => ({ name: tag.name, ...present(tag, ['color']) }));
  }
  if (formats.length > 0) {
    doc.formats = formats.map((format) => ({ name: format.name, ...present(format, ['color']) }));
  }
  if (src.breaks && src.breaks.length > 0) {
    doc.breaks = src.breaks.map((b) => ({
      ...present(b, ['label', 'date']),
      start: hhmm(b.startMin),
      end: hhmm(b.endMin),
    }));
  }
  if (sessions.length > 0) {
    doc.sessions = sessions.map((session, index) => {
      const label = `sessions[${index}] "${String(session.title)}"`;
      const resolve = (kind: string, names: Map<number, unknown>, key: number): unknown => {
        if (!names.has(key)) {
          throw badRequest(`${label}: ${kind} ${key} is not in this export`);
        }
        return names.get(key);
      };
      const row: Loose = {
        room: resolve('roomId', roomName, session.roomId),
        title: session.title,
        ...present(session, [
          'description',
          'type',
          'blocksOpenBooking',
          'startsAt',
          'endsAt',
        ]),
      };
      if (typeof session.trackId === 'number') {
        row.track = resolve('trackId', trackName, session.trackId);
      }
      if (typeof session.formatId === 'number') {
        row.format = resolve('formatId', formatName, session.formatId);
      }
      if (session.tagIds && session.tagIds.length > 0) {
        row.tags = session.tagIds.map((tagId) => resolve('tagId', tagName, tagId));
      }
      // `speakers` is the list and the truth; `speaker` is its first entry,
      // kept on an export for the eye. An old export has only the latter.
      if (session.speakers && session.speakers.length > 0) row.speakers = session.speakers;
      else if (typeof session.speaker === 'string' && session.speaker !== '') {
        row.speaker = session.speaker;
      }
      if (session.livestreams && session.livestreams.length > 0) {
        row.livestreams = session.livestreams;
      }
      return row;
    });
  }

  // What an import cannot take: it builds a programme, and these are the
  // record of one being used. Said once, up front, so the dry run reads it
  // before a single row is written.
  const left: string[] = [];
  const people = src.people?.length ?? 0;
  if (people > 0) {
    left.push(
      `${plural(people, 'profile', 'profiles')} (speakers are billed by name and get a fresh ` +
        'unclaimed profile each, without bio or links)',
    );
  }
  const proposals = src.proposals?.length ?? 0;
  if (proposals > 0) left.push(plural(proposals, 'pitch', 'pitches'));
  const contributions = src.contributions?.length ?? 0;
  if (contributions > 0) left.push(plural(contributions, 'contribution', 'contributions'));
  if (sessions.some((s) => (s.starCount ?? 0) > 0)) left.push('the star counts');
  const warnings =
    left.length === 0
      ? []
      : [
          `This is an export, and an import builds a programme rather than a record of one. ` +
            `Not carried over: ${left.join(', ')}.`,
        ];

  return { doc, warnings };
}

/**
 * The one entry point the route uses: recognise what arrived, translate it if
 * it needs translating, and validate the result as the document it now is.
 */
export function readImportDocument(body: unknown): { doc: EventImport; warnings: string[] } {
  if (!isEventExport(body)) return { doc: parse(eventImportSchema, body), warnings: [] };
  const translated = fromExport(body);
  return { doc: parse(eventImportSchema, translated.doc), warnings: translated.warnings };
}
