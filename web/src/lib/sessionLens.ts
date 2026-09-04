import type { SessionDto } from '@shared/types';

import { matchesQuery } from './search';
import { matchesTracks } from './tracks';

/**
 * The lens: everything that narrows a set of sessions without saying which day
 * you are looking at.
 *
 * Search finds things — a session, a person — and a lens narrows things. The
 * distinction is the one in `_planning/specs/search.md`, and it is why this
 * module exists at all: the schedule and the search page apply the *same*
 * narrowing to different sets, so the predicate has to be one function rather
 * than two that look alike. It was two, and the search page could only have
 * grown a near-copy of it.
 *
 * `FilterApi` satisfies this structurally, so the URL state can be handed
 * straight in.
 */
export interface SessionLens {
  rooms: number[];
  tags: number[];
  /** Track ids, plus `UNTRACKED` for "no track chosen yet". */
  tracks: number[];
  q: string;
  soon: boolean;
  mine: boolean;
}

/**
 * The two questions a lens cannot answer on its own, because their answers
 * belong to the surface asking.
 */
export interface LensContext {
  /** `mine` — whether this identity has starred it. */
  starred: (session: SessionDto) => boolean;
  /**
   * `soon` — whether it is still to come. The grid draws one day, so there it
   * can only mean "later today, and only if today is what is on screen"; the
   * search page spans the event, so there it means "has not ended yet",
   * measured across dates. Same words, two readings, and the surface is what
   * decides which one is honest.
   */
  upcoming: (session: SessionDto) => boolean;
}

/** Whether one session survives every filter that is set. */
export function matchesLens(
  session: SessionDto,
  lens: SessionLens,
  context: LensContext,
): boolean {
  if (lens.rooms.length > 0 && !lens.rooms.includes(session.roomId)) return false;
  if (lens.tags.length > 0 && !session.tagIds.some((t) => lens.tags.includes(t))) {
    return false;
  }
  if (!matchesTracks(lens.tracks, session)) return false;
  if (lens.mine && !context.starred(session)) return false;
  // The same matcher the search box uses: every word has to appear somewhere in
  // the session, in any order.
  const q = lens.q.trim();
  if (q !== '' && !matchesQuery(session, q)) return false;
  if (lens.soon && !context.upcoming(session)) return false;
  return true;
}

/** Whether anything is set — an unset lens shows everything. */
export const lensActive = (lens: SessionLens): boolean =>
  lens.rooms.length > 0 ||
  lens.tags.length > 0 ||
  lens.tracks.length > 0 ||
  lens.q.trim() !== '' ||
  lens.soon ||
  lens.mine;
