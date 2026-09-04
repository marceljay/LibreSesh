/**
 * What an export can be asked to leave out.
 *
 * The event's own settings, its rooms, tracks, tags, formats and breaks are
 * always in the file: they are the frame, a few hundred bytes, and nothing in
 * them is anyone's but the organiser's. These four are the parts with a reason
 * to stay behind — the profiles name people, the pitches and contributions are
 * the record of the event being used rather than its programme, and the
 * sessions are the one thing a speaker list or a pitch archive does not need.
 *
 * Shared so the checkboxes in Manage Event and the route's `?include=` parser
 * are the same list.
 */
export const EXPORT_PARTS = ['sessions', 'people', 'proposals', 'contributions'] as const;

export type ExportPart = (typeof EXPORT_PARTS)[number];
