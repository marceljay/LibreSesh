/**
 * Announcing the schedule into a Telegram group.
 *
 * Design notes live in `_planning/specs/telegram-announcements.md`. The two
 * that explain the shape of this file:
 *
 * A Telegram bot is **not a program and not a place where code runs**. It is a
 * row in Telegram's database — a name and a token — and the token is a
 * credential that lets this process act as that account. Telegram offers no
 * scheduler, so the 60-second loop is ours, it runs here, and it reads SQLite
 * directly rather than over HTTP.
 *
 * The destination is a **group**, not a broadcast channel. So the bot needs no
 * admin rights to post, members can type commands at it, and the group's id
 * has to be *discovered* (see `handleUpdate`) because a private group has no
 * `@name` and its numeric id is not something an organiser can look up.
 */
import type { Db, EventRow, RoomRow, SessionRow } from './db.js';
import { parseLinks, speakersBySession } from './mappers.js';
import type { LabelledLink } from './shared/types.js';
import { localDate, localMinuteOfDay, zonedParts, zonedTimeToUtc } from './shared/time.js';
import { DEFAULT_TEMPLATE, lineParts, type Placeholder } from './shared/telegramTemplate.js';
import { parseTriggers } from './shared/telegramTriggers.js';

const API = 'https://api.telegram.org';

/** Telegram's hard ceiling on one message. */
const MAX_MESSAGE = 4096;

/** A hung Telegram must never reach the process serving the schedule. */
const CALL_TIMEOUT_MS = 10_000;

/**
 * How long after its hour the digest may still go out.
 *
 * A process restarted at 14:00 must not open by announcing a day that is more
 * than half over; outside this window the digest is simply skipped for that
 * day.
 */
const DIGEST_WINDOW_MIN = 60;

/** How long `getUpdates` is allowed to hold the connection open. */
const POLL_SECONDS = 25;

export { MODES, modeOf, parseTriggers, TRIGGERS, type Trigger } from './shared/telegramTriggers.js';

/**
 * The three characters Telegram's HTML parse mode reserves.
 *
 * HTML rather than MarkdownV2 because every value interpolated below is
 * user-authored — titles, speaker names, room names — and MarkdownV2 would
 * need `_*[]()~\`>#+-=|{}.!` escaped in all of them, where one miss is a 400
 * or a silently mangled post. Same instinct as `escapeText` in `ical.ts`.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The same, plus the quote, for a value inside `href="…"`.
 *
 * A stream address is typed by whoever entered the session, and the link rule
 * only asks that it parse — `https://x/a"b` does. Unescaped, that quote ends
 * the attribute early and Telegram refuses the message, which loses the whole
 * slot for one bad link in one room.
 */
