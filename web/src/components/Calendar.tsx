import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { BreakDto, SessionDto, TagDto } from '@shared/types';
import { fmtMin, place, speakerLine } from '../lib/format';
import { laneLayout } from '../lib/laneLayout';
import { InfoIcon } from './icons';
import { StarTally } from './StarTally';
import { popoverPanelClass, usePopover } from './Popover';

export const PX_PER_MIN = 1.6;
export const COL_W = 176;
const GUTTER_W = 48;
const SNAP = 5;
/** Hold this long before a touch drag starts, so the page can still scroll. */
const TOUCH_HOLD_MS = 250;
const RESIZE_HANDLE_PX = 12;

const snap = (m: number): number => Math.round(m / SNAP) * SNAP;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));


/**
 * Ids of sessions that share a room and a time span with another session.
 * The server permits admins to double-book, so the calendar flags the clash
 * rather than preventing it. Back-to-back sessions do not count.
 */
export function overlappingIds(
  items: { session: SessionDto; startMin: number; endMin: number }[],
): Set<number> {
  const byRoom = new Map<number, typeof items>();
  for (const item of items) {
    const list = byRoom.get(item.session.roomId);
    if (list) list.push(item);
    else byRoom.set(item.session.roomId, [item]);
  }
  const out = new Set<number>();
  for (const list of byRoom.values()) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.startMin < b.endMin && b.startMin < a.endMin) {
          out.add(a.session.id);
          out.add(b.session.id);
        }
      }
    }
  }
  return out;
}

/**
 * Sessions running against one that holds the floor.
 *
 * The server refuses these to attendees outright, so what reaches here was
 * placed by an organiser or a speaker, who are allowed to — or was booked
 * before the hold was put on. Either way it is worth saying out loud on the
 * grid: someone reading the schedule needs to know the plenary is not the only
 * thing in that hour, and the organiser needs to see what they created.
 *
 * A holding session never competes with itself, or with another hold.
 */
export function competingIds(
  items: { session: SessionDto; startMin: number; endMin: number }[],
): Set<number> {
  const holds = items.filter((i) => i.session.blocksOpenBooking);
  const out = new Set<number>();
  if (holds.length === 0) return out;
  for (const item of items) {
    if (item.session.blocksOpenBooking) continue;
    for (const hold of holds) {
      if (item.startMin < hold.endMin && hold.startMin < item.endMin) {
        out.add(item.session.id);
        break;
      }
    }
  }
  return out;
}

/**
 * Pairs of sessions that overlap in time, room ignored — the signal that a
 * person cannot attend both. Strict overlap, so back-to-back is fine. Separate
 * from `overlappingIds`, which is a per-room double-booking check.
 */
export function timeClashPairs(
  items: { session: SessionDto; startMin: number; endMin: number; date: string }[],
): [SessionDto, SessionDto][] {
  const sorted = items
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin));
  const out: [SessionDto, SessionDto][] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.date !== b.date || b.startMin >= a.endMin) break;
      if (a.startMin < b.endMin && b.startMin < a.endMin) out.push([a.session, b.session]);
    }
  }
  return out;
}

/**
 * Where a dragged block is drawn, in absolute grid coordinates rather than as
 * an offset from the session's own row.
 *
 * Absolute is what makes the drop stable. The server echoes our own PATCH back
 * down the SSE stream and writes that frame *before* the response, so the
 * session row normally reaches us first, already carrying its new time and
 * room. An offset would then be added on top of the value it was meant to
 * produce — the block would leap twice as far as the drag, and only snap into
 * place once the response cleared the hold. Absolute coordinates make the echo
 * a no-op: the block is already drawn exactly where the echo says it is.
 */
export interface DragTarget {
  id: number;
  mode: 'move' | 'resize';
  startMin: number;
  durMin: number;
  columnIndex: number;
  /** Dropped, and the PATCH has not come back yet. The block stays where it
   *  was dropped until it does. */
  pending?: boolean;
}

/**
 * Where to draw a block: its own row, or — while it is dragged or held after a
 * drop — the drag target, which wins outright and is never combined with the
 * row. `columnIndex` is clamped here because a row can name a column the grid
 * is not showing.
 */
export function drawnAt(
  row: { startMin: number; durMin: number; columnIndex: number },
  target: DragTarget | null,
  columnCount: number,
): { startMin: number; durMin: number; columnIndex: number } {
  const at = target ?? row;
  return {
    startMin: at.startMin,
    durMin: at.durMin,
    columnIndex: clamp(at.columnIndex, 0, Math.max(0, columnCount - 1)),
  };
}

