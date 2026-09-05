import { createCipheriv, randomBytes } from 'node:crypto';
import { createReadStream, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { hasInstanceKey, requireRole } from '../auth.js';
import { audit } from '../audit.js';
import {
  HEADER_BYTES,
  TAG_BYTES,
  buildHeader,
  deriveKey,
  newIv,
  newSalt,
  vacuumInto,
} from '../backup.js';
import type { Ctx } from '../context.js';
import { exportEvent } from '../exportEvent.js';
import { forbidden } from '../errors.js';
import { limit } from '../ratelimit.js';
import { EXPORT_PARTS, type ExportPart } from '../shared/exportParts.js';
import { parse } from '../validation.js';

/**
 * A passphrase, not a password: it protects a file that will sit in a
 * downloads folder or a bucket, where nobody is rate-limiting the guesses.
 * Twelve characters is not much, but it is enough to rule out "hunter2".
 */
const backupSchema = z.object({
  passphrase: z
    .string()
    .min(12, 'A backup passphrase must be at least 12 characters — nothing rate-limits an attacker with the file'),
});

const stamp = (): string => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/**
 * `?include=sessions,people` — which of the optional parts to write. Absent
 * means all of them, so a plain GET is the whole event as it always was; given
 * and empty means the frame alone. A name that is not a part is a 400 rather
 * than a silently thinner file.
 */
const includeSchema = z
  .string()
  .transform((raw) => raw.split(',').map((s) => s.trim()).filter((s) => s !== ''))
  .pipe(z.array(z.enum(EXPORT_PARTS)));

/** Per-event JSON export. Admin of *this* event, no instance password needed. */
export function exportRoutes(ctx: Ctx): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/export.json',
    requireRole(ctx.db, 'admin'),
    limit(ctx.limiter, 'read'),
    (req, res) => {
      const include = req.query.include;
      const parts: ReadonlySet<ExportPart> =
        include === undefined
          ? new Set(EXPORT_PARTS)
          : new Set(parse(includeSchema, Array.isArray(include) ? include.join(',') : include));
      const payload = exportEvent(ctx.db, req.event, parts);
      audit(ctx.db, {
        identityId: req.identity.id,
        eventId: req.event.id,
        action: 'export',
        entity: 'event',
        entityId: req.event.id,
      });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${req.event.slug}-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      // Indented: an export is read by people at least as often as by programs.
      res.send(JSON.stringify(payload, null, 2));
    },
  );

  return router;
}

/**
 * Encrypted whole-database download, gated by the instance password.
 *
 * This is not the per-event export with more rows in it — the artifact is a
 * **credential**. It carries every identity token in clear (they are cookies,
 * and the DB is their home) and the sha256 of every link and speaker code,
 * whose plaintext is a ~37-bit phrase and so falls to an offline guesser in
 * minutes. That is why it never leaves here unencrypted and why the passphrase
 * is typed at download time rather than kept in an env var.
 */
export function backupRoutes(ctx: Ctx): Router {
  const router = Router();

  router.post('/backup', limit(ctx.limiter, 'auth'), (req, res, next) => {
    if (!hasInstanceKey(ctx.config, req.get('X-Instance-Key'))) {
      throw forbidden('Wrong instance password');
    }
    const { passphrase } = parse(backupSchema, req.body);

    // Beside the database, which is the one directory we know is writable and
    // has room for a copy. Dot-prefixed and `.tmp`-suffixed so it is never
    // mistaken for one of the `*.backup-<stamp>` files migrations leave.
    const dir =
      ctx.config.databasePath === ':memory:' ? tmpdir() : dirname(ctx.config.databasePath);
    const snapshot = join(dir, `.backup-${randomBytes(8).toString('hex')}.tmp`);

    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      try {
        unlinkSync(snapshot);
      } catch {
        // Already gone, or never written — nothing to do about it either way.
      }
    };

    void (async () => {
      try {
        vacuumInto(ctx.db, snapshot);
        const plainBytes = statSync(snapshot).size;

        const salt = newSalt();
        const iv = newIv();
        const key = await deriveKey(passphrase, salt);
        const cipher = createCipheriv('aes-256-gcm', key, iv);

        audit(ctx.db, {
          identityId: req.identity.id,
          eventId: null,
          action: 'backup',
          entity: 'instance',
          entityId: null,
        });

        // GCM ciphertext is exactly as long as its plaintext, so the whole
        // size is known before a byte is sent — the browser gets a real
        // progress bar instead of a spinner.
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(HEADER_BYTES + plainBytes + TAG_BYTES));
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="libresesh-backup-${stamp()}.lsbk"`,
        );
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.write(buildHeader(salt, iv));

        const source = createReadStream(snapshot);
        source.on('error', (err) => cipher.destroy(err));
        source.pipe(cipher);
        cipher.pipe(res, { end: false });

        cipher.on('end', () => {
          // The tag only exists once the last block is through the cipher,
          // which is why it trails the ciphertext rather than sitting in the
          // header. `decrypt-backup.ts` seeks to the end for it.
          res.end(cipher.getAuthTag());
          cleanup();
        });
        cipher.on('error', (err) => {
          cleanup();
          res.destroy(err);
        });
      } catch (err) {
        cleanup();
        next(err);
      }
    })();
  });

  return router;
}
