import { plural } from '../lib/plural';
import { type ReactNode, useMemo } from 'react';
import type { BreakDto, RoomDto, SessionDto, TagDto } from '@shared/types';
import { fmtMin, place, speakerLine } from '../lib/format';
import { nowLineIndex } from '../lib/nowLine';
import { StarTally } from './StarTally';
import { TagChip } from './ui';

export interface ListViewProps {
  rooms: RoomDto[];
  tags: TagDto[];
  /** Mark the official programme on the card; see Calendar. */
  showOfficialBadge: boolean;
  sessions: SessionDto[];
  /** Lunch and friends, for the days they apply to. Read-only furniture here
   *  too — it is in the list so the day reads honestly, not to be opened. */
  breaks: BreakDto[];
  contributionCounts: Record<number, number>;
  /** Sessions on the current identity's personal agenda. */
  starredIds: Set<number>;
  /** sessionId -> how many people starred it, across everyone. */
  starCounts: Record<number, number>;
  /** Starred sessions that overlap another starred session in time. */
  clashingIds: Set<number>;
  timezone: string;
  day: string;
  /** The day after this one, when the event has one. A list ends where the
   *  day ends, and the reader who got there is almost always asking what
   *  happens next rather than reaching for the day picker at the top. */
  nextDay?: { date: string; label: string };
  nowMin: number | null;
  onOpen: (id: number) => void;
  onToggleStar?: (session: SessionDto) => void;
  onGoToDay?: (date: string) => void;
}

