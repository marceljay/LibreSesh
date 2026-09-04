import { ApiError } from './api';

/**
 * The one place a failure becomes a sentence.
 *
 * The server answers with a machine code and, where the sentence has moving
 * parts, structured `details` — never a string meant for a person to read. That
 * split is what keeps the server locale-unaware: it reports *what happened*, and
 * the client decides how to say it. Rendering `err.message` instead would put
 * English in the API, which is the one thing that cannot be translated later
 * without touching every route (forms strategy, i18n readiness rule 2).
 *
 * Unknown codes fall through to the HTTP status, so a code added on the server
 * tomorrow still reads as a sentence rather than leaking whatever prose came
 * with it. Add it here when you meet it.
 */

const quoted = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

function byCode(err: ApiError): string | null {
  const d = err.details ?? {};
  switch (err.code) {
    case 'already_claimed':
      return 'Somebody already holds that profile';
    case 'archived':
      return 'This event is archived and read-only';
    case 'blocked': {
      const title = quoted(d.title);
      return title
        ? `“${title}” is on then, and everyone should be at it — nothing else can be booked while it runs`
        : 'Something everyone should be at is on then — nothing else can be booked while it runs';
    }
    case 'claim_pending':
      return 'That request is already waiting for an organiser';
    case 'format_exists':
      return 'A format with that name already exists';
    case 'last_admin':
      return 'That is the last organiser — make someone else an organiser first';
    case 'name_required':
      return 'Pick a username to enter';
    case 'name_taken': {
      const name = quoted(d.name);
      return name
        ? `Someone at this event is already called “${name}”`
        : 'Someone at this event already has that name';
    }
    case 'overlap':
      return 'That slot is already taken in this room';
    case 'placed':
      return 'That pitch is already on the grid — edit the session instead';
    case 'profile_exists':
      return 'There is already a profile with that name';
    case 'rate_limited':
      return 'Too many attempts — wait a moment and try again';
    case 'room_in_use':
      return 'Move or remove this room’s sessions first';
    case 'room_missing':
      return 'That session’s room is gone — recreate it first';
    case 'slug_taken':
      return 'That address is already taken';
    case 'stale':
      return 'Someone else changed this while you were editing';
    case 'tag_exists':
      return 'A tag with that name already exists';
    case 'track_exists':
      return 'A track with that name already exists';
    case 'unauthorized':
      return 'This event needs a password';
    case 'forbidden':
      return 'Your role does not allow that';
    default:
      return null;
  }
}

function byStatus(status: number): string {
  if (status === 400) return 'That did not look right';
  if (status === 401) return 'This event needs a password';
  if (status === 403) return 'Your role does not allow that';
  if (status === 404) return 'That is not here any more';
  if (status === 409) return 'Someone else changed that first';
  if (status === 413) return 'That is too large to send';
  if (status === 429) return 'Too many attempts — wait a moment and try again';
  return 'Something went wrong — try again';
}

/**
 * A sentence for any failure, without ever rendering what the server wrote.
 *
 * `fallback` is for the callers that already have a better line for their own
 * context ("The backup could not be made") than anything general.
 */
export function errorText(err: unknown, fallback?: string): string {
  if (err instanceof ApiError) return byCode(err) ?? fallback ?? byStatus(err.status);
  // A network failure or a bug in our own code. Neither is the user's problem to
  // read, and neither carries a string worth showing.
  return fallback ?? 'Something went wrong — try again';
}
