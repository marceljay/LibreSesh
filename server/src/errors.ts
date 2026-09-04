import type { NextFunction, Request, Response } from 'express';

/** Error carrying the HTTP status and machine-readable code from SPEC §5. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Machine-readable facts a client needs to act on the error — the
     *  gate's "is that you?" prompt carries the profile it found. */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code = 'validation') =>
  new HttpError(400, code, message);
export const unauthorized = (message = 'This event needs a password') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Your role does not allow that') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
/**
 * `details` carries the moving parts of a message as data — the session that
 * blocks a slot, the name already taken — so the client can build its own
 * sentence instead of rendering ours. The `message` stays for logs and for
 * anyone reading the API directly; it is not what the app shows.
 */
export const conflict = (message: string, code = 'conflict', details?: Record<string, unknown>) =>
  new HttpError(409, code, message, details);

/**
 * body-parser's own refusal, thrown before any route runs. It is a plain
 * `Error` with these properties bolted on rather than anything we can
 * `instanceof`, so recognising it means looking at its shape.
 */
function payloadTooLarge(err: unknown): { limit: number } | null {
  const e = err as { type?: unknown; limit?: unknown } | null;
  if (e?.type !== 'entity.too.large') return null;
  return { limit: typeof e.limit === 'number' ? e.limit : 0 };
}

/** Terminal error handler: shapes every failure as `{ error: { code, message } }`. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
    });
    return;
  }
  // A schedule larger than the body cap is the one way an ordinary request
  // gets rejected before reaching a route. Left to the 500 below it came back
  // as "Something went wrong", which is a poor way to say "that file is too
  // big" to someone importing a programme.
  const oversized = payloadTooLarge(err);
  if (oversized) {
    const limit = oversized.limit > 0 ? ` (the limit is ${Math.floor(oversized.limit / 1024)} KB)` : '';
    res
      .status(413)
      .json({ error: { code: 'too_large', message: `That request is too large${limit}.` } });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}
