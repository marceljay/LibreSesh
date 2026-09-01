import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useMatch, useNavigate, useParams } from "react-router-dom";
import type {
  ContributionDto,
  ContributionKind,
  RoomDto,
  SessionDto,
  TrackDto,
} from "@shared/types";
import type { Repeat } from "@shared/repeat";
import { dateRange, zonedTimeToUtc } from "@shared/time";
import { windowLabel, windowOn } from "@shared/trackHours";
import { ApiError, api, type SessionWrite } from "../lib/api";
import {
  dayLabel,
  dayRangeLabel,
  fmtMin,
  nowMinuteOfDay,
  place,
  todayInZone,
} from "../lib/format";
import { useEventData } from "../lib/useEventData";
import { matchesQuery } from "../lib/search";
import { useFilters } from "../lib/useFilters";
import { roomHasInfo, roomNote, seatsLabel } from "../lib/rooms";
import { UNTRACKED, matchesTracks, trackNote } from "../lib/tracks";
import { useMe } from "../lib/useMe";
import { Calendar, PX_PER_MIN, timeClashPairs } from "../components/Calendar";
import { DetailSheet } from "../components/DetailSheet";
import { SessionDetail } from "../components/SessionDetail";
import { ActiveFilters, FilterMenu } from "../components/FilterMenu";
import { Gate } from "../components/Gate";
import { HelpMenu } from "../components/HelpMenu";
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SettingsIcon,
} from "../components/icons";
import { ListView } from "../components/ListView";
import { Logo } from "../components/Logo";
import { ProfileMenu } from "../components/ProfileMenu";
import { Rail } from "../components/Rail";
import { SearchBox } from "../components/SearchBox";
import { SessionModal } from "../components/SessionModal";
import { Tour, type TourStep } from "../components/Tour";
import {
  EmptyState,
  Modal,
  PrimaryButton,
  SecondaryButton,
  Spinner,
  inputClass,
  useToast,
} from "../components/ui";

const NOW_TICK_MS = 30_000;


/**
 * Everything about a room, in one place: the organiser's directions first,
 * then the facts.
 *
 * The card used to carry the seats and the booking permission on a second
 * line, and this panel deliberately held only what the card had no room for.
 * That split asked a reader to look in two places for one room, and put a
 * standing claim — "attendees may book this room" — in the busiest 176px on
 * the schedule. The card is a name now, and everything about the room is
 * behind the ⓘ.
 */
function RoomInfo({ room }: { room: RoomDto }) {
  const note = roomNote(room);
  const seats = seatsLabel(room.capacity);
  return (
    <div className="space-y-1.5">
      {note && <p className="whitespace-pre-line">{note}</p>}
      {seats && <p>{seats}</p>}
      {room.openBooking && <p>Attendees may schedule their own sessions here.</p>}
    </div>
  );
}

/**
 * What a track is for, and what the hours on its card do not say for
 * themselves: that they are a rule rather than a description, who it binds,
 * and whether this day keeps its own window. The times themselves stay on the
 * card, so they are not repeated here.
 */
