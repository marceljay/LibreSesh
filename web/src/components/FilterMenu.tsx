import { useState } from 'react';
import { FloatingFocusManager } from '@floating-ui/react';
import type { RoomDto, TagDto, TrackDto } from '@shared/types';
import { UNTRACKED } from '../lib/tracks';
import type { FilterApi } from '../lib/useFilters';
import { FilterIcon, SearchIcon } from './icons';
import { popoverPanelClass, usePopover } from './Popover';
import { Chip } from './ui';

/**
 * Every way of narrowing the grid, behind one button.
 *
 * The chips used to sit in a row that scrolled sideways, so an event with a
 * dozen rooms and as many tags hid most of its filters off the right edge, and
 * the search box shared that row with them. Collapsing them into a panel leaves
 * the header with two controls, and gives the tags room to wrap and be read.
 *
 * The mini search in here is the *old* search: it writes `q` into the URL and
 * narrows what the grid draws. The header's box is a different question — find
 * a session anywhere in the programme — and deliberately touches nothing.
 *
 * Positioning is `usePopover`'s problem, not this file's: the panel is wider
 * than a phone and the button it hangs off is nowhere near the left edge, which
 * is exactly the combination the old `absolute left-0` got wrong.
 */
export function FilterMenu({
  filters,
  rooms,
  tags,
  tracks,
  hasUntracked,
  starredCount,
}: {
  filters: FilterApi;
  rooms: RoomDto[];
  tags: TagDto[];
  tracks: TrackDto[];
  /** Whether any session is still without a track, which is what makes the
   *  "Unassigned" chip worth offering. */
  hasUntracked: boolean;
  starredCount: number;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
  });

  const count =
    filters.rooms.length +
    filters.tags.length +
    filters.tracks.length +
    (filters.q.trim() ? 1 : 0) +
    (filters.soon ? 1 : 0) +
    (filters.mine ? 1 : 0);

  return (
    <div className="shrink-0">
      <button
        ref={refs.setReference}
        type="button"
        aria-label="Filter"
        title="Filter"
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
          count > 0 || open
            ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
            : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500'
        }`}
      >
        {/* The word goes below `sm`, like Manage and Add above it: the icon
            and the count say the same thing in a third of the width, on the
            screens with none to spare. The ▾ that used to sit at the end is
            gone at every width — it repeated what a panel opening under the
            button already says, and cost the row two characters for it. */}
        <FilterIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Filter</span>
        {count > 0 && (
          <span className="rounded-full bg-white/20 px-1.5 text-[10px] font-semibold text-white dark:bg-stone-900/20 dark:text-stone-900">
            {count}
          </span>
        )}
      </button>

      {/* `initialFocus={-1}`: the first control in the panel is a text input,
          and focusing it on open would throw up the on-screen keyboard over the
          panel every time a phone taps Filter. Tab still walks in from the
          button, and closing still hands focus back to it — which is what the
          focus manager is here for. */}
      {open && (
        <FloatingFocusManager context={context} modal={false} initialFocus={-1}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            aria-label="Filters"
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-[22rem] p-3`}
          >
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
              <input
                value={filters.q}
                onChange={(e) => filters.set({ q: e.target.value })}
                placeholder="Filter by title, speaker…"
                aria-label="Filter sessions by text"
                className="w-full rounded-lg border border-stone-300 bg-white py-1.5 pl-8 pr-3 text-xs outline-none focus:border-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:focus:border-stone-400"
              />
            </div>
            <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
              Narrows the schedule below. Filters live in the URL, so this view can be shared as a
              link.
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip active={filters.soon} onClick={() => filters.set({ soon: !filters.soon })}>
                Now / next
              </Chip>
              <Chip active={filters.mine} onClick={() => filters.set({ mine: !filters.mine })}>
                <span className={filters.mine ? '' : 'text-amber-500 dark:text-amber-400'}>★</span> My
                agenda ({starredCount})
              </Chip>
            </div>

            {rooms.length > 0 && (
              <>
                <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  Rooms
                </h3>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {rooms.map((r) => (
                    <Chip
                      key={r.id}
                      dot={r.color}
                      active={filters.rooms.includes(r.id)}
                      onClick={() => filters.toggleRoom(r.id)}
                    >
                      {r.name}
                    </Chip>
                  ))}
                </div>
              </>
            )}

            {(tracks.length > 0 || hasUntracked) && (
              <>
                <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  Tracks
                </h3>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {tracks.map((t) => (
                    <Chip
                      key={t.id}
                      dot={t.color}
                      active={filters.tracks.includes(t.id)}
                      onClick={() => filters.toggleTrack(t.id)}
                    >
                      {t.name}
                    </Chip>
                  ))}
                  {/* Sessions nobody has put on a strand are programme too, and
                      they are the ones an organiser goes looking for. Offered
                      only when some session actually has no track. */}
                  {hasUntracked && (
                    <Chip
                      active={filters.tracks.includes(UNTRACKED)}
                      onClick={() => filters.toggleTrack(UNTRACKED)}
                      title="Sessions with no track"
                    >
                      Unassigned
                    </Chip>
                  )}
                </div>
              </>
            )}

            {tags.length > 0 && (
              <>
                <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  Tags
                </h3>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <Chip
                      key={t.id}
                      dot={t.color}
                      active={filters.tags.includes(t.id)}
                      onClick={() => filters.toggleTag(t.id)}
                    >
                      {t.name}
                    </Chip>
                  ))}
                </div>
              </>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2 dark:border-stone-800">
              <button
                type="button"
                onClick={filters.clear}
                disabled={count === 0}
                className="text-xs font-medium text-stone-500 underline hover:text-stone-800 disabled:cursor-default disabled:no-underline disabled:opacity-40 dark:text-stone-400 dark:hover:text-stone-200"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-600 hover:border-stone-400 dark:border-stone-600 dark:text-stone-300"
              >
                Done
              </button>
            </div>
          </div>
        </FloatingFocusManager>
      )}
    </div>
  );
}

