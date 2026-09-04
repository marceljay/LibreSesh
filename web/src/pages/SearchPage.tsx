import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SessionDto } from '@shared/types';
import { plural } from '../lib/plural';
import { dayLabel, nowMinuteOfDay, place, todayInZone } from '../lib/format';
import { rankSessions, searchTerms } from '../lib/search';
import { matchesLens } from '../lib/sessionLens';
import { useEventData } from '../lib/useEventData';
import { useFilters } from '../lib/useFilters';
import { useMe } from '../lib/useMe';
import { ActiveFilters, FilterMenu } from '../components/FilterMenu';
import { Gate } from '../components/Gate';
import { Logo } from '../components/Logo';
import { SearchBox, SessionResultRow } from '../components/SearchBox';
import { EmptyState, Spinner } from '../components/ui';

/** What a query returns, counted. */
const RESULTS = { one: 'result', other: 'results' };
/** What a filter returns, counted — nobody "searched" for a tag, they picked it. */
const SESSIONS = { one: 'session', other: 'sessions' };

/**
 * Everything in the event that answers the question, on its own page.
 *
 * Two jobs, and they are the same job at different widths. The header's popdown
 * shows the best few hits for a query and this is where the rest live, grouped
 * by day so a result carries its place in the programme rather than a bare rank.
 * And it is the **advanced search**: the filter panel here is the schedule's own
 * panel, applied to the whole event instead of to the day on screen, because
 * "everything tagged design" is a question about the event and the schedule can
 * only answer it one day at a time.
 *
 * It is a page and not a panel because it is shareable — the whole question is
 * the URL, filters included — and because a search that spans a fortnight of an
 * event needs the room to scroll. See `_planning/specs/search.md`.
 *
 * Opening a result hands off to the schedule with `day` set, so the grid lands
 * on the right day with the session's sheet open.
 */
