/**
 * An event's Nostr identity is a keypair and nothing else. This module makes,
 * encodes and opens it; the encryption at rest is `secretsAtRest.ts`.
 */
import * as nip19 from 'nostr-tools/nip19';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Config } from '../config.js';
import type { EventRow } from '../db.js';
import { decryptAtRest, encryptAtRest, type AtRestKeys } from '../secretsAtRest.js';

/** The HKDF purpose string; changing it orphans every stored key. */
export const PURPOSE = 'nostr-seckey';

export interface NostrKeys {
  /** 32 bytes, lowercase hex: what goes on the wire and in the database. */
  pubkey: string;
  seckey: Uint8Array;
}

export function generateKeys(): NostrKeys {
  const seckey = generateSecretKey();
  return { pubkey: getPublicKey(seckey), seckey };
}

/** Throws on anything that is not a well-formed `nsec1…`. */
export function keysFromNsec(nsec: string): NostrKeys {
  const decoded = nip19.decode(nsec.trim());
  if (decoded.type !== 'nsec') throw new Error('not an nsec');
  return { pubkey: getPublicKey(decoded.data), seckey: decoded.data };
}

export const toNpub = (pubkeyHex: string): string => nip19.npubEncode(pubkeyHex);
export const toNsec = (seckey: Uint8Array): string => nip19.nsecEncode(seckey);

export const atRestKeys = (config: Config): AtRestKeys => ({
  current: config.atRestSecret,
  previous: config.atRestSecretPrevious,
});

export const encryptEventKey = (seckey: Uint8Array, config: Config): string =>
  encryptAtRest(seckey, PURPOSE, config.atRestSecret);

/**
 * The event's private key, or null when it has none or the at-rest secret
 * cannot open it. Callers hold the result only as long as signing takes.
 */
export function openEventKey(event: EventRow, config: Config): Uint8Array | null {
  if (!event.nostr_seckey) return null;
  try {
    return decryptAtRest(event.nostr_seckey, PURPOSE, atRestKeys(config));
  } catch {
    return null;
  }
}
