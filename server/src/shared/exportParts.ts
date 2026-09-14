/**
 * Everything an export can be asked to leave out — which is everything except
 * the event's own identity: name, address, timezone and dates, the lines a
 * file needs to be imported as anything at all.
 *
 * Each part is one key of the file, absent when not asked for. The order is
 * the order Manage Event offers them: the setup first, then the record of the
 * event being used. Two depend on another: contributions are posted *on*
 * sessions and sessions are placed *in* rooms, so the checkboxes refuse those
 * without their parent and the exporter writes what it is asked for.
 *
 * Shared so the checkboxes in Manage Event and the route's `?include=` parser
 * are the same list.
 */
export const EXPORT_PARTS = [
  'settings',
  'permissions',
  'rooms',
  'tracks',
  'tags',
  'formats',
  'breaks',
  'sessions',
  'people',
  'proposals',
  'contributions',
] as const;

export type ExportPart = (typeof EXPORT_PARTS)[number];

/** `part` needs `needs` in the same file to mean anything on the way back in. */
export const EXPORT_PART_NEEDS: Partial<Record<ExportPart, ExportPart>> = {
  sessions: 'rooms',
  contributions: 'sessions',
};
