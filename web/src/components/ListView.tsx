import { plural } from '../lib/plural';
import { type ReactNode, useMemo } from 'react';
import type { BreakDto, RoomDto, SessionDto, TagDto } from '@shared/types';
import { dayFullLabel, fmtMin, place, speakerLine } from '../lib/format';
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

  // The same yellow line the grid draws across the day. The list has no
  // minute axis, so the line goes where the sessions are: across every card
  // that is running, as far down it as that session has run, the way the
  // grid's line crosses every block that is on. One card wearing it while
  // its parallel neighbours did not read as "only this one is on" (reviewed
  // 2026-09-08). When nothing is running it sits in the gap between rows —
  // see `nowLineIndex`. It carries no time here: the header's Now button
  // says it, and a chip beside the cards cost the row a gutter for nothing.
  // Before all this it was a "next / now" pill on the first unfinished
  // row's time, which said which row was next and never what time it was.
  // The Now button and the open-at-now jump scroll to `now-anchor`: the
  // first running card's line, or the gap line.
  const nowLabel = nowMin === null ? '' : `Now, ${fmtMin(nowMin)}`;
  // The first running card, in reading order, carries the anchor.
  const firstLiveId =
    nowMin === null
      ? null
      : (groups.flatMap((g) => g.items).find((i) => nowMin >= i.startMin && nowMin < i.endMin)
          ?.session.id ?? null);
  const nowAt = firstLiveId === null ? nowLineIndex(rows, nowMin) : -1;
  const nowLine =
    nowAt < 0 ? null : (
      <div
        key="now-line"
        id="now-anchor"
        role="separator"
        aria-label={nowLabel}
        className="mb-4 h-0.5 bg-highlight"
      />
    );
  const withNowLine = (items: ReactNode[]): ReactNode[] =>
    nowLine === null ? items : [...items.slice(0, nowAt), nowLine, ...items.slice(nowAt)];

  /** The first row that is a time rather than a break — a day that opens with
   *  lunch would otherwise never say its name, because breaks carry no time
   *  heading to hang it on. */
  const firstGroupIndex = rows.findIndex((r) => r.kind !== 'break');

  return (
    <div className="px-4 pb-24 pt-3">
      {withNowLine(
        rows.map((row, rowIndex) =>
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
                {/* The day, on the first time of the list rather than in a
                    heading of its own: this row is already here, so saying it
                    costs no height. The day picker folds away as soon as you
                    scroll into the day, and after that nothing else on screen
                    named the day — a screenshot of a list said nothing either.
                    The grid says it the same way, beside its first hour. */}
                {rowIndex === firstGroupIndex && (
                  <span className="font-normal text-stone-400 dark:text-stone-500">
                    {dayFullLabel(day)}
                  </span>
                )}
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
                      } ${live ? 'relative isolate overflow-hidden ring-2 ring-stone-900/10 dark:ring-stone-100/10' : ''}`}
                    >
                      {live && (
                        <NowLine
                          progress={(nowMin - startMin) / (endMin - startMin)}
                          label={nowLabel}
                          anchor={session.id === firstLiveId}
                        />
                      )}
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

/**
 * The now line on a running session's card, at the minute: as far down the
 * card as the session has run, the way the grid's line crosses the block that
 * is on, and held inside the card's edges so a session in its last minutes
 * has its line on the card and not under it. It is drawn behind the card's
 * text — the card is its own stacking context (`isolate`) and the line sits
 * under everything in it but the background — and paler than the grid's,
 * because a full-strength stroke through a title read as a strike-out, and
 * a line under the text does not have to fight it (reviewed 2026-09-08). It
 * used to snap to a seam between the card's text, which put a session with
 * seven minutes left a card's border below where it was: a line that says
 * "now" has to be where now is. `anchor` marks the one line the Now button
 * scrolls to.
 */
function NowLine({
  progress,
  label,
  anchor,
}: {
  progress: number;
  label: string;
  anchor: boolean;
}) {
  const pct = `${(Math.min(Math.max(progress, 0), 1) * 100).toFixed(2)}%`;
  return (
    <div
      id={anchor ? 'now-anchor' : undefined}
      role="separator"
      aria-label={label}
      className="pointer-events-none absolute inset-x-0 -z-10 h-0.5 bg-highlight/50"
      style={{ top: `clamp(0px, calc(${pct} - 1px), calc(100% - 2px))` }}
    />
  );
}
