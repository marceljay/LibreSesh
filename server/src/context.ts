import type { Config } from './config.js';
import type { Db } from './db.js';
import type { Backoff, RateLimiter, Tally } from './ratelimit.js';
import type { Broker } from './sse.js';

/** Everything a route module needs. Handlers stay synchronous: better-sqlite3
 *  and bcryptjs are both sync, so Express 4 propagates thrown errors for us. */
export interface Ctx {
  db: Db;
  broker: Broker;
  limiter: RateLimiter;
  /** Per-address backoff on failed logins (D3 §1a). */
  backoff: Backoff;
  /** Per-event failure count, and the closure it triggers (D3 §1b). */
  tally: Tally;
  config: Config;
}
