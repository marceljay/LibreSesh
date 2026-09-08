import { describe, expect, it } from 'vitest';
import type { Role, SessionDto } from '../server/src/shared/types.js';
import type { PermissionMatrix } from '../server/src/shared/capabilities.js';
import {
  canContribute,
  canCreateSession,
  canDeleteSession,
  canEditProfile,
  canEditSession,
  canModerateContributions,
  canMoveSession,
  canPitch,
  canRemoveContribution,
  canStarSessions,
  canVote,
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

/**
 * The other controls, decided by the matrix and never by the role's name.
 * Each pair below is a viewer granted something viewers do not get by
 * default, and an attendee stripped of something attendees do — the two
 * cases a name check gets wrong in opposite directions.
 */
describe('capability-gated controls (client)', () => {
  const v = (role: Role, permissions: Partial<PermissionMatrix>, identityId = 7): Viewer => ({
    role,
    identityId,
    myPersonIds: new Set(),
    permissions,
  });

  it('shows the composer to a viewer granted contribution.create', () => {
    expect(canContribute(v('viewer', { 'contribution.create': ['viewer'] }), false)).toBe(true);
  });
  it('hides the composer from an attendee it was taken from', () => {
    expect(canContribute(v('user', { 'contribution.create': ['viewer'] }), false)).toBe(false);
  });
  it('closes the composer on an archived event whatever the matrix says', () => {
    expect(canContribute(v('user', { 'contribution.create': ['user'] }), true)).toBe(false);
  });

  it('lets the author remove their own contribution, given the capability', () => {
    const perms = { 'contribution.delete_own': ['viewer'] };
    expect(canRemoveContribution({ createdBy: 7 }, v('viewer', perms), false)).toBe(true);
    expect(canRemoveContribution({ createdBy: 8 }, v('viewer', perms), false)).toBe(false);
    expect(canRemoveContribution({ createdBy: 7 }, v('viewer', {}), false)).toBe(false);
  });
  it('lets an organiser remove and hide anything', () => {
    expect(canRemoveContribution({ createdBy: 8 }, v('admin', {}), false)).toBe(true);
    expect(canModerateContributions(v('admin', {}), false)).toBe(true);
    expect(canModerateContributions(v('user', {}), false)).toBe(false);
  });

  it('stars by capability, viewer included', () => {
    expect(canStarSessions(v('viewer', { 'session.star': ['viewer'] }))).toBe(true);
    expect(canStarSessions(v('user', { 'session.star': ['viewer'] }))).toBe(false);
  });

  it('offers Add session only with the capability and a room to put it in', () => {
    const open = [{ openBooking: false }, { openBooking: true }];
    const closed = [{ openBooking: false }];
    const perms = { 'session.create_open': ['viewer', 'user'] };
    expect(canCreateSession(v('viewer', perms), open, false)).toBe(true);
    expect(canCreateSession(v('user', perms), closed, false)).toBe(false);
    expect(canCreateSession(v('user', {}), open, false)).toBe(false);
    expect(canCreateSession(v('admin', {}), closed, false)).toBe(true);
  });

  it('pitches and votes by capability', () => {
    expect(canPitch(v('viewer', { 'proposal.create': ['viewer'] }), false)).toBe(true);
    expect(canPitch(v('user', { 'proposal.create': ['viewer'] }), false)).toBe(false);
    expect(canVote(v('viewer', { 'proposal.vote': ['viewer'] }))).toBe(true);
    expect(canVote(v('user', {}))).toBe(false);
  });

  it('edits a held profile by capability', () => {
    expect(canEditProfile({ isMine: true }, v('viewer', { 'person.edit_own': ['viewer'] }))).toBe(
      true,
    );
    expect(canEditProfile({ isMine: true }, v('viewer', {}))).toBe(false);
    expect(canEditProfile({ isMine: false }, v('viewer', { 'person.edit_own': ['viewer'] }))).toBe(
      false,
    );
    expect(canEditProfile({ isMine: false }, v('admin', {}))).toBe(true);
  });
});
