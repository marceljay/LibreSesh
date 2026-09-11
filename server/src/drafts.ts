/**
 * Drafts: a session kept, and kept off the schedule.
 *
 * A draft is an ordinary session row with `draft = 1`. It keeps its room and
 * its time, so publishing it puts it back exactly where it was, but it claims
 * neither — `assertNoOverlap` and the hold rule skip it, and publishing one is
 * checked as the placement it is. Who sees it is who has a hand in it: the
 * organisers, whoever added it, and the people credited on it. Everyone else
 * is told nothing, on every path a session is read by — the bundle, the
 * session route, the stream, the calendar feed, a profile's list — which is
 * why the rule lives here once rather than in each of them.
 */
import { getRole } from './auth.js';
import type { Db, SessionRow } from './db.js';
import { notFound } from './errors.js';
import { loadSessionDto } from './mappers.js';
import { getPermissions, type PermissionMatrix } from './permissions.js';
import { canMutate } from './series.js';
import { getSession } from './sessionRules.js';
import type { ChangeEvent, Role, SessionDto } from './shared/types.js';
import type { Broker } from './sse.js';

/** Whether one reader may see a given session row. */
export type SessionVisibility = (row: SessionRow) => boolean;

/**
 * The reader's view of the event's sessions. A published session is anyone's;
 * a draft is the organisers', its creator's, and whoever else `canMutate`
 * lets edit it. The creator is named outright rather than left to
 * `canMutate`, which also asks for `session.edit_own`: an organiser who takes
 * that capability away mid-event has stopped someone editing, not made the
 * session they wrote disappear from under them.
 *
 * The matrix is read once, and only if a draft turns up that needs it.
 */
export function sessionVisibility(
  db: Db,
  eventId: number,
  identityId: number,
  role: Role | undefined,
): SessionVisibility {
  let matrix: PermissionMatrix | undefined;
  return (row) => {
    if (row.draft === 0 || role === 'admin' || row.created_by === identityId) return true;
    if (!role) return false;
    matrix ??= getPermissions(db, eventId);
    return canMutate(db, matrix, role, identityId, row);
  };
}

/** `getSession`, answering 404 — not 403 — for a draft this reader may not see:
 *  a refusal would confirm there is something there to refuse. */
export function getVisibleSession(
  db: Db,
  eventId: number,
  sessionId: number,
  identityId: number,
  role: Role | undefined,
): SessionRow {
  const row = getSession(db, eventId, sessionId);
  if (!sessionVisibility(db, eventId, identityId, role)(row)) throw notFound('No such session');
  return row;
}

/**
 * Broadcast a created or updated session to the people who may see it.
 *
 * A published session goes to the whole channel, as every session always has.
 * A draft is sent stream by stream: to whoever may see it, the session; to
 * everyone else, on an update, its removal — an update is how a published
 * session *becomes* a draft, and their copy has to go — and on a create,
 * nothing at all.
 */
export function publishSession(
  db: Db,
  broker: Broker,
  event: { id: number; slug: string },
  type: 'session.created' | 'session.updated',
  row: SessionRow,
  dto: SessionDto = loadSessionDto(db, row),
): void {
  if (row.draft === 0) {
    broker.publish(event.slug, type, dto);
    return;
  }
  const shown: ChangeEvent = { type, entity: dto };
  const gone: ChangeEvent | null =
    type === 'session.updated' ? { type: 'session.deleted', entity: { id: row.id } } : null;
  // One person with three tabs open is one question, not three.
  const verdicts = new Map<number, boolean>();
  broker.publishEach(event.slug, (identityId) => {
    if (identityId === undefined) return gone;
    let may = verdicts.get(identityId);
    if (may === undefined) {
      const role = getRole(db, identityId, event.id);
      may = sessionVisibility(db, event.id, identityId, role)(row);
      verdicts.set(identityId, may);
    }
    return may ? shown : gone;
  });
}
