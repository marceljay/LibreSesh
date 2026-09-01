import { useEffect, useMemo, useRef, useState } from 'react';
import type { RoomDto, SessionDto } from '@shared/types';
import { dayLabel, fmtMin, place } from '../lib/format';
import { bestField, matchRanges, rankSessions, searchTerms, snippet } from '../lib/search';
import { ArrowRightIcon, SearchIcon } from './icons';
import { popoverPanelClass, usePopover } from './Popover';

/** How many hits the popdown shows before it hands you off to the full page. */
const PREVIEW = 5;

/** The matched runs of `text` in bold, the rest as it was. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const ranges = matchRanges(text, terms);
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([from, to], i) => {
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      <mark key={i} className="rounded bg-amber-200/70 text-inherit dark:bg-amber-400/30">
        {text.slice(from, to)}
      </mark>,
    );
    at = to;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * One result, over as many lines as it takes to say where the session is and
 * why it matched. A one-line row was the old behaviour and it made every hit
 * look alike; the day and time are the two things you need to decide whether
 * this is the session you meant, and a description hit has to show the sentence
 * it matched or the row looks like a mistake.
 */
export function SessionResultRow({
  session,
  rooms,
  timezone,
  today,
  terms,
  active = false,
  inMenu = false,
  onSelect,
}: {
  session: SessionDto;
  rooms: RoomDto[];
  timezone: string;
  today: string;
  terms: string[];
  active?: boolean;
  /** In the popdown, keep the press from blurring the input before the click
   *  lands. On the results page the row is just a link-shaped button, and
   *  swallowing pointerdown there would only break selecting its text. */
  inMenu?: boolean;
  onSelect: () => void;
}) {
  const { date, startMin, endMin } = place(session, timezone);
  const label = dayLabel(date, today);
  const room = rooms.find((r) => r.id === session.roomId);
  const field = bestField(session, terms);
  const context = field === 'description' && session.description ? session.description : '';

  return (
    <button
      type="button"
      onPointerDown={inMenu ? (e) => e.preventDefault() : undefined}
      onClick={onSelect}
      className={`block w-full rounded-lg px-3 py-2 text-left ${
        active ? 'bg-stone-100 dark:bg-stone-800' : 'hover:bg-stone-50 dark:hover:bg-stone-800/60'
      }`}
    >
      <div className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
        <Highlight text={session.title} terms={terms} />
      </div>
      <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
        <span className="font-medium text-stone-600 dark:text-stone-300">
          {label.top} {label.sub}
        </span>
        {' · '}
        {fmtMin(startMin)}–{fmtMin(endMin)}
        {room && (
          <>
            {' · '}
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ background: room.color }}
              />
              {room.name}
            </span>
          </>
        )}
        {session.speaker && (
          <>
            {' · '}
            <Highlight text={session.speaker} terms={terms} />
          </>
        )}
      </div>
      {context && (
        <div className="mt-0.5 line-clamp-2 text-xs text-stone-500 dark:text-stone-400">
          <Highlight text={snippet(context, terms)} terms={terms} />
        </div>
      )}
    </button>
  );
}

/**
 * Search across the whole programme, not just the day on screen.
 *
 * Typing opens a popdown of the best few hits; Enter takes the query to the
 * results page, and the arrow keys pick a hit to open directly. That split is
 * the point: the box answers "where is that talk?" without disturbing the grid,
 * while narrowing the grid itself stays in the filter panel, where the mini
 * search still writes `q` into the URL.
 */
