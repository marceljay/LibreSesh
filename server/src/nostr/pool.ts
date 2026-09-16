import type { VerifiedEvent } from 'nostr-tools/pure';

/** What the publishing code needs from `SimplePool`; a test hands in a fake. */
export interface Pool {
  publish(relays: string[], event: VerifiedEvent): Promise<string>[];
}
