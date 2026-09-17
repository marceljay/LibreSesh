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
import { zonedParts } from './shared/time.js';
import {
  Announcer as CoreAnnouncer,
  TRIGGERS,
  announceQuietly,
  announceableSession,
  daySessions,
  dueSessions as dueWithin,
  groupByStart,
  type Announcement,
  type Transport,
  type Trigger,
} from './announcer.js';

export type { Trigger } from './announcer.js';
export { TRIGGERS, announceQuietly, announceableSession, daySessions, groupByStart };

const API = 'https://api.telegram.org';

/** Telegram's hard ceiling on one message. */
const MAX_MESSAGE = 4096;

/** A hung Telegram must never reach the process serving the schedule. */
const CALL_TIMEOUT_MS = 10_000;

/** How long `getUpdates` is allowed to hold the connection open. */
const POLL_SECONDS = 25;

/**
 * Modes are **presets over the trigger set**, not a stored value of their own.
 * Storing both would let the label disagree with the behaviour; deriving it
 * means a set matching no preset reports "custom", which is the truth.
 *
 * Every rung has a trigger behind it that actually fires — that is the rule the
 * ladder is held to, and for a while it had only two rungs because `digest`,
 * `added` and `changed` were named and unwritten. Light sending nothing while
 * calling itself "one message each morning" is the failure this guards.
 *
 * **Light is `up_next`, not `digest`.** `announcements.md` fixes only that
 * Medium carries the digest; which rung is quietest is ours to choose. Putting
 * the per-slot message at the bottom makes migration 023's stored default —
 * `["up_next"]` — a preset with a name, so no event opens its panel on
 * "Custom", a state nobody picked and no control could return to.
 */
export const MODES: Record<string, Trigger[]> = {
  off: [],
  light: ['up_next'],
  medium: ['digest', 'up_next'],
  heavy: ['digest', 'up_next', 'added', 'changed'],
};

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Which preset this trigger set is, or 'custom' when it is none of them. */
export function modeOf(triggers: readonly Trigger[]): string {
  for (const [name, set] of Object.entries(MODES)) if (sameSet(triggers, set)) return name;
  return 'custom';
}

/** Stored as JSON; anything unrecognised is dropped rather than trusted. */
export function parseTriggers(raw: string | null): Trigger[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is Trigger => TRIGGERS.includes(t as Trigger));
  } catch {
    return [];
  }
}

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