/** Chronological agenda for one day, grouped by start time (SPEC §7.2). */
export function ListView({
  rooms,
  tags,
  showOfficialBadge,
  sessions,
  breaks,
  contributionCounts,
  starredIds,
  starCounts,
  clashingIds,
  timezone,
  day,
  nextDay,
  nowMin,
  onOpen,
  onToggleStar,
  onGoToDay,
}: ListViewProps) {
  const roomById = useMemo(() => new Map(rooms.map((r) => [r.id, r])), [rooms]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const groups = useMemo(() => {
    const placed = sessions
      .map((session) => ({ session, ...place(session, timezone) }))
      .filter((p) => p.date === day)
      .sort((a, b) => a.startMin - b.startMin || a.session.roomId - b.session.roomId);

    const out: { start: number; items: typeof placed }[] = [];
    for (const item of placed) {
      const last = out[out.length - 1];
      if (last && last.start === item.startMin) last.items.push(item);
      else out.push({ start: item.startMin, items: [item] });
    }
    return out;
  }, [sessions, timezone, day]);

  /** Session groups and breaks on one clock. A break sorts ahead of a session
   *  starting the same minute: it is the context the session sits in. */
  const rows = useMemo(() => {
    const sessionRows = groups.map((group) => ({
      kind: 'sessions' as const,
      start: group.start,
      end: Math.max(...group.items.map((i) => i.endMin)),
      group,
    }));
    const breakRows = breaks
      .filter((b) => b.date === null || b.date === day)
      .map((b) => ({ kind: 'break' as const, start: b.startMin, end: b.endMin, item: b }));
    return [...breakRows, ...sessionRows].sort(
      (a, b) => a.start - b.start || Number(a.kind === 'sessions') - Number(b.kind === 'sessions'),
    );
  }, [groups, breaks, day]);

  // The same yellow line the grid draws across the day, between the rows
  // here — see `nowLineIndex` for where. It used to be a "next / now" pill on
  // the first unfinished row's time, which said which row was next and never
  // what time it was, and a reader switching from the grid looked for the
  // line and found nothing. The Now button and the open-at-now jump scroll
  // to `now-anchor`, which is the line itself.
  const nowAt = nowLineIndex(rows, nowMin);
  const nowLine =
    nowMin === null ? null : (
      <div
        key="now-line"
        id="now-anchor"
        role="separator"
        aria-label={`Now, ${fmtMin(nowMin)}`}
        className="mb-4 flex items-center gap-2"
      >
        <span className="rounded-sm bg-highlight px-1.5 py-0.5 text-xs font-bold text-stone-900">
          {fmtMin(nowMin)}
        </span>
        <div className="h-0.5 flex-1 bg-highlight" />
      </div>
    );
  const withNowLine = (items: ReactNode[]): ReactNode[] =>
    nowLine === null ? items : [...items.slice(0, nowAt), nowLine, ...items.slice(nowAt)];

  return (
    <div className="px-4 pb-24 pt-3">
      {withNowLine(
        rows.map((row) =>
          row.kind === 'break' ? (
            <div
              key={`break-${row.item.id}`}
              className="mb-4 rounded-xl border border-dashed border-stone-200 bg-stone-100/70 px-3 py-2 text-xs font-semibold text-stone-500 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-400"
            >
              {row.item.label}
              <span className="ms-1.5 font-normal">
                {fmtMin(row.item.startMin)}–{fmtMin(row.item.endMin)}
              </span>
            </div>
          ) : (
            <div key={row.group.start} className="mb-4">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
                {fmtMin(row.group.start)}
              </div>
              <div className="space-y-2">
                {row.group.items.map(({ session, startMin, endMin }) => {
                  const live = nowMin !== null && nowMin >= startMin && nowMin < endMin;
                  const count = contributionCounts[session.id] ?? 0;
                  const starred = starredIds.has(session.id);
                  const stars = starCounts[session.id] ?? 0;
                  const room = roomById.get(session.roomId);
                  // The signal an organiser acts on: more interest than seats.
                  const overCapacity = room?.capacity != null && stars > room.capacity;
                  const clashes = clashingIds.has(session.id);
                  return (
                    // A div, not a button, so the star can be a real nested button.
                    <div
                      key={session.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpen(session.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpen(session.id);
                        }
                      }}
                      className={`block w-full cursor-pointer rounded-xl border bg-white dark:bg-stone-900 p-3 text-start shadow-xs hover:shadow-sm ${
                        session.type === 'open'
                          ? 'border-dashed border-emerald-400 dark:border-emerald-500'
                          : 'border-stone-200 dark:border-stone-700'
                      } ${live ? 'ring-2 ring-stone-900/10 dark:ring-stone-100/10' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{session.title}</div>
                          <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                            {fmtMin(startMin)}–{fmtMin(endMin)} · {room?.name ?? '—'}
                            {session.speakers.length > 0 && ` · ${speakerLine(session.speakers)}`}
                          </div>
                        </div>
                        {live && (
                          <span className="shrink-0 rounded-sm bg-highlight px-1.5 py-0.5 text-xs font-bold text-stone-900">
                            now
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {session.tagIds.map((id) => {
                          const tag = tagById.get(id);
                          if (!tag) return null;
                          return (
                            <TagChip key={id} color={tag.color}>
                              {tag.name}
                            </TagChip>
                          );
                        })}
                        {/* See Calendar: the programme is what gets marked, and
                        only when the organiser asks for it. */}
                        {showOfficialBadge && session.type === 'official' && (
                          <span className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs font-medium text-stone-600 dark:text-stone-300">
                            Official
                          </span>
                        )}
                        {clashes && (
                          <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                            clashes
                          </span>
                        )}
                        {/* The card's one star, in the corner furthest from the
                        title. It was a toggle up beside the title and a count
                        down here, two stars saying two halves of one fact. */}
                        <span className="ms-auto flex items-center gap-2 text-xs">
                          {count > 0 && (
                            <span className="text-stone-400 dark:text-stone-500">
                              {plural(count, { one: 'contribution', other: 'contributions' })}
                            </span>
                          )}
                          <StarTally
                            starred={starred}
                            count={stars}
                            overCapacity={overCapacity}
                            sessionTitle={session.title}
                            onToggle={onToggleStar ? () => onToggleStar(session) : undefined}
                          />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ),
        ),
      )}

      {/* The end of the day, and the way out of it. Only when there is
          something above it: on an empty day the page already says so, and a
          lone button under nothing reads as the whole day's content. */}
      {nextDay && rows.length > 0 && onGoToDay && (
        <button
          type="button"
          onClick={() => onGoToDay(nextDay.date)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-stone-300 px-3 py-3 text-sm font-semibold text-stone-600 hover:border-stone-500 hover:text-stone-900 dark:border-stone-600 dark:text-stone-300 dark:hover:border-stone-400 dark:hover:text-stone-100"
        >
          Next day · {nextDay.label}
        </button>
      )}
    </div>
  );
}
