import { useMemo } from 'react';
import type { BreakDto, RoomDto, SessionDto, TagDto } from '@shared/types';
import { fmtMin, place, speakerLine } from '../lib/format';

export interface ListViewProps {
  rooms: RoomDto[];
  tags: TagDto[];
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
  nowMin: number | null;
  onOpen: (id: number) => void;
  onToggleStar: (session: SessionDto) => void;
}

/** Chronological agenda for one day, grouped by start time (SPEC §7.2). */
export function ListView({
  rooms,
  tags,
  sessions,
  breaks,
  contributionCounts,
  starredIds,
  starCounts,
  clashingIds,
  timezone,
  day,
  nowMin,
  onOpen,
  onToggleStar,
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

  // The first row that has not finished yet is where "Now" scrolls to.
  const nowGroupIndex = nowMin === null ? -1 : rows.findIndex((r) => r.end > nowMin);

  return (
    <div className="px-4 pb-24 pt-3">
      {rows.map((row, index) =>
        row.kind === 'break' ? (
          <div
            key={`break-${row.item.id}`}
            id={index === nowGroupIndex ? 'now-anchor' : undefined}
            className="mb-4 rounded-xl border border-dashed border-stone-200 bg-stone-100/70 px-3 py-2 text-xs font-semibold text-stone-500 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-400"
          >
            {row.item.label}
            <span className="ml-1.5 font-normal">
              {fmtMin(row.item.startMin)}–{fmtMin(row.item.endMin)}
            </span>
          </div>
        ) : (
        <div key={row.group.start} id={index === nowGroupIndex ? 'now-anchor' : undefined} className="mb-4">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
            {fmtMin(row.group.start)}
            {index === nowGroupIndex && (
              <span className="rounded bg-accent px-1.5 py-0.5 font-bold text-stone-900">
                next / now
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
                  className={`block w-full cursor-pointer rounded-xl border bg-white dark:bg-stone-900 p-3 text-left shadow-sm hover:shadow ${
                    session.type === 'open' ? 'border-dashed border-emerald-400 dark:border-emerald-500' : 'border-stone-200 dark:border-stone-700'
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
                      <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-xs font-bold text-stone-900">
                        now
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={starred ? `Unstar ${session.title}` : `Star ${session.title}`}
                      aria-pressed={starred}
                      onClick={(e) => {
                        // Do not let the tap fall through and open the session.
                        e.stopPropagation();
                        onToggleStar(session);
                      }}
                      className={`-m-1 shrink-0 rounded-full p-1 text-base leading-none ${
                        starred ? 'text-amber-500 dark:text-amber-400' : 'text-stone-300 dark:text-stone-600 hover:text-amber-500'
                      }`}
                    >
                      <span aria-hidden="true">{starred ? '★' : '☆'}</span>
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {session.tagIds.map((id) => {
                      const tag = tagById.get(id);
                      if (!tag) return null;
                      return (
                        <span
                          key={id}
                          className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                          style={{ background: tag.color }}
                        >
                          {tag.name}
                        </span>
                      );
                    })}
                    {session.type === 'open' && (
                      <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                        open
                      </span>
                    )}
                    {clashes && (
                      <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                        clashes
                      </span>
                    )}
                    {(stars > 0 || count > 0) && (
                      <span className="ml-auto flex items-center gap-2 text-xs">
                        {stars > 0 && (
                          <span
                            className={
                              overCapacity
                                ? 'font-medium text-amber-700 dark:text-amber-400'
                                : 'text-stone-400 dark:text-stone-500'
                            }
                            aria-label={`Starred by ${stars}${
                              overCapacity ? ', more than the room holds' : ''
                            }`}
                          >
                            <span aria-hidden="true">★</span> {stars}
                          </span>
                        )}
                        {count > 0 && (
                          <span className="text-stone-400 dark:text-stone-500">
                            {count} contribution{count > 1 ? 's' : ''}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        ),
      )}
    </div>
  );
}
