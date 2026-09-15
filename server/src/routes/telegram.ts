import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { EventRow } from '../db.js';
import { badRequest } from '../errors.js';
import { limit } from '../ratelimit.js';
import type { TelegramStatus } from '../shared/types.js';
import { escapeHtml, MODES, modeOf, parseTriggers, sendMessage } from '../telegram.js';

/** Long enough to walk to the group and paste it, short enough to be useless
 *  if it is seen over a shoulder. */
const BIND_CODE_MINUTES = 15;

function status(ctx: Ctx, event: EventRow): TelegramStatus {
  const triggers = parseTriggers(event.telegram_triggers);
  return {
    available: ctx.config.telegramBotToken !== null,
    connected: event.telegram_chat_id !== null,
    mode: modeOf(triggers),
    triggers,
    leadMin: event.telegram_lead_min,
    bindCode: event.telegram_bind_code,
    bindExpires: event.telegram_bind_expires,
  };
}

/**
 * Connecting an event to a Telegram group, and saying how loud it should be.
 *
 * Admin only, every route: pointing an event at a group publishes its titles,
 * speakers, rooms and times to everyone who can see that group. That is a
 * disclosure decision and it belongs to the organiser, which is why it is
 * audited like any other setting (SECURITY.md §Telegram).
 *
 * The group is never typed in. A private group has no `@name`, and its numeric
 * id is not something an organiser can look up without going and finding a
 * third-party bot first. So they mint a code here and say it in the group; the
 * bot reads its own `chat.id` off the update and stores that.
 */
export function telegramRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });
  const adminWrite = [requireRole(ctx.db, 'admin'), limit(ctx.limiter, 'write')];

  const reload = (id: number): EventRow =>
    ctx.db.prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?').get(id)!;

  router.get('/telegram', requireRole(ctx.db, 'admin'), (req, res) => {
    res.json(status(ctx, req.event));
  });

  router.post('/telegram/code', ...adminWrite, (req, res) => {
    if (!ctx.config.telegramBotToken) throw badRequest('This instance has no Telegram bot');
    // Base32-ish and short: it is read off a screen and typed into a phone.
    const code = randomBytes(5).toString('hex');
    const expires = new Date(Date.now() + BIND_CODE_MINUTES * 60_000).toISOString();
    ctx.db
      .prepare('UPDATE events SET telegram_bind_code = ?, telegram_bind_expires = ? WHERE id = ?')
      .run(code, expires, req.event.id);
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'telegram.code',
      entity: 'event',
      entityId: req.event.id,
    });
    res.json(status(ctx, reload(req.event.id)));
  });

  router.delete('/telegram', ...adminWrite, (req, res) => {
    ctx.db
      .prepare(
        `UPDATE events SET telegram_chat_id = NULL, telegram_topic_id = NULL,
                           telegram_bind_code = NULL, telegram_bind_expires = NULL
          WHERE id = ?`,
      )
      .run(req.event.id);
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: req.event.id,
      action: 'telegram.disconnect',
      entity: 'event',
      entityId: req.event.id,
    });
    res.json(status(ctx, reload(req.event.id)));
  });

  router.patch('/telegram', ...adminWrite, (req, res) => {
    const body = req.body as { mode?: string; leadMin?: number };
    const event = req.event;

    if (body.mode !== undefined) {
      const triggers = MODES[body.mode];
      if (!triggers) throw badRequest(`Unknown mode ${body.mode}`);
      ctx.db
        .prepare('UPDATE events SET telegram_triggers = ? WHERE id = ?')
        .run(JSON.stringify(triggers), event.id);
    }
    if (body.leadMin !== undefined) {
      if (!Number.isInteger(body.leadMin) || body.leadMin < 1 || body.leadMin > 180) {
        throw badRequest('Lead time must be between 1 and 180 minutes');
      }
      ctx.db
        .prepare('UPDATE events SET telegram_lead_min = ? WHERE id = ?')
        .run(body.leadMin, event.id);
    }
    audit(ctx.db, {
      identityId: req.identity.id,
      eventId: event.id,
      action: 'telegram.settings',
      entity: 'event',
      entityId: event.id,
    });
    res.json(status(ctx, reload(event.id)));
  });

  /**
   * The button that earns its place. Half of all setup failures are a bot that
   * was removed from the group or a stale binding, and both are invisible
   * until the first real announcement fails at 09:45 on day one. Telegram's own
   * error text goes straight back to the organiser — it is the only useful
   * thing to say.
   */
  router.post('/telegram/test', ...adminWrite, async (req, res) => {
    const token = ctx.config.telegramBotToken;
    const event = req.event;
    if (!token) throw badRequest('This instance has no Telegram bot');
    if (!event.telegram_chat_id) throw badRequest('No group is connected yet');
    try {
      await sendMessage(token, {
        chatId: event.telegram_chat_id,
        text: `✅ Connected. This group will be told what is coming up at <b>${escapeHtml(event.name)}</b>.`,
        topicId: event.telegram_topic_id,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    }
  });

  return router;
}
