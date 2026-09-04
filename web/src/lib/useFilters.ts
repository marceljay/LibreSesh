import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { ViewMode } from '@shared/types';

import { lensActive } from './sessionLens';
import { UNTRACKED } from './tracks';

/** Re-exported so the components that read a view off the URL do not each have
 *  to know it is the same two words the event stores as its default. */
export type { ViewMode };

/** What the grid's columns are. Only meaningful once the event has tracks. */
export type Axis = 'room' | 'track';

export interface Filters {
  day: string | null;
  view: ViewMode | null;
  axis: Axis | null;
  rooms: number[];
  tags: number[];
  /** Track ids, plus `UNTRACKED` for "no track chosen yet". */
  tracks: number[];
  q: string;
  /** "happening now or next" quick filter. */
  soon: boolean;
  /** Show only sessions the current identity has starred. */
  mine: boolean;
}

export interface FilterApi extends Filters {
  active: boolean;
  set: (patch: Partial<Filters>) => void;
  toggleRoom: (id: number) => void;
  toggleTag: (id: number) => void;
  toggleTrack: (id: number) => void;
  clear: () => void;
}

const parseIds = (raw: string | null, extra?: number): number[] =>
  raw
    ? raw
        .split(',')
        .map(Number)
        .filter((n) => Number.isInteger(n) && (n > 0 || n === extra))
    : [];

const toggle = (list: number[], id: number): number[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/**
 * The lens half of the URL: what narrows a set of sessions, with `day`, `view`
 * and `axis` left out — those are facts about the grid, and the page this is
 * built for has no grid.
 *
 * This is what makes "the same question, over the whole event" a link rather
 * than a state transfer. It lives here because this file is the one place that
 * knows a room filter is spelled `room` and a starred one `mine`.
 */
export const lensParams = (filters: Filters): URLSearchParams => {
  const params = new URLSearchParams();
  const q = filters.q.trim();
  if (q !== '') params.set('q', q);
  if (filters.rooms.length > 0) params.set('room', filters.rooms.join(','));
  if (filters.tags.length > 0) params.set('tag', filters.tags.join(','));
  if (filters.tracks.length > 0) params.set('track', filters.tracks.join(','));
  if (filters.soon) params.set('soon', '1');
  if (filters.mine) params.set('mine', '1');
  return params;
};

/** Filter state lives in the query string so a filtered view is shareable
 *  (SPEC §7.3). */
export function useFilters(): FilterApi {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<Filters>(() => {
    const view = params.get('view');
    const axis = params.get('axis');
    return {
      day: params.get('day'),
      view: view === 'cal' || view === 'list' ? view : null,
      axis: axis === 'room' || axis === 'track' ? axis : null,
      rooms: parseIds(params.get('room')),
      tags: parseIds(params.get('tag')),
      // `UNTRACKED` is a real value here, not a placeholder: `?track=-1` is a
      // shareable link to the sessions still waiting for a strand.
      tracks: parseIds(params.get('track'), UNTRACKED),
      q: params.get('q') ?? '',
      soon: params.get('soon') === '1',
      mine: params.get('mine') === '1',
    };
  }, [params]);

  const set = useCallback(
    (patch: Partial<Filters>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const write = (key: string, value: string | null) => {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          };
          if ('day' in patch) write('day', patch.day ?? null);
          if ('view' in patch) write('view', patch.view ?? null);
          if ('axis' in patch) write('axis', patch.axis ?? null);
          if ('rooms' in patch) write('room', (patch.rooms ?? []).join(','));
          if ('tags' in patch) write('tag', (patch.tags ?? []).join(','));
          if ('tracks' in patch) write('track', (patch.tracks ?? []).join(','));
          if ('q' in patch) write('q', patch.q ?? null);
          if ('soon' in patch) write('soon', patch.soon ? '1' : null);
          if ('mine' in patch) write('mine', patch.mine ? '1' : null);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return useMemo(
    () => ({
      ...filters,
      active: lensActive(filters),
      set,
      toggleRoom: (id: number) => set({ rooms: toggle(filters.rooms, id) }),
      toggleTag: (id: number) => set({ tags: toggle(filters.tags, id) }),
      toggleTrack: (id: number) => set({ tracks: toggle(filters.tracks, id) }),
      clear: () =>
        set({ rooms: [], tags: [], tracks: [], q: '', soon: false, mine: false }),
    }),
    [filters, set],
  );
}