export function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/** 'HH:MM' as the clock reads it at the venue, never UTC. */
export function hhmm(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export interface AnnounceItem {
  id: number;
  /** UTC ISO, so a template may say `{time}` wherever it likes. */
  startsAt: string;
  title: string;
  room: string;
  /** '' when the event has no tracks, or this session is not on one. */
  track: string;
  speakers: string[];
  /** '' when the event defines no formats, or nobody picked one. */
  format: string;
  tags: string[];
  /** Whatever the session carries. Posted only when the event asks for it. */
  livestreams: LabelledLink[];
}

/**
 * One session: a line, or two when it is streamed.
 *
 * `Main Hall · Title, by Ada Lovelace [Workshop] #accessibility`, then
 * `Stream: Main camera` beneath it. Everything but the title is a field the
 * event switched on; with none of them it is the title alone.
 *
 * Four lines a session made a five-room slot a message nobody reads to the
 * bottom, and the slot is the unit that matters — one notification, scannable
 * in the second it is on screen. So the fields compose onto one line and only
 * the streams, which are links and would wrap anyway, get their own.
 *
 * A block, not a line, because the 4096-character split has to happen on a
 * session boundary and never between a title and its stream.
 */
/**
 * Render one session's line through the organiser's template.
 *
 * `templateParts` decides *what survives* — which placeholders had a value and
 * which bracketed parts therefore stay — and this decides what each surviving
 * part looks like in Telegram's HTML. The panel does the same thing with React,
 * from the same parts, which is what keeps the Example honest.
 */
export function renderTemplate(
  template: string,
  item: AnnounceItem,
  sessionUrl: string | null,
  timeZone: string,
): string {
  const plain: Partial<Record<Placeholder, string>> = {
    title: item.title,
    room: item.room,
    track: item.track,
    speakers: item.speakers.join(', '),
    format: item.format,
    tags: item.tags.join(' '),
    streams: item.livestreams.map((stream) => stream.label).join(', '),
    time: item.startsAt === '' ? '' : hhmm(new Date(item.startsAt), timeZone),
  };

  return lineParts(template, plain)
    .map((part) => {
      // Two parts are links rather than words. Everything else, the organiser's
      // own text included, is escaped: a stray `<` stays a `<` and can never
      // become a 400 from Telegram's parser.
      if (part.name === 'title') {
        return sessionUrl
          ? `<a href="${escapeAttr(sessionUrl)}">${escapeHtml(item.title)}</a>`
          : `<b>${escapeHtml(item.title)}</b>`;
      }
      if (part.name === 'streams') {
        return item.livestreams
          .map((stream) => `<a href="${escapeAttr(stream.url)}">${escapeHtml(stream.label)}</a>`)
          .join(', ');
      }
      if (part.name === 'tags') {
        return item.tags.map((tag) => `#${escapeHtml(tag.replace(/\s+/g, ''))}`).join(' ');
      }
      return escapeHtml(part.text);
    })
    .join('')
    .trim();
}

/**
 * One message per start time, not per session: five rooms starting at 10:00 is
 * one message, and five pushes is how a group mutes the bot on day one.
 *
 * Returns one string per message — more than one only when the slot is too
 * wide for 4096 characters, which a twelve-room unconference can be. Splitting
 * here beats letting Telegram reject the whole post.
 */
export function renderUpNext(
  startsAt: Date,
  timeZone: string,
  items: AnnounceItem[],
  sessionUrl: (id: number) => string | null,
  template: string = DEFAULT_TEMPLATE,
): string[] {
  const header = `🕐 ${hhmm(startsAt, timeZone)} — up next`;
  const out: string[] = [];
  let current = header;

  for (const item of items) {
    const block = `\n\n${renderTemplate(template, item, sessionUrl(item.id), timeZone)}`;
    if (current.length + block.length > MAX_MESSAGE) {
      out.push(current);
      current = `${header} (continued)${block}`;
    } else {
      current += block;
    }
  }
  out.push(current);
  return out;
}

/** 'Tuesday 16 September' as the venue reads it. */
export function dayLabel(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(instant);
}

/** Kept as a name: a digest or a moved line spans a day, so it always shows a
 *  time where an up-next block usually does not. */
export type TimedItem = AnnounceItem;

/**
 * The whole day in one message, deliberately terser than `up_next`.
 *
 * `announcements.md` fixes the digest at the terse level: one line a session,
 * no speakers, no stream links. It is read at breakfast to decide where to be,
 * not to decide whether to walk out of the room you are already in — and a
 * forty-line message that has to be scrolled is one nobody opens twice.
 */
export function renderDigest(
  day: Date,
  timeZone: string,
  items: TimedItem[],
  sessionUrl: (id: number) => string | null,
): string[] {
  const header = `📋 ${escapeHtml(dayLabel(day, timeZone))}`;
  const out: string[] = [];
  let current = header;

  for (const item of items) {
    const line = `\n${hhmm(new Date(item.startsAt), timeZone)} · ${escapeHtml(item.room)} — ${linked(item, sessionUrl(item.id))}`;
    if (current.length + line.length > MAX_MESSAGE) {
      out.push(current);
      current = `${header} (continued)${line}`;
    } else {
      current += line;
    }
  }
  return [...out, current];
}

/** A title, linked where the instance knows its own address. */
function linked(item: AnnounceItem, url: string | null): string {
  return url
    ? `<a href="${escapeAttr(url)}">${escapeHtml(item.title)}</a>`
    : escapeHtml(item.title);
}

/**
 * One session that has just appeared on the grid, named rather than listed.
 *
 * A pitch says so. "Just pitched" is the message a group at an unconference
 * actually acts on — somebody put a session up twenty minutes ago and there is
 * still time to go — where "just added" reads like programme admin.
 */
export function renderAdded(
  startsAt: Date,
  timeZone: string,
  item: AnnounceItem,
  sessionUrl: (id: number) => string | null,
  template: string = DEFAULT_TEMPLATE,
  placed = false,
): string {
  const head = placed ? '🙌 Just pitched' : '✨ Just added';
  return `${head} — ${hhmm(startsAt, timeZone)}\n\n${renderTemplate(template, item, sessionUrl(item.id), timeZone)}`;
}

/**
 * Sessions that have moved since the last tick, in one message.
 *
 * Plural on purpose: dragging a morning about produces a dozen writes, and one
 * announcement out of them is the whole reason these are held for a tick rather
 * than sent from the route the way `added` is.
 */
export function renderMoved(
  timeZone: string,
  items: TimedItem[],
  sessionUrl: (id: number) => string | null,
): string {
  const lines = items.map(
    (item) =>
      `${hhmm(new Date(item.startsAt), timeZone)} · ${escapeHtml(item.room)} — ${linked(item, sessionUrl(item.id))}`,
  );
  return `🔄 Moved on the schedule\n\n${lines.join('\n')}`;
}

export interface TelegramMessage {
  chatId: string;
  text: string;
  topicId?: number | null;
  silent?: boolean;
}

/** Injected so every test above this line runs without a network. */
export type Sender = (token: string, message: TelegramMessage) => Promise<void>;

/**
 * One call to the Bot API. Throws with Telegram's own `description`, which is
 * the only useful thing to show an organiser whose group is misconfigured.
 */
export async function callTelegram<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
  const body = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!body.ok) throw new Error(body.description ?? `Telegram refused ${method}`);
  return body.result as T;
}

