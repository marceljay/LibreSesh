import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SessionDto } from '@shared/types';
import { dayLabel, place, todayInZone } from '../lib/format';
import { rankSessions, searchTerms } from '../lib/search';
import { useEventData } from '../lib/useEventData';
import { useMe } from '../lib/useMe';
import { Gate } from '../components/Gate';
import { Logo } from '../components/Logo';
import { SearchBox, SessionResultRow } from '../components/SearchBox';
import { EmptyState, Spinner } from '../components/ui';

/**
 * Every hit for a query, on its own page.
 *
 * The popdown shows the best few; this is where the rest live, grouped by day
 * so a result carries its place in the programme rather than a bare rank. It is
 * a page and not a panel because it is shareable — the query is the URL — and
 * because a search that spans a fortnight of an event needs the room to scroll.
 *
 * Opening a result hands off to the schedule with `day` set, so the grid lands
 * on the right day with the session's sheet open.
 */
export function SearchPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useMe();
  const data = useEventData(slug);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';

  const bundle = data.bundle;
  const event = bundle?.event;
  const timezone = event?.timezone ?? 'UTC';
  const today = useMemo(() => (event ? todayInZone(timezone) : ''), [event, timezone]);
  const terms = useMemo(() => searchTerms(query), [query]);

  const hits = useMemo(() => {
    if (!bundle) return [];
    const chronological = bundle.sessions
      .slice()
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return rankSessions(chronological, query);
  }, [bundle, query]);

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
            autoFocus={query === ''}
            onOpen={openSession}
            onSeeAll={(q) => setParams({ q }, { replace: true })}
          />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="text-sm font-semibold">
          {query.trim() === ''
            ? 'Search the programme'
            : `${hits.length} result${hits.length === 1 ? '' : 's'} for “${query.trim()}”`}
        </h1>

        {query.trim() === '' ? (
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            Type above to search every session in this event by title, speaker or description.
          </p>
        ) : hits.length === 0 ? (
          <EmptyState>
            Nothing matches “{query.trim()}”. Every word has to appear somewhere in the session —
            try fewer of them.
          </EmptyState>
        ) : (
          <div className="mt-4 space-y-6">
            {byDay.map(([date, sessions]) => {
              const label = dayLabel(date, today);
              return (
                <section key={date}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                    {label.top} {label.sub}
                    <span className="ml-1.5 font-normal normal-case tracking-normal">
                      · {sessions.length} result{sessions.length === 1 ? '' : 's'}
                    </span>
                  </h2>
                  <ul className="space-y-1.5">
                    {sessions.map((session) => (
                      <li
                        key={session.id}
                        className="rounded-xl border border-stone-200 bg-white shadow-sm hover:shadow dark:border-stone-700 dark:bg-stone-900"
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
