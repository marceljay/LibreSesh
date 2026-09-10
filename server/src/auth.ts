import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role } from './shared/types.js';
import type { Config } from './config.js';
import type { Db, EventRow } from './db.js';
import { conflict, forbidden, notFound, tooManyRequests, unauthorized } from './errors.js';
import { keysFor, LIMITS, type RateLimiter } from './ratelimit.js';
import { audit } from './audit.js';
import { isAnonymous } from './identity.js';

/** Cost 10 is right at this scale; tests lower it so suites stay fast. */
export const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 10);

const RANK: Record<Role, number> = { viewer: 1, user: 2, speaker: 3, admin: 4 };

export const atLeast = (role: Role, min: Role): boolean => RANK[role] >= RANK[min];

export const hashPassword = (plain: string): string => bcrypt.hashSync(plain, BCRYPT_COST);

/**
 * The counterpart, so bcrypt is named in one module and nowhere else.
 *
 * Every event password on every existing instance is a stored hash that
 * nothing re-hashes, so "can this still read a hash written by an older
 * release?" is the only question a bcrypt upgrade has to answer — and it is
 * answerable in one place because of this.
 */
export const verifyPassword = (plain: string, hash: string): boolean =>
  bcrypt.compareSync(plain, hash);

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Instance-level operations — creating an event, downloading the whole
 * database — are gated by one shared env password sent as `X-Instance-Key`.
 * It is not a role: nobody earns it by being an admin somewhere.
 */
export function hasInstanceKey(config: Config, header: unknown): boolean {
  return typeof header === 'string' && constantTimeEquals(header, config.instanceAdminPassword);
}

/**
 * One attempt at the instance password, rate-limited and audited (D3 §2).
 *
 * Before this existed the four call sites compared the header inline and sat
 * behind the `write` rate limit, which allows 43,000 guesses a day per address
 * against a single shared password. Here the `auth` rate limit applies — five
 * wrong keys in a quarter hour — a success refunds its token so a working
 * client is never throttled by its own use, and a failure leaves an audit row
 * with no event id, because the instance is what was attacked, not an event.
 *
 * Throws `429` when that limit is spent. Returns whether the key was right;
 * the caller decides what a wrong one means, which is why this is not always
 * middleware: cloning accepts *either* the event's admin or the key.
 */
export function tryInstanceKey(
  ctx: { db: Db; config: Config; limiter: RateLimiter },
  req: Request,
  res: Response,
): boolean {
  const keys = keysFor('auth', req);
  let retryAfter = 0;
  for (const key of keys) retryAfter = Math.max(retryAfter, ctx.limiter.consume(key, LIMITS.auth));
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter));
    throw tooManyRequests('Too many attempts with the instance password — wait a moment');
  }
  if (!hasInstanceKey(ctx.config, req.get('X-Instance-Key'))) {
    audit(ctx.db, {
      identityId: isAnonymous(req.identity) ? null : req.identity.id,
      eventId: null,
      action: 'instance_key_failed',
      entity: 'instance',
      entityId: null,
    });
    return false;
  }
  for (const key of keys) ctx.limiter.refund(key, LIMITS.auth);
  return true;
}

/**
 * The login page on an operation the instance password alone opens: creating an
 * event, importing one, taking a whole-database backup. Middleware rather
 * than a helper so the rate limit cannot be forgotten at a new call site.
 */
export function requireInstanceKey(ctx: { db: Db; config: Config; limiter: RateLimiter }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!tryInstanceKey(ctx, req, res)) {
        next(forbidden('Wrong instance password'));
        return;
      }
    } catch (err) {
      next(err);
      return;
    }
    next();
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      event: EventRow;
      role: Role;
    }
  }
}

/**
 * The event this slug names — its current one, or any it has been renamed
 * away from.
 *
 * The fallback is what makes a rename safe: an old link is not a redirect the
 * browser has to follow, it simply still works, so the invite URL on a badge,
 * a subscribed calendar feed and an API caller written against the old name
 * all keep answering. The web app rewrites the address bar to the current slug
 * when it notices the difference; nothing here depends on it doing so.
 */
export function getEventBySlug(db: Db, slug: string): EventRow | undefined {
  const own = db.prepare<[string], EventRow>('SELECT * FROM events WHERE slug = ?').get(slug);
  if (own) return own;
  return db
    .prepare<[string], EventRow>(
      `SELECT e.* FROM events e
         JOIN event_slugs a ON a.event_id = e.id
        WHERE a.slug = ?`,
    )
    .get(slug);
}

export function getRole(db: Db, identityId: number, eventId: number): Role | undefined {
  const row = db
    .prepare<[number, number], { role: Role }>(
      'SELECT role FROM roles WHERE identity_id = ? AND event_id = ?',
    )
    .get(identityId, eventId);
  return row?.role;
}

export function setRole(db: Db, identityId: number, eventId: number, role: Role): void {
  db.prepare(
    `INSERT INTO roles (identity_id, event_id, role, granted_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(identity_id, event_id) DO UPDATE SET role = excluded.role, granted_at = excluded.granted_at`,
  ).run(identityId, eventId, role, new Date().toISOString());
}

export function clearRole(db: Db, identityId: number, eventId: number): void {
  db.prepare('DELETE FROM roles WHERE identity_id = ? AND event_id = ?').run(identityId, eventId);
}

/**
 * Check a submitted password against the event's three hashes, highest first,
 * so entering the admin password grants admin even if two passwords match.
 * Returns the granted role, or undefined on no match.
 */
export function roleForPassword(event: EventRow, password: string): Role | undefined {
  if (verifyPassword(password, event.admin_pw_hash)) return 'admin';
  if (verifyPassword(password, event.user_pw_hash)) return 'user';
  if (verifyPassword(password, event.viewer_pw_hash)) return 'viewer';
  return undefined;
}

/**
 * One path segment, as a string.
 *
 * Express 5 routes through path-to-regexp 8, where a pattern can repeat a
 * parameter, so `req.params.x` is typed `string | string[]`. None of ours
 * repeat — every route is `:id` or `:slug`, one segment each — but the type is
 * honest about what the router can express, so the narrowing has to be too.
 * An array here would mean a route pattern changed underneath this; taking the
 * first value keeps that a 404 rather than a crash.
 */
export const pathParam = (req: Request, name: string): string => {
  const raw: string | string[] | undefined = req.params[name];
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
};

/** Resolve `:slug` into `req.event`. */
export function loadEvent(db: Db) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const event = getEventBySlug(db, pathParam(req, 'slug'));
    if (!event) {
      next(notFound('No such event'));
      return;
    }
    req.event = event;
    next();
  };
}

/** Require at least `min` on `req.event`; 401 when no role at all. */
export function requireRole(db: Db, min: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Over the limit on minting: no row was created, so there is no role to find
    // and never will be. Say so, rather than sending them to a login page that
    // cannot let them in.
    if (isAnonymous(req.identity)) {
      next(
        tooManyRequests(
          'Too many new visitors from this address — try again in a few minutes',
          'too_many_identities',
        ),
      );
      return;
    }
    const role = getRole(db, req.identity.id, req.event.id);
    if (!role) {
      next(unauthorized());
      return;
    }
    req.role = role;
    if (!atLeast(role, min)) {
      next(forbidden());
      return;
    }
    next();
  };
}

/** Block writes to an archived event (SPEC §3.3). */
export function requireWritable(req: Request, _res: Response, next: NextFunction): void {
  if (req.event.archived) {
    next(conflict('This event is archived and read-only', 'archived'));
    return;
  }
  next();
}