function TrackInfo({
  track,
  day,
  note,
  hours,
}: {
  track: TrackDto;
  day: string;
  /** The organiser's context for the strand, or '' if they gave none. */
  note: string;
  /** Whether the card is showing hours that need explaining. */
  hours: boolean;
}) {
  const ownDay = track.windows.some((w) => w.date === day);
  return (
    <div className="space-y-1.5">
      {/* The organiser's words first: a reader who tapped the button wants to
          know what the strand is, and the hours are a footnote to that. */}
      {note && <p className="whitespace-pre-line">{note}</p>}
      {hours && (
        <>
          <p>
            The hours on the card are a rule: a session outside them is refused, unless an organiser
            places it.
          </p>
          {ownDay && <p>Today keeps its own window — other days differ.</p>}
          {!ownDay && track.windows.length > 0 && (
            <p>
              Other days differ:{" "}
              {track.windows.map((w) => `${w.date} ${windowLabel(w)}`).join(", ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Matches `duration-700` on the folding rows; see `foldRow` below. */
const FOLD_MS = 700;
/** Scroll this far into the day before the header folds itself away. */
const FOLD_AT = 24;
/** And this far down again before a header opened by hand gives way. */
const OVERRIDE_PX = 120;
/** Past this, the way back to the top of the day is worth a button. */
const TOP_BUTTON_AT = 160;

export function SchedulePage() {
  const { slug = "", sessionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useMe();
  const data = useEventData(slug);
  const filters = useFilters();

  const [tourOpen, setTourOpen] = useState(false);
  const [arrange, setArrange] = useState(false);
  const [calendar, setCalendar] = useState<"download" | "subscribe" | null>(
    null,
  );
  const [clashDismissed, setClashDismissed] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ session?: SessionDto } | null>(null);
  const [saving, setSaving] = useState(false);
  // The wall clock is state, not a counter, so everything derived from "now"
  // has a real dependency to recompute against.
  const [clock, setClock] = useState(() => Date.now());
  const calRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const closeTour = useCallback(() => setTourOpen(false), []);

  // The tour never opens by itself. It used to start on a first visit, which
  // meant everyone's first sight of a schedule was a stack of coach-marks over
  // it — in the way of the one thing they came to read. It is the "?" button in
  // the action row, and only that.

  const bundle = data.bundle;
  const event = bundle?.event;
  const timezone = event?.timezone ?? "UTC";

  const days = useMemo(
    () => (event ? dateRange(event.startDate, event.endDate) : []),
    [event],
  );
  const today = useMemo(
    () => (event ? todayInZone(timezone, new Date(clock)) : ""),
    [event, timezone, clock],
  );
  const day =
    filters.day && days.includes(filters.day)
      ? filters.day
      : days.includes(today)
        ? today
        : (days[0] ?? "");
  const isToday = day === today;
  const nowMin = useMemo(
    () => (event && isToday ? nowMinuteOfDay(timezone, new Date(clock)) : null),
    [event, isToday, timezone, clock],
  );

  // Only offered when the event actually has tracks; otherwise there is one
  // sensible axis and no switch to show.
  const hasTracks = (bundle?.tracks.length ?? 0) > 0;
  /** Whether the programme still holds sessions with no track — what makes the
   *  "Unassigned" filter chip, and the column of the same name, worth showing. */
  const hasUntracked = (bundle?.sessions ?? []).some((s) => s.trackId === null);
  const axis: "room" | "track" =
    hasTracks && filters.axis === "track" ? "track" : "room";

  /* Where a reader who has not picked a view lands. It used to be a guess
     about the device — under 640px the list, above it the grid — which is the
     browser answering a question about the event: a dense multi-room
     programme is unreadable as a list on a laptop, and a single-track
     unconference is a column of empty grid on a desktop. The organiser sets it
     in Manage Event → Settings, and until they do it is the list, the view
     that survives every shape of event. The switch still works either way, and
     a chosen view goes in the URL, which is what a shared link reproduces. */
  const view = filters.view ?? event?.defaultView ?? "list";

  const dayLabels = useMemo(
    () =>
      Object.fromEntries(
        days.map((d) => {
          const label = dayLabel(d, today);
          return [d, `${label.top} ${label.sub}`];
        }),
      ),
    [days, today],
  );

  /**
   * Past `weekRailFrom` days the flat day strip becomes a horizontal scroller
   * that hides the event's shape: no sense of where you are, or how much is
   * left. From there it splits in two — a rail of weeks, and that week's days
   * below. The threshold is the organiser's call (default 8), so a one- to
   * three-day unconference, which is nearly all of them, never sees it.
   */
  const weeks = useMemo(() => {
    const from = event?.weekRailFrom ?? 8;
    if (days.length <= from) return [];
    const out: string[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days, event?.weekRailFrom]);

  /**
   * The grid's columns. Rooms carry seats and their booking permission; tracks
   * carry how many sessions are on them. A session with no track needs
   * somewhere to sit, so an "Unassigned" column is appended when any exists —
   * dropping those sessions would hide real programme.
   */
  const columns = useMemo(() => {
    if (axis === "room") {
      return (bundle?.rooms ?? []).map((room) => {
        // The card is the room's name and nothing else. Seats, the booking
        // permission and the directions are all the same kind of thing — facts
        // about a room — so they live together behind the ⓘ rather than being
        // split across a truncating second line and a panel.
        return {
          id: room.id,
          name: room.name,
          color: room.color,
          info: roomHasInfo(room) ? <RoomInfo room={room} /> : undefined,
        };
      });
    }
    const tracks = bundle?.tracks ?? [];
    const sessions = bundle?.sessions ?? [];
    const cols = tracks.map((track) => {
      // The hours as they apply to the day on screen, not the track's default:
      // on a day with its own window the default is not the rule, and printing
      // it under the column would be a lie about what will be accepted.
      const hours = windowOn(track, day);
      // The strand's own context, exactly as a room's directions are handled:
      // the session count and the hours are on the card, so the panel carries
      // what the card has no room for.
      const note = trackNote(track);
      return {
        id: track.id,
        name: track.name,
        color: track.color,
        detail: (
          <div className="text-xs text-stone-600">
            <div className="truncate">
              {sessions.filter((x) => x.trackId === track.id).length} in the programme
            </div>
            {hours && <div className="truncate tabular-nums">{windowLabel(hours)}</div>}
          </div>
        ),
        info:
          note || hours ? (
            <TrackInfo track={track} day={day} note={note} hours={Boolean(hours)} />
          ) : undefined,
      };
    });
    if (sessions.some((x) => x.trackId === null)) {
      cols.push({
        id: UNTRACKED,
        name: "Unassigned",
        color: "#E7E5E4",
        detail: (
          <div className="truncate text-xs text-stone-600">
            {sessions.filter((x) => x.trackId === null).length} with no track
          </div>
        ),
        info: undefined,
      });
    }
    return cols;
  }, [axis, bundle?.rooms, bundle?.tracks, bundle?.sessions, day]);

  const columnOf = useCallback(
    (session: SessionDto) =>
      axis === "room" ? session.roomId : (session.trackId ?? UNTRACKED),
    [axis],
  );

  const roomNames = useMemo(
    () => new Map((bundle?.rooms ?? []).map((r) => [r.id, r.name])),
    [bundle?.rooms],
  );
  const roomNameOf = useCallback(
    (session: SessionDto) => roomNames.get(session.roomId) ?? "",
    [roomNames],
  );

  /** Sessions per day — an empty day is dimmed, and a week counts its own. */
  const perDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of bundle?.sessions ?? []) {
      const date = place(session, timezone).date;
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    return counts;
  }, [bundle?.sessions, timezone]);

  // Derived from the selected day rather than held in state, so the rail
  // follows a shared `?day=` link instead of fighting it.
  const weekIndex = weeks.length
    ? Math.floor(Math.max(0, days.indexOf(day)) / 7)
    : 0;
  const stripDays = weeks.length ? (weeks[weekIndex] ?? days) : days;

  /** The identity's starred session ids, as a set for cheap lookups. */
  const starredIds = useMemo(
    () => new Set(bundle?.starredSessionIds ?? []),
    [bundle?.starredSessionIds],
  );

  /** Sessions on the current day that pass the filter chips (SPEC §7.3). */
  const matchedIds = useMemo(() => {
    if (!bundle) return new Set<number>();
    const q = filters.q.trim();
    const soonNow = nowMin;
    return new Set(
      bundle.sessions
        .filter((s) => {
          if (filters.rooms.length && !filters.rooms.includes(s.roomId))
            return false;
          if (
            filters.tags.length &&
            !s.tagIds.some((t) => filters.tags.includes(t))
          )
            return false;
          if (!matchesTracks(filters.tracks, s)) return false;
          if (filters.mine && !starredIds.has(s.id)) return false;
          // Same matcher the search box uses: every word has to appear
          // somewhere in the session, in any order.
          if (q && !matchesQuery(s, q)) return false;
          if (filters.soon) {
            if (soonNow === null) return false;
            const { endMin } = place(s, timezone);
            if (endMin <= soonNow) return false;
          }
          return true;
        })
        .map((s) => s.id),
    );
  }, [
    bundle,
    filters.rooms,
    filters.tags,
    filters.tracks,
    filters.q,
    filters.soon,
    filters.mine,
    starredIds,
    nowMin,
    timezone,
  ]);

  const daySessions = useMemo(
    () =>
      bundle
        ? bundle.sessions.filter((s) => place(s, timezone).date === day)
        : [],
    [bundle, timezone, day],
  );
  const visibleSessions = useMemo(
    () => daySessions.filter((s) => matchedIds.has(s.id)),
    [daySessions, matchedIds],
  );

  /** Text-search hits that fall on a day other than the one on screen. Room,
   *  tag and "soon" scoping is unchanged — only a free-text query reaches
   *  across days, because that is the case that looks broken otherwise. */
  const otherDayMatches = useMemo(() => {
    if (!bundle || !filters.q.trim()) return [];
    return bundle.sessions
      .filter((s) => matchedIds.has(s.id) && place(s, timezone).date !== day)
      .map((s) => ({ session: s, ...place(s, timezone) }))
      .sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin,
      );
  }, [bundle, filters.q, matchedIds, timezone, day]);

  /** Starred pairs that overlap in time (any room) — you cannot attend both. */
  const clashPairs = useMemo(() => {
    if (!bundle) return [] as [SessionDto, SessionDto][];
    const placed = bundle.sessions
      .filter((s) => starredIds.has(s.id))
      .map((s) => ({ session: s, ...place(s, timezone) }));
    return timeClashPairs(placed);
  }, [bundle, starredIds, timezone]);
  const clashIds = useMemo(
    () => new Set(clashPairs.flatMap(([a, b]) => [a.id, b.id])),
    [clashPairs],
  );
  // Dismissal is keyed to the clashing set, so starring into a fresh clash
  // brings the warning back.
  const clashKey = clashPairs.map(([a, b]) => `${a.id}-${b.id}`).join(",");
  const showClashBanner = clashKey !== "" && clashDismissed !== clashKey;

  /** Jump to a search result on another day: switch day and open it in one nav. */
  const openResult = useCallback(
    (session: SessionDto) => {
      const params = new URLSearchParams(window.location.search);
      params.set("day", place(session, timezone).date);
      navigate(`/e/${slug}/s/${session.id}?${params.toString()}`);
    },
    [navigate, slug, timezone],
  );

  const openSession = useCallback(
    (id: number) => navigate(`/e/${slug}/s/${id}${window.location.search}`),
    [navigate, slug],
  );
  const closeSession = useCallback(
    () => navigate(`/e/${slug}${window.location.search}`),
    [navigate, slug],
  );

  const selected = sessionId
    ? bundle?.sessions.find((s) => s.id === Number(sessionId))
    : undefined;

  // `/s/:id/full` renders the same session as a page instead of a panel. It
  // stays on this component rather than becoming its own route component
  // because every handler the detail needs — star, edit, delete, contribute,
  // hide — is defined here, along with the live stream that keeps it current.
  // Falling back to the grid when the id matches nothing means a stale link
  // lands somewhere useful instead of on an empty page.
  const fullPage = useMatch("/e/:slug/s/:sessionId/full") !== null && !!selected;
  const sheetUrl = selected
    ? `/e/${slug}/s/${selected.id}${window.location.search}`
    : `/e/${slug}`;

  const { loadContributions } = data;
  useEffect(() => {
    if (selected) void loadContributions(selected.id);
  }, [selected?.id, loadContributions, selected]);

  const canEdit = useCallback(
    (session: SessionDto) =>
      bundle?.role === "admin" ||
      (bundle?.role === "user" &&
        session.type === "open" &&
        session.createdBy === me?.id),
    [bundle?.role, me?.id],
  );

  const reportError = useCallback(
    (err: unknown) => {
      const message =
        err instanceof ApiError
          ? err.message
          : ((err as Error)?.message ?? "Something went wrong");
      toast.show(message);
    },
    [toast],
  );

  /** Optimistic star toggle; stars are private so there is no SSE echo to wait
   *  for. Revert and toast if the server rejects it. */
  const toggleStar = useCallback(
    async (session: SessionDto) => {
      const wasStarred =
        bundle?.starredSessionIds.includes(session.id) ?? false;
      data.setStarred(session.id, !wasStarred);
      try {
        if (wasStarred) await api.unstarSession(slug, session.id);
        else await api.starSession(slug, session.id);
      } catch (err) {
        data.setStarred(session.id, wasStarred);
        reportError(err);
      }
    },
    [bundle, data, reportError, slug],
  );

  /**
   * A schedule opened while the event is running should open at the current
   * time. The day already defaults to today; without this the grid still
   * started at the day's first hour, so anyone arriving mid-afternoon had to
   * scroll past the whole morning — or find the Now button — before seeing
   * what was on.
   *
   * Once per visit, and never over a position the reader asked for: an
   * explicit `?day=` or a link to one session both mean the URL already says
   * where to be. Outside the running day there is nothing to jump to — the now
   * line is not in the grid — so the day opens at its start as before.
   */
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || data.status !== "ready" || !event) return;
    if (sessionId || filters.day) return;
    if (nowMin === null || nowMin < event.dayStartMin || nowMin > event.dayEndMin) {
      return;
    }
    jumped.current = true;
    // After paint: the grid is what we are scrolling and it has to exist first.
    // No smooth scroll — this is where the page opens, not a journey to watch.
    const raf = requestAnimationFrame(() => {
      const el = calRef.current;
      if (el) {
        el.scrollTop =
          (nowMin - event.dayStartMin) * PX_PER_MIN - el.clientHeight / 2;
      }
      document.getElementById("now-anchor")?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [data.status, event, filters.day, nowMin, sessionId]);

  const jumpToNow = useCallback(() => {
    if (today && days.includes(today)) filters.set({ day: today });
    requestAnimationFrame(() => {
      const minute = nowMinuteOfDay(timezone);
      const el = calRef.current;
      if (el && event) {
        el.scrollTo({
          top: (minute - event.dayStartMin) * PX_PER_MIN - el.clientHeight / 2,
          behavior: "smooth",
        });
      }
      document
        .getElementById("now-anchor")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [days, event, filters, timezone, today]);

  /**
   * Past the first screenful of a day, the event bar, the week rail and the
   * day strip are paying for themselves in room the grid wants: you are
   * reading the afternoon, not choosing a day. They fold away and leave one
   * row — search, filters, Now — and come back the moment you scroll to the
   * top of the day again, or press the calendar button, which is the only way
   * back that does not cost you your place in the day.
   */
  const foldable = !fullPage;

  /**
   * Whichever box is actually doing the scrolling.
   *
   * There are two candidates and no reliable way to name the winner in
   * advance: the grid owns a scroller of its own so its room cards can stick
   * to it, the list has none and scrolls `<main>`, and which of them ends up
   * with the overflow depends on the day's length, the header's height and
   * whether a banner is up. Naming one — first the grid's, then the grid's in
   * one view and `<main>` in the other — is what kept leaving the fold
   * listening to a box that never moved, in one view or the other. So ask the
   * boxes instead of predicting them: the one with somewhere to scroll is the
   * one the reader is scrolling. Both are listened to; this picks which one to
   * read.
   */
  const scroller = useCallback((): HTMLElement | null => {
    const boxes = [calRef.current, mainRef.current];
    return boxes.find((el) => el && el.scrollHeight > el.clientHeight + 1) ?? mainRef.current;
  }, []);

  /**
   * The header folds itself away once you are into the day, and the ⌄/⌃ button
   * beside the filters overrides whichever way it went. The two used to fight,
   * which is what made the button look broken — you pressed it, the header came
   * back, and the next flick of the wheel put it away again. Three rules keep
   * them apart:
   *
   *  - It only folds when folding will not move the day under you. Folding
   *    hands the grid the ~150px those rows were using; if the day is not that
   *    much longer than the screen, the browser clamps the scroll back up to
   *    fit, which reads as a lurch — and when it clamps all the way to the top
   *    it unfolds the header again, one notch from folding it. A day that
   *    short simply does not fold.
   *  - Nothing auto-folds while the fold is moving: every height the animation
   *    passes through fires scroll events of its own, and they are not the
   *    reader scrolling.
   *  - A header opened by hand stays open until you deliberately scroll another
   *    `OVERRIDE_PX` down. The trackpad momentum still arriving when you press
   *    the button is not an instruction to fold it again.
   */
  /** `?debug=fold` puts the fold's own arithmetic on screen. The fold depends
   *  entirely on numbers no test in this project can see — a box's
   *  `scrollHeight` against its `clientHeight` — so when it misbehaves on a
   *  real device this is the difference between a guess and an answer. Off
   *  unless asked for, and it reads state rather than changing any. */
  const debugFold = new URLSearchParams(window.location.search).get("debug") === "fold";
  const [foldStats, setFoldStats] = useState("");

  const [chromeMode, setChromeMode] = useState<"auto" | "open" | "shut">("auto");
  const [autoFolded, setAutoFolded] = useState(false);
  const [foldMoving, setFoldMoving] = useState(false);
  /** Far enough down the day that scrolling back is work worth a button. */
  const [pastTop, setPastTop] = useState(false);
  /** Where the grid was when the button last overrode the scroll rule. */
  const overrideFrom = useRef(0);
  /** Whether the reader has been down into the day since that override. */
  const beenDown = useRef(false);
  /** The fold is mid-animation. A ref because the scroll listener reads it. */
  const foldInFlight = useRef(false);
  const foldedBar = useRef<HTMLDivElement>(null);
  const foldedRows = useRef<HTMLDivElement>(null);

  const folded =
    foldable && (chromeMode === "shut" || (chromeMode === "auto" && autoFolded));

  const readFold = useCallback(() => {
    const el = scroller();
    if (!el) return;
    const top = el.scrollTop;
    setPastTop(top > TOP_BUTTON_AT);
    if (debugFold) {
      const gain =
        (foldedBar.current?.offsetHeight ?? 0) +
        (foldedRows.current?.offsetHeight ?? 0);
      setFoldStats(
        `${el === calRef.current ? "grid" : "main"} top=${Math.round(top)} ` +
          `scrollH=${el.scrollHeight} clientH=${el.clientHeight} ` +
          `slack=${el.scrollHeight - el.clientHeight} gain=${gain}`,
      );
    }
    if (foldInFlight.current) return;
    if (top > FOLD_AT) beenDown.current = true;
    const slack = el.scrollHeight - el.clientHeight;
    setAutoFolded((was) => {
      // Unfolds at the very top, folds at FOLD_AT: one threshold in both
      // directions would flicker, because folding resizes the grid it reads.
      if (was) return top > 0;
      const gain =
        (foldedBar.current?.offsetHeight ?? 0) +
        (foldedRows.current?.offsetHeight ?? 0);
      // `slack`, not `slack - top`: what folding costs is the same wherever you
      // are in the day — the box keeps its content and gains `gain` of
      // viewport, so what is left to scroll afterwards is `slack - gain`. Ask
      // whether *that* is still worth scrolling. The old form asked whether
      // there was a screenful left below you as well, which is a different and
      // much stricter question: it refused to fold in the bottom third of every
      // day, and in a list — which is as long as its sessions rather than as
      // long as the day — it refused almost everywhere.
      return top > FOLD_AT && slack > gain + FOLD_AT;
    });
    setChromeMode((mode) => {
      if (mode === "auto") return mode;
      // Coming back to the top of the day spends the override either way: it
      // is where the header is open anyway, and where the scroll rule and the
      // button agree again. "Coming back" is the point — folding by hand while
      // already at the top would otherwise undo itself on the spot.
      if (top <= 0 && beenDown.current) return "auto";
      if (mode === "open" && top > overrideFrom.current + OVERRIDE_PX) {
        return "auto";
      }
      return mode;
    });
  }, [debugFold, scroller]);

  const toggleChrome = useCallback(() => {
    const top = scroller()?.scrollTop ?? 0;
    overrideFrom.current = top;
    beenDown.current = top > FOLD_AT;
    setChromeMode(folded ? "open" : "shut");
  }, [folded, scroller]);

  const jumpToTop = useCallback(() => {
    setChromeMode("auto");
    scroller()?.scrollTo({ top: 0, behavior: "smooth" });
  }, [scroller]);

  /**
   * The fold takes time, so "folded" and "gone" are two different moments and
   * the rows need to know which one they are in: mid-move they have to be
   * clipped, and only once they have finished leaving can they drop out of the
   * tab order. Nothing measures the transition — this is the same 700ms the
   * classes below spend, kept beside them. The scroll position is read again
   * at the end, because the resize may have moved it while we were not
   * listening.
   */
  const wasFolded = useRef(folded);
  useEffect(() => {
    if (wasFolded.current === folded) return;
    wasFolded.current = folded;
    foldInFlight.current = true;
    setFoldMoving(true);
    const timer = setTimeout(() => {
      foldInFlight.current = false;
      setFoldMoving(false);
      readFold();
    }, FOLD_MS);
    return () => clearTimeout(timer);
  }, [folded, readFold]);

  useEffect(() => {
    const boxes = [calRef.current, mainRef.current].filter(
      (el): el is HTMLElement => el !== null,
    );
    if (!foldable || boxes.length === 0) {
      setAutoFolded(false);
      setChromeMode("auto");
      setPastTop(false);
      return;
    }
    readFold();
    // Both, not the one we think will scroll: a listener on the wrong box
    // hears nothing, and which box scrolls is the grid's business, not ours.
    for (const el of boxes) el.addEventListener("scroll", readFold, { passive: true });
    return () => {
      for (const el of boxes) el.removeEventListener("scroll", readFold);
    };
  }, [foldable, readFold, bundle?.rooms.length, day, view]);

  /** PATCH on drop; a rejected move snaps back because we never mutated locally. */
  const moveSession = useCallback(
    async (
      session: SessionDto,
      startMin: number,
      durMin: number,
      roomId: number,
    ) => {
      if (!event) return;
      const date = place(session, timezone).date;
      try {
        const updated = await api.updateSession(slug, session.id, {
          roomId,
          startsAt: zonedTimeToUtc(date, startMin, timezone).toISOString(),
          endsAt: zonedTimeToUtc(
            date,
            startMin + durMin,
            timezone,
          ).toISOString(),
          expectedUpdatedAt: session.updatedAt,
        });
        data.apply({ type: "session.updated", entity: updated });
        toast.show(`Moved to ${fmtMin(startMin)}`);
      } catch (err) {
        if (err instanceof ApiError && err.code === "stale") {
          toast.show("Someone else moved that session — reloading");
          void data.reload();
        } else {
          reportError(err);
        }
      }
    },
    [data, event, reportError, slug, timezone, toast],
  );

  const saveSession = useCallback(
    async (body: SessionWrite, repeat?: Repeat) => {
      setSaving(true);
      try {
        if (editing?.session) {
          const updated = await api.updateSession(slug, editing.session.id, {
            ...body,
            expectedUpdatedAt: editing.session.updatedAt,
          });
          data.apply({ type: "session.updated", entity: updated });
          toast.show("Session updated");
        } else if (repeat) {
          // One request, then every session it made applied here: the server
          // broadcasts them too, and `apply` is idempotent, but a grid that
          // waited for the echo would sit empty on a slow connection.
          const { sessions } = await api.createSessionRepeat(slug, { ...body, repeat });
          for (const created of sessions) {
            data.apply({ type: "session.created", entity: created });
          }
          toast.show(`${sessions.length} sessions added`);
        } else {
          const created = await api.createSession(slug, body);
          data.apply({ type: "session.created", entity: created });
          toast.show("Session added");
        }
        setEditing(null);
      } catch (err) {
        reportError(err);
      } finally {
        setSaving(false);
      }
    },
    [data, editing, reportError, slug, toast],
  );

  const deleteSession = useCallback(
    async (session: SessionDto) => {
      if (!window.confirm(`Delete “${session.title}”?`)) return;
      try {
        await api.deleteSession(slug, session.id);
        data.apply({ type: "session.deleted", entity: { id: session.id } });
        setEditing(null);
        closeSession();
        toast.show("Session deleted");
      } catch (err) {
        reportError(err);
      }
    },
    [closeSession, data, reportError, slug, toast],
  );

  const addContribution = useCallback(
    async (kind: ContributionKind, body: string, url?: string) => {
      if (!selected) return;
      try {
        const created = await api.addContribution(slug, selected.id, {
          kind,
          body,
          url,
        });
        data.apply({ type: "contribution.created", entity: created });
        toast.show("Added — everyone sees it live");
      } catch (err) {
        reportError(err);
      }
    },
    [data, reportError, selected, slug, toast],
  );

  const removeContribution = useCallback(
    async (id: number) => {
      if (!selected) return;
      try {
        await api.deleteContribution(slug, id);
        data.apply({
          type: "contribution.deleted",
          entity: { id, sessionId: selected.id },
        });
      } catch (err) {
        reportError(err);
      }
    },
    [data, reportError, selected, slug],
  );

  const toggleHidden = useCallback(
    async (contribution: ContributionDto) => {
      try {
        const updated = await api.setContributionHidden(
          slug,
          contribution.id,
          !contribution.hidden,
        );
        data.apply({ type: "contribution.hidden", entity: updated });
      } catch (err) {
        reportError(err);
      }
    },
    [data, reportError, slug],
  );

  if (data.status === "loading") return <Spinner label="Loading schedule…" />;
  if (data.status === "gate") {
    return (
      <Gate slug={slug} me={me} onEntered={() => void data.reload()} />
    );
  }
  if (data.status === "error" || !bundle || !event) {
    return (
      <EmptyState>
        {data.error ?? "Could not load this event."}
        <div className="mt-3">
          <Link to="/" className="underline">
            Back to all events
          </Link>
        </div>
      </EmptyState>
    );
  }

  const role = bundle.role;
  const canWrite = role !== "viewer" && !event.archived;
  // Admin-only. Arrange is a whole-grid drag mode, and the grid is the
  // organiser's instrument: an attendee has at most one open session of their
  // own on it, and dragging is a clumsy way to move the one thing you may
  // touch past everything you may not. They still edit that session — time,
  // room and length included — through Edit session, which is the same change
  // made by naming it rather than by aiming at it. The server never knew about
  // Arrange; it gates the underlying edit, and that rule is unchanged.
  const canArrange = !event.archived && role === "admin";

  // Ordered coach-marks. Role-conditional controls are dropped here; the Tour
  // itself also skips any target that isn't in the DOM. Not memoised because
  // Tour freezes its own copy on mount.
  const participant = event.userRoleLabel;
  const tourSteps: TourStep[] = [
    {
      target: "identity",
      title: "This is you",
      body: `You're known by a name on this device, not an account — you're here as ${participant}. Open it for your profile, your calendar links, or to sign out.`,
    },
    {
      target: "days",
      title: "Pick a day",
      body:
        weeks.length > 1
          ? "One tab per day. A long event splits into weeks above — pick a week, then a day. Dimmed days have nothing scheduled yet."
          : "One tab per day of the event.",
    },
    {
      target: "view",
      title: "Grid or list",
      body: "Grid shows the rooms side by side; list is a plain agenda that reads better on a phone.",
    },
    {
      target: "axis",
      title: "Rooms or tracks",
      body: "This event has tracks, so the grid can lay its columns out either way. Reading by track, each block says which room it is in.",
    },
    {
      target: "pitches",
      title: "Pitch a session",
      body: "Propose a session with no room or time, and say which pitches you would turn up to. Organisers place the popular ones on the grid.",
    },
    {
      target: "now",
      title: "Jump to now",
      body: "Scrolls the grid to the current time and the yellow now-line.",
    },
    {
      target: "session-block",
      title: "Open a session",
      body: "Tap any block for its description, speaker and everyone's notes, links and questions. Dashed green blocks are open sessions that anyone may propose.",
    },
    {
      target: "filters",
      title: "Find and narrow",
      body: "Search finds a session on any day — press Enter for the full list of results. Filter narrows the day on screen by room, tag or text, and lives in the URL, so a filtered view can be shared as a link.",
    },
  ];
  if (canArrange) {
    tourSteps.push({
      target: "arrange",
      title: "Move things around",
      body: "Turn on Arrange, then drag a block to change its time or room, or drag its bottom edge to change its length. It snaps to 5 minutes and only moves what you may edit.",
    });
  }
  if (canWrite) {
    tourSteps.push({
      target: "add",
      title: "Add a session",
      body: "Organisers add official sessions anywhere; everyone else proposes open sessions in the rooms that anyone may book.",
    });
  }
  if (role === "admin") {
    tourSteps.push({
      target: "manage",
      title: "Organiser tools",
      body: "Rooms, tags, passwords, duplicating the event and archiving all live behind Manage Event.",
    });
  }
  tourSteps.push({
    target: "live",
    title: "It's live",
    body: "Everyone else sees your changes within a second, with no refresh needed.",
  });

  /* Folding is a movement rather than a cut: the rows shrink to nothing over
     `FOLD_MS`, so the grid growing into the space they leave reads as one
     gesture with the wheel that started it. `grid-rows-[0fr]` rather than a
     max-height because nothing then has to guess the height being animated —
     the row keeps measuring itself all the way down.

     `grid-cols-[minmax(0,1fr)]` is not decoration. The default single column is
     `auto`, and an auto track grows to its content: a row wider than the phone
     — the event bar with a long role badge on it, the week rail — made the row
     itself wider than the header instead of being made to fit, so its right
     end (the profile menu) sat off the edge of the screen with
     `overflow-x: clip` over the top of it. Pinning the column to the width
     that is actually there hands the squeeze back to the rows, which each
     already know how to take it: truncation, or a scroller of their own. */
  const foldRow = `grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-700 ease-in-out motion-reduce:transition-none ${
    folded ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
  }`;
  /* Clipped while it moves and while it is away, open once it has settled: the
     profile menu drops out of the event bar, and a permanent `overflow-hidden`
     here would cut it off. `invisible` only at the end, because a row that is
     still on its way out is still on screen, and one that has gone should not
     be a tab stop. */
  const foldInner = `${folded || foldMoving ? "overflow-hidden" : ""}${
    folded && !foldMoving ? " invisible" : ""
  }`;

  return (
    /* An app shell, not a document: the viewport holds the header and the
       grid, and the grid is what scrolls. When the page scrolled instead, the
       grid's room cards — sticky to the grid, not to the window — rode up
       under the header and left the day with no column labels. `dvh` because
       on a phone `vh` counts the strip behind the address bar. */
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      <header className="relative z-30 shrink-0 border-b border-stone-200 dark:border-stone-700 bg-stone-50/95 dark:bg-stone-900/95 backdrop-blur">
        <div ref={foldedBar} className={foldRow}>
          <div className={foldInner}>
            <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
              <Link
                to="/"
                className="flex shrink-0 items-center"
                aria-label="All events"
              >
                {/* Below `sm` the wordmark's width belongs to the event name, so
                    the phone header gets the near-square mark instead. The swap
                    lives on wrappers because Logo spends its own display classes
                    on the theme. */}
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
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold tracking-tight">
                  {event.name}
                </div>
                <div
                  data-tour="live"
                  className="truncate text-xs text-stone-500 dark:text-stone-400"
                >
                  {days.length} day{days.length > 1 ? "s" : ""} ·{" "}
                  {event.archived
                    ? "archived — read-only"
                    : data.connected
                      ? "schedule is live"
                      : "reconnecting…"}
                </div>
              </div>
              {/* Theme moved into the profile menu and Manage Event down to the
                  action row, where it belongs beside Add session. On a phone this
                  header had five controls competing for the width left over after
                  the event name. */}
              <div className="ml-auto flex items-center justify-end gap-2">
                <HelpMenu
                  onTour={() => setTourOpen(true)}
                  demo={me?.demoMode === true}
                />
                <ProfileMenu
                  onCalendar={setCalendar}
                  displayName={bundle.displayName}
                  slug={slug}
                  role={role}
                  userLabel={event.userRoleLabel}
                  people={bundle.people}
                  publicId={me?.uid ?? ""}
                  onSignOut={() => {
                    void api.logout(slug).then(() => void data.reload());
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Everything below the event bar belongs to the grid — weeks,
            filters, the day rail. The full-page session view keeps the bar
            for its context and drops the rest. */}
        {!fullPage && (
          <>
          <div ref={foldedRows} className={foldRow}>
            <div className={foldInner}>
              {weeks.length > 1 && (
                /* One line that scrolls sideways, like the day strip below
                   it, rather than a row that wraps: on a phone a four-week
                   conference wrapped to two lines and a six-week one to three,
                   and every line of it is height the grid wanted. `Rail`
                   carries the arrows that say the line goes on — without them
                   a week past the edge was simply a week you never found. */
                /* The rail's own box is exactly the line of chips: the space
                   under it is this wrapper's, because the arrows are centred
                   on the rail and padding inside it would sit them low. */
                <div className="mx-auto max-w-6xl pb-2">
                  <Rail label="Weeks" className="gap-1.5 px-4">
                    {weeks.map((week, i) => {
                      const first = week[0] as string;
                      const last = week[week.length - 1] as string;
                      const count = week.reduce((n, d) => n + (perDay.get(d) ?? 0), 0);
                      const holdsToday = week.includes(today);
                      return (
                        <button
                          key={first}
                          type="button"
                          onClick={() => filters.set({ day: holdsToday ? today : first })}
                          aria-pressed={i === weekIndex}
                          aria-label={`Week ${i + 1}, ${dayRangeLabel(first, last)}, ${count} sessions`}
                          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${
                            i === weekIndex
                              ? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
                              : "border-stone-300 text-stone-600 hover:border-stone-500 dark:border-stone-600 dark:text-stone-300 dark:hover:border-stone-400"
                          }`}
                        >
                          Week {i + 1}
                          <span className="ml-1.5 text-stone-400 dark:text-stone-500">
                            {dayRangeLabel(first, last)}
                          </span>
                          {holdsToday && !week.includes(day) && (
                            <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
                          )}
                        </button>
                      );
                    })}
                  </Rail>
                </div>
              )}

              <div
                className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pb-3"
              >
                <div
                  data-tour="days"
                  className="flex overflow-x-auto rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-0.5 no-scrollbar"
                >
                  {stripDays.map((d) => {
                    const label = dayLabel(d, today);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => filters.set({ day: d })}
                        aria-pressed={day === d}
                        className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                          day === d
                            ? "bg-stone-900 dark:bg-stone-100 dark:text-stone-900 text-white"
                            : "text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                        } ${day !== d && (perDay.get(d) ?? 0) === 0 ? "opacity-40" : ""}`}
                      >
                        {label.top}{" "}
                        <span
                          className={
                            day === d
                              ? "text-stone-300 dark:text-stone-600"
                              : "text-stone-400 dark:text-stone-500"
                          }
                        >
                          {label.sub}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div
                  data-tour="view"
                  className="flex rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 p-0.5"
                >
                  {(["cal", "list"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => filters.set({ view: v })}
                      aria-pressed={view === v}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        view === v
                          ? "bg-stone-900 dark:bg-stone-100 dark:text-stone-900 text-white"
                          : "text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                      }`}
                    >
                      {v === "cal" ? "Grid" : "List"}
                    </button>
                  ))}
                </div>

                {/* Only when the event has tracks, and only in the grid — the list
                    is an agenda in time order, with no columns to lay out. */}
                {hasTracks && view === "cal" && (
                  <div
                    data-tour="axis"
                    className="flex rounded-lg border border-stone-300 bg-white p-0.5 dark:border-stone-600 dark:bg-stone-900"
                  >
                    {(["room", "track"] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => filters.set({ axis: a })}
                        aria-pressed={axis === a}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                          axis === a
                            ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                            : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                        }`}
                      >
                        {a === "room" ? "Rooms" : "Tracks"}
                      </button>
                    ))}
                  </div>
                )}

                {/* Everyone needs the board: attendees pitch there, viewers can
                    register interest. It sits with the other ways of looking at the
                    programme, not up with the account chrome. */}
                <Link
                  data-tour="pitches"
                  to={`/e/${slug}/proposals`}
                  className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-medium text-stone-600 dark:text-stone-300 hover:border-stone-400 dark:hover:border-stone-500"
                >
                  Pitches
                  {bundle.proposals.filter((p) => p.placedSessionId === null).length >
                    0 && (
                    <span className="ml-1 text-stone-400 dark:text-stone-500">
                      {bundle.proposals.filter((p) => p.placedSessionId === null)
                        .length}
                    </span>
                  )}
                </Link>

                {/* Manage / Arrange / Add travel together at every width — an
                    organiser's three actions belong in one place, not split between
                    the header and here. Each keeps its glyph and drops its label
                    below `sm`, which is what buys the room on a phone. */}
                <div className="ml-auto flex items-center gap-2">
                  {role === "admin" && (
                    <Link
                      data-tour="manage"
                      to={`/e/${slug}/admin`}
                      aria-label="Manage Event"
                      title="Manage Event"
                      className="flex items-center gap-1.5 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-medium text-stone-600 dark:text-stone-300 hover:border-stone-400 dark:hover:border-stone-500"
                    >
                      <SettingsIcon className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Manage Event</span>
                    </Link>
                  )}
                  {canArrange && (
                    <button
                      type="button"
                      data-tour="arrange"
                      onClick={() => setArrange((a) => !a)}
                      aria-pressed={arrange}
                      aria-label={arrange ? "Done arranging" : "Arrange sessions"}
                      title={arrange ? "Done arranging" : "Arrange sessions"}
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium ${
                        arrange
                          ? "border-stone-900 bg-stone-900 dark:bg-stone-100 dark:text-stone-900 text-white"
                          : "border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 hover:border-stone-400 dark:hover:border-stone-500"
                      }`}
                    >
                      <span aria-hidden="true">{arrange ? "✓" : "↕"}</span>
                      <span className="hidden sm:inline">
                        {arrange ? "Done arranging" : "Arrange Sessions"}
                      </span>
                    </button>
                  )}
                  {canWrite && (
                    <button
                      type="button"
                      data-tour="add"
                      onClick={() => setEditing({})}
                      aria-label="Add session"
                      title="Add session"
                      className="flex items-center gap-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 dark:text-stone-900 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-700 dark:hover:bg-stone-300"
                    >
                      <span aria-hidden="true">+</span>
                      <span className="hidden sm:inline">Add session</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Two controls, not a row of chips that scrolled off the right
              edge: find a session anywhere (the box), or narrow the day on
              screen (the panel). Whatever the panel is currently doing shows
              up beside it as chips you can take off one at a time. */}
          <div
            className={`mx-auto max-w-6xl px-4 pb-3 transition-[padding] duration-700 ease-in-out motion-reduce:transition-none ${
              folded ? "pt-2" : "pt-0"
            }`}
          >
            <div
              data-tour="filters"
              className="flex flex-wrap items-center gap-1.5"
            >
              {/* This row is the whole header once the rest folds away, so it
                  carries the way back — and the day it is showing, since the
                  day strip that usually answers that is one of the things put
                  away. The button stays put in both states rather than
                  appearing with the fold: a control that vanishes the moment
                  you press it reads as one that did not work. */}
              <button
                type="button"
                onClick={toggleChrome}
                aria-expanded={!folded}
                aria-label={
                  folded
                    ? "Show the event bar and the day picker"
                    : "Fold the event bar and the day picker away"
                }
                title={
                  folded
                    ? "Show the event bar and the day picker"
                    : "Fold the event bar and the day picker away"
                }
                className="flex shrink-0 items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-xs font-medium text-stone-600 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500"
              >
                {/* A calendar and an arrow, at both states and at every width.
                    The folded button used to carry the day as text, which made
                    it a different width in each state and a different width
                    again on a Tuesday than on a Wednesday — a control that
                    moves under the thumb that is reaching for it. The calendar
                    says what comes back; the arrow says which way. */}
                <CalendarIcon className="h-3.5 w-3.5" />
                {folded ? (
                  <ChevronDownIcon className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUpIcon className="h-3.5 w-3.5" />
                )}
              </button>
              <SearchBox
                sessions={bundle.sessions}
                rooms={bundle.rooms}
                timezone={timezone}
                today={today}
                onOpen={openResult}
                onSeeAll={(q) =>
                  navigate(`/e/${slug}/search?q=${encodeURIComponent(q)}`)
                }
              />
              <FilterMenu
                filters={filters}
                rooms={bundle.rooms}
                tags={bundle.tags}
                tracks={bundle.tracks}
                hasUntracked={hasUntracked}
                starredCount={starredIds.size}
              />
              {/* Now lives with the filters rather than up in the action row:
                  this row is what survives folding, and jumping to the current
                  time is the thing you reach for mid-scroll. */}
              <button
                type="button"
                data-tour="now"
                onClick={jumpToNow}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-stone-900 shadow-sm hover:brightness-95"
              >
                ● Now {fmtMin(nowMinuteOfDay(timezone))}
              </button>
              <ActiveFilters
                filters={filters}
                rooms={bundle.rooms}
                tags={bundle.tags}
                tracks={bundle.tracks}
              />
            </div>
          </div>
          </>
        )}
      </header>

      {fullPage && selected ? (
        <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-4 py-6">
          <Link
            to={sheetUrl}
            className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
          >
            <span aria-hidden="true">←</span>
            Back to the schedule
          </Link>
          {/* `collapseAt={null}`: the panel collapses long discussions to keep
              the composer reachable, and this page is where you come to read
              the rest, so collapsing here would defeat the trip. */}
          <SessionDetail
            session={selected}
            slug={slug}
            rooms={bundle.rooms}
            tags={bundle.tags}
            contributions={data.contributions[selected.id]}
            role={role}
            me={me}
            timezone={timezone}
            canEdit={canEdit(selected)}
            archived={event.archived}
            starred={starredIds.has(selected.id)}
            userLabel={event.userRoleLabel}
            layout="page"
            collapseAt={null}
            onToggleStar={() => void toggleStar(selected)}
            onEdit={() => setEditing({ session: selected })}
            onDelete={() => void deleteSession(selected)}
            onAdd={addContribution}
            onRemoveContribution={(id) => void removeContribution(id)}
            onToggleHidden={(c) => void toggleHidden(c)}
          />
        </main>
      ) : (
      <main
        ref={mainRef}
        className="mx-auto flex w-full min-h-0 max-w-6xl flex-1 flex-col overflow-y-auto px-0 sm:px-4"
      >
        {showClashBanner && (
          <div className="mx-4 mt-2 shrink-0 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-100 dark:bg-amber-950/60 p-3 text-amber-900 dark:text-amber-200 sm:mx-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {clashIds.size} sessions on your agenda clash.
                </p>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {clashPairs.map(([a, b]) => {
                    const pa = place(a, timezone);
                    const pb = place(b, timezone);
                    return (
                      <li key={`${a.id}-${b.id}`}>
                        {a.title} ({fmtMin(pa.startMin)}–{fmtMin(pa.endMin)})
                        overlaps {b.title} ({fmtMin(pb.startMin)}–
                        {fmtMin(pb.endMin)})
                      </li>
                    );
                  })}
                </ul>
              </div>
              <button
                type="button"
                onClick={() => setClashDismissed(clashKey)}
                aria-label="Dismiss agenda clash warning"
                className="-m-1 shrink-0 rounded p-1 text-lg leading-none hover:text-amber-950 dark:hover:text-amber-100"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>
        )}
        {bundle.rooms.length === 0 ? (
          <EmptyState>
            No rooms yet.{" "}
            {role === "admin" ? (
              <Link to={`/e/${slug}/admin`} className="underline">
                Add the first one
              </Link>
            ) : (
              "An organiser needs to add one."
            )}
          </EmptyState>
        ) : view === "cal" ? (
          /* The grid takes the height the header leaves and scrolls inside
             it. `min-h-0` so this flex item may shrink below its content, and
             a floor so a banner above cannot squeeze the day to nothing. */
          <div className="min-h-[16rem] min-w-0 flex-1 sm:pt-2">
            <Calendar
              scrollRef={calRef}
              columns={columns}
              columnOf={columnOf}
              axis={axis === "track" ? "Track" : "Room"}
              moveBetweenColumns={axis === "room"}
              subtitleOf={axis === "track" ? roomNameOf : undefined}
              tags={bundle.tags}
              sessions={daySessions}
              breaks={bundle.breaks}
              matchedIds={matchedIds}
              starredIds={starredIds}
              starCounts={bundle.starCounts}
              timezone={timezone}
              day={day}
              dayStartMin={event.dayStartMin}
              dayEndMin={event.dayEndMin}
              nowMin={nowMin}
              // Guarded, not just hidden: the toggle disappears when the role
              // changes but the state it left behind does not.
              arrange={arrange && canArrange}
              canEdit={canEdit}
              onOpen={openSession}
              onMove={(s, startMin, durMin, roomId) =>
                void moveSession(s, startMin, durMin, roomId)
              }
            />
          </div>
        ) : (
          <ListView
            rooms={bundle.rooms}
            tags={bundle.tags}
            sessions={visibleSessions}
            breaks={bundle.breaks}
            contributionCounts={bundle.contributionCounts}
            starredIds={starredIds}
            starCounts={bundle.starCounts}
            clashingIds={clashIds}
            timezone={timezone}
            day={day}
            nowMin={nowMin}
            onOpen={openSession}
            onToggleStar={(s) => void toggleStar(s)}
          />
        )}

        {bundle.rooms.length > 0 &&
          visibleSessions.length === 0 &&
          otherDayMatches.length === 0 && (
            <EmptyState>
              {filters.active ? (
                <>
                  No sessions match.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={filters.clear}
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                "Nothing scheduled on this day yet."
              )}
            </EmptyState>
          )}

        {otherDayMatches.length > 0 && (
          <section className="px-4 pb-24 pt-2 sm:px-0">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
              {visibleSessions.length === 0
                ? `${otherDayMatches.length} match${
                    otherDayMatches.length > 1 ? "es" : ""
                  } on other days`
                : `${otherDayMatches.length} more on other days`}
            </h2>
            <ul className="space-y-2">
              {otherDayMatches.map(({ session, startMin, endMin, date }) => {
                const label = dayLabel(date, today);
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => openResult(session)}
                      className="block w-full rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-3 text-left shadow-sm hover:shadow"
                    >
                      <div className="truncate text-sm font-semibold">
                        {session.title}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                        {label.top} {label.sub} · {fmtMin(startMin)}–
                        {fmtMin(endMin)}
                        {session.speaker && ` · ${session.speaker}`}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
      )}

      {selected && !fullPage && (
        <DetailSheet
          session={selected}
          slug={slug}
          rooms={bundle.rooms}
          tags={bundle.tags}
          contributions={data.contributions[selected.id]}
          role={role}
          me={me}
          timezone={timezone}
          canEdit={canEdit(selected)}
          archived={event.archived}
          starred={starredIds.has(selected.id)}
          userLabel={event.userRoleLabel}
          expandTo={`/e/${slug}/s/${selected.id}/full`}
          onClose={closeSession}
          onToggleStar={() => void toggleStar(selected)}
          onEdit={() => setEditing({ session: selected })}
          onDelete={() => void deleteSession(selected)}
          onAdd={addContribution}
          onRemoveContribution={(id) => void removeContribution(id)}
          onToggleHidden={(c) => void toggleHidden(c)}
        />
      )}

      {editing && (
        <SessionModal
          session={editing.session}
          rooms={bundle.rooms}
          tags={bundle.tags}
          tracks={bundle.tracks}
          people={bundle.people}
          role={role}
          timezone={timezone}
          days={days}
          dayLabels={dayLabels}
          defaultDay={day}
          dayStartMin={event.dayStartMin}
          dayEndMin={event.dayEndMin}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={(body, repeat) => void saveSession(body, repeat)}
          onDelete={
            editing.session
              ? () => void deleteSession(editing.session as SessionDto)
              : undefined
          }
        />
      )}

      {debugFold && (
        <div className="pointer-events-none fixed bottom-2 left-2 right-2 z-50 rounded-lg bg-stone-900/90 px-2 py-1 font-mono text-[10px] leading-tight text-stone-100">
          {view} · {foldStats || "no scroller yet"} · folded={String(folded)}{" "}
          auto={String(autoFolded)} mode={chromeMode}
        </div>
      )}

      {/* The day is long and the wheel back up is longer, so once you are past
          the fold there is a way to the top of it in one press. It scrolls
          rather than jumping, and the header unfolds on the way up because the
          scroll it makes is the same scroll the fold listens to. */}
      {foldable && (
        <button
          type="button"
          onClick={jumpToTop}
          aria-hidden={!pastTop}
          tabIndex={pastTop ? 0 : -1}
          aria-label="Back to the top of the day"
          title="Back to the top of the day"
          className={`fixed right-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-600 shadow-lg transition-all duration-300 hover:border-stone-400 hover:text-stone-900 motion-reduce:transition-none dark:border-stone-600 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-500 dark:hover:text-stone-100 ${
            arrange ? "bottom-16" : "bottom-4"
          } ${
            pastTop
              ? "opacity-100"
              : "pointer-events-none translate-y-2 opacity-0"
          }`}
        >
          <span aria-hidden="true">↑</span>
        </button>
      )}

      {arrange && (
        <div className="fixed bottom-4 right-4 z-40 rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-xs text-stone-600 dark:text-stone-300 shadow">
          Drag sessions you may edit · snaps to 5 min
        </div>
      )}

      {calendar && (
        <CalendarExportModal
          slug={slug}
          starredCount={starredIds.size}
          section={calendar}
          onClose={() => setCalendar(null)}
        />
      )}

      {tourOpen && (
        <Tour steps={tourSteps} onClose={closeTour} />
      )}
    </div>
  );
}

/** Download a one-off .ics, or mint a personal subscription link for the feed
 *  that follows your starred agenda. */
function CalendarExportModal({
  slug,
  starredCount,
  section,
  onClose,
}: {
  slug: string;
  starredCount: number;
  /** Which half the menu asked for. Both are always shown — they are two
   *  answers to the same question — but the one you picked is scrolled to. */
  section: "download" | "subscribe";
  onClose: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const downloadRef = useRef<HTMLDivElement>(null);
  const subscribeRef = useRef<HTMLDivElement>(null);
  const [subUrl, setSubUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const base = `/api/e/${encodeURIComponent(slug)}/calendar.ics`;

  // Both scopes are worth subscribing to: the whole programme, or only what
  // you starred. The token is the same either way.
  const subscribe = useCallback(
    async (mine: boolean) => {
      setLoading(true);
      try {
        const { token } = await api.calendarToken(slug);
        setSubUrl(
          `${window.location.origin}${base}?token=${encodeURIComponent(token)}${
            mine ? "&mine=1" : ""
          }`,
        );
      } catch (err) {
        toast.show(
          err instanceof ApiError
            ? err.message
            : "Could not create a subscription link",
        );
      } finally {
        setLoading(false);
      }
    },
    [base, slug, toast],
  );

  const copy = useCallback(async () => {
    if (!subUrl) return;
    try {
      // Rejects on insecure origins — fall back to a manual selection.
      await navigator.clipboard.writeText(subUrl);
      toast.show("Link copied");
    } catch {
      inputRef.current?.select();
      toast.show("Press Ctrl/Cmd+C to copy the selected link");
    }
  }, [subUrl, toast]);

  // The modal is short enough to show both halves at once on a desktop; on a
  // phone it is not, so the half the menu asked for is brought into view.
  useEffect(() => {
    const target = section === "subscribe" ? subscribeRef : downloadRef;
    target.current?.scrollIntoView({ block: "nearest" });
  }, [section]);

  return (
    <Modal title="Calendar" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div ref={downloadRef}>
          <p className="font-medium text-stone-800 dark:text-stone-200">
            Download
          </p>
          <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
            A one-off snapshot you can import into any calendar app.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={base}
              download
              className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
            >
              Whole schedule
            </a>
            {starredCount > 0 ? (
              <a
                href={`${base}?mine=1`}
                download
                className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
              >
                My agenda ({starredCount})
              </a>
            ) : (
              <span className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-3 py-2 text-xs font-semibold text-stone-400 dark:text-stone-500">
                My agenda — star some sessions first
              </span>
            )}
          </div>
        </div>

        <div
          ref={subscribeRef}
          className="border-t border-stone-200 dark:border-stone-700 pt-4"
        >
          <p className="font-medium text-stone-800 dark:text-stone-200">
            Subscribe
          </p>
          <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
            A live link your calendar app refreshes on its own. It is personal
            to you — anyone who has it can read the schedule.
          </p>
          {subUrl ? (
            <div className="flex gap-2">
              <input
                ref={inputRef}
                readOnly
                value={subUrl}
                aria-label="Personal calendar subscription link"
                onFocus={(e) => e.currentTarget.select()}
                className={inputClass}
              />
              <SecondaryButton className="shrink-0" onClick={() => void copy()}>
                Copy
              </SecondaryButton>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <PrimaryButton
                onClick={() => void subscribe(false)}
                disabled={loading}
              >
                {loading ? "Creating…" : "Link to the whole schedule"}
              </PrimaryButton>
              <SecondaryButton
                onClick={() => void subscribe(true)}
                disabled={loading || starredCount === 0}
              >
                Link to my agenda
              </SecondaryButton>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
