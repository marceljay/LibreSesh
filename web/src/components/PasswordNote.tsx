import { passwordWarning } from '../../../server/src/shared/passwordAdvice';

/**
 * The line under an event-password field when there is something worth
 * saying about what was typed — a password anyone would guess first, the
 * event's own name, or one short enough to fall in bulk.
 *
 * Advice, never a refusal (D3 §1d): the form submits whatever this says, and
 * nothing here re-checks a password an event already has. How long a password
 * should be depends on whether it is about to be read aloud to an audience,
 * which only the organiser knows. Rendered amber rather than red for the same
 * reason — this is not an error.
 */
export function PasswordNote({
  password,
  name,
  slug,
}: {
  password: string;
  name?: string;
  slug?: string;
}) {
  const warning = passwordWarning(password, { name, slug });
  if (!warning) return null;
  return (
    <p className="mt-1 text-xs text-amber-700 dark:text-amber-500" role="status">
      {warning}
    </p>
  );
}
