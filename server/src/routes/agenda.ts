import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { getRole, requireRole } from '../auth.js';
import type { Ctx } from '../context.js';
import type { EventRow, IdentityRow, RoomRow, SessionRow } from '../db.js';
import { unauthorized } from '../errors.js';
import { buildCalendar, type IcsEvent } from '../ical.js';
import { requireCapability } from '../permissions.js';
import { limit } from '../ratelimit.js';
import { speakersBySession } from '../mappers.js';
import { getSession } from '../sessionRules.js';

/**
 * Personal agenda: starring sessions, and the iCal feed built from either the
 * whole schedule or just your stars. Stars are private to one identity, so
 * nothing here is broadcast over SSE.
 */
export function agendaRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  // Starring is a personal bookmark, not event content, so it stays available
  // even after an event is archived.
  const star = [requireCapability(ctx.db, 'session.star'), limit(ctx.limiter, 'write')];

  router.put('/sessions/:id/star', ...star, (req, res) => {
    const session = getSession(ctx.db, req.event.id, Number(req.params.id));
    ctx.db
      .prepare(
        `INSERT INTO stars (identity_id, session_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT(identity_id, session_id) DO NOTHING`,
      )
      .run(req.identity.id, session.id, new Date().toISOString());
    res.status(204).end();
  });

  router.delete('/sessions/:id/star', ...star, (req, res) => {
    ctx.db
      .prepare('DELETE FROM stars WHERE identity_id = ? AND session_id = ?')
      .run(req.identity.id, Number(req.params.id));
    res.status(204).end();
  });

  /** Mint (once) and return this identity's calendar subscription token. */
  router.post(
    '/calendar-token',
    requireRole(ctx.db, 'viewer'),
    limit(ctx.limiter, 'write'),
    (req, res) => {
      let token = req.identity.ics_token;
      if (!token) {
        token = randomBytes(24).toString('base64url');
        ctx.db.prepare('UPDATE identities SET ics_token = ? WHERE id = ?').run(
          token,
          req.identity.id,
        );
      }
      res.json({ token });
    },
  );

  return router;
}

/**
 * The calendar feed, mounted BEFORE the viewer-role gate: a subscribing
 * calendar app has no cookie, and `?token=` is what stands in for one.
 */
export function calendarRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  router.get('/calendar.ics', limit(ctx.limiter, 'read'), (req, res) => {
    const event: EventRow = req.event;
    const rawToken = req.query.token;
    let identityId: number | undefined;

    if (typeof rawToken === 'string' && rawToken !== '') {
      const owner = ctx.db
        .prepare<[string], IdentityRow>('SELECT * FROM identities WHERE ics_token = ?')
        .get(rawToken);
      // A token only grants what its owner's role already allows.
      if (owner && getRole(ctx.db, owner.id, event.id)) identityId = owner.id;
    } else if (getRole(ctx.db, req.identity.id, event.id)) {
      identityId = req.identity.id;
    }
    if (identityId === undefined) throw unauthorized('This calendar needs the event password');

    const mine = req.query.mine === '1';
    const sessions = mine
      ? ctx.db
          .prepare<[number, number], SessionRow>(
            `SELECT s.* FROM sessions s
               JOIN stars st ON st.session_id = s.id
              WHERE s.event_id = ? AND st.identity_id = ? AND s.deleted_at IS NULL
              ORDER BY s.starts_at`,
          )
          .all(event.id, identityId)
      : ctx.db
          .prepare<[number], SessionRow>(
            'SELECT * FROM sessions WHERE event_id = ? AND deleted_at IS NULL ORDER BY starts_at',
          )
          .all(event.id);

    const rooms = new Map(
      ctx.db
        .prepare<[number], RoomRow>('SELECT * FROM rooms WHERE event_id = ?')
        .all(event.id)
        .map((r) => [r.id, r.name]),
    );
    const speakers = speakersBySession(
      ctx.db,
      sessions.map((s) => s.id),
    );
    const tagsBySession = new Map<number, string[]>();
    for (const row of ctx.db
      .prepare<[number], { session_id: number; name: string }>(
        `SELECT st.session_id AS session_id, t.name AS name
           FROM session_tags st JOIN tags t ON t.id = st.tag_id
          WHERE t.event_id = ? AND t.deleted_at IS NULL`,
      )
      .all(event.id)) {
      const list = tagsBySession.get(row.session_id);
      if (list) list.push(row.name);
      else tagsBySession.set(row.session_id, [row.name]);
    }

    const base = `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    const events: IcsEvent[] = sessions.map((s) => {
      // "Speakers" once there are two of them, joined the way a poster would:
      // a calendar entry is read at a glance, in a notification.
      const credited = (speakers.get(s.id) ?? []).map((p) => p.name);
      const billing =
        credited.length === 0
          ? undefined
          : `${credited.length === 1 ? 'Speaker' : 'Speakers'}: ${credited.join(', ')}`;
      const description = [billing, s.description]
        .filter(Boolean)
        .join('\n\n');
      return {
        uid: `session-${s.id}@${event.slug}.libresesh`,
        startsAt: new Date(s.starts_at),
        endsAt: new Date(s.ends_at),
        summary: s.title,
        description: description || undefined,
        location: rooms.get(s.room_id),
        url: `${base}/e/${event.slug}/s/${s.id}`,
        categories: tagsBySession.get(s.id),
        lastModified: new Date(s.updated_at),
      };
    });

    const name = mine ? `${event.name} — my agenda` : event.name;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${event.slug}${mine ? '-my-agenda' : ''}.ics"`,
    );
    // Subscribers poll this; let them revalidate rather than cache hard.
    res.setHeader('Cache-Control', 'no-cache');
    res.send(buildCalendar({ name, timezone: event.timezone, events }));
  });

  return router;
}