/**
 * What the grid lays out along its horizontal axis. Rooms by default; tracks
 * when the event has them and the organiser or reader switches. Everything
 * below is column-agnostic — only `axis` and the card's subtitle name it.
 */
export interface CalendarColumn {
  id: number;
  name: string;
  color: string;
  /** Second line on the column card, for a fact that changes with the day: a
   *  track's session count and the hours it is keeping. Rooms leave this unset
   *  — a room card is its name, and everything else is behind the ⓘ. */
  detail?: ReactNode;
  /** Everything the card does not say. Present only when there is something to
   *  say; the info button appears with it and is absent without it. */
  info?: ReactNode;
}

/**
 * A column's header card, and the panel behind its info button.
 *
 * The card is 176px wide, so anything on it has to survive truncation at that
 * width. That is a hard enough budget that a room spends all of it on the
 * name: its seats, its booking permission and its directions are all behind
 * the ⓘ, together, rather than split between a clipped second line and a
 * panel. A track keeps a `detail` line because what it says there changes with
 * the day on screen — how many sessions are on it, the hours it is keeping —
 * and a reader comparing days needs that visible without a hover.
 *
 * Whatever is on the card is not repeated in the panel: a panel that says
 * again what is already on screen is noise twice. The button appears only when
 * a column has something more to give, so its presence is itself the signal
 * that there is more.
 *
 * Three input models, one panel. A real mouse opens it on hover, the keyboard
 * opens it on focus, and a finger opens it on tap — and the three are told
 * apart by `usePopover({ hover: true })` rather than by hand. They used to be
 * hand-rolled here, and the tap did not work: a touch browser synthesises
 * `mouseenter` before the `click`, so the enter opened the panel and the
 * click's toggle shut it again in the same gesture. Everything the redesign
 * moved behind this button — a room's seats, whether attendees may book it,
 * the organiser's directions, a track's description and hours — was therefore
 * unreachable on a phone, which is where somebody standing in a corridor
 * actually reads the schedule.
 */
