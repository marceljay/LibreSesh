import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { UNTRACKED } from './tracks';

export type ViewMode = 'cal' | 'list';
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
      active:
        filters.rooms.length > 0 ||
        filters.tags.length > 0 ||
        filters.tracks.length > 0 ||
        filters.q !== '' ||
        filters.soon ||
        filters.mine,
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
