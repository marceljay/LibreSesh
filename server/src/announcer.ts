/**
 * The announcer: one loop and one record of what has been said, shared by
 * every transport that posts the schedule somewhere else. The rules live in
 * `_planning/specs/announcements.md`; this file is them, and a transport is
 * only rendering and delivery.
 *
 * Six triggers. `up_next` and `digest` come from the tick; `added`,
 * `changed`, `pitched` and `placed` come from the write path, called beside
 * the route's `audit()` — never from the SSE broker, which returns early with
 * no subscribers and would post only while somebody had a tab open.
 *
 * The record of what was sent is an in-memory set keyed by transport, so one
 * transport failing or being switched off can never silence another. It is
 * not a table, deliberately: the only thing a table would buy is surviving a
 * restart inside a lead window, and the accepted cost of not having one is
 * that such a restart repeats one slot.
 */
import type { Db, EventRow, ProposalRow, SessionRow } from './db.js';
import { localDate, localMinuteOfDay, zonedTimeToUtc } from './shared/time.js';

export type Trigger = 'up_next' | 'digest' | 'added' | 'changed' | 'pitched' | 'placed';

export const TRIGGERS: readonly Trigger[] = [
  'up_next',
  'digest',
  'added',
  'changed',
  'pitched',
  'placed',
];

export type TransportName = 'telegram' | 'nostr';

/** A value built from rows and handed to each enabled transport to render. */
export interface Announcement {
  trigger: Trigger;
  event: EventRow;
  /** The instant it is about: a slot's start, the digest's first session, or now. */
  at: string;
  /** The sessions concerned; empty for `pitched`. */
  sessions: SessionRow[];
  /** The pitch, for `pitched` and `placed`. */
  proposal?: ProposalRow;
}

export interface Transport {
  name: TransportName;
  /** Whether this event has the transport set up and the trigger switched on. */
  enabled(event: EventRow, trigger: Trigger): boolean;
  /** Minutes before a slot its `up_next` goes out, and the local minute of day of the digest. */
  timing(event: EventRow): { leadMin: number; digestMin: number };
  /** Render and deliver. May throw; the announcer logs it and keeps the sent mark. */
  send(event: EventRow, announcement: Announcement): Promise<void>;
}

/**
 * How long after its hour the digest may still go out. A process restarted at
 * 14:00 must not open by announcing a day more than half over.
 */
export const DIGEST_WINDOW_MIN = 60;

/** Detach a write-path announcement from the request: it must never fail a write. */
export function announceQuietly(work: Promise<unknown>): void {
  void work.catch((err: unknown) => console.warn(`announcer: ${(err as Error).message}`));
}

/**
 * Sessions whose lead window is open: `starts_at - lead <= now < starts_at`.
 *
 * A **range**, not the moment the window opens. A session created at 13:40 to
 * run at 13:45 has already missed an edge trigger before it existed, and that
 * — a pitch placed at short notice — is the case the whole feature is for. A
 * range picks it up on the next tick.
 */