export function SearchBox({
  sessions,
  rooms,
  timezone,
  today,
  onOpen,
  onSeeAll,
  initialQuery = '',
  autoFocus = false,
  className = '',
}: {
  sessions: SessionDto[];
  rooms: RoomDto[];
  timezone: string;
  today: string;
  onOpen: (session: SessionDto) => void;
  onSeeAll: (query: string) => void;
  initialQuery?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  // -1 = nothing picked, which is what makes Enter mean "show me everything".
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  const terms = useMemo(() => searchTerms(query), [query]);
  /** Chronological in, chronological out: `rankSessions` sorts stably, so hits
   *  of equal weight read in programme order rather than by row id. */
  const chronological = useMemo(
    () => sessions.slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [sessions],
  );
  const all = useMemo(() => rankSessions(chronological, query), [chronological, query]);
  const hits = all.slice(0, PREVIEW);

  useEffect(() => setActive(-1), [query]);
  // The results page owns the query in its URL; going back or forward there has
  // to move the box with it, or the box says one thing and the page another.
  useEffect(() => setQuery(initialQuery), [initialQuery]);

  // "/" focuses the box from anywhere on the page, unless you are typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? '')) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const seeAll = () => {
    if (!query.trim()) return;
    setOpen(false);
    input.current?.blur();
    onSeeAll(query.trim());
  };

  const pick = (session: SessionDto) => {
    setOpen(false);
    input.current?.blur();
    onOpen(session);
  };

  const showPanel = open && terms.length > 0;

  // The box itself is the anchor, not the input inside it, so the results line
  // up with the whole control and a press on the clear "×" still counts as
  // inside. Escape stays this component's own — see the input's keydown.
  const { refs, floatingStyles, getFloatingProps } = usePopover({
    open: showPanel,
    onOpenChange: setOpen,
    role: 'listbox',
    escapeKey: false,
  });

  return (
    <div ref={refs.setReference} className={`relative shrink-0 ${className}`}>
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
      <input
        ref={input}
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (hits.length === 0) return;
            e.preventDefault();
            setOpen(true);
            setActive((a) => {
              const next = a + (e.key === 'ArrowDown' ? 1 : -1);
              if (next < -1) return hits.length - 1;
              if (next >= hits.length) return -1;
              return next;
            });
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const hit = active >= 0 ? hits[active] : undefined;
            if (hit) pick(hit);
            else seeAll();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            if (open) setOpen(false);
            else setQuery('');
          }
        }}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-label="Search sessions"
        placeholder="Search…"
        /* Sized for what it holds rather than for the placeholder it used to
           spell out: a query is a word or two, and the field grows on focus
           anyway. `Search sessions…` is still the accessible name, and on a
           touch screen the text is floored at 16px — under that Safari zooms
           the page in on focus and does not zoom back out — which the shorter
           placeholder leaves room for. */
        className="w-36 rounded-full border border-stone-300 bg-white py-1.5 pl-8 pr-8 text-xs outline-none focus:w-56 focus:border-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:focus:border-stone-400 sm:w-44 sm:focus:w-72"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery('');
            input.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
        >
          ×
        </button>
      )}

      {showPanel && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          id="search-results"
          role="listbox"
          className={`${popoverPanelClass} w-[28rem] p-1`}
        >
          {hits.length === 0 ? (
            <p className="px-3 py-3 text-xs text-stone-500 dark:text-stone-400">
              Nothing matches “{query.trim()}”.
            </p>
          ) : (
            <>
              <ul>
                {hits.map((session, i) => (
                  <li key={session.id} role="option" aria-selected={i === active}>
                    <SessionResultRow
                      session={session}
                      rooms={rooms}
                      timezone={timezone}
                      today={today}
                      terms={terms}
                      active={i === active}
                      inMenu
                      onSelect={() => pick(session)}
                    />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onPointerDown={(e) => e.preventDefault()}
                onClick={seeAll}
                className={`mt-1 flex w-full items-center justify-between gap-2 rounded-lg border-t border-stone-100 px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-800/60 ${
                  active === -1 ? 'bg-stone-50 dark:bg-stone-800/60' : ''
                }`}
              >
                <span>
                  {all.length > hits.length
                    ? `See all ${all.length} results`
                    : `See ${all.length === 1 ? 'the result' : 'all results'} on one page`}
                </span>
                <span className="flex items-center gap-1.5 text-stone-400 dark:text-stone-500">
                  <kbd className="rounded border border-stone-300 px-1 font-sans text-[10px] dark:border-stone-600">
                    ↵
                  </kbd>
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
