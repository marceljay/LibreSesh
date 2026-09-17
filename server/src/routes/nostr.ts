import { Router } from 'express';
import { audit } from '../audit.js';
import { requireRole } from '../auth.js';
import type { Ctx } from '../context.js';
import type { EventRow, NostrPublishedRow } from '../db.js';
import type { NostrStatus } from '../shared/types.js';
import { exampleNote } from '../nostr/notes.js';
import { badRequest } from '../errors.js';
import {
  encryptEventKey,
  generateKeys,
  keysFromNsec,
  openEventKey,
  toNpub,
  toNsec,
} from '../nostr/keys.js';
import {
  appendPending,
  markDirty,
  markResync,
  markRetract,
  publishProfileNow,
  removePending,
} from '../nostr/queue.js';
import { limit } from '../ratelimit.js';
import {
  nostrEnableSchema,
  nostrExampleSchema,
  nostrImportSchema,
  nostrPatchSchema,
  parse,
  type NostrTrigger,
} from '../validation.js';

export const relaysOf = (event: EventRow): string[] =>
  event.nostr_relays ? (JSON.parse(event.nostr_relays) as string[]) : [];
export const triggersOf = (event: EventRow): NostrTrigger[] =>
  JSON.parse(event.nostr_triggers) as NostrTrigger[];

/**
 * Publishing to Nostr, organiser only (_planning/specs/nostr-publishing.md).
 *
 * The private key is decrypted in exactly one handler here, `export-key`,
 * for as long as encoding it takes; nothing else in this file sees it in
 * clear, and no response, export or log ever carries the stored columns.
 */
