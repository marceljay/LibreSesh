import { Router, type Request } from 'express';
import { clearRole, getRole, roleForPassword } from '../auth.js';
import { audit } from '../audit.js';
import { isDemoEvent } from '../config.js';
import type { Ctx } from '../context.js';
import { claimEventName, eventDisplayName } from '../eventIdentity.js';
import { HttpError, badRequest, forbidden } from '../errors.js';
import { requireIdentity } from '../identity.js';
import { factsFor, toPersonDto } from '../mappers.js';
import {
  adoptProfile,
  ensureOwnProfile,
  findUnclaimedNamesake,
  ownProfile,
  restoreOnEntry,
} from '../people.js';
import {
  ADDRESS_FAILURES_PER_HOUR,
  LOGIN_CLOSED_MS,
  LOGIN_DISTINCT_ADDRESSES,
  LOGIN_FAILURES_PER_HOUR,
  clientIp,
  limit,
} from '../ratelimit.js';
import type { LoginDto } from '../shared/types.js';
import { authSchema, demoAuthSchema, parse } from '../validation.js';

/**
 * Password login page for an event. Mounted before the viewer requirement, since
 * this is how a visitor earns a role in the first place.
 */
export function eventAuthRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  /**
   * Usernames are unique per event (migration 009), so entry is where one is
   * claimed, and — since everyone who enters is a person (migration 010) —
   * where the `people` row is made. Runs before the role is granted: a clash
   * must leave you outside the event, back at the login page with a name to change,
   * not inside it nameless.
   *
   * A first entry must bring a name; there is no seed to fall back on any
   * more. A device that already holds one here may omit it and keep it.
   *
   * When an organiser has typed this exact name onto a session before the
   * person arrived, there is an unclaimed profile waiting. It is not adopted
   * silently — the same name can be a different person — but offered: the
   * login page answers `profile_exists`, and re-entering with `claimProfile` takes
   * it. A profile with a speaker code is already claimed and never gets here.
   */
  /**
   * Turning up is how somebody says they are back, so entering takes their
   * profile out of the archive. Announced like any other change to it: an
   * organiser with the People list open watches the row return to it rather
   * than finding out on their next reload.
   *
   * The broadcast carries the public view. Nobody has a role here yet — this
   * runs before the login page grants one — and the organiser-only facts are not
   * this identity's to hand out anyway.
   */
  const restore = (req: Request, personId: number): void => {
    const row = restoreOnEntry(ctx.db, personId);
    if (!row) return;
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'unarchive',
      entity: 'person',
      entityId: personId,
    });
    ctx.broker.publish(
      req.event.slug,
      'person.updated',
      toPersonDto(row, req.identity.id, factsFor(ctx.db, req.event.id, personId)),
    );
  };

  const claim = (req: Request, desired?: string, claimProfile?: boolean): void => {
    const held = eventDisplayName(ctx.db, req.event.id, req.identity.id);
    const name = desired ?? held;
    if (name === undefined) throw badRequest('Pick a username to enter', 'name_required');

    const own = ownProfile(ctx.db, req.event.id, req.identity.id);
    const namesake = own ? undefined : findUnclaimedNamesake(ctx.db, req.event.id, name);
    if (namesake && !claimProfile) {
      throw new HttpError(
        409,
        'profile_exists',
        `There is a speaker profile here called “${namesake.name}”`,
        { personId: namesake.id, name: namesake.name, sessionCount: namesake.sessionCount },
      );
    }

    claimEventName(ctx.db, req.event.id, req.identity.id, name);
    if (own) {
      restore(req, own.id);
      return;
    }
    if (namesake) {
      adoptProfile(ctx.db, namesake.id, req.identity.id);
      // A shell an organiser filed away and its person then walked in under:
      // the same "they are here" that restores your own profile.
      restore(req, namesake.id);
    } else ensureOwnProfile(ctx.db, req.event.id, req.identity.id, name);
  };

  /** What this device already is here, for the login page to prefill. */
  router.get('/login', limit(ctx.limiter, 'read'), (req, res) => {
    const dto: LoginDto = {
      heldName: eventDisplayName(ctx.db, req.event.id, req.identity.id) ?? null,
    };
    res.json(dto);
  });

  const grant = (identityId: number, eventId: number, role: string): void => {
    ctx.db
      .prepare(
        `INSERT INTO roles (identity_id, event_id, role, granted_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(identity_id, event_id) DO UPDATE SET role = excluded.role, granted_at = excluded.granted_at`,
      )
      .run(identityId, eventId, role, new Date().toISOString());
  };

  router.post('/auth', requireIdentity, (req, res) => {
    // On a demo *event* the login page is a role picker, not a password prompt.
    // There is no secret to brute-force here, so no rate limiting either.
    // Scoped to the seeded fixtures: a real event on the same instance keeps
    // its passwords, which is the whole reason this is not `config.demoMode`.
    if (isDemoEvent(ctx.config, req.event.slug)) {
      const { role, displayName, claimProfile } = parse(demoAuthSchema, req.body);
      claim(req, displayName, claimProfile);
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

    // Three checks, cheapest first, before any password is compared.
    //
    // 1. Is this event's login closed? A hundred addresses defeat any per-
    //    address limit, so failures are also counted per target. While it is
    //    shut, nothing is checked and no bcrypt is spent on the attacker.
    //    Everyone already holding a role is unaffected.
    const closedFor = ctx.tally.blockedFor(`event:${req.event.id}`);
    if (closedFor > 0) {
      res.setHeader('Retry-After', String(closedFor));
      throw new HttpError(
        429,
        'login_closed',
        'Too many wrong passwords here recently — this event is not letting new people in for a few minutes',
      );
    }

    // 2. Has this *visitor* been failing at this event? Keyed on the cookie
    //    as well as the address, because a venue is one address: 200 people
    //    reading a password off a slide must not share five attempts between
    //    them, and one of them mistyping must not hold up the rest.
    //
    //    This is the only per-visitor limit here. The `auth` token bucket
    //    used to sit below it and would impose three minutes at the sixth
    //    attempt whatever the steps above said, which is a second lockout
    //    with numbers nobody chose.
    const ip = clientIp(req);
    const backoffKey = `${req.event.id}:${ip}:${req.identity.id}`;
    const waitFor = ctx.backoff.check(backoffKey);
    if (waitFor > 0) {
      res.setHeader('Retry-After', String(waitFor));
      throw new HttpError(
        429,
        'rate_limited',
        waitFor > 300
          ? 'Too many wrong passwords from here — try again in about a quarter of an hour'
          : 'Too many wrong passwords from here — try again in a couple of minutes',
      );
    }

    // 3. And has this address been failing at this event whatever cookie it
    //    presents? Keying step 2 on the cookie would otherwise be free to
    //    escape: throw the cookie away, get five more attempts. This is
    //    sized for a room rather than a person, so a burst of honest typing
    //    never reaches it.
    const addressKey = `address:${req.event.id}:${ip}`;
    const addressBlocked = ctx.tally.blockedFor(addressKey);
    if (addressBlocked > 0) {
      res.setHeader('Retry-After', String(addressBlocked));
      throw new HttpError(
        429,
        'rate_limited',
        'Too many wrong passwords from this network — try again in about a quarter of an hour',
      );
    }

    const { password, displayName, claimProfile } = parse(authSchema, req.body);
    const role = roleForPassword(req.event, password);
    if (!role) {
      ctx.backoff.fail(backoffKey);
      ctx.tally.fail(addressKey, {
        threshold: ADDRESS_FAILURES_PER_HOUR,
        blockMs: LOGIN_CLOSED_MS,
      });
      // The event closes only when the failures are spread across many
      // addresses. One person cannot shut a door on everybody: their own
      // address is already waiting, and this needs company.
      const closedAfter = ctx.tally.fail(`event:${req.event.id}`, {
        threshold: LOGIN_FAILURES_PER_HOUR,
        blockMs: LOGIN_CLOSED_MS,
        source: ip,
        distinctSources: LOGIN_DISTINCT_ADDRESSES,
      });
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'auth_failed',
        entity: 'event',
        entityId: req.event.id,
      });
      // Exactly one row per closure, carrying the count that caused it: this
      // is what the organiser's notice and the audit log read.
      if (closedAfter > 0) {
        audit(ctx.db, {
          identityId: null,
          eventId: req.event.id,
          action: 'login_closed',
          entity: 'event',
          entityId: closedAfter,
        });
      }
      throw forbidden('That password does not match');
    }

    ctx.backoff.succeed(backoffKey);
    claim(req, displayName, claimProfile);
    grant(req.identity.id, req.event.id, role);
    res.json({ role });
  });

  router.post('/logout', (req, res) => {
    if (getRole(ctx.db, req.identity.id, req.event.id)) {
      clearRole(ctx.db, req.identity.id, req.event.id);
    }
    res.status(204).end();
  });

  return router;
}
