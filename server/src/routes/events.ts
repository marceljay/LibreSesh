import { Router } from 'express';
import type { EventRow } from '../db.js';
import { getEventBySlug, getRole, hasInstanceKey, hashPassword, setRole } from '../auth.js';
import { audit } from '../audit.js';
import { isDemoEvent } from '../config.js';
import type { Ctx } from '../context.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { toEventSummary } from '../mappers.js';
import { limit } from '../ratelimit.js';
import { cloneEventSchema, createEventSchema, parse } from '../validation.js';
import { resolveEventPasswords } from '../eventPasswords.js';

export function eventRoutes(ctx: Ctx): Router {
  const router = Router();

  // Public: enough to render the landing page. No schedule data.
  router.get('/events', limit(ctx.limiter, 'read'), (_req, res) => {
    const rows = ctx.db
      .prepare<[], EventRow>('SELECT * FROM events ORDER BY start_date DESC, name ASC')
      .all();
    res.json(rows.map(toEventSummary));
  });

  router.post('/events', limit(ctx.limiter, 'write'), (req, res) => {
    if (!hasInstanceKey(ctx.config, req.get('X-Instance-Key'))) {
      throw forbidden('Wrong instance password');
    }
    const body = parse(createEventSchema, req.body);
    if (getEventBySlug(ctx.db, body.slug)) throw conflict('That slug is already taken', 'slug_taken');

    // Blank password fields are filled in, not rejected; `generated` is the
    // subset this instance invented, which the creator is shown once.
    const { passwords, generated } = resolveEventPasswords(body, isDemoEvent(ctx.config, body.slug));

    const now = new Date().toISOString();
    const info = ctx.db
      .prepare(
        `INSERT INTO events
          (slug, name, timezone, start_date, end_date, day_start_min, day_end_min,
           viewer_pw_hash, user_pw_hash, admin_pw_hash, archived, user_role_label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        body.slug,
        body.name,
        body.timezone,
        body.startDate,
        body.endDate,
        body.dayStartMin ?? 480,
        body.dayEndMin ?? 1320,
        hashPassword(passwords.viewerPassword),
        hashPassword(passwords.userPassword),
        hashPassword(passwords.adminPassword),
        body.userRoleLabel ?? 'attendee',
        now,
      );

    const eventId = Number(info.lastInsertRowid);
    // The creator walks straight into their new event as its admin.
    setRole(ctx.db, req.identity.id, eventId, 'admin');
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId,
      action: 'create',
      entity: 'event',
      entityId: eventId,
    });

    const row = ctx.db.prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?').get(eventId);
    // The only time these leave the server: they are hashed on the way in and
    // unrecoverable afterwards, so the creator has to see them now or never.
    res.status(201).json({ ...toEventSummary(row as EventRow), generatedPasswords: generated });
  });

  /** Copy rooms and tags into a fresh event — never sessions or contributions. */
  router.post('/events/:slug/clone', limit(ctx.limiter, 'write'), (req, res) => {
    const source = getEventBySlug(ctx.db, req.params.slug ?? '');
    if (!source) throw notFound('No such event');

    const isEventAdmin = getRole(ctx.db, req.identity.id, source.id) === 'admin';
    if (!isEventAdmin && !hasInstanceKey(ctx.config, req.get('X-Instance-Key'))) {
      throw forbidden('Only this event’s admins can clone it');
    }

    const body = parse(cloneEventSchema, req.body);
    if (getEventBySlug(ctx.db, body.newSlug)) {
      throw conflict('That slug is already taken', 'slug_taken');
    }
    if (body.newSlug === source.slug) throw badRequest('Pick a different slug');

    const now = new Date().toISOString();
    const newId = ctx.db.transaction((): number => {
      const info = ctx.db
        .prepare(
          `INSERT INTO events
            (slug, name, timezone, start_date, end_date, day_start_min, day_end_min,
             week_rail_from, viewer_pw_hash, user_pw_hash, admin_pw_hash, archived,
             user_role_label, audit_keep, default_view, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          body.newSlug,
          body.newName,
          source.timezone,
          body.startDate,
          body.endDate,
          source.day_start_min,
          source.day_end_min,
          source.week_rail_from,
          hashPassword(body.viewerPassword),
          hashPassword(body.userPassword),
          hashPassword(body.adminPassword),
          source.user_role_label,
          // A retention choice is a preference about how this organiser keeps
          // records, so it carries over with the rest of the setup.
          source.audit_keep,
          // As does how the copy opens: a clone is the same event again.
          source.default_view,
          now,
        );
      const id = Number(info.lastInsertRowid);
      ctx.db
        .prepare(
          `INSERT INTO rooms (event_id, name, description, capacity, color, open_booking, sort_order)
           SELECT ?, name, description, capacity, color, open_booking, sort_order
             FROM rooms WHERE event_id = ? AND deleted_at IS NULL`,
        )
        .run(id, source.id);
      ctx.db
        .prepare(
          `INSERT INTO tags (event_id, name, color)
           SELECT ?, name, color FROM tags WHERE event_id = ? AND deleted_at IS NULL`,
        )
        .run(id, source.id);
      return id;
    })();

    setRole(ctx.db, req.identity.id, newId, 'admin');
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: newId,
      action: 'clone',
      entity: 'event',
      entityId: source.id,
    });

    const row = ctx.db.prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?').get(newId);
    res.status(201).json(toEventSummary(row as EventRow));
  });

  return router;
}
