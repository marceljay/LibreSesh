import cookieParser from 'cookie-parser';
import express, { Router, type Express } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEvent, requireRole } from './auth.js';
import type { Config } from './config.js';
import type { Ctx } from './context.js';
import type { Db } from './db.js';
import { errorHandler, notFound } from './errors.js';
import { identityMiddleware } from './identity.js';
import { RateLimiter } from './ratelimit.js';
import { agendaRoutes, calendarRoutes } from './routes/agenda.js';
import { auditRoutes } from './routes/audit.js';
import { backupRoutes, exportRoutes } from './routes/backup.js';
import { breakRoutes } from './routes/breaks.js';
import { bundleRoutes } from './routes/bundle.js';
import { claimRoutes } from './routes/claims.js';
import { contributionRoutes } from './routes/contributions.js';
import { notificationRoutes } from './routes/notifications.js';
import { eventAuthRoutes } from './routes/eventAuth.js';
import { eventRoutes } from './routes/events.js';
import { importRoutes } from './routes/import.js';
import { eventMeRoutes, meRoutes } from './routes/me.js';
import { peopleRoutes } from './routes/people.js';
import { roomRoutes } from './routes/rooms.js';
import { proposalRoutes } from './routes/proposals.js';
import { sessionRoutes } from './routes/sessions.js';
import { settingsRoutes } from './routes/settings.js';
import { trashRoutes } from './routes/trash.js';
import { streamRoutes } from './routes/stream.js';
import { tagRoutes } from './routes/tags.js';
import { formatRoutes } from './routes/formats.js';
import { trackRoutes } from './routes/tracks.js';
import { Broker } from './sse.js';

const here = dirname(fileURLToPath(import.meta.url));
/** web/dist, from either server/src (dev) or server/dist (built). */
const WEB_DIST = resolve(here, '..', '..', 'web', 'dist');

export interface App {
  express: Express;
  ctx: Ctx;
}

export function createApp(db: Db, config: Config): App {
  const ctx: Ctx = { db, broker: new Broker(), limiter: new RateLimiter(), config };
  const app = express();

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser(config.cookieSecret));

  const api = Router();
  // Middleware order per SPEC §5: identity → rate limit → role check → handler.
  api.use(identityMiddleware(db, process.env.NODE_ENV === 'production'));
  api.use(meRoutes(ctx));
  api.use(eventRoutes(ctx));
  api.use(importRoutes(ctx));
  api.use(backupRoutes(ctx));

  const event = Router({ mergeParams: true });
  event.use(loadEvent(db));
  // Earning a role has to come before requiring one.
  event.use(eventAuthRoutes(ctx));
  // The calendar feed authenticates by capability token instead of a cookie.
  event.use(calendarRoutes(ctx));
  event.use(requireRole(db, 'viewer'));
  event.use(eventMeRoutes(ctx));
  event.use(bundleRoutes(ctx));
  event.use(streamRoutes(ctx));
  event.use(roomRoutes(ctx));
  event.use(tagRoutes(ctx));
  event.use(formatRoutes(ctx));
  event.use(trackRoutes(ctx));
  event.use(breakRoutes(ctx));
  event.use(sessionRoutes(ctx));
  event.use(proposalRoutes(ctx));
  event.use(contributionRoutes(ctx));
  event.use(notificationRoutes(ctx));
  event.use(peopleRoutes(ctx));
  event.use(claimRoutes(ctx));
  event.use(agendaRoutes(ctx));
  event.use(settingsRoutes(ctx));
  event.use(trashRoutes(ctx));
  event.use(exportRoutes(ctx));
  event.use(auditRoutes(ctx));
  api.use('/e/:slug', event);

  api.use((_req, _res, next) => next(notFound('No such endpoint')));
  app.use('/api', api);

  if (config.serveStatic && existsSync(WEB_DIST)) {
    // Hashed asset filenames can be cached hard; index.html must not be.
    app.use(
      express.static(WEB_DIST, {
        index: false,
        setHeaders: (res, path) => {
          if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(WEB_DIST, 'index.html'));
    });
  }

  app.use(errorHandler);
  return { express: app, ctx };
}