export const sendMessage: Sender = async (token, message) => {
  await callTelegram(token, 'sendMessage', {
    chat_id: message.chatId,
    text: message.text,
    parse_mode: 'HTML',
    // Session links point at a password-gated page, so the preview card would
    // be a grey box doubling the height of every message.
    link_preview_options: { is_disabled: true },
    ...(message.topicId ? { message_thread_id: message.topicId } : {}),
    ...(message.silent ? { disable_notification: true } : {}),
  });
};

/**
 * Telegram from the write path: never awaited, never able to fail the request.
 *
 * A session is created whether or not a group hears about it. Awaiting a
 * `sendMessage` inside a route would put a third party's latency in front of
 * the response, and letting it throw would turn a working write into a 500.
 */
export function announceQuietly(work: Promise<unknown>): void {
  void work.catch((err: unknown) => console.warn(`telegram: ${(err as Error).message}`));
}

/**
 * Which bot speaks for an event: its own if the organiser supplied one, else
 * the instance's, else nothing.
 *
 * The event's own token comes first because this app is one an organiser runs
 * their own event in. On a shared instance, needing the operator to set a
 * token would make Telegram something an organiser must *ask permission* for,
 * and would put every event's announcements through one bot wearing the
 * operator's name. The instance token stays as the fallback for the other
 * shape — one organisation running LibreSesh for its own conferences, where
 * making a bot once is less work than making one per event.
 */
export function resolveToken(event: EventRow, fallback: string | null): string | null {
  return event.telegram_bot_token ?? fallback;
}

/** Events this instance is configured to announce for. */
export function configuredEvents(db: Db): EventRow[] {
  return db
    .prepare<[], EventRow>(
      `SELECT * FROM events
        WHERE telegram_chat_id IS NOT NULL AND archived = 0
        ORDER BY id`,
    )
    .all();
}

/** Every distinct bot this instance must poll: one connection per token. */
export function activeTokens(db: Db, fallback: string | null): string[] {
  const tokens = new Set<string>();
  for (const event of db.prepare<[], EventRow>('SELECT * FROM events WHERE archived = 0').all()) {
    const token = resolveToken(event, fallback);
    if (token) tokens.add(token);
  }
  return [...tokens];
}

/**
 * Sessions whose lead window is open: `starts_at - lead <= now < starts_at`.
 *
 * A **range**, not the moment the window opens. A session created at 13:40 to
 * run at 13:45 has already missed an edge trigger before it existed, and that
 * — a pitch placed at short notice — is the case the whole feature is for. A
 * range picks it up on the next tick.
 */
