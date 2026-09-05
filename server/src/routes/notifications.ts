import { Router } from 'express';
import type { Ctx } from '../context.js';
import {
  listNotifications,
  markAllRead,
  mutedKinds,
  setMuted,
  unreadCount,
} from '../notifications.js';
import type { InboxDto } from '../shared/types.js';
import { muteSchema, parse } from '../validation.js';

/**
 * One person's inbox for one event. No role check beyond the event gate: rows
 * are selected by `identity_id`, so the query cannot return anyone else's, and
 * a viewer can be mentioned as easily as an organiser.
 */
export function notificationRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  const inbox = (eventId: number, identityId: number): InboxDto => ({
    items: listNotifications(ctx.db, eventId, identityId),
    unread: unreadCount(ctx.db, eventId, identityId),
    muted: mutedKinds(ctx.db, eventId, identityId),
  });

  router.get('/notifications', (req, res) => {
    res.json(inbox(req.event.id, req.identity.id));
  });

  /** Opening the panel is the read — see `markAllRead`. Returns the inbox it
   *  just marked, so the client needs one round trip rather than two. */
  router.post('/notifications/read', (req, res) => {
    markAllRead(ctx.db, req.event.id, req.identity.id);
    res.json(inbox(req.event.id, req.identity.id));
  });

  router.patch('/notifications/mutes', (req, res) => {
    const body = parse(muteSchema, req.body);
    setMuted(ctx.db, req.event.id, req.identity.id, body.kind, body.muted);
    res.json(inbox(req.event.id, req.identity.id));
  });

  return router;
}
