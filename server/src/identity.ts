import { randomInt } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Db, IdentityRow } from './db.js';
import { clientIp, LIMITS, type RateLimiter } from './ratelimit.js';

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export const COOKIE_NAME = 'cid';
const TOKEN_LENGTH = 22;
/** Cookie lifetime: long enough that an attendee keeps their name all conference. */
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

function randomString(length: number, alphabet: string): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export const newIdentityToken = (): string => randomString(TOKEN_LENGTH, BASE62);

const HEX = '0123456789abcdef';
export const PUBLIC_ID_LENGTH = 5;

/**
 * The "UID" admins see beside a name. Random hex rather than the row id, so
 * that knowing one UID reveals nothing about how many identities exist or
 * what the others are. Five hex chars is ~1M values — collisions stay rare at
 * any plausible instance size, and the loop absorbs the ones that do happen.
 */
export function newPublicId(db: Db): string {
  const exists = db.prepare<[string], { found: number }>(
    'SELECT 1 AS found FROM identities WHERE public_id = ?',
  );
  for (;;) {
    const candidate = randomString(PUBLIC_ID_LENGTH, HEX);
    if (!exists.get(candidate)) return candidate;
  }
}

/** One place for the cookie's attributes: minting on first contact and
 *  adopting another device's identity must set exactly the same cookie. */
export function setIdentityCookie(res: Response, token: string, isProd: boolean): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      identity: IdentityRow;
    }
  }
}

export function findIdentityByToken(db: Db, token: string): IdentityRow | undefined {
  return db.prepare<[string], IdentityRow>('SELECT * FROM identities WHERE token = ?').get(token);
}

/**
 * The identity a request gets when it has no valid cookie *and* its address
 * has spent the `mint` budget (D3 §3). Row id 0 exists in no table, so it
 * holds no role anywhere and can be granted none; `requireRole` and the gate
 * turn it into `429 too_many_identities`. Public reads that need no identity
 * — `/api/me`, the landing page's event list — still work.
 *
 * A sentinel rather than a thrown error because the limit is on *creating* a
 * row, not on making a request: an address over the budget should still be
 * able to read, and a returning visitor with a cookie is never affected.
 */
export const ANONYMOUS_IDENTITY: IdentityRow = Object.freeze({
  id: 0,
  public_id: '00000',
  token: '',
  display_name: '',
  created_at: '1970-01-01T00:00:00.000Z',
  last_seen_at: null,
  ics_token: null,
});

/** Whether this request never got an identity of its own (see above). */
export const isAnonymous = (identity: IdentityRow): boolean => identity.id === 0;

/**
 * Resolves `req.identity` from the signed `cid` cookie, minting a new anonymous
 * identity (and setting the cookie) on first contact. Runs before everything
 * else so even rate-limit rejections are attributable.
 *
 * Minting is budgeted per source address, because it is the one write any
 * stranger can make: without the budget a `curl` loop is an unbounded
 * `INSERT`, and the identity half of every other bucket is decorative, since
 * an attacker simply never sends a cookie.
 */
export function identityMiddleware(db: Db, isProd: boolean, limiter: RateLimiter) {
  const insert = db.prepare(
    'INSERT INTO identities (public_id, token, display_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  );
  const touch = db.prepare('UPDATE identities SET last_seen_at = ? WHERE id = ?');

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = new Date().toISOString();
    // `false` is what cookie-parser puts here when the signature does not
    // verify — a tampered cookie, or one signed with a previous secret. Both
    // mean "no identity", so the falsy test below is the whole check.
    const cookieToken = req.signedCookies?.[COOKIE_NAME] as string | false | undefined;

    let identity = cookieToken ? findIdentityByToken(db, cookieToken) : undefined;

    if (!identity) {
      if (limiter.consume(`mint:ip:${clientIp(req)}`, LIMITS.mint) > 0) {
        req.identity = ANONYMOUS_IDENTITY;
        next();
        return;
      }
      const token = newIdentityToken();
      const publicId = newPublicId(db);
      // No seed name: a username is typed at the first gate, never handed
      // out. The column follows the last name chosen, for the next gate.
      const info = insert.run(publicId, token, '', now, now);
      identity = {
        id: Number(info.lastInsertRowid),
        public_id: publicId,
        token,
        display_name: '',
        created_at: now,
        last_seen_at: now,
        ics_token: null,
      };
      setIdentityCookie(res, token, isProd);
    } else if (
      identity.last_seen_at === null ||
      identity.last_seen_at.slice(0, 16) !== now.slice(0, 16)
    ) {
      // Throttle the write to once a minute — this runs on every request.
      touch.run(now, identity.id);
      identity.last_seen_at = now;
    }

    req.identity = identity;
    next();
  };
}