export function dueSessions(db: Db, event: EventRow, now: Date): SessionRow[] {
  const leadMs = event.telegram_lead_min * 60_000;
  return db
    .prepare<[number, string, string], SessionRow>(
      `SELECT * FROM sessions
        WHERE event_id = ? AND deleted_at IS NULL AND draft = 0
          AND starts_at > ? AND starts_at <= ?
        ORDER BY starts_at, room_id`,
    )
    .all(event.id, now.toISOString(), new Date(now.getTime() + leadMs).toISOString());
}

/** Every non-draft session on one local day, for the digest. */
export function daySessions(db: Db, event: EventRow, day: string): SessionRow[] {
  const from = zonedTimeToUtc(day, 0, event.timezone);
  const to = zonedTimeToUtc(day, 24 * 60, event.timezone);
  return db
    .prepare<[number, string, string], SessionRow>(
      `SELECT * FROM sessions
        WHERE event_id = ? AND deleted_at IS NULL AND draft = 0
          AND starts_at >= ? AND starts_at < ?
        ORDER BY starts_at, room_id`,
    )
    .all(event.id, from.toISOString(), to.toISOString());
}

/** One session by id, or null once it is a draft, deleted or gone. */
export function announceableSession(db: Db, event: EventRow, id: number): SessionRow | null {
  return (
    db
      .prepare<[number, number], SessionRow>(
        `SELECT * FROM sessions
          WHERE id = ? AND event_id = ? AND deleted_at IS NULL AND draft = 0`,
      )
      .get(id, event.id) ?? null
  );
}

/** Turn rows into what the renderer needs, resolving the lookups once. */
export function toItems(db: Db, event: EventRow, sessions: SessionRow[]): AnnounceItem[] {
  if (sessions.length === 0) return [];
  const rooms = new Map(
    db
      .prepare<[number], RoomRow>('SELECT * FROM rooms WHERE event_id = ?')
      .all(event.id)
      .map((r) => [r.id, r.name]),
  );
  // Resolved whether or not the event shows them: one query each for the whole
  // slot is cheaper than branching, and the renderer decides what it uses.
  const named = (table: 'tracks' | 'session_formats'): Map<number, string> =>
    new Map(
      db
        .prepare<[number], { id: number; name: string }>(
          `SELECT id, name FROM ${table} WHERE event_id = ?`,
        )
        .all(event.id)
        .map((r) => [r.id, r.name]),
    );
  const tracks = named('tracks');
  const formats = named('session_formats');
  const tags = new Map<number, string[]>();
  for (const row of db
    .prepare<[number], { session_id: number; name: string }>(
      `SELECT st.session_id, t.name FROM session_tags st
         JOIN tags t ON t.id = st.tag_id
        WHERE t.event_id = ?
        ORDER BY t.name`,
    )
    .all(event.id)) {
    const list = tags.get(row.session_id);
    if (list) list.push(row.name);
    else tags.set(row.session_id, [row.name]);
  }
  const speakers = speakersBySession(
    db,
    sessions.map((s) => s.id),
  );
  return sessions.map((s) => ({
    id: s.id,
    startsAt: s.starts_at,
    title: s.title,
    room: rooms.get(s.room_id) ?? '',
    track: s.track_id === null ? '' : (tracks.get(s.track_id) ?? ''),
    speakers: (speakers.get(s.id) ?? []).map((p) => p.name),
    format: s.format_id === null ? '' : (formats.get(s.format_id) ?? ''),
    tags: tags.get(s.id) ?? [],
    livestreams: parseLinks(s.livestreams),
  }));
}

/** `Map<startsAt, sessions>`, preserving the query's ordering. */
export function groupByStart(sessions: SessionRow[]): Map<string, SessionRow[]> {
  const out = new Map<string, SessionRow[]>();
  for (const s of sessions) {
    const list = out.get(s.starts_at);
    if (list) list.push(s);
    else out.set(s.starts_at, [s]);
  }
  return out;
}

/**
 * The 60-second loop, plus the record of what it has already said.
 *
 * That record is an in-memory `Set` and not a table, deliberately. The only
 * thing a table would buy is surviving a restart *inside* a lead window, and
 * the cost is a migration and a rollback constraint for a failure that repeats
 * one message. The accepted consequence is written down in the spec: a restart
 * mid-window reposts that slot. If a real conference day shows it matters, the
 * shape to add is `announced`, keyed `UNIQUE(transport, event_id, trigger,
 * key)` — transport-neutral, per `_planning/specs/announcements.md`.
 *
 * The rules this obeys — a window rather than an edge, mark-then-send, drafts
 * never, only a move counts as a change — are shared with every other
 * transport and live in that file. LIB-214 lifts this loop into `announcer.ts`
 * once this branch lands; what stays here is rendering and the bot.
 */