function ColumnCard({ column }: { column: CalendarColumn }) {
  const [open, setOpen] = useState(false);
  const hasInfo = column.info != null;
  const { refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    // Describes the card it hangs off; `useRole` wires the `aria-describedby`
    // that the hand-rolled panel spelled out.
    role: 'tooltip',
    hover: true,
  });

  return (
    <div className="shrink-0 px-1" style={{ width: COL_W }}>
      <div
        // The panel is positioned against the *card*, not the ⓘ inside it, so
        // it stays flush with the card's edge rather than starting at the icon
        // — and against this box rather than the flex item around it, which
        // stretches to the tallest card in the row and once dropped the panel
        // a card's height below the one it belongs to. The interactions stay
        // on the button; only the geometry comes from here.
        ref={refs.setPositionReference}
        className="rounded-lg border border-stone-200/80 px-3 py-2 dark:border-stone-700"
        // The palette is already washed out; 'cc'/'22' keep it that way
        // in light and dark without maintaining two palettes.
        style={{ background: `${column.color}cc`, borderColor: column.color }}
      >
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 truncate text-xs font-semibold text-stone-900">
            {column.name}
          </div>
          {hasInfo && (
            <button
              ref={refs.setReference}
              type="button"
              aria-label={`About ${column.name}`}
              aria-expanded={open}
              className="-m-1 shrink-0 rounded-full p-1 text-stone-600 hover:text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-stone-500"
              // The tap, and only the tap: hover, focus and every way of
              // dismissing this belong to `usePopover`.
              {...getReferenceProps({ onClick: () => setOpen((v) => !v) })}
            >
              <InfoIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {column.detail}
      </div>
      {hasInfo && open && (
        // Positioned rather than placed. It used to be `absolute` inside the
        // card and right-aligned by hand on the last column, because a
        // left-aligned panel there hung off the end of the grid and was
        // clipped by the scroller; `usePopover` is `position: fixed` with
        // `shift`, so it slides itself back inside the viewport instead and
        // the card no longer has to know which column it is.
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          className={`${popoverPanelClass} w-60 p-3 text-xs leading-relaxed text-stone-600 dark:text-stone-300`}
        >
          {column.info}
        </div>
      )}
    </div>
  );
}

export interface CalendarProps {
  scrollRef: React.RefObject<HTMLDivElement>;
  columns: CalendarColumn[];
  /** Which column a session belongs in. */
  columnOf: (session: SessionDto) => number;
  /** Label above the gutter — "Room" or "Track". */
  axis: string;
  /**
   * Whether dragging sideways changes a session's column. True for rooms,
   * where the column *is* the room and `onMove` can carry it. False for
   * tracks: reassigning a strand is not a scheduling move, and `onMove`
   * speaks in room ids.
   */
  moveBetweenColumns: boolean;
  /** Small line under the title — the room, when rooms are not the columns. */
  subtitleOf?: (session: SessionDto) => string;
  tags: TagDto[];
  /** Mark the official programme on the block. Off unless the organiser has
   *  turned it on: on an event where everything is official the badge says
   *  nothing, and on an unconference it is noise. */
  showOfficialBadge: boolean;
  sessions: SessionDto[];
  /** Lunch and friends. Drawn behind the grid, and only ever drawn: a break
   *  belongs to the event, not to a column, and nothing opens it. */
  breaks: BreakDto[];
  /** Sessions filtered out are dimmed rather than removed (SPEC §7.3). */
  matchedIds: Set<number>;
  /** Sessions on the current identity's personal agenda. */
  starredIds: Set<number>;
  /** sessionId -> how many people starred it, across everyone. */
  starCounts: Record<number, number>;
  /** Star or unstar from the block itself. Given, the corner tally is a
   *  button rather than a read-out — so the grid no longer sends you into the
   *  sheet for the one thing an attendee does most. */
  onToggleStar?: (session: SessionDto) => void;
  /** The session whose sheet is open, drawn with a ring so the grid says
   *  which block the panel beside it belongs to. */
  activeId?: number;
  timezone: string;
  day: string;
  dayStartMin: number;
  dayEndMin: number;
  nowMin: number | null;
  arrange: boolean;
  canEdit: (session: SessionDto) => boolean;
  onOpen: (id: number) => void;
  /** Resolves when the move has been saved (or rejected) — the block is held
   *  at the drop position until then. */
  onMove: (
    session: SessionDto,
    startMin: number,
    durMin: number,
    roomId: number,
  ) => void | Promise<void>;
}

export function Calendar({
  scrollRef,
  columns,
  columnOf,
  axis,
  moveBetweenColumns,
  subtitleOf,
  tags,
  showOfficialBadge,
  sessions,
  breaks,
  matchedIds,
  starredIds,
  starCounts,
  onToggleStar,
  activeId,
  timezone,
  day,
  dayStartMin,
  dayEndMin,
  nowMin,
  arrange,
  canEdit,
  onOpen,
  onMove,
}: CalendarProps) {
  const [drag, setDrag] = useState<DragTarget | null>(null);
  // A block whose PATCH is still in flight must not be picked up again: the
  // second request would race the first and lose on `expectedUpdatedAt`.
  const pending = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);

  const onThisDay = useMemo(
    () =>
      sessions
        .map((session) => ({ session, ...place(session, timezone) }))
        .filter((p) => p.date === day),
    [sessions, timezone, day],
  );
  const placed = onThisDay;
  // A hold draws an amber band across every column *as well as* its own block.
  const holdBands = useMemo(
    () => onThisDay.filter((p) => p.session.blocksOpenBooking),
    [onThisDay],
  );
  // Lunch. `date === null` is the every-day case, which is most of them.
  // Clipped to the viewport rather than dropped: a break that starts before
  // the grid does still says where the morning ends.
  const breakBands = useMemo(
    () =>
      breaks
        .filter((b) => b.date === null || b.date === day)
        .map((b) => ({
          ...b,
          startMin: Math.max(b.startMin, dayStartMin),
          endMin: Math.min(b.endMin, dayEndMin),
        }))
        .filter((b) => b.endMin > b.startMin),
    [breaks, day, dayStartMin, dayEndMin],
  );
  const lanes = useMemo(() => laneLayout(placed, columnOf), [placed, columnOf]);
  const overlaps = useMemo(() => overlappingIds(placed), [placed]);
  const competing = useMemo(() => competingIds(onThisDay), [onThisDay]);
  const tagColor = useMemo(() => new Map(tags.map((t) => [t.id, t.color])), [tags]);

  const height = (dayEndMin - dayStartMin) * PX_PER_MIN;
  const showNow = nowMin !== null && nowMin >= dayStartMin && nowMin <= dayEndMin;

  const startDrag = useCallback(
    (
      event: ReactPointerEvent<HTMLDivElement>,
      session: SessionDto,
      startMin: number,
      durMin: number,
      mode: 'move' | 'resize',
    ) => {
      if (!arrange || !canEdit(session)) return;
      // Its last move is still saving; a second PATCH would race the first.
      if (pending.current === session.id) return;
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startY = event.clientY;
      // Read once, at pointer-down: the block's own column can change under a
      // live drag when someone else moves it, and the drag should follow the
      // pointer from where it was picked up, not jump.
      const fromIndex = columns.findIndex((c) => c.id === columnOf(session));
      const isTouch = event.pointerType !== 'mouse';
      let armed = !isTouch;
      let moved = false;
      let deltaMin = 0;
      let deltaRoom = 0;
      let nextDur = durMin;

      const arm = () => {
        armed = true;
        setDrag({ id: session.id, mode, startMin, durMin, columnIndex: fromIndex });
      };
      if (isTouch) holdTimer.current = window.setTimeout(arm, TOUCH_HOLD_MS);
      else arm();

      const onMoveEvent = (ev: PointerEvent) => {
        if (!armed) {
          // Moving before the hold completes means the user meant to scroll.
          if (Math.abs(ev.clientY - startY) > 8 || Math.abs(ev.clientX - startX) > 8) {
            if (holdTimer.current) window.clearTimeout(holdTimer.current);
            cleanup();
          }
          return;
        }
        if (Math.abs(ev.clientY - startY) > 4 || Math.abs(ev.clientX - startX) > 4) moved = true;
        if (mode === 'resize') {
          nextDur = clamp(
            snap(durMin + (ev.clientY - startY) / PX_PER_MIN),
            SNAP,
            dayEndMin - startMin,
          );
          setDrag({ id: session.id, mode, startMin, durMin: nextDur, columnIndex: fromIndex });
        } else {
          deltaMin = snap((ev.clientY - startY) / PX_PER_MIN);
          deltaRoom = moveBetweenColumns ? Math.round((ev.clientX - startX) / COL_W) : 0;
          setDrag({
            id: session.id,
            mode,
            startMin: startMin + deltaMin,
            durMin,
            columnIndex: fromIndex + deltaRoom,
          });
        }
      };

      const detach = () => {
        window.removeEventListener('pointermove', onMoveEvent);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', cleanup);
      };

      const cleanup = () => {
        detach();
        setDrag(null);
      };

      /**
       * Hold the block where it was dropped until the server answers. Dropping
       * the drag state here instead would repaint the block at its old
       * position for a whole round trip and then jump it forward when the
       * PATCH lands. Because the hold is absolute (see `DragTarget`), the
       * server's own echo arriving mid-hold moves nothing, and releasing the
       * hold onto an already-updated row moves nothing either. A rejected move
       * still snaps back — just at the moment we learn it failed, which is the
       * only moment that means anything.
       */
      const settle = (held: DragTarget, result: void | Promise<void>) => {
        setDrag(held);
        pending.current = session.id;
        void Promise.resolve(result).finally(() => {
          pending.current = null;
          setDrag((d) => (d?.id === session.id ? null : d));
        });
      };

      const onUp = () => {
        if (holdTimer.current) window.clearTimeout(holdTimer.current);
        const wasArmed = armed;
        detach();
        if (!wasArmed || !moved) {
          setDrag(null);
          onOpen(session.id);
          return;
        }
        if (mode === 'resize') {
          if (nextDur === durMin) {
            setDrag(null);
            return;
          }
          settle(
            { id: session.id, mode, startMin, durMin: nextDur, columnIndex: fromIndex, pending: true },
            onMove(session, startMin, nextDur, session.roomId),
          );
          return;
        }
        // Clamp before holding, so the block waits exactly where it will land
        // rather than where the pointer happened to be.
        const newStart = clamp(startMin + deltaMin, dayStartMin, dayEndMin - durMin);
        const toIndex = clamp(fromIndex + deltaRoom, 0, columns.length - 1);
        // Safe because deltaRoom is pinned to 0 unless the columns are rooms,
        // and then a column id *is* a room id.
        const roomId = moveBetweenColumns
          ? (columns[toIndex]?.id ?? session.roomId)
          : session.roomId;
        if (newStart === startMin && roomId === session.roomId) {
          setDrag(null);
          return;
        }
        settle(
          { id: session.id, mode, startMin: newStart, durMin, columnIndex: toIndex, pending: true },
          onMove(session, newStart, durMin, roomId),
        );
      };

      window.addEventListener('pointermove', onMoveEvent);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', cleanup);
    },
    [
      arrange,
      canEdit,
      columnOf,
      columns,
      dayEndMin,
      dayStartMin,
      moveBetweenColumns,
      onMove,
      onOpen,
    ],
  );

  const hourCount = Math.floor((dayEndMin - dayStartMin) / 60) + 1;
  const halfHourCount = Math.ceil((dayEndMin - dayStartMin) / 30);

  return (
    /* The height comes from the shell around it, not from a guess at what the
       header costs: the page does not scroll, this box does, and that is what
       keeps the sticky room cards below on screen all day. */
    <div
      ref={scrollRef}
      /* `no-scrollbar`: the grid scrolls both ways, and on the platforms that
         draw a permanent bar the horizontal one sat across the bottom of the
         day for the whole time you were reading it. The room cards and the
         time gutter say which way the grid goes; the bars only said it again,
         in the space the day was using. Both go — CSS hides scrollbars per
         box, not per axis. */
      className="no-scrollbar h-full overflow-auto border-t border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 sm:rounded-xl sm:border"
    >
      <div className="relative" style={{ width: GUTTER_W + columns.length * COL_W }}>
        {/*
          Each room is a detached card, not a table header cell: a row of
          bordered cells sitting flush on a time grid reads as one table, and
          then as weekdays. The cards keep the column width so they still line
          up with the grid, but the gaps between them and the painted gap below
          say "these are labels for the columns", not "this is row zero".
        */}
        <div className="sticky top-0 z-20 flex bg-white/95 pb-3 pt-1 backdrop-blur dark:bg-stone-900/95">
          <div className="shrink-0 px-1" style={{ width: GUTTER_W }}>
            {/* Same padding and border box as a card, so the label sits on the
                same line as the room names rather than floating. */}
            <div className="border border-transparent py-2 text-right text-xs leading-4">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                {axis}
              </span>
            </div>
          </div>
          {columns.map((column) => (
            <ColumnCard key={column.id} column={column} />
          ))}
        </div>

        <div className="relative flex" style={{ height }}>
          <div className="sticky left-0 z-10 shrink-0 bg-white dark:bg-stone-900" style={{ width: GUTTER_W }}>
            {Array.from({ length: hourCount }, (_, i) => (
              <div
                key={i}
                className="absolute -translate-y-1/2 pr-1 text-right text-xs text-stone-400 dark:text-stone-500"
                style={{ top: i * 60 * PX_PER_MIN, width: GUTTER_W - 4 }}
              >
                {fmtMin(dayStartMin + i * 60)}
              </div>
            ))}
          </div>

          {Array.from({ length: halfHourCount }, (_, i) => (
            <div
              key={i}
              className={`pointer-events-none absolute right-0 border-t ${
                i % 2 ? 'border-stone-100 dark:border-stone-800' : 'border-stone-200 dark:border-stone-700'
              }`}
              style={{ top: i * 30 * PX_PER_MIN, left: GUTTER_W }}
            />
          ))}

          {columns.map((column, i) => (
            <div
              key={column.id}
              className="pointer-events-none absolute bottom-0 top-0 border-l border-stone-100 dark:border-stone-800"
              // Very low alpha: this sits under every session block, so it has
              // to identify the column without competing with it.
              style={{
                left: GUTTER_W + i * COL_W,
                width: COL_W,
                background: `${column.color}22`,
              }}
            />
          ))}

          {breakBands.map((item) => (
            <div
              key={`break-${item.id}`}
              // Decoration, not content: it is behind everything, it takes no
              // clicks, and a screen reader gets it from the day's heading
              // rather than as a thing in the grid it could act on.
              aria-hidden
              className="pointer-events-none absolute right-0 border-y border-stone-200/80 bg-stone-100/70 dark:border-stone-700/70 dark:bg-stone-800/50"
              style={{
                top: (item.startMin - dayStartMin) * PX_PER_MIN,
                height: (item.endMin - item.startMin) * PX_PER_MIN,
                left: GUTTER_W,
              }}
            >
              <span className="absolute left-2 top-0.5 text-xs font-semibold text-stone-500 dark:text-stone-400">
                {item.label}
                <span className="ml-1.5 font-normal">
                  {fmtMin(item.startMin)}–{fmtMin(item.endMin)}
                </span>
              </span>
              {/* The same again, bottom-right. On a grid more than two columns
                  wide the top-left label is off the edge of where you are
                  reading — the far side of lunch has no marker at all — so it
                  is repeated in the opposite corner. Only when the band is
                  tall enough that the two labels do not meet. */}
              {columns.length > 2 && (item.endMin - item.startMin) * PX_PER_MIN >= 44 && (
                <span className="absolute bottom-0.5 right-2 text-xs font-semibold text-stone-500 dark:text-stone-400">
                  {item.label}
                  <span className="ml-1.5 font-normal">
                    {fmtMin(item.startMin)}–{fmtMin(item.endMin)}
                  </span>
                </span>
              )}
            </div>
          ))}

          {holdBands.map(({ session, startMin, durMin }) => (
            // The hold has a block of its own in a column, so its band must not
            // take clicks: it spans every column and would swallow the ones
            // meant for the grid underneath.
            <div
              key={`band-${session.id}`}
              aria-hidden
              className="pointer-events-none absolute right-0 border-y border-amber-300/70 bg-amber-100/50 dark:border-amber-500/40 dark:bg-amber-500/10"
              style={{
                top: (startMin - dayStartMin) * PX_PER_MIN,
                height: durMin * PX_PER_MIN,
                left: GUTTER_W,
              }}
            >
              <span className="absolute right-1 top-0.5 text-xs font-semibold text-amber-800/80 dark:text-amber-300/80">
                {session.title} — everyone should be here
              </span>
            </div>
          ))}

          {showNow && (
            <div
              className="pointer-events-none absolute left-0 right-0 z-10"
              style={{ top: (nowMin - dayStartMin) * PX_PER_MIN }}
            >
              <div className="h-0.5 w-full bg-highlight" />
              <span
                className="absolute -top-2.5 rounded-r bg-stone-900 dark:bg-stone-100 dark:text-stone-900 px-1.5 py-0.5 text-xs font-semibold text-white"
                style={{ left: GUTTER_W }}
              >
                {fmtMin(nowMin)}
              </span>
            </div>
          )}

          {placed.map(({ session, startMin, durMin, endMin }, blockIndex) => {
            const active = drag?.id === session.id ? drag : null;
            const {
              startMin: effectiveStart,
              durMin: effectiveDur,
              columnIndex: roomIndex,
            } = drawnAt(
              {
                startMin,
                durMin,
                columnIndex: columns.findIndex((c) => c.id === columnOf(session)),
              },
              active,
              columns.length,
            );
            const lane = lanes.get(session.id) ?? { lane: 0, lanes: 1 };
            const width = (COL_W - 8) / lane.lanes;
            const editable = arrange && canEdit(session);
            const live = nowMin !== null && nowMin >= startMin && nowMin < endMin;
            const clash = overlaps.has(session.id);
            const competes = competing.has(session.id);
            const dimmed = !matchedIds.has(session.id);
            const highlighted = activeId === session.id;
            const starred = starredIds.has(session.id);
            const starCount = starCounts[session.id] ?? 0;

            return (
              <div
                key={session.id}
                // Anchor for the guided tour on the first block only.
                data-tour={blockIndex === 0 ? 'session-block' : undefined}
                role="button"
                tabIndex={0}
                aria-label={`${session.title}, ${fmtMin(startMin)} to ${fmtMin(endMin)}${
                  clash ? ', overlaps another session' : ''
                }${session.blocksOpenBooking ? ', everyone should be here' : ''}${
                  competes ? ', competing with an official session' : ''
                }${starred ? ', on your agenda' : ''}${
                  starCount > 0 ? `, starred by ${starCount}` : ''
                }`}
                onPointerDown={(e) => startDrag(e, session, startMin, durMin, 'move')}
                // Draggable blocks open from the drag's mouse-up (so a drag is
                // not mistaken for a tap); everything else opens on plain click.
                onClick={() => {
                  if (!editable) onOpen(session.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(session.id);
                  }
                }}
                className={`absolute overflow-hidden rounded-lg border bg-white dark:bg-stone-900 px-2 py-1 text-left shadow-xs transition-shadow
                  ${session.type === 'open' ? 'border-dashed border-emerald-400 dark:border-emerald-500' : 'border-stone-200 dark:border-stone-700'}
                  ${
                    highlighted
                      ? 'z-20 shadow-lg ring-2 ring-stone-900 dark:ring-stone-100'
                      : editable
                        ? 'cursor-grab ring-1 ring-stone-300 dark:ring-stone-600'
                        : 'cursor-pointer hover:shadow-sm'
                  }
                  ${active ? 'z-30 opacity-90 shadow-lg' : ''}
                  ${active?.pending ? 'cursor-progress' : ''}
                  ${dimmed && !highlighted ? 'opacity-30' : ''}`}
                style={{
                  top: (effectiveStart - dayStartMin) * PX_PER_MIN,
                  left: GUTTER_W + roomIndex * COL_W + 4 + lane.lane * width,
                  width: width - 2,
                  height: Math.max(effectiveDur * PX_PER_MIN - 3, 22),
                  touchAction: editable ? 'none' : 'auto',
                }}
              >
                <div className="flex items-center gap-1">
                  {session.tagIds.map((id) => (
                    <span
                      key={id}
                      className="h-1 w-4 rounded-full"
                      style={{ background: tagColor.get(id) ?? '#6B7280' }}
                    />
                  ))}
                  {clash && (
                    <span
                      title="Overlaps another session in this room"
                      className="ml-auto rounded-sm bg-amber-100 dark:bg-amber-950/60 px-1 text-xs font-bold text-amber-800 dark:text-amber-300"
                    >
                      clash
                    </span>
                  )}
                  {competes && (
                    <span
                      title="Runs against a session everyone should be at"
                      className={`${clash ? '' : 'ml-auto '}rounded-sm bg-amber-100 dark:bg-amber-950/60 px-1 text-xs font-bold text-amber-800 dark:text-amber-300`}
                    >
                      competing
                    </span>
                  )}
                  {live && (
                    <span
                      className={`${clash || competes ? '' : 'ml-auto '}rounded-sm bg-highlight px-1 text-xs font-bold text-stone-900`}
                    >
                      now
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs font-semibold leading-tight">
                  {session.title}
                </div>
                <div className="truncate text-xs text-stone-500 dark:text-stone-400">
                  {fmtMin(effectiveStart)}–{fmtMin(effectiveStart + effectiveDur)}
                  {session.speakers.length > 0 && ` · ${speakerLine(session.speakers)}`}
                </div>
                {/* Where the session is, once the columns stopped saying so. */}
                {subtitleOf && (
                  <div className="truncate text-xs text-stone-500 dark:text-stone-400">
                    {subtitleOf(session)}
                  </div>
                )}
                {/* Positive and optional. The block used to label the *other*
                    kind — "open session", which read as open to join, which
                    every session here is. Marking the programme instead says
                    something on an event that has both, and an event that does
                    not leaves this off and keeps the block quiet. */}
                {showOfficialBadge && session.type === 'official' && (
                  <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                    Official
                  </span>
                )}
                {/* Out of the flow, so a star cannot push the title down a
                    line and leave two identical blocks reading differently.
                    When it can be toggled it is a button that swallows the
                    press (`StarTally` stops pointer-down), so starring a block
                    neither drags it nor opens it — the grid stops sending an
                    attendee into the sheet for the thing they do most. Without
                    a handler it is a read-out, hidden from a screen reader
                    because the block's own `aria-label` already says both
                    facts. It is drawn whenever it can be pressed, so a session
                    nobody has starred still offers the star to press. */}
                {(onToggleStar !== undefined || starred || starCount > 0) && (
                  <StarTally
                    starred={starred}
                    count={starCount}
                    onToggle={onToggleStar ? () => onToggleStar(session) : undefined}
                    sessionTitle={session.title}
                    className={`absolute bottom-0.5 right-1 rounded-sm bg-white/90 pl-1 text-xs leading-none dark:bg-stone-900/90 ${
                      onToggleStar ? '' : 'pointer-events-none'
                    }`}
                  />
                )}
                {editable && (
                  <div
                    role="presentation"
                    onPointerDown={(e) => startDrag(e, session, startMin, durMin, 'resize')}
                    className="absolute inset-x-0 bottom-0 cursor-ns-resize"
                    style={{ height: RESIZE_HANDLE_PX, touchAction: 'none' }}
                  >
                    <div className="mx-auto mb-1 h-0.5 w-6 rounded-full bg-stone-300 dark:bg-stone-600" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