export function SearchPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useMe();
  const data = useEventData(slug);
  const filters = useFilters();
  const query = filters.q;

  const bundle = data.bundle;
  const event = bundle?.event;
  const timezone = event?.timezone ?? 'UTC';
  const today = useMemo(() => (event ? todayInZone(timezone) : ''), [event, timezone]);
  const terms = useMemo(() => searchTerms(query), [query]);

  const starredIds = useMemo(
    () => new Set(bundle?.starredSessionIds ?? []),
    [bundle?.starredSessionIds],
  );
  const hasUntracked = (bundle?.sessions ?? []).some((s) => s.trackId === null);

  /**
   * Every session that survives the lens, best first when there is a query to
   * rank by and in programme order when there is not — a tag on its own is a
   * browse, and a browse has no ranking to offer beyond "what happens first".
   */
  const hits = useMemo(() => {
    if (!bundle) return [];
    // "Now / next" means something different here than on the grid: the grid
    // draws one day, so there it can only mean a minute of that day. A page that
    // spans the event can ask the honest question — has it ended yet — across
    // dates. Read at render; nothing on this page ticks.
    const nowDate = todayInZone(timezone);
    const nowMin = nowMinuteOfDay(timezone);
    const chronological = bundle.sessions
      .slice()
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const lensed = chronological.filter((session) =>
      matchesLens(session, filters, {
        starred: (s) => starredIds.has(s.id),
        upcoming: (s) => {
          const at = place(s, timezone);
          return at.date > nowDate || (at.date === nowDate && at.endMin > nowMin);
        },
      }),
    );
    return query.trim() === '' ? lensed : rankSessions(lensed, query);
  }, [bundle, filters, query, starredIds, timezone]);

  /** Grouped by the day they sit on, days in programme order. Ranking already
   *  decided the order *within* a day; grouping only regroups it. */
  const byDay = useMemo(() => {
    const groups = new Map<string, SessionDto[]>();
    for (const session of hits) {
      const { date } = place(session, timezone);
      const list = groups.get(date);
      if (list) list.push(session);
      else groups.set(date, [session]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [hits, timezone]);

  const openSession = (session: SessionDto) => {
    const date = place(session, timezone).date;
    navigate(`/e/${slug}/s/${session.id}?day=${date}`);
  };

  if (data.status === 'loading') return <Spinner label="Loading schedule…" />;
  if (data.status === 'gate') {
    return <Gate slug={slug} me={me} onEntered={() => void data.reload()} />;
  }
  if (data.status === 'error' || !bundle || !event) {
    return (
      <EmptyState>
        {data.error ?? 'Could not load this event.'}
        <div className="mt-3">
          <Link to="/events" className="underline">
            Back to all events
          </Link>
        </div>
      </EmptyState>
    );
  }

  const typed = query.trim();
  /** Anything at all asked — a query, a chip, or both. */
  const asked = filters.active;
  /** A filtered browse counts sessions; a query counts results. */
  const noun = typed === '' ? SESSIONS : RESULTS;

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-stone-50/95 backdrop-blur dark:border-stone-700 dark:bg-stone-900/95">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="flex shrink-0 items-center" aria-label="LibreSesh home">
            <span className="flex items-center sm:hidden">
              <Logo variant="mark" className="h-6 w-auto" />
            </span>
            <span className="hidden items-center sm:flex">
              <Logo variant="oneline" className="h-6 w-auto" />
            </span>
          </Link>
          <span
            aria-hidden="true"
            className="hidden h-6 w-px shrink-0 bg-stone-300 dark:bg-stone-700 sm:block"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-tight">{event.name}</div>
            <Link
              to={`/e/${slug}`}
              className="text-xs text-stone-500 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
            >
              ← Back to the schedule
            </Link>
          </div>
          <SearchBox
            sessions={bundle.sessions}
            rooms={bundle.rooms}
            timezone={timezone}
            today={today}
            initialQuery={query}
            autoFocus={!asked}
            onOpen={openSession}
            // The page's own query, not a fresh navigation: writing `q` through
            // the filters keeps every chip beside it. `setParams({ q })` here
            // used to drop them.
            onSeeAll={(q) => filters.set({ q })}
          />
          {/* No `onSearchEverywhere`: this is everywhere. */}
          <FilterMenu
            filters={filters}
            rooms={bundle.rooms}
            tags={bundle.tags}
            tracks={bundle.tracks}
            hasUntracked={hasUntracked}
            starredCount={starredIds.size}
          />
          {filters.active && (
            <div className="flex basis-full flex-wrap items-center gap-1.5">
              <ActiveFilters
                filters={filters}
                rooms={bundle.rooms}
                tags={bundle.tags}
                tracks={bundle.tracks}
              />
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="text-sm font-semibold">
          {!asked
            ? 'Search the programme'
            : typed === ''
              ? plural(hits.length, noun)
              : `${plural(hits.length, noun)} for “${typed}”`}
        </h1>

        {!asked ? (
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            Type above to search every session in this event by title, speaker or description —
            or use Filter to see every session on a tag, a room or your agenda, across all days.
          </p>
        ) : hits.length === 0 ? (
          <EmptyState>
            {typed === ''
              ? 'No session matches these filters. Take one off to widen it.'
              : `Nothing matches “${typed}”. Every word has to appear somewhere in the session — try fewer of them, or clear a filter.`}
          </EmptyState>
        ) : (
          <div className="mt-4 space-y-6">
            {byDay.map(([date, sessions]) => {
              const label = dayLabel(date, today);
              return (
                <section key={date}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                    {label.top} {label.sub}
                    <span className="ms-1.5 font-normal normal-case tracking-normal">
                      · {plural(sessions.length, noun)}
                    </span>
                  </h2>
                  <ul className="space-y-1.5">
                    {sessions.map((session) => (
                      <li
                        key={session.id}
                        className="rounded-xl border border-stone-200 bg-white shadow-xs hover:shadow-sm dark:border-stone-700 dark:bg-stone-900"
                      >
                        <SessionResultRow
                          session={session}
                          rooms={bundle.rooms}
                          timezone={timezone}
                          today={today}
                          terms={terms}
                          onSelect={() => openSession(session)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
