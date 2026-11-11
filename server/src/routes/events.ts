import { Router } from 'express';
import type { EventRow } from '../db.js';
import { getEventBySlug, requireInstanceKey, hashPassword, setRole } from '../auth.js';
import { audit, initialFields } from '../audit.js';
import { isDemoEvent } from '../config.js';
import type { Ctx } from '../context.js';
import { conflict } from '../errors.js';
import { CREATION_FIELDS, settingsReading, toEventSummary } from '../mappers.js';
import { limit } from '../ratelimit.js';
import { createEventSchema, parse } from '../validation.js';
import { resolveEventPasswords } from '../eventPasswords.js';

export function eventRoutes(ctx: Ctx): Router {
  const router = Router();

  // Public: enough to render the landing page. No schedule data.
  router.get('/events', (_req, res) => {
    const rows = ctx.db
      .prepare<[], EventRow>('SELECT * FROM events ORDER BY start_date DESC, name ASC')
      .all();
    res.json(rows.map(toEventSummary));
  });

  router.post('/events', requireInstanceKey(ctx), limit(ctx.limiter, 'write'), (req, res) => {
    const body = parse(createEventSchema, req.body);
    if (getEventBySlug(ctx.db, body.slug))
      throw conflict('That slug is already taken', 'slug_taken');

    // Blank password fields are filled in, not rejected; `generated` is the
    // subset this instance invented, which the creator is shown once.
    const { passwords, generated } = resolveEventPasswords(
      body,
      isDemoEvent(ctx.config, body.slug),
    );

    const now = new Date().toISOString();
    const info = ctx.db
      .prepare(
        `INSERT INTO events
          (slug, name, timezone, start_date, end_date, day_start_min, day_end_min,
           viewer_pw_hash, user_pw_hash, admin_pw_hash, archived, user_role_label,
           default_view, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
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
        // `createEventSchema` has always taken this; the column list did not,
        // so the row took migration 008's default and the caller got a 201 for
        // a setting that never landed.
        body.defaultView ?? 'list',
        now,
      );

    const eventId = Number(info.lastInsertRowid);
    // The creator walks straight into their new event as its admin.
    setRole(ctx.db, req.identity.id, eventId, 'admin');
    const row = ctx.db
      .prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?')
      .get(eventId) as EventRow;
    // The line names what the event started as. Its label is looked up at
    // read time, so after a rename this is the only place the first name is.
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId,
      action: 'create',
      entity: 'event',
      entityId: eventId,
      changes: initialFields(CREATION_FIELDS, settingsReading(row)),
    });
    // The only time these leave the server: they are hashed on the way in and
    // unrecoverable afterwards, so the creator has to see them now or never.
    res.status(201).json({ ...toEventSummary(row), generatedPasswords: generated });
  });

  return router;
}