export function nostrRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });
  const isProd = process.env.NODE_ENV === 'production';

  const set = (id: number, assignments: string, ...args: unknown[]): void => {
    ctx.db.prepare(`UPDATE events SET ${assignments} WHERE id = ?`).run(...args, id);
  };
  const reload = (id: number): EventRow =>
    ctx.db.prepare(`SELECT * FROM events WHERE id = ?`).get(id) as EventRow;
  const record = (identityId: number, eventId: number, action: string): void =>
    audit(ctx.db, { identityId, eventId, action, entity: 'event', entityId: eventId });

  router.get('/nostr', requireRole(ctx.db, 'admin'), (req, res) => {
    const e = req.event;
    const rows = ctx.db
      .prepare(`SELECT * FROM nostr_published WHERE event_id = ?`)
      .all(e.id) as NostrPublishedRow[];
    const relays = relaysOf(e);
    const pendingOf = (row: NostrPublishedRow): string[] => JSON.parse(row.pending) as string[];
    const status: NostrStatus = {
      enabled: e.nostr_enabled === 1,
      npub: e.nostr_pubkey ? toNpub(e.nostr_pubkey) : null,
      relays,
      triggers: triggersOf(e),
      counts: {
        published: rows.filter((r) => r.published_at !== null && r.deleted === 0).length,
        dirty: rows.filter((r) => r.dirty_since !== null).length,
        pending: rows.filter((r) => r.pending !== '[]').length,
        deleted: rows.filter((r) => r.deleted === 1).length,
      },
      relayStatus: relays.map((url) => ({
        url,
        pending: rows.filter((r) => pendingOf(r).includes(url)).length,
        lastError:
          rows
            .map((r) => r.last_error)
            .filter((m): m is string => m !== null && m.startsWith(`${url}: `))
            .at(-1) ?? null,
      })),
    };
    res.json(status);
  });

  /**
   * Turning it on. The key is generated once: an event that was turned off
   * and on again keeps its npub, and with it everyone who followed it. The
   * relay list is seeded from the instance default the first time only, so
   * an organiser's edits survive a round trip too.
   */
  router.post('/nostr/enable', requireRole(ctx.db, 'admin'), (req, res) => {
    parse(nostrEnableSchema, req.body);
    const e = req.event;
    if (!e.nostr_seckey) {
      const keys = generateKeys();
      set(
        e.id,
        'nostr_pubkey = ?, nostr_seckey = ?',
        keys.pubkey,
        encryptEventKey(keys.seckey, ctx.config),
      );
    }
    if (e.nostr_relays === null) {
      set(e.id, 'nostr_relays = ?', JSON.stringify(ctx.config.nostrDefaultRelays));
    }
    set(e.id, 'nostr_enabled = 1');
    markDirty(ctx.db, e.id);
    record(req.identity.id, e.id, 'nostr_enable');
    res.json({ npub: toNpub(reload(e.id).nostr_pubkey!) });
  });

  /** Turning it off retracts nothing; the Publish tab says so and offers Retract. */
  router.post('/nostr/disable', requireRole(ctx.db, 'admin'), (req, res) => {
    set(req.event.id, 'nostr_enabled = 0');
    record(req.identity.id, req.event.id, 'nostr_disable');
    res.status(204).end();
  });

  router.patch('/nostr', requireRole(ctx.db, 'admin'), (req, res) => {
    const body = parse(nostrPatchSchema, req.body);
    const e = req.event;
    if (isProd && body.relays?.some((u) => u.startsWith('ws://'))) {
      throw badRequest('Relay URLs start with wss:// — plain ws:// is for local testing only');
    }
    if (body.relays) {
      const before = relaysOf(e);
      const relays = [...new Set(body.relays)];
      set(e.id, 'nostr_relays = ?', JSON.stringify(relays));
      appendPending(
        ctx.db,
        e.id,
        relays.filter((r) => !before.includes(r)),
      );
      removePending(
        ctx.db,
        e.id,
        before.filter((r) => !relays.includes(r)),
      );
    }
    if (body.triggers) set(e.id, 'nostr_triggers = ?', JSON.stringify([...new Set(body.triggers)]));
    record(req.identity.id, e.id, 'nostr_settings');
    const after = reload(e.id);
    res.json({ relays: relaysOf(after), triggers: triggersOf(after) });
  });

  /**
   * A key made elsewhere — `nak key generate`, another library, a signer's
   * export. It replaces the event's identity, so the programme is republished
   * under the new pubkey once the queue exists; until then the audit row
   * records the change.
   */
  router.post(
    '/nostr/import-key',
    requireRole(ctx.db, 'admin'),
    limit(ctx.limiter, 'auth'),
    (req, res) => {
      const { nsec } = parse(nostrImportSchema, req.body);
      let keys;
      try {
        keys = keysFromNsec(nsec);
      } catch {
        throw badRequest('That is not a valid nsec');
      }
      set(
        req.event.id,
        'nostr_pubkey = ?, nostr_seckey = ?',
        keys.pubkey,
        encryptEventKey(keys.seckey, ctx.config),
      );
      markDirty(ctx.db, req.event.id);
      record(req.identity.id, req.event.id, 'nostr_key_imported');
      res.json({ npub: toNpub(keys.pubkey) });
    },
  );

  /**
   * The one place the private key leaves the server, on purpose: rotating
   * the at-rest secret without its predecessor loses the key, and with it
   * every way to update or retract what was published.
   */
  router.post(
    '/nostr/export-key',
    requireRole(ctx.db, 'admin'),
    limit(ctx.limiter, 'auth'),
    (req, res) => {
      const seckey = openEventKey(req.event, ctx.config);
      if (!seckey) {
        throw badRequest(
          'This event has no key, or the instance secret has changed since it was made',
        );
      }
      record(req.identity.id, req.event.id, 'nostr_key_exported');
      res.json({ nsec: toNsec(seckey) });
    },
  );

  /**
   * What a trigger would post, rendered from this event's own schedule. The
   * effect of every setting on the tab is only visible on a relay, so the
   * tab shows the note itself; before the first enable the reference uses a
   * placeholder key, which is fine for reading.
   */
  router.get('/nostr/example', requireRole(ctx.db, 'admin'), (req, res) => {
    const { trigger } = parse(nostrExampleSchema, req.query);
    res.json({ content: exampleNote(ctx.db, ctx.config, req.event, trigger) });
  });

  /** Kind 5 for everything, then off. The loop drains the deletions. */
  router.post('/nostr/retract', requireRole(ctx.db, 'admin'), (req, res) => {
    markRetract(ctx.db, req.event.id);
    record(req.identity.id, req.event.id, 'nostr_retract');
    res.status(204).end();
  });

  router.post('/nostr/resync', requireRole(ctx.db, 'admin'), (req, res) => {
    markResync(ctx.db, req.event.id);
    res.status(204).end();
  });

  /**
   * Send a test: the profile again, now, with each relay's answer verbatim.
   * The effect of every setting on this tab is only visible in the external
   * service, and republishing the profile is the one send followers do not
   * see as a new post.
   */
  router.post(
    '/nostr/test',
    requireRole(ctx.db, 'admin'),
    limit(ctx.limiter, 'auth'),
    async (req, res) => {
      const relays = await publishProfileNow(ctx.db, ctx.config, ctx.nostrPool, req.event.id);
      res.json({ relays });
    },
  );

  return router;
}
