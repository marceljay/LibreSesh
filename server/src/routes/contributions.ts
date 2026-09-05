import { Router } from 'express';
import { atLeast, requireWritable } from '../auth.js';
import { requireCapability } from '../permissions.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { ContributionRow } from '../db.js';
import { forbidden, notFound } from '../errors.js';
import { NameResolver } from '../eventIdentity.js';
import { mentionedIdentities, notify } from '../notifications.js';
import { toContributionDto } from '../mappers.js';
import { limit } from '../ratelimit.js';
import { getSession } from '../sessionRules.js';
import { contributionSchema, hiddenSchema, parse } from '../validation.js';

export function contributionRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  /** Contributions are addressed by id at event scope, so verify the row's
   *  session really belongs to this event before touching it. */
  const load = (eventId: number, id: number): ContributionRow => {
    const row = ctx.db
      .prepare<[number, number], ContributionRow>(
        `SELECT c.* FROM contributions c
           JOIN sessions s ON s.id = c.session_id
          WHERE c.id = ? AND s.event_id = ? AND c.deleted_at IS NULL`,
      )
      .get(id, eventId);
    if (!row) throw notFound('No such contribution');
    return row;
  };

  const dtoFor = (row: ContributionRow, eventId: number) =>
    toContributionDto(row, new NameResolver(ctx.db, eventId).get(row.created_by));

  router.post(
    '/sessions/:id/contributions',
    requireCapability(ctx.db, 'contribution.create'),
    requireWritable,
    limit(ctx.limiter, 'contribution'),
    (req, res) => {
      const session = getSession(ctx.db, req.event.id, Number(req.params.id));
      const body = parse(contributionSchema, req.body);
      const info = ctx.db
        .prepare(
          `INSERT INTO contributions (session_id, kind, body, url, created_by, created_at, hidden)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(
          session.id,
          body.kind,
          body.body,
          body.kind === 'link' ? (body.url ?? null) : null,
          req.identity.id,
          new Date().toISOString(),
        );
      const dto = dtoFor(load(req.event.id, Number(info.lastInsertRowid)), req.event.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'create',
        entity: 'contribution',
        entityId: dto.id,
      });
      ctx.broker.publish(req.event.slug, 'contribution.created', dto);

      // The mention parse runs here, on the server, over the same tokenizer
      // the comment renders through — so what was stored as a mention and what
      // is drawn as a link cannot disagree. The title is frozen now because an
      // edited comment must not rewrite the line that already reached someone.
      for (const identityId of mentionedIdentities(ctx.db, req.event.id, body.body)) {
        const id = notify(ctx.db, {
          eventId: req.event.id,
          identityId,
          kind: 'mention',
          subjectType: 'session',
          subjectId: session.id,
          title: `${dto.createdByName} mentioned you`,
          body: body.body,
          actorId: req.identity.id,
        });
        if (id !== null) ctx.broker.publishTo(req.event.slug, identityId, 'notification.ping', {});
      }

      res.status(201).json(dto);
    },
  );

  router.delete(
    '/contributions/:id',
    requireCapability(ctx.db, 'contribution.delete_own'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const row = load(req.event.id, Number(req.params.id));
      if (!atLeast(req.role, 'admin') && row.created_by !== req.identity.id) {
        throw forbidden('That is not yours to delete');
      }
      ctx.db
        .prepare('UPDATE contributions SET deleted_at = ? WHERE id = ?')
        .run(new Date().toISOString(), row.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'delete',
        entity: 'contribution',
        entityId: row.id,
      });
      ctx.broker.publish(req.event.slug, 'contribution.deleted', {
        id: row.id,
        sessionId: row.session_id,
      });
      res.status(204).end();
    },
  );

  router.patch(
    '/contributions/:id/hidden',
    requireCapability(ctx.db, 'contribution.moderate'),
    requireWritable,
    limit(ctx.limiter, 'write'),
    (req, res) => {
      const row = load(req.event.id, Number(req.params.id));
      const { hidden } = parse(hiddenSchema, req.body);
      ctx.db.prepare('UPDATE contributions SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, row.id);
      const dto = dtoFor(load(req.event.id, row.id), req.event.id);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: hidden ? 'hide' : 'unhide',
        entity: 'contribution',
        entityId: row.id,
      });
      ctx.broker.publish(req.event.slug, 'contribution.hidden', dto);
      res.json(dto);
    },
  );

  return router;
}
