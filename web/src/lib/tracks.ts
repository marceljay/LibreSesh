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
