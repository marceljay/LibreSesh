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

/** Free attempts before the first block, and again before the second. */
export const LOGIN_FREE_ATTEMPTS = 5;
/** The first block, once the free attempts are spent. */
export const LOGIN_FIRST_BLOCK_S = 120;
/** The second, and every block after it. */
export const LOGIN_LONG_BLOCK_S = 900;

/**
 * How long this address waits after its nth failed password at one event
 * (D3 §1a, curve chosen 2026-09-09).
 *
 * Five attempts cost nothing at all, because the common case is a person
 * misreading a four-word phrase off a slide, and making them wait for that is
 * a worse failure than the one being defended against. The sixth costs two
 * minutes, five more cost nothing, and the eleventh costs a quarter of an
 * hour, as does every failure after it.
 *
 * A doubling curve from one second was the earlier proposal. It was rejected
 * as too fussy at the top of the range — the difference between one second
 * and four is noise to a person and to an attacker alike, so the whole ramp
 * bought nothing that the two flat steps do not.
 */
export function loginBlockSeconds(failures: number): number {
  if (failures < LOGIN_FREE_ATTEMPTS) return 0;
  if (failures === LOGIN_FREE_ATTEMPTS) return LOGIN_FIRST_BLOCK_S;
  if (failures < LOGIN_FREE_ATTEMPTS * 2) return 0;
  return LOGIN_LONG_BLOCK_S;
}

/**
 * Per-address backoff on failed password attempts at one event (D3 §1a).
 *
 * Keyed on the pair, so an attacker cannot spend one event's patience on
 * another, and a correct password forgets everything that came before it.
 * This is the *only* limit on the login route: the token bucket that used to
 * sit there imposed three minutes at the sixth attempt whatever this said,
 * which would have silently overridden the curve above.
 */
export class Backoff {
  private readonly failures = new Map<string, { count: number; notBefore: number }>();
  private lastSweep = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds still to wait, or 0. */
  check(key: string): number {
    const t = this.now();
    this.sweep(t);
    const entry = this.failures.get(key);
    if (!entry || entry.notBefore <= t) return 0;
    return Math.ceil((entry.notBefore - t) / 1000);
  }

  /** Record a failure and apply the curve. */
  fail(key: string): void {
    const t = this.now();
    const entry = this.failures.get(key) ?? { count: 0, notBefore: 0 };
    entry.count += 1;
    entry.notBefore = t + loginBlockSeconds(entry.count) * 1000;
    this.failures.set(key, entry);
  }

  /** A correct password forgets the misses that came before it. */
  succeed(key: string): void {
    this.failures.delete(key);
  }

  /**
   * Entries are dropped an hour after their block ended. A count is kept that
   * long on purpose: the second five attempts are only meaningful if the
   * first five are still remembered when the block lifts.
   */
  private sweep(t: number): void {
    if (t - this.lastSweep < 60_000) return;
    this.lastSweep = t;
    for (const [key, entry] of this.failures) {
      if (t - entry.notBefore > 60 * 60_000) this.failures.delete(key);
    }
  }

  reset(): void {
    this.failures.clear();
  }
}

/** Failures an event tolerates in a sliding hour before its login closes. */
export const LOGIN_FAILURES_PER_HOUR = 60;
/** How long it stays closed to people who are not already in. */
export const LOGIN_CLOSED_MS = 15 * 60_000;

/**
 * Failed attempts against one event from *every* source (D3 §1b).
 *
 * Per-address limits do nothing against a hundred addresses, which a cheap
 * proxy list buys. Counting per target does: past the threshold the login
 * closes to new entrants for a quarter of an hour, no password is checked
 * (so no bcrypt is spent on an attacker), and everyone already holding a
 * role is untouched — the schedule stays up, only the door shuts.
 *
 * The worst a hostile can do with this is keep a door shut a quarter hour at
 * a time, which is loud: the organiser is told, and it is in the audit log.
 */
export class Tally {
  private readonly events = new Map<number, { at: number[]; closedUntil: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds until the login reopens, or 0 when it is open. */
  closedFor(eventId: number): number {
    const t = this.now();
    const entry = this.events.get(eventId);
    if (!entry || entry.closedUntil <= t) return 0;
    return Math.ceil((entry.closedUntil - t) / 1000);
  }

  /**
   * Record a failure. Returns the count in the last hour when this one closed
   * the login, and 0 otherwise — so the caller writes exactly one audit row
   * per closure.
   */
  fail(eventId: number): number {
    const t = this.now();
    const entry = this.events.get(eventId) ?? { at: [], closedUntil: 0 };
    entry.at = entry.at.filter((when) => t - when < 60 * 60_000);
    entry.at.push(t);
    this.events.set(eventId, entry);
    if (entry.at.length < LOGIN_FAILURES_PER_HOUR || entry.closedUntil > t) return 0;
    entry.closedUntil = t + LOGIN_CLOSED_MS;
    return entry.at.length;
  }

  /** How many failures this event has seen in the last hour. */
  recentFailures(eventId: number): number {
    const t = this.now();
    const entry = this.events.get(eventId);
    if (!entry) return 0;
    entry.at = entry.at.filter((when) => t - when < 60 * 60_000);
    return entry.at.length;
  }

  reset(): void {
    this.events.clear();
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
