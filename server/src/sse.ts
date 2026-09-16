import type { Response } from 'express';
import { RESYNC_EVENT, type ChangeEvent, type ChangeType } from './shared/types.js';

const HEARTBEAT_MS = 25_000;
const RETRY_MS = 3000;

/**
 * How far back a reconnecting stream can be caught up, in frames and in time.
 * A browser retries 3 s after a drop and the heartbeat is 25 s, so a gap that
 * outruns either of these is not a blip — it is a tab that was asleep, a laptop
 * that was shut, or a wifi outage long enough that a fresh bundle is the honest
 * answer anyway.
 */
const REPLAY_MS = 5 * 60_000;
const REPLAY_FRAMES = 200;

/**
 * Names this process in every id it hands out. Ids are positions in a history
 * held in memory, so an id minted before a restart points into a history that
 * no longer exists — and without the epoch its number would happily match a
 * position in the new one, and the client would be told it had missed nothing.
 */
const EPOCH = Math.floor(Math.random() * 0xffffff).toString(36);

/** What was published, as a question rather than a frame: `publishTo` and
 *  `publishEach` address their frames per listener, so a replay has to ask
 *  again for the identity now reconnecting rather than hand back what someone
 *  else was sent. */
type FrameFor = (identityId: number | undefined) => ChangeEvent | null;

interface Recorded {
  id: number;
  at: number;
  frameFor: FrameFor;
}

interface Channel {
  subscribers: Set<Response>;
  /** Recent frames, oldest first. */
  history: Recorded[];
  /** The highest id that has fallen out of `history`. A stream that last saw
   *  an id below this missed something nobody can replay, so it is told to
   *  refetch. Kept when the history empties, which is the whole point of it:
   *  "no frames to replay" and "the frames you missed are gone" look identical
   *  from an empty list. */
  droppedThrough: number;
}

/**
 * In-process pub/sub for Server-Sent Events, one channel per event slug
 * (SPEC §6). Single process, so no external broker is involved.
 *
 * Every frame carries an id, and each channel keeps a short ring of the frames
 * it has just sent. A browser reconnecting sends the last id it saw back as
 * `Last-Event-ID` on its own, so a stream that dropped for a few seconds is
 * handed the two or three frames it missed instead of refetching the event.
 * That matters at the scale this runs at: a room on venue wifi reconnects
 * constantly, and a full bundle per device per reconnect is the loudest thing
 * a busy event does to its own server.
 */
export class Broker {
  private readonly channels = new Map<string, Channel>();
  /** Who each open stream belongs to, for `publishTo`. A `WeakMap` so a
   *  response that is dropped without unsubscribing takes its entry with it. */
  private readonly owner = new WeakMap<Response, number>();
  private readonly heartbeat: NodeJS.Timeout;
  private lastId = 0;

