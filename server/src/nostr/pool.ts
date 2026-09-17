import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool';
import type { VerifiedEvent } from 'nostr-tools/pure';
import WebSocket from 'ws';

/** What the publishing code needs from `SimplePool`; a test hands in a fake. */
export interface Pool {
  publish(relays: string[], event: VerifiedEvent): Promise<string>[];
}

/**
 * A relay pool on the `ws` package, not Node's own WebSocket.
 *
 * Node 22 has a global WebSocket, but a relay that refuses the connection
 * sends it into `close()` from inside its own error handler, and that
 * recurses until the stack is gone: an uncaught RangeError that takes the
 * whole process with it. One dead relay in an organiser's list must not
 * stop the schedule, so the pool uses `ws`, which fails the connection once
 * and moves on. Reproduced against `ws://127.0.0.1:1` on Node 22.23.
 */
export function makePool(): Pool {
  useWebSocketImplementation(WebSocket);
  return new SimplePool();
}
