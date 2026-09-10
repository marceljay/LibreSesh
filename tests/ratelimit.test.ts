import { describe, expect, it } from 'vitest';
import { addressSpec, LIMITS, RateLimiter } from '../server/src/ratelimit.js';

describe('RateLimiter', () => {
  const spec = { capacity: 3, windowMs: 60_000 };

  it('allows up to capacity, then rejects with a wait', () => {
    const limiter = new RateLimiter();
    expect(limiter.consume('k', spec)).toBe(0);
    expect(limiter.consume('k', spec)).toBe(0);
    expect(limiter.consume('k', spec)).toBe(0);
    expect(limiter.consume('k', spec)).toBeGreaterThan(0);
  });

  it('keeps buckets separate per key', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) limiter.consume('a', spec);
    expect(limiter.consume('a', spec)).toBeGreaterThan(0);
    expect(limiter.consume('b', spec)).toBe(0);
  });

  it('refills over time', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) limiter.consume('k', spec);
    expect(limiter.consume('k', spec)).toBeGreaterThan(0);

    // A third of the window restores exactly one token.
    now += 20_000;
    expect(limiter.consume('k', spec)).toBe(0);
    expect(limiter.consume('k', spec)).toBeGreaterThan(0);
  });

  it('never refills past capacity', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    limiter.consume('k', spec);
    now += 10 * 60_000;
    for (let i = 0; i < 3; i++) expect(limiter.consume('k', spec)).toBe(0);
    expect(limiter.consume('k', spec)).toBeGreaterThan(0);
  });

  it('refunds a token without exceeding capacity', () => {
    const limiter = new RateLimiter();
    limiter.consume('k', spec);
    limiter.refund('k', spec);
    limiter.refund('k', spec);
    for (let i = 0; i < 3; i++) expect(limiter.consume('k', spec)).toBe(0);
    expect(limiter.consume('k', spec)).toBeGreaterThan(0);
  });

  it('reports a retry-after that actually covers the wait', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) limiter.consume('k', spec);
    const wait = limiter.consume('k', spec);
    now += wait * 1000;
    expect(limiter.consume('k', spec)).toBe(0);
  });

  it('matches the limits the spec asks for', () => {
    expect(LIMITS.auth).toEqual({ capacity: 5, windowMs: 15 * 60_000 });
    expect(LIMITS.contribution.capacity).toBe(10);
    expect(LIMITS.session.capacity).toBe(12);
    expect(LIMITS.write.capacity).toBe(30);
    expect(LIMITS.read.capacity).toBe(300);
  });

  it('gives an address a room-sized bucket, over the same window', () => {
    for (const name of ['contribution', 'session', 'write', 'read'] as const) {
      expect(addressSpec(name)).toEqual({
        capacity: LIMITS[name].capacity * 100,
        windowMs: LIMITS[name].windowMs,
      });
    }
  });

  it('leaves the buckets that meter a secret at their personal size', () => {
    expect(addressSpec('auth')).toEqual(LIMITS.auth);
    expect(addressSpec('mint')).toEqual(LIMITS.mint);
  });
});
