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
 * (D3 §1a, chosen 2026-09-09).
 *
 * Five attempts cost nothing at all, because the common case is a person
 * mistyping a four-word phrase they were given, and making them wait for that
 * is a worse failure than the one being defended against. The sixth costs two
 * minutes, five more cost nothing, and the eleventh costs a quarter of an
 * hour, as does every failure after it.
 *
 * Doubling from one second was the earlier proposal. It was rejected
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
 * which would have silently overridden the waits above.
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

  /** Record a failure and set how long this address now waits. */
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

  /** Forget every visitor's failures at one event (see `clearEventLimits`). */
  clearEvent(eventId: number): void {
    const prefix = `${eventId}:`;
    for (const key of this.failures.keys()) {
      if (key.startsWith(prefix)) this.failures.delete(key);
    }
  }

  reset(): void {
    this.failures.clear();
  }
}

/**
 * Failures an event tolerates in a sliding hour before its login closes, and
 * the number of *distinct addresses* they must come from.
 *
 * The distinct-address requirement is the whole point (added 2026-09-09).
 * Without it, one person from a single address could fail sixty times in a
 * script and stop an event accepting any new sign-in for a quarter of an
 * hour, repeatedly. That is a denial of service, and cheaper to mount than
 * the guessing it defends against. A single address is already handled by its own wait, so requiring the
 * failures to come from several addresses loses nothing and is what a
 * distributed attack looks like.
 */
export const LOGIN_FAILURES_PER_HOUR = 60;
export const LOGIN_DISTINCT_ADDRESSES = 10;
/** How long it stays closed to people who are not already in. */
export const LOGIN_CLOSED_MS = 15 * 60_000;

/**
 * Failures from one address at one event, across every cookie it presents.
 *
 * The waits above are keyed on the visitor as well as the address, so several
 * hundred people behind one shared address do not share five attempts. That alone would let
 * an attacker throw the cookie away between guesses and get five more every
 * time, which is why this exists: whatever cookie they present, the address
 * gets this many failures an hour and then waits.
 *
 * Sized for a shared address, not for one person. Several hundred people
 * signing in at once from one address produce a burst of mistyped passwords,
 * and that must not lock all of them out.
 */
export const ADDRESS_FAILURES_PER_HOUR = 300;

/**
 * A sliding-hour count of failures, with a block once a threshold is passed
 * (D3 §1b). Used twice: per event, where a closure needs failures from many
 * addresses, and per address, where it does not.
 */
export class Tally {
  private readonly rows = new Map<
    string,
    { at: number[]; sources: string[]; blockedUntil: number }
  >();

  constructor(private readonly now: () => number = Date.now) {}

  /** Seconds until this key is usable again, or 0. */
  blockedFor(key: string): number {
    const t = this.now();
    const entry = this.rows.get(key);
    if (!entry || entry.blockedUntil <= t) return 0;
    return Math.ceil((entry.blockedUntil - t) / 1000);
  }

  /**
   * Record a failure. `source` is what the distinct count is over — the
   * address, for an event. Returns the failure count when this one caused
   * the block, and 0 otherwise, so the caller writes exactly one audit row.
   */
  fail(
    key: string,
    options: { threshold: number; blockMs: number; source?: string; distinctSources?: number },
  ): number {
    const t = this.now();
    const entry = this.rows.get(key) ?? { at: [], sources: [], blockedUntil: 0 };
    const keep = (_: unknown, i: number): boolean => t - entry.at[i] < 60 * 60_000;
    entry.sources = entry.sources.filter(keep);
    entry.at = entry.at.filter((when) => t - when < 60 * 60_000);
    entry.at.push(t);
    entry.sources.push(options.source ?? '');
    this.rows.set(key, entry);

    if (entry.at.length < options.threshold || entry.blockedUntil > t) return 0;
    if (
      options.distinctSources !== undefined &&
      new Set(entry.sources).size < options.distinctSources
    ) {
      return 0;
    }
    entry.blockedUntil = t + options.blockMs;
    return entry.at.length;
  }

  /** How many failures this key has seen in the last hour. */
  recentFailures(key: string): number {
    const t = this.now();
    const entry = this.rows.get(key);
    if (!entry) return 0;
    return entry.at.filter((when) => t - when < 60 * 60_000).length;
  }

  /** How many distinct sources those failures came from. */
  recentSources(key: string): number {
    const t = this.now();
    const entry = this.rows.get(key);
    if (!entry) return 0;
    return new Set(entry.sources.filter((_, i) => t - entry.at[i] < 60 * 60_000)).size;
  }

  /** Forget every row whose key starts with this (see `clearEventLimits`). */
  clearPrefix(prefix: string): void {
    for (const key of this.rows.keys()) {
      if (key.startsWith(prefix)) this.rows.delete(key);
    }
  }

  reset(): void {
    this.rows.clear();
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
   * 300 a quarter hour is set by the shared-address case: behind NAT, every
   * device on one network presents the same address, and 300 first-time
   * visitors in a quarter hour is an ordinary morning for one event.
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

/**
 * Forget everything counted against one event: every visitor's waits, every
 * address's failures, and the stop on new sign-ins.
 *
 * Called when an organiser changes a password, and from the reset action
 * beside the notice. Changing the password is exactly what the notice tells
 * an organiser to do when attempts are failing, and it is the moment when
 * everybody holding the old one has just failed: leaving them to wait two or
 * fifteen minutes after the fix has been applied would make the advice worse
 * than useless. The counts protect a password that no longer exists.
 */
export function clearEventLimits(ctx: { backoff: Backoff; tally: Tally }, eventId: number): void {
  ctx.backoff.clearEvent(eventId);
  ctx.tally.clearPrefix(`address:${eventId}:`);
  ctx.tally.clearPrefix(`event:${eventId}`);
}
