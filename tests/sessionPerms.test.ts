import { describe, expect, it } from 'vitest';
import type { Role, SessionDto } from '../server/src/shared/types.js';
import type { PermissionMatrix } from '../server/src/shared/capabilities.js';
import {
  canDeleteSession,
  canEditSession,
  canMoveSession,
  type Viewer,
} from '../web/src/lib/sessionPerms.js';

/**
 * Who may edit, delete and move a session, on the client. This mirrors the
 * server's `assertMayMutate`; the case that matters most is the one an
 * attendee must never pass — editing a session that is neither theirs nor one
 * they speak at.
 */
describe('session permissions (client)', () => {
  const perms: Partial<PermissionMatrix> = { 'session.edit_own': ['user', 'speaker', 'admin'] };

  const session = (over: Partial<SessionDto> = {}): SessionDto =>
    ({
      id: 1,
      type: 'open',
      createdBy: 100,
      speakers: [],
      ...over,
    }) as SessionDto;

  const viewer = (role: Role, identityId: number | null, myPersonIds: number[] = []): Viewer => ({
    role,
    identityId,
    myPersonIds: new Set(myPersonIds),
    permissions: perms,
  });

  it('lets an admin edit, delete and move anything', () => {
    const s = session({ type: 'official', createdBy: 999 });
    const admin = viewer('admin', 7);
    expect(canEditSession(s, admin)).toBe(true);
    expect(canDeleteSession(s, admin)).toBe(true);
    expect(canMoveSession(s, 'admin')).toBe(true);
  });

  it('lets the creator edit and delete their own open session', () => {
    const s = session({ createdBy: 100 });
    const me = viewer('user', 100);
    expect(canEditSession(s, me)).toBe(true);
    expect(canDeleteSession(s, me)).toBe(true);
  });

  it("stops an attendee editing or deleting someone else's session", () => {
    const theirs = session({ createdBy: 200 }); // not this viewer
    const me = viewer('user', 100);
    expect(canEditSession(theirs, me)).toBe(false);
    expect(canDeleteSession(theirs, me)).toBe(false);
  });

  it('treats a not-yet-loaded identity as nobody', () => {
    const s = session({ createdBy: 100 });
    const loading = viewer('user', null);
    expect(canEditSession(s, loading)).toBe(false);
  });

  it('lets a credited speaker edit an official session but not move it', () => {
    const s = session({ type: 'official', createdBy: 999, speakers: [{ id: 55, name: 'Ada' }] });
    const speaker = viewer('user', 100, [55]); // credited under profile 55
    expect(canEditSession(s, speaker)).toBe(true);
    expect(canMoveSession(s, 'user')).toBe(false); // an official slot stays the organisers'
  });

  it('does not let a co-speaker delete a session they do not own', () => {
    const s = session({ type: 'official', createdBy: 999, speakers: [{ id: 55, name: 'Ada' }] });
    const speaker = viewer('user', 100, [55]);
    expect(canDeleteSession(s, speaker)).toBe(false); // credited, but not the owner
  });

  it('keeps an attendee out of their own session once it is official', () => {
    // The created-by branch is open-only, so promoting a session to official
    // takes it out of the attendee's hands even though they made it.
    const s = session({ type: 'official', createdBy: 100 });
    const me = viewer('user', 100);
    expect(canEditSession(s, me)).toBe(false);
  });

  it('refuses a viewer with no edit_own capability', () => {
    const s = session({ createdBy: 100 });
    const readOnly: Viewer = { ...viewer('viewer', 100), permissions: perms };
    expect(canEditSession(s, readOnly)).toBe(false);
  });

  it('lets anyone move a new (undefined) session', () => {
    expect(canMoveSession(undefined, 'user')).toBe(true);
  });
});
