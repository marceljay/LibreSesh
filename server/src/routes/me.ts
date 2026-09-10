import { Router } from 'express';
import type { Me, Role } from '../shared/types.js';
import { audit } from '../audit.js';
import { requireIdentity } from '../identity.js';
import type { Ctx } from '../context.js';
import { mintLinkCode, redeemLinkCode } from '../deviceLink.js';
import { claimEventName } from '../eventIdentity.js';
import { HttpError, forbidden } from '../errors.js';
import { setIdentityCookie } from '../identity.js';
import { LIMITS, keysFor, limit } from '../ratelimit.js';
import { linkPhraseSchema, parse, renameSchema } from '../validation.js';

function rolesFor(ctx: Ctx, identityId: number): Record<string, Role> {
  const rows = ctx.db
    .prepare<[number], { slug: string; role: Role }>(
      `SELECT e.slug AS slug, r.role AS role
         FROM roles r JOIN events e ON e.id = r.event_id
        WHERE r.identity_id = ?`,
    )
    .all(identityId);
  return Object.fromEntries(rows.map((r) => [r.slug, r.role]));
}

export function meRoutes(ctx: Ctx): Router {
  const router = Router();

  const me = (identity: { id: number; public_id: string }, displayName: string): Me => ({
    id: identity.id,
    uid: identity.public_id,
    displayName,
    roles: rolesFor(ctx, identity.id),
    demoMode: ctx.config.demoMode,
    demoEventSlugs: ctx.config.demoEventSlugs,
  });

  router.get('/me', limit(ctx.limiter, 'read'), (req, res) => {
    res.json(me(req.identity, req.identity.display_name));
  });

  router.patch('/me', requireIdentity, limit(ctx.limiter, 'write'), (req, res) => {
    const { displayName } = parse(renameSchema, req.body);
    ctx.db
      .prepare('UPDATE identities SET display_name = ? WHERE id = ?')
      .run(displayName, req.identity.id);
    res.json(me(req.identity, displayName));
  });

  /** Show a phrase on this device so another one can become you (SPEC §3.1
   *  follow-up; spec identity-and-people, A1). */
  router.post('/me/link-code', requireIdentity, limit(ctx.limiter, 'write'), (req, res) => {
    const code = mintLinkCode(ctx.db, req.identity.id);
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: null,
      action: 'link_mint',
      entity: 'identity',
      entityId: req.identity.id,
    });
    res.json(code);
  });

  /**
   * Redeem a phrase minted on another device: this browser's cookie is
   * repointed at that identity, and the freshly minted one it arrived with is
   * simply abandoned. Guesses share the password-attempt rate limit, and like
   * `/auth` a correct phrase refunds its token.
   */
  router.post('/me/link', (req, res) => {
    const keys = keysFor('auth', req);
    let retryAfter = 0;
    for (const key of keys) {
      retryAfter = Math.max(retryAfter, ctx.limiter.consume(key, LIMITS.auth));
    }
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpError(429, 'rate_limited', 'Too many attempts — try again later');
    }

    const { phrase } = parse(linkPhraseSchema, req.body);
    const identity = redeemLinkCode(ctx.db, phrase);
    if (!identity) {
      audit(ctx.db, {
        identityId: req.identity.id === 0 ? null : req.identity.id,
        eventId: null,
        action: 'link_failed',
        entity: 'identity',
        entityId: null,
      });
      throw forbidden('That phrase didn’t match — codes work once and expire after 10 minutes');
    }

    for (const key of keys) ctx.limiter.refund(key, LIMITS.auth);
    setIdentityCookie(res, identity.token, process.env.NODE_ENV === 'production');
    // Attributed to the adopted identity; entityId records the one left behind.
    audit(ctx.db, {
      identityId: identity.id,
      eventId: null,
      action: 'link_redeem',
      entity: 'identity',
      entityId: req.identity.id,
    });
    res.json(me(identity, identity.display_name));
  });

  return router;
}

/**
 * Renaming yourself inside one event. Names are unique per event (migration
 * 009), so this is where the collision is caught; `PATCH /me` above only moves
 * the global seed and cannot clash with anything.
 */
export function eventMeRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  router.patch('/me', requireIdentity, limit(ctx.limiter, 'write'), (req, res) => {
    const { displayName } = parse(renameSchema, req.body);
    claimEventName(ctx.db, req.event.id, req.identity.id, displayName);
    res.json({ displayName });
  });

  return router;
}
