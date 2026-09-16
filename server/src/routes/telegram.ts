import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { audit } from '../audit.js';
import type { Ctx } from '../context.js';
import type { EventRow } from '../db.js';
import { badRequest, HttpError } from '../errors.js';
import { limit } from '../ratelimit.js';
import type { TelegramStatus } from '../shared/types.js';
import {
  escapeHtml,
  MODES,
  modeOf,
  parseTriggers,
  resolveToken,
  sendMessage,
} from '../telegram.js';
import { parse, telegramSettingsSchema } from '../validation.js';

/** Long enough to walk to the group and paste it, short enough to be useless
 *  if it is seen over a shoulder. */
const BIND_CODE_MINUTES = 15;

/**
 * A bot token is a credential, so it goes out to nobody — not even the
 * organiser who saved it. All they get back is enough to recognise which bot
 * is stored, which is all anyone needs to answer "is the right one in there?".
 */
const hint = (token: string): string => `…${token.slice(-4)}`;

function status(ctx: Ctx, event: EventRow): TelegramStatus {
  const triggers = parseTriggers(event.telegram_triggers);
  const own = event.telegram_bot_token;
  return {
    available: resolveToken(event, ctx.config.telegramBotToken) !== null,
    ownBot: own !== null,
    ownBotHint: own ? hint(own) : null,
    instanceBot: ctx.config.telegramBotToken !== null,
    connected: event.telegram_chat_id !== null,
    mode: modeOf(triggers),
    triggers,
    leadMin: event.telegram_lead_min,
    livestreams: event.telegram_livestreams === 1,
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
    if (!resolveToken(req.event, ctx.config.telegramBotToken)) {
      throw badRequest('Add a bot token first');
    }
    // Hex and short, because it is read off one screen and typed into a phone
    // on the way to the group. Ten characters is forty bits, far past guessing
    // inside a fifteen-minute life.
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
    // Parsed up front, like every other write here. Validating between the
    // writes meant a bad `mode` could 400 *after* the token had been stored:
    // an error the caller sees and a change they did not ask for.
    const body = parse(telegramSettingsSchema, req.body);
    const event = req.event;

    if (body.botToken !== undefined) {
      // Changing the bot invalidates the binding: the new bot is not in the
      // old group, and posting there would fail every minute until somebody
      // worked out why. Clearing it is cleaner than leaving a dead pairing.
      ctx.db
        .prepare(
          `UPDATE events SET telegram_bot_token = ?, telegram_chat_id = NULL,
                             telegram_topic_id = NULL, telegram_bind_code = NULL,
                             telegram_bind_expires = NULL
            WHERE id = ?`,
        )
        .run(body.botToken, event.id);
    }
    if (body.mode !== undefined) {
      ctx.db
        .prepare('UPDATE events SET telegram_triggers = ? WHERE id = ?')
        .run(JSON.stringify(MODES[body.mode]), event.id);
    }
    if (body.leadMin !== undefined) {
      ctx.db
        .prepare('UPDATE events SET telegram_lead_min = ? WHERE id = ?')
        .run(body.leadMin, event.id);
    }
    if (body.livestreams !== undefined) {
      ctx.db
        .prepare('UPDATE events SET telegram_livestreams = ? WHERE id = ?')
        .run(body.livestreams ? 1 : 0, event.id);
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
    const event = req.event;
    const token = resolveToken(event, ctx.config.telegramBotToken);
    if (!token) throw badRequest('Add a bot token first');
    if (!event.telegram_chat_id) throw badRequest('No group is connected yet');
    try {
      await sendMessage(token, {
        chatId: event.telegram_chat_id,
        text: `✅ Connected. This group will be told what is coming up at <b>${escapeHtml(event.name)}</b>.`,
        topicId: event.telegram_topic_id,
      });
      res.json({ ok: true });
    } catch (err) {
      // Through the standard error shape, not a bespoke one. `{ error: '<prose>' }`
      // reached the client's parser as an unknown code, so the organiser was
      // shown "Something went wrong" — the exact opposite of this button's
      // point. Telegram's own words ride in `details`, which is data the client
      // chooses to render, not a sentence the server wrote for it.
      const reason = (err as Error).message;
      throw new HttpError(502, 'telegram_refused', reason, { reason });
    }
  });

  return router;
}
