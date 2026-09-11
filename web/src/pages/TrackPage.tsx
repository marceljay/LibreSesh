import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SessionDto, TrackDto } from '@shared/types';
import { fmtMinute, windowLabel } from '@shared/trackHours';
import { EventBar } from '../components/EventBar';
import { Login } from '../components/Login';
import { SessionResultRow } from '../components/SearchBox';
import { EmptyState, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { dayLabel, place, todayInZone } from '../lib/format';
import { plural } from '../lib/plural';
import { trackNote } from '../lib/tracks';
import { useEventData } from '../lib/useEventData';
import { useMe } from '../lib/useMe';

const SESSIONS = { one: 'session', other: 'sessions' };

/**
 * One track, every day of it, as a list.
 *
 * The grid shows a track one day at a time, which is the right view for
 * "what is on this afternoon" and the wrong one for "what is this strand" —
 * that question spans the event, and the answer used to be pieced together by
 * paging through the days with the Tracks axis on. This is the page the
 * column's name opens onto: what the strand is for in the organiser's words,
 * the hours it keeps, and its sessions in running order grouped by day, the
 * way the search page groups its results.
 *
 * Opening a session hands off to the schedule with `day` set, so the grid
 * lands on the right day with the session's sheet open, exactly as search
 * does.
 */
export function TrackPage() {
  const { slug = '', trackId = '' } = useParams();
  const navigate = useNavigate();
  const { me } = useMe();
  const data = useEventData(slug);

  const bundle = data.bundle;
  const event = bundle?.event;
  const timezone = event?.timezone ?? 'UTC';
  const today = useMemo(() => (event ? todayInZone(timezone) : ''), [event, timezone]);

  const id = Number(trackId);
  const track: TrackDto | undefined = bundle?.tracks.find((t) => t.id === id);

  /** The track's sessions in running order, grouped by the day they sit on. */
  const byDay = useMemo(() => {
    if (!bundle || !track) return [];
    const groups = new Map<string, SessionDto[]>();
    const sessions = bundle.sessions
      .filter((s) => s.trackId === track.id)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    for (const session of sessions) {
      const { date } = place(session, timezone);
      const list = groups.get(date);
      if (list) list.push(session);
      else groups.set(date, [session]);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [bundle, track, timezone]);
  const total = byDay.reduce((n, [, sessions]) => n + sessions.length, 0);

  const openSession = (session: SessionDto) => {
    const date = place(session, timezone).date;
    navigate(`/e/${slug}/s/${session.id}?day=${date}`);
  };

  if (data.status === 'loading') return <Spinner label="Loading schedule…" />;
  if (data.status === 'login page') {
    return <Login slug={slug} me={me} onEntered={() => void data.reload()} />;
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

  const back = (
    <Link
      to={`/e/${slug}`}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
    >
      <span aria-hidden="true">←</span>
      Back to the schedule
    </Link>
  );

  if (!track) {
    return (
      <div className="min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
        <EmptyState>
          No such track. It may have been removed since this link was shared.
          <div className="mt-3">{back}</div>
        </EmptyState>
      </div>
    );
  }

  const note = trackNote(track);
  const hours =
    track.startMin !== null && track.endMin !== null
      ? { startMin: track.startMin, endMin: track.endMin }
      : null;

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-stone-50/95 backdrop-blur dark:border-stone-700 dark:bg-stone-900/95">
        <EventBar
          slug={slug}
          bundle={bundle}
          me={me}
          ping={data.notificationPing}
          width="max-w-4xl"
          onSignOut={() => void api.logout(slug).then(() => void data.reload())}
        />
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {/* No way back of its own: the event bar above already carries one. */}
        {/* The column card, at reading size: the same wash of the track's
            colour, the name, and under it everything the card keeps behind
            its ⓘ — with room here to say it in full. */}
        <section
          className="rounded-xl border px-4 py-3"
          style={{ background: `${track.color}cc`, borderColor: track.color }}
        >
          <h1 className="text-lg font-semibold text-stone-900">{track.name}</h1>
          <p className="mt-0.5 text-xs text-stone-700">
            {plural(total, SESSIONS)}
            {hours && (
              <>
                {' · '}
                <span className="tabular-nums">{windowLabel(hours)}</span>
              </>
            )}
          </p>
          {note && <p className="mt-2 whitespace-pre-line text-sm text-stone-800">{note}</p>}
          {/* The hours are a rule about what may be booked, so they are worth a
              sentence rather than a bare range — and the days that keep their
              own window are listed, because on those the default is not the
              rule. */}
          {(hours || track.windows.length > 0) && (
            <div className="mt-2 space-y-0.5 text-xs text-stone-700">
              {hours && (
                <p>
                  Takes sessions from {fmtMinute(hours.startMin)} to {fmtMinute(hours.endMin)};
                  outside that, only an organiser can place one.
                </p>
              )}
              {track.windows.map((w) => {
                const label = dayLabel(w.date, today);
                return (
                  <p key={w.date}>
                    {label.top} {label.sub}: {windowLabel(w)}
                    {!hours && ' — other days take a session at any hour.'}
                  </p>
                );
              })}
            </div>
          )}
        </section>

        {byDay.length === 0 ? (
          <EmptyState>Nothing is on this track yet.</EmptyState>
        ) : (
          <div className="mt-6 space-y-6">
            {byDay.map(([date, sessions]) => {
              const label = dayLabel(date, today);
              return (
                <section key={date}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                    {label.top} {label.sub}
                    <span className="ms-1.5 font-normal normal-case tracking-normal">
                      · {plural(sessions.length, SESSIONS)}
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
                          terms={[]}
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
