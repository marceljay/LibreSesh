import type { Response } from 'express';
import type { ChangeEvent, ChangeType } from './shared/types.js';

const HEARTBEAT_MS = 25_000;
const RETRY_MS = 3000;

/**
 * In-process pub/sub for Server-Sent Events, one channel per event slug
 * (SPEC §6). Single process, so no external broker is involved.
 */
export class Broker {
  private readonly channels = new Map<string, Set<Response>>();
  /** Who each open stream belongs to, for `publishTo`. A `WeakMap` so a
   *  response that is dropped without unsubscribing takes its entry with it. */
  private readonly owner = new WeakMap<Response, number>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  /** Attach a response as a stream subscriber; returns an unsubscribe function.
   *  `identityId` is who is listening, which `publishTo` needs — a
   *  notification is addressed to one person and must not be broadcast to
   *  every tab open on the event. */
  subscribe(slug: string, res: Response, identityId?: number): () => void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Defeat proxy buffering, which would otherwise hold events back.
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: ${RETRY_MS}\n\n`);
    res.flushHeaders?.();

    let set = this.channels.get(slug);
    if (!set) {
      set = new Set();
      this.channels.set(slug, set);
    }
    set.add(res);
    if (identityId !== undefined) this.owner.set(res, identityId);

    return () => {
      const current = this.channels.get(slug);
      if (!current) return;
      current.delete(res);
      if (current.size === 0) this.channels.delete(slug);
    };
  }

  publish(slug: string, type: ChangeType, entity: unknown): void {
    const set = this.channels.get(slug);
    if (!set || set.size === 0) return;
    const payload: ChangeEvent = { type, entity };
    const frame = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) {
      try {
        res.write(frame);
      } catch {
        set.delete(res);
      }
    }
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
    const set = this.channels.get(slug);
    if (!set || set.size === 0) return;
    const frame = `event: change\ndata: ${JSON.stringify({ type, entity } satisfies ChangeEvent)}\n\n`;
    for (const res of set) {
      if (this.owner.get(res) !== identityId) continue;
      try {
        res.write(frame);
      } catch {
        set.delete(res);
      }
    }
  }

  subscriberCount(slug: string): number {
    return this.channels.get(slug)?.size ?? 0;
  }

  private ping(): void {
    for (const set of this.channels.values()) {
      for (const res of set) {
        try {
          res.write(': ping\n\n');
        } catch {
          set.delete(res);
        }
      }
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const set of this.channels.values()) {
      for (const res of set) res.end();
    }
    this.channels.clear();
  }
}
