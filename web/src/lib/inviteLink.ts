import type { Role } from '@shared/types';

/**
 * Invite links: a QR that carries an event password.
 *
 * The password rides in the **fragment**, and that is the whole design:
 *
 * - a fragment is never sent to the server, so the secret stays out of access
 *   logs, `Referer` headers and any proxy in between — a query string would
 *   put an event's password in Caddy's log for every scan;
 * - the login page strips it with `history.replaceState` the moment it reads it, so
 *   the URL left in the address bar is a bare `/e/:slug`. An attendee who
 *   scans the poster and then pastes "the link" into a group chat shares a
 *   page that asks for the password, not one that hands it out.
 *
 * What it does not do is make the QR itself a secret. Anyone who photographs
 * the poster has the password, exactly as if it were printed underneath — an
 * event password is a shared secret read off a wall, and this only saves the
 * typing.
 */
const PASSWORD_KEY = 'k';
const ROLE_KEY = 'r';
/** A speaker link carries a speaker code under this key, alone. */
const CODE_KEY = 'c';

export interface Invite {
  password: string;
  /**
   * A label, never a grant. The server derives the real role from the password
   * and this is only what the login page says while you are looking at it, so that
   * "Invited as Attendee" can be shown before anything is submitted.
   */
  role?: Role;
}

const ROLES: readonly Role[] = ['viewer', 'user', 'speaker', 'admin'];

/**
 * A speaker link: the same shape as an invite, carrying a speaker code
 * instead of a password. Opening it redeems the code, so the device that
 * opened it *is* that speaker — no name to pick, because the profile already
 * has one, and no password, because the code is the credential.
 *
 * It rides in the fragment for the invite's reasons, and one more: a speaker
 * code lives until revoked and names one person, so a copy in an access log
 * is a standing impersonation rather than a leaked room key.
 */
export interface SpeakerLink {
  phrase: string;
}

/** Trim a typed origin down to something `${base}/e/slug` can be built on. */
export const normalizeBaseUrl = (raw: string): string => raw.trim().replace(/\/+$/, '');

export function buildInviteUrl(opts: {
  baseUrl: string;
  slug: string;
  password: string;
  role?: Role;
}): string {
  const params = new URLSearchParams();
  params.set(PASSWORD_KEY, opts.password);
  if (opts.role) params.set(ROLE_KEY, opts.role);
  return `${normalizeBaseUrl(opts.baseUrl)}/e/${encodeURIComponent(opts.slug)}#${params.toString()}`;
}

export function buildSpeakerLinkUrl(opts: {
  baseUrl: string;
  slug: string;
  phrase: string;
}): string {
  const params = new URLSearchParams();
  params.set(CODE_KEY, opts.phrase);
  return `${normalizeBaseUrl(opts.baseUrl)}/e/${encodeURIComponent(opts.slug)}#${params.toString()}`;
}

/**
 * Read an invite out of `window.location.hash`. Undefined for anything that
 * is not one — including a bare `#`, which React Router and in-page anchors
 * both produce.
 */
export function parseInvite(hash: string): Invite | undefined {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return undefined;
  const params = new URLSearchParams(raw);
  const password = params.get(PASSWORD_KEY);
  if (!password) return undefined;
  const role = params.get(ROLE_KEY);
  return { password, role: ROLES.includes(role as Role) ? (role as Role) : undefined };
}

/** The speaker-link counterpart of `parseInvite`; undefined for anything else. */
export function parseSpeakerLink(hash: string): SpeakerLink | undefined {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return undefined;
  const phrase = new URLSearchParams(raw).get(CODE_KEY)?.trim();
  return phrase ? { phrase } : undefined;
}

let takenInvite: Invite | undefined;
let takenSpeakerLink: SpeakerLink | undefined;
let hasTaken = false;

/**
 * Read whatever secret the address bar carries and take it back out, once per
 * page load. Idempotent, and cached: the first caller gets it and every
 * caller after it gets the same answer from a URL that no longer holds one.
 *
 * Called from `main.tsx` before anything renders, and *not* only from the
 * login page, because the login page does not always appear. An organiser who scans the
 * attendee code already holds a role, walks straight through to the schedule,
 * and would otherwise be left with the password sitting in their address bar
 * with nothing to clear it.
 *
 * Touches the DOM, so it lives beside the pure helpers rather than among them —
 * the tests import those and never this.
 */
function takeHash(): void {
  if (hasTaken) return;
  hasTaken = true;
  const hash = window.location.hash;
  takenInvite = parseInvite(hash);
  takenSpeakerLink = parseSpeakerLink(hash);
  if (takenInvite || takenSpeakerLink) {
    // `replaceState`, not `pushState`: it overwrites the current history entry,
    // so Back does not return to a URL carrying the secret and the browser's
    // history list never holds one either.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export function takeInvite(): Invite | undefined {
  takeHash();
  return takenInvite;
}

/** The speaker link the page was opened with, if any — see `takeInvite`. */
export function takeSpeakerLink(): SpeakerLink | undefined {
  takeHash();
  return takenSpeakerLink;
}

const BASE_STORAGE_KEY = 'libresesh:invite-base';

/**
 * The address a shared link should point at, which is not reliably the one
 * the organiser is looking at. Behind Caddy they match; in a dev container the
 * app is reached through a forwarded port, and on a laptop plugged into the
 * projector it can be a LAN address no phone can resolve. So it is remembered
 * per browser and editable (Manage Event → Invite), with the current origin as
 * the starting guess. Read wherever a link is built, so a speaker link from a
 * profile page points where the invite QR does.
 */
export function readLinkBase(): string {
  try {
    return localStorage.getItem(BASE_STORAGE_KEY) ?? window.location.origin;
  } catch {
    // Private windows and blocked site data throw on access.
    return window.location.origin;
  }
}

export function writeLinkBase(value: string): void {
  try {
    localStorage.setItem(BASE_STORAGE_KEY, value);
  } catch {
    // Nothing to persist; the field simply starts from the origin next time.
  }
}