  constructor() {
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  /** Attach a response as a stream subscriber; returns an unsubscribe function.
   *  `identityId` is who is listening, which `publishTo` needs — a
   *  notification is addressed to one person and must not be broadcast to
   *  every tab open on the event. `lastEventId` is the browser's own
   *  `Last-Event-ID` header, the position it wants catching up from. */
  subscribe(slug: string, res: Response, identityId?: number, lastEventId?: string): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defeat proxy buffering, which would otherwise hold events back.
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: ${RETRY_MS}\n\n`);
    res.flushHeaders?.();

    const channel = this.channel(slug);
    channel.subscribers.add(res);
    if (identityId !== undefined) this.owner.set(res, identityId);

    this.catchUp(channel, res, identityId, lastEventId);

    return () => {
      // The channel itself stays: its history is what the next reconnect is
      // caught up from, and a reconnect arrives precisely when the last
      // subscriber has just gone.
      this.channels.get(slug)?.subscribers.delete(res);
    };
  }

  publish(slug: string, type: ChangeType, entity: unknown): void {
    this.send(slug, () => ({ type, entity }));
  }

  /**
   * Publish to one person's streams on this channel, and to nobody else.
   *
   * The event channel is the wrong place for a notification: everyone reading
   * the schedule is subscribed to it, so broadcasting "Ada mentioned you"
   * tells the room who was mentioned and when. The payload is deliberately
   * contentless — the client refetches its own inbox over an authenticated
   * request — so even a stream attributed to the wrong identity leaks nothing
   * but a nudge.
   */
  publishTo(slug: string, identityId: number, type: ChangeType, entity: unknown): void {
    this.send(slug, (to) => (to === identityId ? { type, entity } : null));
  }

  /**
   * Publish a frame chosen per stream, or none: `frameFor` is asked once for
   * each open stream, with the identity it belongs to. For what not everyone
   * reading the schedule may see — a draft session — where `publish` would
   * hand it to the whole room.
   */
  publishEach(slug: string, frameFor: FrameFor): void {
    this.send(slug, frameFor);
  }

  subscriberCount(slug: string): number {
    return this.channels.get(slug)?.subscribers.size ?? 0;
  }

  /**
   * Record one publication and write it to everyone it is for.
   *
   * Recording happens even with nobody listening. A reconnect is a gap with no
   * subscriber in it by definition, and a frame published during that gap is
   * exactly the frame the replay exists to deliver.
   */
  private send(slug: string, frameFor: FrameFor): void {
    const channel = this.channel(slug);
    const id = ++this.lastId;
    channel.history.push({ id, at: Date.now(), frameFor });
    this.prune(channel);

    for (const res of channel.subscribers) {
      const change = frameFor(this.owner.get(res));
      if (!change) continue;
      this.write(res, channel, id, change);
    }
  }

  /** Hand a reconnecting stream what it missed, or tell it to refetch. */
  private catchUp(
    channel: Channel,
    res: Response,
    identityId: number | undefined,
    lastEventId: string | undefined,
  ): void {
    // A first connection. The client has just fetched the bundle, so there is
    // nothing to catch up on — but it does need a position, or its first
    // reconnect would arrive with no id at all and be indistinguishable from a
    // tab that has missed everything. That is the common case on a quiet event
    // and the one worth getting right: nothing happens all morning, the wifi
    // drops anyway, and nobody should refetch over it. An id on its own updates
    // the browser's `Last-Event-ID` without dispatching an event.
    if (lastEventId === undefined) {
      res.write(`id: ${EPOCH}-${this.lastId}\n\n`);
      return;
    }

    // `null` is an id this process never minted — from before a restart, or
    // made up. Either way its position means nothing here.
    const seen = parseId(lastEventId);
    if (seen === null || seen < channel.droppedThrough) {
      this.write(res, channel, this.lastId, null);
      return;
    }

    for (const frame of channel.history) {
      if (frame.id <= seen) continue;
      const change = frame.frameFor(identityId);
      if (!change) continue;
      this.write(res, channel, frame.id, change);
    }
  }

  /** One frame out, `change` or — for `null` — the instruction to refetch.
   *  A write that throws is a socket already gone; drop it rather than let it
   *  take the loop it is in with it. */
  private write(res: Response, channel: Channel, id: number, change: ChangeEvent | null): void {
    const body = change
      ? `event: change\ndata: ${JSON.stringify(change)}\n\n`
      : `event: ${RESYNC_EVENT}\ndata: {}\n\n`;
    try {
      res.write(`id: ${EPOCH}-${id}\n${body}`);
    } catch {
      channel.subscribers.delete(res);
    }
  }

  private channel(slug: string): Channel {
    let channel = this.channels.get(slug);
    if (!channel) {
      channel = { subscribers: new Set(), history: [], droppedThrough: 0 };
      this.channels.set(slug, channel);
    }
    return channel;
  }

  /** Drop what is too old or too far back to replay, remembering how far the
   *  dropping reached. Note that a stream which already saw a dropped frame is
   *  unaffected: its id is at or above the one dropped. */
  private prune(channel: Channel): void {
    const cutoff = Date.now() - REPLAY_MS;
    let drop = 0;
    while (
      drop < channel.history.length &&
      ((channel.history[drop] as Recorded).at < cutoff ||
        channel.history.length - drop > REPLAY_FRAMES)
    ) {
      drop += 1;
    }
    if (drop === 0) return;
    channel.droppedThrough = (channel.history[drop - 1] as Recorded).id;
    channel.history.splice(0, drop);
  }

  private ping(): void {
    for (const channel of this.channels.values()) {
      for (const res of channel.subscribers) {
        try {
          res.write(': ping\n\n');
        } catch {
          channel.subscribers.delete(res);
        }
      }
      this.prune(channel);
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const channel of this.channels.values()) {
      for (const res of channel.subscribers) res.end();
    }
    this.channels.clear();
  }
}

/** The number out of an `EPOCH-n` id, or `null` for anything this process did
 *  not mint — a header from before a restart, or one somebody made up. */
function parseId(lastEventId: string): number | null {
  const [epoch, position] = lastEventId.split('-');
  if (epoch !== EPOCH) return null;
  const id = Number(position);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}
