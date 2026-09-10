/**
 * Filling in the event passwords a creator left blank.
 *
 * Three passwords is a lot to invent at the point of creating an event, and
 * inventing them badly is worse than not inventing them — so blank fields get
 * filled in rather than rejected. What they get filled in *with* depends on the
 * instance:
 *
 * - On a demo instance the login page is a role picker and the passwords are not
 *   checked at all, so secrecy is meaningless and predictability is worth
 *   something: the published DemoConf values are used, and screenshots, docs
 *   and tutorials keep working.
 * - Anywhere else a fresh phrase is generated per role and handed back to the
 *   creator once, so a real instance never has a password that is printed in
 *   this repository.
 */
import { randomInt } from 'node:crypto';
import { WORDS } from './deviceLink.js';
import { DEMO_PASSWORDS } from './seed.js';

/**
 * Four words from the ~500-word list, about 37 bits — the same shape as a
 * speaker code, and for the same reason: it survives being read across a room.
 * Unlike a link code this one lives as long as the event, so it leans on the
 * auth endpoint's rate limiting rather than on length alone.
 */
export const newEventPassword = (): string =>
  Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]).join('-');

export type PasswordField = 'viewerPassword' | 'userPassword' | 'adminPassword';

const FIELDS: readonly PasswordField[] = ['viewerPassword', 'userPassword', 'adminPassword'];

const DEMO_DEFAULTS: Record<PasswordField, string> = {
  viewerPassword: DEMO_PASSWORDS.viewer,
  userPassword: DEMO_PASSWORDS.user,
  adminPassword: DEMO_PASSWORDS.admin,
};

export interface ResolvedPasswords {
  /** Every role has one, whether supplied or filled in. */
  passwords: Record<PasswordField, string>;
  /**
   * Only the ones this instance invented. The creator already knows the ones
   * they typed, and a password should not be echoed back without reason.
   */
  generated: Partial<Record<PasswordField, string>>;
}

/**
 * Supplied passwords always win. Anything missing is filled in with a value
 * that collides with none of the others — the roles are told apart by these
 * strings, so two matching would silently grant the higher role.
 */
export function resolveEventPasswords(
  supplied: Partial<Record<PasswordField, string>>,
  demoMode: boolean,
): ResolvedPasswords {
  const passwords = {} as Record<PasswordField, string>;
  const generated: Partial<Record<PasswordField, string>> = {};
  const taken = new Set(FIELDS.map((f) => supplied[f]).filter((v): v is string => !!v));

  for (const field of FIELDS) {
    const given = supplied[field];
    if (given) {
      passwords[field] = given;
      continue;
    }
    // On a demo instance prefer the published value, but not if the creator
    // happened to type it into another field — a collision there would hand
    // out the wrong role, and predictability is not worth that.
    let value = demoMode && !taken.has(DEMO_DEFAULTS[field]) ? DEMO_DEFAULTS[field] : '';
    while (!value || taken.has(value)) value = newEventPassword();
    taken.add(value);
    passwords[field] = value;
    generated[field] = value;
  }

  return { passwords, generated };
}
