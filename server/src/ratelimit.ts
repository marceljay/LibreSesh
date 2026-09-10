import type { NextFunction, Request, Response } from 'express';
import { HttpError } from './errors.js';

/**
 * In-memory token buckets (SPEC §8). A request must pass the identity bucket
 * AND the IP bucket. Single process, so no shared store is needed.
 */
export interface BucketSpec {
  /** Maximum tokens (also the burst size). */
  capacity: number;
  /** Milliseconds over which a full bucket refills. */
  windowMs: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Consume one token. Returns 0 when allowed, otherwise the number of seconds
   * to wait (for `Retry-After`).
   */
  consume(key: string, spec: BucketSpec): number {
    const t = this.now();
    this.sweep(t);
    const refillPerMs = spec.capacity / spec.windowMs;
    const bucket = this.buckets.get(key) ?? { tokens: spec.capacity, updatedAt: t };
    bucket.tokens = Math.min(spec.capacity, bucket.tokens + (t - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = t;

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1000));
    }
    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return 0;
  }

  /** Give a token back — used when an auth attempt succeeds. */
  refund(key: string, spec: BucketSpec): void {
    const bucket = this.buckets.get(key);
    if (bucket) bucket.tokens = Math.min(spec.capacity, bucket.tokens + 1);
  }

  /** Drop buckets that have been idle long enough to be full again. */
  private sweep(t: number): void {
    if (t - this.lastSweep < 60_000) return;
    this.lastSweep = t;
    for (const [key, bucket] of this.buckets) {
      if (t - bucket.updatedAt > 60 * 60_000) this.buckets.delete(key);
    }
  }

  /** Test seam. */
  reset(): void {
    this.buckets.clear();
  }
}

export const LIMITS = {
  auth: { capacity: 5, windowMs: 15 * 60_000 },
  /**
   * Identity *creation* per source address (D3 §3). Not applied through
   * `limit()`: minting happens before `req.identity` exists, so there is no
   * identity key to pair with the address, and `identityMiddleware` consumes
   * this one directly.
   *
   * 300 a quarter hour is set by the NAT case — a venue's whole wifi is one
   * address, and 300 first-ever visits in the quarter hour before a keynote
   * is a real morning.
   */
  mint: { capacity: 300, windowMs: 15 * 60_000 },
  contribution: { capacity: 10, windowMs: 60_000 },
  session: { capacity: 12, windowMs: 60_000 },
  write: { capacity: 30, windowMs: 60_000 },
  read: { capacity: 300, windowMs: 60_000 },
} as const satisfies Record<string, BucketSpec>;

export type LimitName = keyof typeof LIMITS;

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** The two buckets a request must pass: its identity and its source IP. */
export function keysFor(name: LimitName, req: Request): string[] {
  return [`${name}:id:${req.identity.id}`, `${name}:ip:${clientIp(req)}`];
}

/** Express middleware applying one named limit to both the identity and the IP. */
export function limit(limiter: RateLimiter, name: LimitName) {
  const spec = LIMITS[name];
  return (req: Request, res: Response, next: NextFunction): void => {
    const keys = keysFor(name, req);
    let retryAfter = 0;
    for (const key of keys) retryAfter = Math.max(retryAfter, limiter.consume(key, spec));
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      next(new HttpError(429, 'rate_limited', 'Too many requests — slow down a moment'));
      return;
    }
    next();
  };
}
