import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SessionDto } from '@shared/types';

import { ApiError, api } from '../lib/api';
import {
  dayLabel,
  fmtMin,
  nowMinuteOfDay,
  place,
  speakerLine,
  todayInZone,
} from '../lib/format';
import { useEventData } from '../lib/useEventData';
import { useMe } from '../lib/useMe';
import { timeClashPairs } from '../components/Calendar';
import { Gate } from '../components/Gate';
import { Logo } from '../components/Logo';
import { EmptyState, Spinner, useToast } from '../components/ui';

/** Same cadence as the schedule's clock: a minute is the resolution anything
 *  on this page is drawn at. */
const NOW_TICK_MS = 30_000;

/**
 * Everything you have starred, in one list, across every day of the event.
 *
 * The schedule answers "what is on?" one day at a time — that is what a grid
 * of rooms is for. This answers a different question: "where am I going?",
 * which is the whole event at once and, at a fortnight-long conference, the
 * only view of your own plan that is not fourteen page-loads. It is also where
 * a clash is obvious: two sessions you starred at the same hour sit next to
 * each other here rather than in two different columns of two different days.
 *
 * Starring is private, so this is your list and nobody else's — including the
 * organiser's. Unstarring from here is the same call the ☆ makes on the grid.
 */
export function AgendaPage() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useMe();
  const data = useEventData(slug);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const bundle = data.bundle;
  const event = bundle?.event;
  const timezone = event?.timezone ?? 'UTC';
  const today = useMemo(
    () => (event ? todayInZone(timezone, new Date(clock)) : ''),
    [event, timezone, clock],
  );
  const nowMin = useMemo(
    () => (event ? nowMinuteOfDay(timezone, new Date(clock)) : 0),
    [event, timezone, clock],
  );

  const roomById = useMemo(
    () => new Map((bundle?.rooms ?? []).map((r) => [r.id, r])),
    [bundle],
  );

  /** Starred, placed and in programme order — one flat list before it is cut
   *  into days, so a clash across midnight is still a clash. */
  const mine = useMemo(() => {
    if (!bundle) return [];
    const starred = new Set(bundle.starredSessionIds);
    return bundle.sessions
      .filter((s) => starred.has(s.id))
      .map((session) => ({ session, ...place(session, timezone) }))
      .sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin,
      );
  }, [bundle, timezone]);

  const clashPairs = useMemo(() => timeClashPairs(mine), [mine]);
  const clashIds = useMemo(
    () => new Set(clashPairs.flatMap(([a, b]) => [a.id, b.id])),
    [clashPairs],
  );

  const byDay = useMemo(() => {
    const groups = new Map<string, typeof mine>();
    for (const item of mine) {
      const list = groups.get(item.date);
      if (list) list.push(item);
      else groups.set(item.date, [item]);
    }
    return [...groups.entries()];
  }, [mine]);

  const { setStarred } = data;
  const unstar = useCallback(
    async (session: SessionDto) => {
      // Optimistic: stars are private, so there is no broadcast to wait for and
      // nothing anyone else can contradict. Put it back if the server refuses.
      setStarred(session.id, false);
      try {
        await api.unstarSession(slug, session.id);
      } catch (err) {
        setStarred(session.id, true);
        toast.show(err instanceof ApiError ? err.message : 'Could not update your agenda');
      }
    },
    [setStarred, slug, toast],
  );

  if (data.status === 'loading') return <Spinner label="Loading your agenda…" />;
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
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
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
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-base font-semibold tracking-tight">My agenda</h1>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {mine.length === 0
              ? 'Nothing starred yet'
              : `${mine.length} session${mine.length === 1 ? '' : 's'} across ${byDay.length} day${
                  byDay.length === 1 ? '' : 's'
                }`}
          </p>
          {mine.length > 0 && (
            // Straight to the file rather than through the calendar dialog:
            // someone on this page has already said which sessions they mean.
            <a
              href={`/api/e/${encodeURIComponent(slug)}/calendar.ics?mine=1`}
              download
              className="ml-auto rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500"
            >
              Download as calendar
            </a>
          )}
        </div>

        {clashPairs.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-100 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
            <p className="text-sm font-medium">
              {clashIds.size} of these overlap.
            </p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {clashPairs.map(([a, b]) => {
                const pa = place(a, timezone);
                const pb = place(b, timezone);
                return (
                  <li key={`${a.id}-${b.id}`}>
                    {a.title} ({fmtMin(pa.startMin)}–{fmtMin(pa.endMin)}) overlaps {b.title} (
                    {fmtMin(pb.startMin)}–{fmtMin(pb.endMin)})
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {mine.length === 0 ? (
          <div className="mt-4">
            <EmptyState>
              Star a session with the ☆ on the schedule and it lands here. Your
              stars are private — nobody else, organisers included, can see what
              you have picked.
              <div className="mt-3">
                <Link to={`/e/${slug}`} className="underline">
                  Go to the schedule
                </Link>
              </div>
            </EmptyState>
          </div>
        ) : (
          <div className="mt-5 space-y-6">
            {byDay.map(([date, items]) => {
              const label = dayLabel(date, today);
              return (
                <section key={date}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                    {label.top} {label.sub}
                  </h2>
                  <ul className="space-y-1.5">
                    {items.map(({ session, startMin, endMin }) => {
                      const room = roomById.get(session.roomId);
                      const live = date === today && nowMin >= startMin && nowMin < endMin;
                      const past = date < today || (date === today && nowMin >= endMin);
                      return (
                        <li
                          key={session.id}
                          className={`flex items-start gap-2 rounded-xl border bg-white shadow-sm dark:bg-stone-900 ${
                            clashIds.has(session.id)
                              ? 'border-amber-300 dark:border-amber-800'
                              : 'border-stone-200 dark:border-stone-700'
                          } ${past ? 'opacity-60' : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => navigate(`/e/${slug}/s/${session.id}?day=${date}`)}
                            className="min-w-0 flex-1 rounded-l-xl px-3 py-2 text-left hover:bg-stone-50 dark:hover:bg-stone-800/60"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-stone-500 dark:text-stone-400">
                                {fmtMin(startMin)}–{fmtMin(endMin)}
                              </span>
                              {live && (
                                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-stone-900">
                                  on now
                                </span>
                              )}
                              {clashIds.has(session.id) && (
                                <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                                  clash
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-sm font-semibold">
                              {session.title}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                              {room && (
                                <span className="inline-flex items-center gap-1">
                                  <span
                                    aria-hidden="true"
                                    className="inline-block h-1.5 w-1.5 rounded-full align-middle"
                                    style={{ background: room.color }}
                                  />
                                  {room.name}
                                </span>
                              )}
                              {session.speakers.length > 0 && (
                                <>
                                  {room && ' · '}
                                  {speakerLine(session.speakers)}
                                </>
                              )}
                            </div>
                          </button>
                          {/* The star is filled, because everything here is
                              starred; pressing it takes the session off the
                              list, which is the only thing it can mean. */}
                          <button
                            type="button"
                            onClick={() => void unstar(session)}
                            aria-label={`Remove ${session.title} from my agenda`}
                            title="Remove from my agenda"
                            className="shrink-0 rounded-r-xl px-3 py-3 text-base leading-none text-amber-500 hover:bg-stone-50 hover:text-amber-600 dark:hover:bg-stone-800/60"
                          >
                            ★
                          </button>
                        </li>
                      );
                    })}
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
