import { errorText } from '../lib/errorText';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EventSummary } from '@shared/types';
import { api } from '../lib/api';
import { useMe } from '../lib/useMe';
import { ThemeToggle } from '../components/ThemeToggle';
import { Logo } from '../components/Logo';
import { EmptyState, Spinner } from '../components/ui';

const fmtRange = (start: string, end: string): string => {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const from = new Date(`${start}T12:00:00Z`).toLocaleDateString(undefined, opts);
  if (start === end) return from;
  const to = new Date(`${end}T12:00:00Z`).toLocaleDateString(undefined, {
    ...opts,
    year: 'numeric',
  });
  return `${from} – ${to}`;
};

function EventCard({ event }: { event: EventSummary }) {
  return (
    <Link
      to={`/e/${event.slug}`}
      className="flex items-center gap-3 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-4 shadow-xs hover:shadow-sm"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{event.name}</div>
        <div className="text-xs text-stone-500 dark:text-stone-400">
          {fmtRange(event.startDate, event.endDate)}
          {event.archived && ' · archived'}
        </div>
      </div>
      <span className="text-xs font-medium text-stone-400 dark:text-stone-500">Enter →</span>
    </Link>
  );
}

function EventCards({ events }: { events: EventSummary[] }) {
  return (
    <ul className="space-y-2">
      {events.map((event) => (
        <li key={event.slug}>
          <EventCard event={event} />
        </li>
      ))}
    </ul>
  );
}

const headingClass =
  'mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400';
const noteClass = 'mb-3 max-w-[70ch] text-xs leading-5 text-stone-500 dark:text-stone-400';

export function EventListPage() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { me } = useMe();

  useEffect(() => {
    api
      .listEvents()
      .then(setEvents)
      .catch((err: unknown) => setError(errorText(err)));
  }, []);

  /*
   * Three piles, not one list.
   *
   * "Demo" here means exactly what it means everywhere else in the app
   * (`isDemoEvent`, SPEC §3.3): an event whose login page hands out roles on a
   * click instead of checking a password. The server names those slugs in
   * `/me`, so the page does not have to guess one from a name — and off a demo
   * instance that list is empty, which is right: the seeded fixture there is an
   * ordinary password-protected event, and labelling it "demo" would say the
   * opposite of what its login does. Until `/me` answers, every event sits in
   * the live pile and the demo ones move across when it does; the alternative
   * is holding the whole list back on a request that fails silently by design.
   *
   * Archived wins over both. It is the only pile that is *hidden*, because it
   * is the one that grows without bound — every conference that ever ran on
   * this box — and it was burying the two events anyone is actually going to.
   */
  const demoSlugs = me?.demoEventSlugs;
  const { live, demo, archived } = useMemo(() => {
    const piles = {
      live: [] as EventSummary[],
      demo: [] as EventSummary[],
      archived: [] as EventSummary[],
    };
    for (const event of events ?? []) {
      if (event.archived) piles.archived.push(event);
      else if (demoSlugs?.includes(event.slug)) piles.demo.push(event);
      else piles.live.push(event);
    }
    return piles;
  }, [events, demoSlugs]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* The logo carries the wordmark and the tagline as artwork, so the
            page's real heading is the screen-reader one. */}
        <h1 className="sr-only">LibreSesh — live schedules for conferences and unconferences</h1>
        {/* The list is no longer the front door, so the logo has somewhere to
            go: `/` is what this is, for whoever landed here first. */}
        <Link to="/" className="flex shrink-0 items-center" aria-label="LibreSesh home">
          <Logo className="h-11 w-auto sm:h-14" />
        </Link>
        <div className="ms-auto flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/import"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:border-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-400"
          >
            Import
          </Link>
          <Link
            to="/new"
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:border-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-400"
          >
            New event
          </Link>
        </div>
      </header>

      {error && <EmptyState>{error}</EmptyState>}
      {!events && !error && <Spinner label="Loading events…" />}
      {events?.length === 0 && (
        <EmptyState>
          No events yet.{' '}
          <Link to="/new" className="underline">
            Create the first one
          </Link>{' '}
          or{' '}
          <Link to="/import" className="underline">
            import a schedule
          </Link>
          .
        </EmptyState>
      )}
      {/* Not "no events": there are events, they are all in the archive, and
          the button below is the way to them. Without this the page reads as
          an empty instance to someone who has simply archived everything. */}
      {live.length === 0 && demo.length === 0 && archived.length > 0 && (
        <EmptyState>Every event here is archived.</EmptyState>
      )}

      {live.length > 0 && (
        <section>
          {/* No heading when there is nothing to tell it apart from — on an
              ordinary instance this is just "the events", and a label over a
              single list is furniture. */}
          {demo.length > 0 && <h2 className={headingClass}>Live events</h2>}
          <EventCards events={live} />
        </section>
      )}

      {demo.length > 0 && (
        <section className={live.length > 0 ? 'mt-8' : ''}>
          <h2 className={`${headingClass} flex items-center gap-2`}>
            Demo events
            {/* The same amber pill the login page and the About dialog use for
                "this is a demo" — one visual word for one idea. */}
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.6875rem] font-semibold normal-case tracking-normal text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              sample data
            </span>
          </h2>
          <p className={noteClass}>
            Fixtures to look around in. Their login asks for no password — you pick a role — and
            anything you change in them is reset.
          </p>
          <EventCards events={demo} />
        </section>
      )}

      {archived.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            aria-expanded={showArchived}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 hover:border-stone-500 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-400"
          >
            {showArchived ? 'Hide archived' : `Archived (${archived.length})`}
          </button>
          {showArchived && (
            <section className="mt-3">
              <p className={noteClass}>
                Finished events, kept read-only. The schedule is all still there; nothing in one can
                be changed.
              </p>
              <EventCards events={archived} />
            </section>
          )}
        </div>
      )}

      {/* Two different passwords meet on this page, and only here. Entering an
          event wants that event's; the two buttons in the header want the
          *instance's* (SPEC §3.3), which is the server owner's and which nobody
          attending an event ever sees. That distinction used to be spelled out
          on the landing page, where it defined a password almost every visitor
          will never meet — a question they had not asked. It belongs where the
          two buttons are, which is also where whoever deployed this box goes. */}
      <p className="mt-6 max-w-[70ch] text-xs leading-5 text-stone-400 dark:text-stone-500">
        {/* The demo events are the exception, and they are now named on this
            page — so the flat claim above them had to stop being flat. */}
        {demo.length > 0 ? 'Apart from the demo events, every' : 'Every'} event is
        password-protected — you’ll be asked for one when you enter.{' '}
        <span className="font-semibold">New event</span> and{' '}
        <span className="font-semibold">Import</span> ask for a different one: this instance’s
        password, set by whoever hosts the server.
      </p>
    </div>
  );
}