export class Announcer {
  private readonly sent = new Set<string>();

  /**
   * Sessions this transport has actually told the group about.
   *
   * `changed` fires only for these. A session nobody was told about has not
   * moved as far as the group is concerned, and announcing its move would
   * disclose a session that was never announced in the first place —
   * `announcements.md` §Announcement data is explicit about that.
   */
  private readonly announced = new Set<number>();

  /** Moves waiting for the next tick, per event. Drained by `announceMoved`. */
  private readonly moved = new Map<number, Set<number>>();

  /**
   * Keyed into the sent set even though there is only one transport today.
   *
   * `_planning/specs/announcements.md` settles that the mark is per transport,
   * so one transport failing or being switched off can never silence another.
   * Writing the key that way now means LIB-214 — lifting this loop out into
   * `announcer.ts` with Telegram as its first transport — moves code rather
   * than changing behaviour.
   */
  private static readonly TRANSPORT = 'telegram';

  constructor(
    private readonly db: Db,
    /** The instance bot, used only by events that have not brought their own. */
    private readonly fallbackToken: string | null,
    private readonly publicUrl: string | null,
    private readonly send: Sender = sendMessage,
  ) {}

  private sessionUrl(event: EventRow): (id: number) => string | null {
    return (id) => (this.publicUrl ? `${this.publicUrl}/e/${event.slug}/s/${id}` : null);
  }

  private key(eventId: number, startsAt: string): string {
    return `${Announcer.TRANSPORT}:${eventId}:${startsAt}`;
  }

  /** Exposed so a test can assert a slot is announced exactly once. */
  hasSent(eventId: number, startsAt: string): boolean {
    return this.sent.has(this.key(eventId, startsAt));
  }

  async tick(now: Date = new Date()): Promise<void> {
    const events = configuredEvents(this.db);
    // Moves buffered for an event that has since disconnected are dropped
    // rather than kept for a group that may never be reconnected. Pruned here,
    // and never by clearing the map after the loop: a tick awaits every send,
    // and a move noted during one of those awaits would otherwise be thrown
    // away before any tick had looked at it.
    const listening = new Set(events.map((event) => event.id));
    for (const id of this.moved.keys()) if (!listening.has(id)) this.moved.delete(id);

    for (const event of events) {
      const triggers = parseTriggers(event.telegram_triggers);
      try {
        // Moves first: a session that has just been dragged into the next
        // fifteen minutes should read as moved, not arrive as a fresh slot.
        if (triggers.includes('changed')) await this.announceMoved(event);
        if (triggers.includes('digest')) await this.announceDigest(event, now);
        if (triggers.includes('up_next')) await this.announceEvent(event, now);
      } catch (err) {
        // One misconfigured group must not stop the others.
        console.warn(`telegram: ${event.slug}: ${(err as Error).message}`);
      }
    }
  }

  /** Where a message goes, or null when this event cannot send one. */
  private destination(event: EventRow): { chatId: string; token: string } | null {
    const chatId = event.telegram_chat_id;
    const token = resolveToken(event, this.fallbackToken);
    return chatId && token ? { chatId, token } : null;
  }

  private async post(event: EventRow, texts: string[]): Promise<void> {
    const to = this.destination(event);
    if (!to) return;
    for (const text of texts) {
      await this.send(to.token, {
        chatId: to.chatId,
        text,
        topicId: event.telegram_topic_id,
      });
    }
  }

  private async announceEvent(event: EventRow, now: Date): Promise<void> {
    if (!this.destination(event)) return;

    for (const [startsAt, sessions] of groupByStart(dueSessions(this.db, event, now))) {
      const key = this.key(event.id, startsAt);
      if (this.sent.has(key)) continue;
      // Marked BEFORE the send: a call that times out after Telegram accepted
      // it would otherwise repost, and a duplicate in a group is permanent and
      // visible where a miss is neither.
      this.sent.add(key);

      const items = toItems(this.db, event, sessions);
      for (const item of items) this.announced.add(item.id);
      await this.post(
        event,
        renderUpNext(
          new Date(startsAt),
          event.timezone,
          items,
          this.sessionUrl(event),
          event.telegram_template,
        ),
      );
    }
  }