/** 'HH:MM' as the clock reads it at the venue, never UTC. */
export function hhmm(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export interface AnnounceItem {
  id: number;
  title: string;
  room: string;
  speakers: string[];
  /** Whatever the session carries. Posted only when the event asks for it. */
  livestreams: LabelledLink[];
}

/** One block per session, so a split can happen on a session boundary. */
function itemBlock(item: AnnounceItem, sessionUrl: string | null, streams: boolean): string {
  const title = sessionUrl
    ? `<a href="${escapeHtml(sessionUrl)}">${escapeHtml(item.title)}</a>`
    : `<b>${escapeHtml(item.title)}</b>`;
  const lines = [escapeHtml(item.room), title];
  if (item.speakers.length > 0) lines.push(escapeHtml(item.speakers.join(', ')));
  // The session link lands on the password gate; a stream link does not. That
  // is the whole reason this is a setting and not simply what a message says.
  if (streams)
    for (const stream of item.livestreams)
      lines.push(`▶ <a href="${escapeHtml(stream.url)}">${escapeHtml(stream.label)}</a>`);
  return lines.join('\n');
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
  streams = false,
): string[] {
  const header = `🕐 ${hhmm(startsAt, timeZone)} — up next`;
  const out: string[] = [];
  let current = header;

  for (const item of items) {
    const block = `\n\n${itemBlock(item, sessionUrl(item.id), streams)}`;
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

/** A session in a message that spans a day, so the time has to be on the line. */
export type TimedItem = AnnounceItem & { startsAt: string };

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
    ? `<a href="${escapeHtml(url)}">${escapeHtml(item.title)}</a>`
    : escapeHtml(item.title);
}

/** One session that has just appeared on the grid, named rather than listed. */
export function renderAdded(
  startsAt: Date,
  timeZone: string,
  item: AnnounceItem,
  sessionUrl: (id: number) => string | null,
  streams = false,
): string {
  return `✨ Just added — ${hhmm(startsAt, timeZone)}\n\n${itemBlock(item, sessionUrl(item.id), streams)}`;
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

/** The Telegram lead window, as the announcer's range query. */
export const dueSessions = (db: Db, event: EventRow, now: Date): SessionRow[] =>
  dueWithin(db, event, now, event.telegram_lead_min);

/** Turn rows into what the renderer needs, resolving rooms and speakers once. */
export function toItems(db: Db, event: EventRow, sessions: SessionRow[]): AnnounceItem[] {
  if (sessions.length === 0) return [];
  const rooms = new Map(
    db
      .prepare<[number], RoomRow>('SELECT * FROM rooms WHERE event_id = ?')
      .all(event.id)
      .map((r) => [r.id, r.name]),
  );
  const speakers = speakersBySession(
    db,
    sessions.map((s) => s.id),
  );
  return sessions.map((s) => ({
    id: s.id,
    title: s.title,
    room: rooms.get(s.room_id) ?? '',
    speakers: (speakers.get(s.id) ?? []).map((p) => p.name),
    livestreams: parseLinks(s.livestreams),
  }));
}

/** A pitch made on the board, for the group that watches it fill. */
export function renderPitched(
  title: string,
  pitcher: string | null,
  boardUrl: string | null,
): string {
  const head = boardUrl
    ? `<a href="${escapeHtml(boardUrl)}">${escapeHtml(title)}</a>`
    : `<b>${escapeHtml(title)}</b>`;
  const by = pitcher ? `\nby ${escapeHtml(pitcher)}` : '';
  return `💡 Pitched — ${head}${by}`;
}

/** A pitch that has become a session: `added`, but saying where it came from. */
export function renderPlaced(
  startsAt: Date,
  timeZone: string,
  item: AnnounceItem,
  sessionUrl: (id: number) => string | null,
  streams = false,
): string {
  return `📌 Placed from the pitch board — ${hhmm(startsAt, timeZone)}\n\n${itemBlock(item, sessionUrl(item.id), streams)}`;
}

/**
 * Telegram as a transport of the shared announcer (`announcer.ts`): which
 * events and triggers it serves, how long before a slot it speaks, and how
 * each announcement is rendered and posted. The loop, the sent record and
 * every rule about *when* live in the announcer, shared with Nostr.
 */
export function telegramTransport(
  db: Db,
  /** The instance bot, used only by events that have not brought their own. */
  fallbackToken: string | null,
  publicUrl: string | null,
  send: Sender = sendMessage,
): Transport {
  const sessionUrl =
    (event: EventRow) =>
    (id: number): string | null =>
      publicUrl ? `${publicUrl}/e/${event.slug}/s/${id}` : null;
  const boardUrl = (event: EventRow): string | null =>
    publicUrl ? `${publicUrl}/e/${event.slug}/proposals` : null;

  /** Where a message goes, or null when this event cannot send one. */
  const destination = (event: EventRow): { chatId: string; token: string } | null => {
    const chatId = event.telegram_chat_id;
    const token = resolveToken(event, fallbackToken);
    return chatId && token ? { chatId, token } : null;
  };

  const post = async (event: EventRow, texts: string[]): Promise<void> => {
    const to = destination(event);
    if (!to) return;
    for (const text of texts) {
      await send(to.token, { chatId: to.chatId, text, topicId: event.telegram_topic_id });
    }
  };

  /** `toItems`, plus the start time each line has to carry. */
  const timed = (event: EventRow, sessions: SessionRow[]): TimedItem[] =>
    toItems(db, event, sessions).map((item, i) => ({ ...item, startsAt: sessions[i]!.starts_at }));

  return {
    name: 'telegram',
    enabled: (event, trigger) =>
      destination(event) !== null && parseTriggers(event.telegram_triggers).includes(trigger),
    timing: (event) => ({ leadMin: event.telegram_lead_min, digestMin: event.telegram_digest_min }),
    async send(event: EventRow, a: Announcement): Promise<void> {
      const tz = event.timezone;
      const url = sessionUrl(event);
      const streams = event.telegram_livestreams === 1;
      switch (a.trigger) {
        case 'up_next':
          await post(
            event,
            renderUpNext(new Date(a.at), tz, toItems(db, event, a.sessions), url, streams),
          );
          return;
        case 'digest':
          await post(event, renderDigest(new Date(a.at), tz, timed(event, a.sessions), url));
          return;
        case 'changed':
          await post(event, [renderMoved(tz, timed(event, a.sessions), url)]);
          return;
        case 'added':
        case 'placed': {
          const [item] = toItems(db, event, a.sessions);
          if (!item) return;
          const render = a.trigger === 'added' ? renderAdded : renderPlaced;
          await post(event, [render(new Date(a.at), tz, item, url, streams)]);
          return;
        }
        case 'pitched': {
          if (!a.proposal) return;
          const pitcher =
            a.proposal.speaker_id === null
              ? null
              : (db
                  .prepare<[number], { name: string }>('SELECT name FROM people WHERE id = ?')
                  .get(a.proposal.speaker_id)?.name ?? null);
          await post(event, [renderPitched(a.proposal.title, pitcher, boardUrl(event))]);
          return;
        }
      }
    },
  };
}

/** What `/next` answers with: the next slot that has not started yet. */
export function nextSlotText(
  db: Db,
  event: EventRow,
  now: Date,
  publicUrl: string | null,
): string[] {
  const upcoming = db
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
    toItems(db, event, slot),
    (id) => (publicUrl ? `${publicUrl}/e/${event.slug}/s/${id}` : null),
    event.telegram_livestreams === 1,
  );
}

/** What the poller needs to answer `/next`. */
export interface NextSlot {
  nextSlotText(event: EventRow, now: Date): string[];
}

/**
 * The announcer with Telegram as its only transport: what the tests build,
 * and what the poller's `/next` reads. The instance itself constructs the
 * shared announcer in `app.ts` with every transport.
 */
export class Announcer extends CoreAnnouncer implements NextSlot {
  constructor(
    db: Db,
    fallbackToken: string | null,
    private readonly publicUrl: string | null,
    send: Sender = sendMessage,
  ) {
    super(db, [telegramTransport(db, fallbackToken, publicUrl, send)]);
  }

  /** Exposed so a test can assert a slot is announced exactly once. */
  hasSent(eventId: number, startsAt: string): boolean {
    return this.wasSent('telegram', eventId, startsAt);
  }

  nextSlotText(event: EventRow, now: Date): string[] {
    return nextSlotText(this.db, event, now, this.publicUrl);
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
    private readonly announcer: NextSlot,
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
    private readonly announcer: NextSlot,
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
