import { Router, type Request } from 'express';
import {
  clearRole,
  getRole,
  hasInstanceKey,
  hashPassword,
  roleForPassword,
} from '../auth.js';
import { audit } from '../audit.js';
import { isDemoEvent } from '../config.js';
import type { Ctx } from '../context.js';
import { claimEventName, eventDisplayName } from '../eventIdentity.js';
import { HttpError, badRequest, forbidden } from '../errors.js';
import { newEventPassword } from '../eventPasswords.js';
import { LIMITS, keysFor, limit } from '../ratelimit.js';
import { authSchema, demoAuthSchema, parse } from '../validation.js';

/**
 * Password gate for an event. Mounted before the viewer requirement, since
 * this is how a visitor earns a role in the first place.
 */
export function eventAuthRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  /**
   * Names are unique per event (migration 009), so entry is where one is
   * claimed. Runs before the role is granted: a clash must leave you outside
   * the event, back at the gate with a name to change, not inside it nameless.
   */
  const claim = (req: Request, desired?: string): void => {
    const held = eventDisplayName(ctx.db, req.event.id, req.identity.id);
    claimEventName(
      ctx.db,
      req.event.id,
      req.identity.id,
      desired ?? held ?? req.identity.display_name,
    );
  };

  const grant = (identityId: number, eventId: number, role: string): void => {
    ctx.db
      .prepare(
        `INSERT INTO roles (identity_id, event_id, role, granted_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(identity_id, event_id) DO UPDATE SET role = excluded.role, granted_at = excluded.granted_at`,
      )
      .run(identityId, eventId, role, new Date().toISOString());
  };

  router.post('/auth', (req, res) => {
    // On a demo *event* the gate is a role picker, not a password prompt.
    // There is no secret to brute-force here, so no rate limiting either.
    // Scoped to the seeded fixtures: a real event on the same instance keeps
    // its passwords, which is the whole reason this is not `config.demoMode`.
    if (isDemoEvent(ctx.config, req.event.slug)) {
      const { role, displayName } = parse(demoAuthSchema, req.body);
      claim(req, displayName);
      grant(req.identity.id, req.event.id, role);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'auth_demo',
        entity: 'event',
        entityId: req.event.id,
      });
      res.json({ role });
      return;
    }

    // Hand-rolled instead of the `limit` middleware so a correct password can
    // refund its token — switching roles shouldn't burn the lockout budget.
    const keys = keysFor('auth', req);
    let retryAfter = 0;
    for (const key of keys) {
      retryAfter = Math.max(retryAfter, ctx.limiter.consume(key, LIMITS.auth));
    }
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      throw new HttpError(429, 'rate_limited', 'Too many password attempts — try again later');
    }

    const { password, displayName } = parse(authSchema, req.body);
    const role = roleForPassword(req.event, password);
    if (!role) {
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'auth_failed',
        entity: 'event',
        entityId: req.event.id,
      });
      throw forbidden('That password does not match');
    }

    for (const key of keys) ctx.limiter.refund(key, LIMITS.auth);
    claim(req, displayName);
    grant(req.identity.id, req.event.id, role);
    res.json({ role });
  });

  /**
   * Mint a fresh password for one role and hand it back.
   *
   * It lives here, beside `/auth`, rather than with the other settings —
   * because like `/auth` it has to be reachable by someone holding no role.
   * `app.ts` puts `requireRole(db, 'viewer')` in front of everything mounted
   * after this router, and the whole point of the instance-key path below is
   * the event where nobody has a role left.
   *
   * Two different people need this and the route serves both, because it is
   * one operation:
   *
   * - **An organiser** who has lost a password, or is deliberately rotating
   *   one after an event. Any of the three roles.
   * - **Whoever holds the instance password**, when an event has no organiser
   *   left who can sign in — the lockout that previously had no answer short
   *   of shell access to the database. Only `admin`, because that is all the
   *   recovery needs: the new organiser signs in and can reset the rest from
   *   inside. The instance key still grants no role and reads no data here; it
   *   replaces one secret and returns the replacement, which is the smallest
   *   thing that unsticks a locked-out event.
   *
   * The new password is generated rather than chosen. A reset is not the
   * moment to invent a good phrase, and generating it means the plaintext is
   * ours to keep, so the password is readable afterwards instead of being lost
   * again by the next person who closes the tab.
   */
  router.post(
    '/passwords/:role/reset',
    limit(ctx.limiter, 'auth'),
    (req, res) => {
      const role = req.params.role;
      if (role !== 'viewer' && role !== 'user' && role !== 'admin') {
        throw badRequest('No such role — expected viewer, user or admin');
      }

      const isEventAdmin = getRole(ctx.db, req.identity.id, req.event.id) === 'admin';
      const byInstanceKey =
        !isEventAdmin && hasInstanceKey(ctx.config, req.get('X-Instance-Key'));
      if (!isEventAdmin && !byInstanceKey) {
        throw forbidden('Only this event’s organisers, or the instance password, can reset a password');
      }
      if (byInstanceKey && role !== 'admin') {
        throw forbidden('The instance password resets the organiser password only');
      }

      // Distinct from the two it is not replacing, for the same reason the
      // creation form insists on it: the roles are told apart by these strings
      // alone, so a collision silently grants whichever role is higher.
      // `roleForPassword` answers "does any role already use this", which is
      // the same question — the role being replaced included, since reissuing
      // the password somebody just lost would not be a reset.
      let password = newEventPassword();
      while (roleForPassword(req.event, password)) password = newEventPassword();

      const columns = {
        viewer: ['viewer_pw_hash', 'viewer_pw_plain'],
        user: ['user_pw_hash', 'user_pw_plain'],
        admin: ['admin_pw_hash', 'admin_pw_plain'],
      }[role];
      ctx.db
        .prepare(`UPDATE events SET ${columns[0]} = ?, ${columns[1]} = ? WHERE id = ?`)
        .run(hashPassword(password), password, req.event.id);

      // Existing role rows survive on purpose — rotating a password does not
      // sign the room out mid-event (ARCHITECTURE §Security). What changes is
      // who can get in from here.
      // Which password, in the action itself: the audit row has nowhere else
      // to put it, and "a password was reset" is not the line an organiser
      // reading this back needs.
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: byInstanceKey ? 'reset_pw_instance' : `reset_pw_${role}`,
        entity: 'event',
        entityId: req.event.id,
      });
      res.json({ role, password });
    },
  );

  router.post('/logout', (req, res) => {
    if (getRole(ctx.db, req.identity.id, req.event.id)) {
      clearRole(ctx.db, req.identity.id, req.event.id);
    }
    res.status(204).end();
  });

  return router;
}