  /**
   * The day's programme, once, at the hour the event chose.
   *
   * Fired inside a one-hour window after that time rather than at any moment
   * past it, so a process restarted at 14:00 does not open with "today's
   * programme" for a day half over. A restart inside the window still repeats
   * it — the same accepted cost as `up_next`, for the same reason: the record
   * is in memory.
   */
  private async announceDigest(event: EventRow, now: Date): Promise<void> {
    if (!this.destination(event)) return;
    const day = localDate(now, event.timezone);
    const key = `${Announcer.TRANSPORT}:digest:${event.id}:${day}`;
    if (this.sent.has(key)) return;

    const minute = localMinuteOfDay(now, event.timezone);
    const due = event.telegram_digest_min;
    if (minute < due || minute >= due + DIGEST_WINDOW_MIN) return;

    this.sent.add(key);
    const sessions = daySessions(this.db, event, day);
    // An empty day says nothing. A group told "nothing today" every morning of
    // the week before the conference is a group that mutes the bot.
    if (sessions.length === 0) return;

    const items = this.timedItems(event, sessions);
    for (const item of items) this.announced.add(item.id);
    await this.post(
      event,
      renderDigest(new Date(sessions[0]!.starts_at), event.timezone, items, this.sessionUrl(event)),
    );
  }

  /**
   * A session that has just appeared, announced from the write path.
   *
   * Called by the route beside its `audit()`, never from the broker:
   * `Broker.publish` returns early when nobody is subscribed, so a bot hooked
   * there would post only while somebody had a tab open.
   *
   * When the new session starts inside the lead window, this *is* that slot's
   * `up_next` — the whole slot goes out and the key is marked, so the scheduler
   * does not say the same thing again a few seconds later. Sending the slot
   * rather than the one session is what keeps the other rooms in it visible.
   */
  async announceAdded(
    event: EventRow,
    sessionId: number,
    now: Date = new Date(),
    /** A pitch reaching the grid rather than a session being entered. Its own
     *  trigger, so an organiser building a programme announces nothing while a
     *  conference in progress announces every pitch. */
    placed = false,
  ): Promise<void> {
    if (!parseTriggers(event.telegram_triggers).includes(placed ? 'placed' : 'added')) return;
    if (!this.destination(event)) return;
    const session = announceableSession(this.db, event, sessionId);
    if (!session) return;

    const startsAt = new Date(session.starts_at);
    const leadMs = event.telegram_lead_min * 60_000;
    const key = this.key(event.id, session.starts_at);
    // Inside the window *and* the slot not yet announced: this becomes the
    // slot's up-next. Inside the window with the slot already out — the pitch
    // placed at 13:47 for a 13:50 slot that went out at 13:35 — the slot must
    // not repeat, but the one session still has to be said, or the case the
    // feature exists for is the one case it stays silent on.
    const imminent =
      startsAt > now && startsAt.getTime() - now.getTime() <= leadMs && !this.sent.has(key);

    this.announced.add(sessionId);
    if (imminent) {
      this.sent.add(key);
      const slot = this.db
        .prepare<[number, string], SessionRow>(
          `SELECT * FROM sessions
            WHERE event_id = ? AND deleted_at IS NULL AND draft = 0 AND starts_at = ?
            ORDER BY room_id`,
        )
        .all(event.id, session.starts_at);
      const items = toItems(this.db, event, slot);
      for (const item of items) this.announced.add(item.id);
      await this.post(
        event,
        renderUpNext(
          startsAt,
          event.timezone,
          items,
          this.sessionUrl(event),
          event.telegram_template,
        ),
      );
      return;
    }

    const [item] = toItems(this.db, event, [session]);
    if (!item) return;
    await this.post(event, [
      renderAdded(
        startsAt,
        event.timezone,
        item,
        this.sessionUrl(event),
        event.telegram_template,
        placed,
      ),
    ]);
  }

