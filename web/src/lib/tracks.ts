import type { TrackDto } from '@shared/types';

/** Only what a track's column header reads, so tests and callers need no
 *  full DTO. */
export type TrackFactsInput = Pick<TrackDto, 'description'>;

/**
 * The organiser's context for the strand — what it is for, who it is aimed at,
 * what to bring — or '' when there is none.
 *
 * The twin of `roomNote`, and deliberately the same shape: a track column and
 * a room column are the same furniture on the schedule, so the one thing that
 * does not fit on the card belongs behind the same info button in both. What
 * is already on the card — the session count, the hours — stays off the panel,
 * because a panel that repeats the header gives a reader nothing for the tap.
 */
export const trackNote = (track: TrackFactsInput): string => track.description.trim();

/** The id a session with no track filters and columns under. Negative so it
 *  cannot collide with a real track id, and low enough to sort last. */
export const UNTRACKED = -1;

/** Which track bucket a session belongs to — its own track, or unassigned. */
export const trackBucket = (session: { trackId: number | null }): number =>
  session.trackId ?? UNTRACKED;

/**
 * Does a session pass a track selection?
 *
 * An empty selection narrows nothing, exactly as the room and tag chips do.
 * `UNTRACKED` is a selectable bucket rather than a special case: "show me the
 * sessions nobody has put on a strand yet" is the question an organiser asks
 * most, and it is unanswerable if the only choices are the tracks that exist.
 */
export const matchesTracks = (
  selected: number[],
  session: { trackId: number | null },
): boolean => selected.length === 0 || selected.includes(trackBucket(session));
