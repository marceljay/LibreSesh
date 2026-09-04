import { Router } from 'express';
import { hasInstanceKey } from '../auth.js';
import type { Ctx } from '../context.js';
import { forbidden } from '../errors.js';
import { importEvent } from '../importEvent.js';
import { readImportDocument } from '../importDocument.js';
import { limit } from '../ratelimit.js';

/**
 * Build a new event from a JSON schedule.
 *
 * Instance-password protected, like creating an event by hand: this makes an
 * event rather than editing one, so there is no event admin to ask yet.
 *
 *   curl -X POST https://host/api/events/import \
 *     -H 'X-Instance-Key: …' -H 'Content-Type: application/json' \
 *     --data @schedule.json
 *
 * `?dryRun=1` validates and reports without writing. Do that first — the
 * document is usually transcribed rather than exported, and the difference
 * between a right one and a wrong one is invisible until something reads it.
 *
 * An event's own `export.json` is accepted too: it is translated into the
 * authoring document at the door (`importDocument.ts`), and what the
 * translation leaves behind comes back as the first warning.
 */
export function importRoutes(ctx: Ctx): Router {
  const router = Router();

  router.post('/events/import', limit(ctx.limiter, 'write'), (req, res) => {
    if (!hasInstanceKey(ctx.config, req.get('X-Instance-Key'))) {
      throw forbidden('Wrong instance password');
    }
    const { doc, warnings } = readImportDocument(req.body);
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const result = importEvent(ctx.db, ctx.config, doc, {
      actorIdentityId: req.identity.id,
      dryRun,
      warnings,
    });
    res.status(dryRun ? 200 : 201).json(result);
  });

  return router;
}