  /**
   * Remember that a session moved. Nothing is sent here.
   *
   * Held until the next tick because a reshuffle is a dozen writes and should
   * be one message — `announcements.md` calls for coalescing over 60s, and the
   * tick already runs at exactly that. Only a session this transport has
   * actually announced is worth a correction: telling a group that something
   * they were never told about has moved discloses it and helps nobody.
   */
  noteMoved(event: EventRow, sessionId: number): void {
    if (!parseTriggers(event.telegram_triggers).includes('changed')) return;
    if (!this.announced.has(sessionId)) return;
    const pending = this.moved.get(event.id);
    if (pending) pending.add(sessionId);
    else this.moved.set(event.id, new Set([sessionId]));
  }

  private async announceMoved(event: EventRow): Promise<void> {
    const pending = this.moved.get(event.id);
    this.moved.delete(event.id);
    if (!pending || pending.size === 0) return;
    if (!this.destination(event)) return;

    const sessions = [...pending]
      .map((id) => announceableSession(this.db, event, id))
      .filter((s): s is SessionRow => s !== null)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.room_id - b.room_id);
    // Everything in the batch was deleted or drafted between the drag and the
    // tick; the move is no longer news.
    if (sessions.length === 0) return;

    await this.post(event, [
      renderMoved(event.timezone, this.timedItems(event, sessions), this.sessionUrl(event)),
    ]);
  }

  /** The same rows a slot uses; the name says these are read across a day. */
  private timedItems(event: EventRow, sessions: SessionRow[]): TimedItem[] {
    return toItems(this.db, event, sessions);
  }

  /** What `/next` answers with: the next slot that has not started yet. */
  nextSlotText(event: EventRow, now: Date): string[] {
    const upcoming = this.db
      .prepare<[number, string], SessionRow>(
        `SELECT * FROM sessions
          WHERE event_id = ? AND deleted_at IS NULL AND draft = 0 AND starts_at > ?
          ORDER BY starts_at, room_id`,
      )
      .all(event.id, now.toISOString());
    if (upcoming.length === 0) return ['Nothing left on the schedule.'];

    const first = upcoming[0]!.starts_at;
    const slot = upcoming.filter((s) => s.starts_at === first);
    return renderUpNext(
      new Date(first),
      event.timezone,
      toItems(this.db, event, slot),
      this.sessionUrl(event),
      event.telegram_template,
    );
  }
}

interface Update {
  update_id: number;
  message?: {
    text?: string;
    message_thread_id?: number;
    chat: { id: number; title?: string; type: string };
  };
}

/**
 * A command as it actually arrives in a group: `/bind@TheBot code`. The
 * `@BotName` suffix is added by Telegram's own UI whenever more than one bot
 * is present, so stripping it is not optional.
 */
export function parseCommand(text: string): { command: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const [head, ...args] = trimmed.split(/\s+/);
  return { command: head!.split('@')[0]!.toLowerCase(), args };
}

/**
 * Long-polls `getUpdates` and answers the two commands that matter.
 *
 * Polling rather than a webhook: no public URL, no secret route, and dev and
 * production run the same code path. Only one poller may hold a token — a
 * second gets 409 — so staging and production need different bots.
 */
export class Poller {
  private offset = 0;
  private running = false;
  private failures = 0;

  constructor(
    private readonly db: Db,
    /** The bot this poller *is*. One connection per token, never shared. */
    private readonly token: string,
    private readonly fallbackToken: string | null,
    private readonly announcer: Announcer,
    /** Injected for the same reason `Announcer` injects one: a reply is a
     *  message to a real group, and deciding *whether* to send it is the part
     *  worth testing. Reaching for the module-level sender here made the whole
     *  command path untestable without a network. */
    private readonly send: Sender = sendMessage,
  ) {}

