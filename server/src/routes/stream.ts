import { Router } from 'express';
import type { Ctx } from '../context.js';

/** SSE endpoint (SPEC §6). Viewer role or better; the broker owns heartbeats. */
export function streamRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  router.get('/stream', (req, res) => {
    // An SSE connection is one long-lived request; don't let compression or
    // the request timeout interfere with it.
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    req.socket.setKeepAlive(true);

    // Named, so the broker can address a notification to this person alone.
    // `Last-Event-ID` is sent by the browser itself on a reconnect and says
    // where to resume; the broker replays from there rather than leaving the
    // client to refetch the whole event.
    const resume = req.get('last-event-id');
    const unsubscribe = ctx.broker.subscribe(req.event.slug, res, req.identity.id, resume);
    req.on('close', unsubscribe);
  });

  return router;
}
