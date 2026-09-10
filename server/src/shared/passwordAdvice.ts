/**
 * Advice on a typed event password — never a refusal (D3 §1d, decided
 * 2026-09-09).
 *
 * How long an event's passwords are is the organiser's decision. They know
 * whether one is read aloud to an audience, printed on a badge, or guarding
 * an unpublished programme; the server does not. So nothing here rejects
 * anything, no existing password is re-checked, and no instance is ever made
 * to rotate. The minimum stays where it was.
 *
 * Shared with the client so the same sentence appears beside the field as the
 * one the server would give, and so the check costs no request.
 */

/** The roles an event password can open, weakest first. */
export type PasswordTier = 'viewer' | 'user' | 'admin';

/**
 * Passwords that are tried first by anyone guessing. Short on purpose: the
 * point is to catch the handful a person actually reaches for when inventing
 * one quickly, not to be a dictionary. A longer list belongs in a password
 * cracker, not in a form that submits either way.
 */
const COMMON = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  '1234567890',
  'password',
  'password1',
  'passw0rd',
  'qwerty',
  'qwerty123',
  'abc123',
  'letmein',
  'welcome',
  'welcome1',
  'iloveyou',
  'admin',
  'admin123',
  'root',
  'guest',
  'login',
  'test',
  'test123',
  'changeme',
  'secret',
  'monkey',
  'dragon',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'trustno1',
  'starwars',
  'whatever',
  'summer',
  'winter',
  'conference',
  'unconference',
  'event',
  'hello',
  'hallo',
  'geheim',
  'passwort',
]);

const normalise = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, '');

/** What every field says regardless of what is typed: the default is better. */
export const BLANK_GENERATES =
  'Leave blank and we make one for you — four random words, stronger than anything worth typing.';

/** Per-tier context, so the advice matches what the password actually opens. */
export const TIER_NOTE: Record<PasswordTier, string> = {
  viewer: 'This one is usually read aloud or shown on screen. Short is a fair trade for that.',
  user: 'Shared with everyone taking part, so expect it to be passed on.',
  admin: 'This one changes the event. Worth more length than the other two.',
};

/**
 * A warning to show under the field, or null. The form submits either way —
 * that is the whole point of returning a string rather than throwing.
 */
export function passwordWarning(
  password: string,
  event: { name?: string; slug?: string } = {},
): string | null {
  const value = normalise(password);
  if (value === '') return null;
  if (COMMON.has(value)) {
    return 'This is one of the first passwords anyone guessing would try.';
  }
  const name = normalise(event.name ?? '');
  const slug = normalise(event.slug ?? '');
  if ((name !== '' && value === name) || (slug !== '' && value === slug)) {
    return 'This is the event’s own name, which is the second thing anyone would try.';
  }
  if (value.length < 8) {
    return 'Short enough to guess in bulk. Fine if it is about to be read out loud; worth more length otherwise.';
  }
  return null;
}