  /**
   * The events this bot speaks for, and the only ones it may act on.
   *
   * Without this scoping, one organiser's bot could redeem another event's
   * bind code, or answer `/next` about an event it has nothing to do with.
   *
   * Archived events are excluded for the same reason the announcer skips them:
   * an archived event is over, and it should no more answer a command than it
   * should announce a session.
   */
  private servedEvents(): EventRow[] {
    return this.db
      .prepare<[], EventRow>('SELECT * FROM events WHERE archived = 0')
      .all()
      .filter((event) => resolveToken(event, this.fallbackToken) === this.token);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await callTelegram<Update[]>(this.token, 'getUpdates', {
          offset: this.offset,
          timeout: POLL_SECONDS,
          allowed_updates: ['message'],
        });
        this.failures = 0;
        for (const update of updates) {
          this.offset = update.update_id + 1;
          await this.handle(update);
        }
      } catch (err) {
        // Backs off to a minute. A wrong token, a revoked bot or an instance
        // with no route out fails every single time, and a five-second retry
        // forever is how an operator learns to stop reading the log.
        this.failures += 1;
        const wait = Math.min(5000 * 2 ** (this.failures - 1), 60_000);
        if (this.failures <= 3 || this.failures % 20 === 0) {
          console.warn(
            `telegram: poll failed (${this.failures}×, retrying in ${wait / 1000}s): ${(err as Error).message}`,
          );
        }
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  private async reply(chatId: string, text: string, topicId?: number): Promise<void> {
    await this.send(this.token, { chatId, text, topicId });
  }

  async handle(update: Update): Promise<void> {
    const message = update.message;
    if (!message?.text) return;
    const parsed = parseCommand(message.text);
    if (!parsed) return;

    const chatId = String(message.chat.id);
    const topicId = message.message_thread_id;

    if (parsed.command === '/bind') {
      const code = parsed.args[0];
      if (!code) {
        await this.reply(chatId, 'Say /bind followed by the code from Manage Event.', topicId);
        return;
      }
      const now = new Date().toISOString();
      const event = this.servedEvents().find(
        (e) =>
          e.telegram_bind_code === code &&
          e.telegram_bind_expires !== null &&
          e.telegram_bind_expires > now,
      );
      if (!event) {
        await this.reply(chatId, 'That code is wrong or has expired.', topicId);
        return;
      }
      this.db
        .prepare(
          `UPDATE events
              SET telegram_chat_id = ?, telegram_topic_id = ?,
                  telegram_bind_code = NULL, telegram_bind_expires = NULL
            WHERE id = ?`,
        )
        .run(chatId, topicId ?? null, event.id);
      await this.reply(chatId, `Connected to ${escapeHtml(event.name)}.`, topicId);
      return;
    }

    // Everything below answers only a group that has already been bound to an
    // event *this bot speaks for* — otherwise the bot is a free schedule
    // oracle for anyone who adds it.
    const event = this.servedEvents().find((e) => e.telegram_chat_id === chatId);
    if (!event) return;

    if (parsed.command === '/unbind') {
      this.db
        .prepare('UPDATE events SET telegram_chat_id = NULL, telegram_topic_id = NULL WHERE id = ?')
        .run(event.id);
      await this.reply(chatId, 'Disconnected. No more announcements here.', topicId);
      return;
    }

    if (parsed.command === '/next') {
      for (const text of this.announcer.nextSlotText(event, new Date())) {
        await this.reply(chatId, text, topicId);
      }
    }
  }
}

/**
 * One poller per bot, kept in step with what the database says.
 *
 * Events bring their own tokens now, so the set of bots to listen to changes
 * while the process runs — an organiser pastes a token, changes it, or clears
 * it. Reconciling on the announce tick is enough: a new bot starts answering
 * within a minute of being saved, which is faster than anyone can walk to
 * their group and type.
 *
 * Stopping a poller does not cut its in-flight request; that connection closes
 * when Telegram answers it, up to `POLL_SECONDS` later. Harmless, because a
 * stopped poller ignores what comes back.
 */
export class PollerPool {
  private readonly pollers = new Map<string, Poller>();

  constructor(
    private readonly db: Db,
    private readonly fallbackToken: string | null,
    private readonly announcer: Announcer,
    private readonly send: Sender = sendMessage,
  ) {}

  reconcile(): void {
    const wanted = new Set(activeTokens(this.db, this.fallbackToken));
    for (const [token, poller] of this.pollers) {
      if (!wanted.has(token)) {
        poller.stop();
        this.pollers.delete(token);
      }
    }
    for (const token of wanted) {
      if (this.pollers.has(token)) continue;
      const poller = new Poller(this.db, token, this.fallbackToken, this.announcer, this.send);
      poller.start();
      this.pollers.set(token, poller);
    }
  }

  /** How many bots are being listened to, for the boot log and for tests. */
  get size(): number {
    return this.pollers.size;
  }

  stop(): void {
    for (const poller of this.pollers.values()) poller.stop();
    this.pollers.clear();
  }
}