/**
 * What is currently narrowing the grid, spelled out beside the button — a
 * filter you cannot see is a filter you forget you set, and the panel that now
 * holds them is closed most of the time. Each chip takes itself off.
 */
export function ActiveFilters({
  filters,
  rooms,
  tags,
  tracks,
}: {
  filters: FilterApi;
  rooms: RoomDto[];
  tags: TagDto[];
  tracks: TrackDto[];
}) {
  if (!filters.active) return null;
  const remove = (label: string, onClick: () => void, key: string, dot?: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-label={`Remove filter ${label}`}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-stone-300 bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300"
    >
      {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
      {label}
      <span aria-hidden="true" className="text-stone-400 dark:text-stone-500">
        ×
      </span>
    </button>
  );

  return (
    <>
      {filters.q.trim() &&
        remove(`“${filters.q.trim()}”`, () => filters.set({ q: '' }), 'q')}
      {filters.soon && remove('Now / next', () => filters.set({ soon: false }), 'soon')}
      {filters.mine && remove('★ My agenda', () => filters.set({ mine: false }), 'mine')}
      {filters.rooms.map((id) => {
        const room = rooms.find((r) => r.id === id);
        return room
          ? remove(room.name, () => filters.toggleRoom(id), `room-${id}`, room.color)
          : null;
      })}
      {filters.tags.map((id) => {
        const tag = tags.find((t) => t.id === id);
        return tag ? remove(tag.name, () => filters.toggleTag(id), `tag-${id}`, tag.color) : null;
      })}
      {filters.tracks.map((id) => {
        if (id === UNTRACKED)
          return remove('Unassigned', () => filters.toggleTrack(id), 'track-none');
        const track = tracks.find((t) => t.id === id);
        return track
          ? remove(track.name, () => filters.toggleTrack(id), `track-${id}`, track.color)
          : null;
      })}
      <button
        type="button"
        onClick={filters.clear}
        className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-stone-500 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
      >
        Clear all
      </button>
    </>
  );
}
