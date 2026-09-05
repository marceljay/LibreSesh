import type { Role, SessionDto } from '@shared/types';
import { can, type PermissionMatrix } from '@shared/capabilities';

/**
 * What the signed-in person may do to a session, decided the same way the
 * server's `assertMayMutate` (server/src/sessionRules.ts) does. Kept pure and
 * apart from the schedule page so the rule can be unit-tested on its own — the
 * one about who may edit what is not a thing to leave buried in a 1900-line
 * component and hope.
 */
export interface Viewer {
  role: Role;
  /** The viewer's identity id — what `session.createdBy` holds. `null` while
   *  `/me` is still loading, which reads as "not the creator". */
  identityId: number | null;
  /** Profile ids this device holds; a session credits people by profile id,
   *  not by identity, so this is the bridge between the two. */
  myPersonIds: Set<number>;
  permissions: Partial<PermissionMatrix>;
}

/** Whether the viewer is credited on the session under one of their profiles. */
export const speaksOn = (session: SessionDto, v: Viewer): boolean =>
  session.speakers.some((p) => v.myPersonIds.has(p.id));

/**
 * Editing: an organiser, anyone credited on it (one of five co-hosts as much
 * as the only one, and an official session as much as an open one), or the
 * creator of an *open* session who holds `session.edit_own`. Being credited on
 * someone else's session is not the same as owning it — the created-by branch
 * is what keeps an attendee out of a session that is neither theirs nor one
 * they speak at.
 */
export function canEditSession(session: SessionDto, v: Viewer): boolean {
  return (
    v.role === 'admin' ||
    speaksOn(session, v) ||
    (can(v.permissions, v.role, 'session.edit_own') &&
      session.type === 'open' &&
      session.createdBy === v.identityId)
  );
}

/** Deleting is the creator's and the organiser's, never a co-speaker's: being
 *  credited on a session is not a mandate to remove it from the programme. */
export function canDeleteSession(session: SessionDto, v: Viewer): boolean {
  return (
    v.role === 'admin' ||
    (can(v.permissions, v.role, 'session.edit_own') &&
      session.type === 'open' &&
      session.createdBy === v.identityId)
  );
}

/** An official session's slot belongs to the organisers, so a speaker editing
 *  one gets the words and not the placement. `undefined` is a new session. */
export function canMoveSession(session: SessionDto | undefined, role: Role): boolean {
  return role === 'admin' || session === undefined || session.type !== 'official';
}