export function dueSessions(db: Db, event: EventRow, now: Date, leadMin: number): SessionRow[] {
  return db
    .prepare<[number, string, string], SessionRow>(
      `SELECT * FROM sessions
        WHERE event_id = ? AND deleted_at IS NULL AND draft = 0
          AND starts_at > ? AND starts_at <= ?
        ORDER BY starts_at, room_id`,
    )
    .all(event.id, now.toISOString(), new Date(now.getTime() + leadMin * 60_000).toISOString());
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

export class Announcer {
  /** `<transport>:<eventId>:<startsAt>` for slots, `<transport>:digest:<eventId>:<day>` for digests. */
  private readonly sent = new Set<string>();

  /**
   * Sessions each transport has actually told its audience about.
   *
   * `changed` fires only for these. A session nobody was told about has not
   * moved as far as that audience is concerned, and announcing its move would
   * disclose a session that was never announced in the first place.
   */
  private readonly announced = new Map<TransportName, Set<number>>();

  /** Moves waiting for the next tick, keyed `<transport>:<eventId>`. */
  private readonly moved = new Map<string, Set<number>>();

  constructor(
    protected readonly db: Db,
    private readonly transports: readonly Transport[],
  ) {}

  private key(transport: TransportName, eventId: number, startsAt: string): string {
    return `${transport}:${eventId}:${startsAt}`;
  }

  /** Whether a slot has gone out on a transport; a test asserts exactly once. */
  wasSent(transport: TransportName, eventId: number, startsAt: string): boolean {
    return this.sent.has(this.key(transport, eventId, startsAt));
  }

  private announcedBy(transport: TransportName): Set<number> {
    let set = this.announced.get(transport);
    if (!set) {
      set = new Set();
      this.announced.set(transport, set);
    }
    return set;
  }

  private liveEvents(): EventRow[] {
    return this.db
      .prepare<[], EventRow>('SELECT * FROM events WHERE archived = 0 ORDER BY id')
      .all();
  }

  private warn(transport: Transport, event: EventRow, err: unknown): void {
    // One misconfigured destination must not stop the others.
    console.warn(`${transport.name}: ${event.slug}: ${(err as Error).message}`);
  }

  async tick(now: Date = new Date()): Promise<void> {
    for (const event of this.liveEvents()) {
      for (const transport of this.transports) {
        try {
          // Moves first: a session that has just been dragged into the next
          // fifteen minutes should read as moved, not arrive as a fresh slot.
          if (transport.enabled(event, 'changed')) await this.sendMoved(transport, event, now);
          if (transport.enabled(event, 'digest')) await this.sendDigest(transport, event, now);
          if (transport.enabled(event, 'up_next')) await this.sendUpNext(transport, event, now);
        } catch (err) {
          this.warn(transport, event, err);
        }
      }
    }
    // Anything buffered for an event or transport that has since stopped
    // listening is dropped rather than kept for an audience that may never
    // be reconnected.
    this.moved.clear();
  }

  private async sendUpNext(transport: Transport, event: EventRow, now: Date): Promise<void> {
    const { leadMin } = transport.timing(event);
    for (const [startsAt, sessions] of groupByStart(dueSessions(this.db, event, now, leadMin))) {
      const key = this.key(transport.name, event.id, startsAt);
      if (this.sent.has(key)) continue;
      // Marked BEFORE the send: a call that times out after the remote end
      // accepted it would otherwise repost, and a duplicate is permanent and
      // visible where a miss is neither.
      this.sent.add(key);
      const announced = this.announcedBy(transport.name);
      for (const s of sessions) announced.add(s.id);
      await transport.send(event, { trigger: 'up_next', event, at: startsAt, sessions });
    }
  }

  /**
   * The day's programme, once, at the hour the transport's settings chose.
   * Fired inside a one-hour window after that time rather than at any moment
   * past it. A restart inside the window still repeats it — the same accepted
   * cost as `up_next`, for the same reason: the record is in memory.
   */
  private async sendDigest(transport: Transport, event: EventRow, now: Date): Promise<void> {
    const day = localDate(now, event.timezone);
    const key = `${transport.name}:digest:${event.id}:${day}`;
    if (this.sent.has(key)) return;
    const minute = localMinuteOfDay(now, event.timezone);
    const { digestMin } = transport.timing(event);
    if (minute < digestMin || minute >= digestMin + DIGEST_WINDOW_MIN) return;
    this.sent.add(key);
    const sessions = daySessions(this.db, event, day);
    // An empty day says nothing. An audience told "nothing today" every
    // morning of the week before the conference is one that mutes the bot.
    if (sessions.length === 0) return;
    const announced = this.announcedBy(transport.name);
    for (const s of sessions) announced.add(s.id);
    await transport.send(event, {
      trigger: 'digest',
      event,
      at: sessions[0]!.starts_at,
      sessions,
    });
  }

  /** A session that has just appeared on the grid, from the write path. */
  async announceAdded(event: EventRow, sessionId: number, now: Date = new Date()): Promise<void> {
    await this.arrival('added', event, sessionId, undefined, now);
  }

  /** A pitch placed on the grid: the same shape as `added`, under its own trigger. */
  async announcePlaced(
    event: EventRow,
    proposalId: number,
    sessionId: number,
    now: Date = new Date(),
  ): Promise<void> {
    await this.arrival('placed', event, sessionId, this.proposal(proposalId), now);
  }

  /**
   * When the new session starts inside the lead window, this *is* that slot's
   * `up_next` — the whole slot goes out and the key is marked, so the tick
   * does not say the same thing again a few seconds later. Sending the slot
   * rather than the one session keeps the other rooms in it visible.
   */
  private async arrival(
    trigger: 'added' | 'placed',
    event: EventRow,
    sessionId: number,
    proposal: ProposalRow | undefined,
    now: Date,
  ): Promise<void> {
    const session = announceableSession(this.db, event, sessionId);
    if (!session) return;
    for (const transport of this.transports) {
      if (!transport.enabled(event, trigger)) continue;
      try {
        const startsAt = new Date(session.starts_at);
        const leadMs = transport.timing(event).leadMin * 60_000;
        const imminent = startsAt > now && startsAt.getTime() - now.getTime() <= leadMs;
        const key = this.key(transport.name, event.id, session.starts_at);
        if (imminent && this.sent.has(key)) continue;
        const announced = this.announcedBy(transport.name);
        announced.add(sessionId);
        if (imminent) {
          this.sent.add(key);
          const slot = this.db
            .prepare<[number, string], SessionRow>(
              `SELECT * FROM sessions
                WHERE event_id = ? AND deleted_at IS NULL AND draft = 0 AND starts_at = ?
                ORDER BY room_id`,
            )
            .all(event.id, session.starts_at);
          for (const s of slot) announced.add(s.id);
          await transport.send(event, {
            trigger: 'up_next',
            event,
            at: session.starts_at,
            sessions: slot,
          });
          continue;
        }
        await transport.send(event, {
          trigger,
          event,
          at: session.starts_at,
          sessions: [session],
          proposal,
        });
      } catch (err) {
        this.warn(transport, event, err);
      }
    }
  }

  /** A pitch made on the board. Nothing is suppressed or coalesced: a pitch is one act. */
  async announcePitched(
    event: EventRow,
    proposalId: number,
    now: Date = new Date(),
  ): Promise<void> {
    const proposal = this.proposal(proposalId);
    if (!proposal || proposal.deleted_at !== null) return;
    for (const transport of this.transports) {
      if (!transport.enabled(event, 'pitched')) continue;
      try {
        await transport.send(event, {
          trigger: 'pitched',
          event,
          at: now.toISOString(),
          sessions: [],
          proposal,
        });
      } catch (err) {
        this.warn(transport, event, err);
      }
    }
  }

  private proposal(id: number): ProposalRow | undefined {
    return this.db.prepare<[number], ProposalRow>('SELECT * FROM proposals WHERE id = ?').get(id);
  }

  /**
   * Remember that a session moved. Nothing is sent here: held until the next
   * tick because a reshuffle is a dozen writes and should be one message.
   * Only a transport that actually announced the session owes a correction.
   */
  noteMoved(event: EventRow, sessionId: number): void {
    for (const transport of this.transports) {
      if (!transport.enabled(event, 'changed')) continue;
      if (!this.announcedBy(transport.name).has(sessionId)) continue;
      const key = `${transport.name}:${event.id}`;
      const pending = this.moved.get(key);
      if (pending) pending.add(sessionId);
      else this.moved.set(key, new Set([sessionId]));
    }
  }

  private async sendMoved(transport: Transport, event: EventRow, now: Date): Promise<void> {
    const key = `${transport.name}:${event.id}`;
    const pending = this.moved.get(key);
    this.moved.delete(key);
    if (!pending || pending.size === 0) return;
    const sessions = [...pending]
      .map((id) => announceableSession(this.db, event, id))
      .filter((s): s is SessionRow => s !== null)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.room_id - b.room_id);
    // Everything in the batch was deleted or drafted between the drag and the
    // tick; the move is no longer news.
    if (sessions.length === 0) return;
    await transport.send(event, { trigger: 'changed', event, at: now.toISOString(), sessions });
  }
}
