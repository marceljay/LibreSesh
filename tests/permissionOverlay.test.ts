import { describe, expect, it } from 'vitest';
import type { PermissionMatrix } from '../server/src/shared/capabilities.js';
import { overlay, settled } from '../web/src/pages/AdminPermissions.js';

/**
 * The permission matrix draws its switches from the saved matrix with any
 * clicked-but-unsaved switch laid over it. Without the overlay a checkbox
 * paints itself on click and React puts it straight back on the next render,
 * so the switch flicks back and then flicks forward a round trip later.
 */
const saved = (over: Partial<PermissionMatrix> = {}): Partial<PermissionMatrix> => ({
  'session.create': ['user', 'speaker', 'admin'],
  ...over,
});

describe('overlay', () => {
  it('reads the saved value when nothing is in flight', () => {
    expect(overlay(saved(), {}, 'session.create')).toEqual(['user', 'speaker', 'admin']);
  });

  it('prefers the clicked value while it is still saving', () => {
    const optimistic: Partial<PermissionMatrix> = { 'session.create': ['speaker', 'admin'] };
    expect(overlay(saved(), optimistic, 'session.create')).toEqual(['speaker', 'admin']);
  });

  it('leaves other capabilities alone', () => {
    const optimistic: Partial<PermissionMatrix> = { 'session.create': ['admin'] };
    expect(overlay(saved(), optimistic, 'contribution.create')).toEqual([]);
  });
});

describe('settled', () => {
  it('retires an entry the saved matrix has caught up with', () => {
    const optimistic: Partial<PermissionMatrix> = { 'session.create': ['speaker', 'admin'] };
    expect(settled(saved({ 'session.create': ['speaker', 'admin'] }), optimistic)).toEqual({});
  });

  /**
   * The server returns a capability in ROLE_ORDER once it has stored an
   * override, but in the capability's own declared order while it still sits
   * at its defaults — so a switch flipped back to default comes home as the
   * same set in a different order. Comparing by position would strand the
   * optimistic value on top of it for good.
   */
  it('retires an entry that came back in a different order', () => {
    const optimistic: Partial<PermissionMatrix> = { 'session.create': ['admin', 'speaker'] };
    expect(settled(saved({ 'session.create': ['speaker', 'admin'] }), optimistic)).toEqual({});
  });

  it('keeps an entry the saved matrix has not caught up with', () => {
    const optimistic: Partial<PermissionMatrix> = { 'session.create': ['admin'] };
    expect(settled(saved(), optimistic)).toEqual(optimistic);
  });

  it('keeps object identity when nothing settled, so it can run every render', () => {
    const optimistic: Partial<PermissionMatrix> = { 'session.create': ['admin'] };
    expect(settled(saved(), optimistic)).toBe(optimistic);
  });

  it('settles one entry without disturbing another still in flight', () => {
    const optimistic: Partial<PermissionMatrix> = {
      'session.create': ['speaker', 'admin'],
      'contribution.create': ['admin'],
    };
    expect(settled(saved({ 'session.create': ['speaker', 'admin'] }), optimistic)).toEqual({
      'contribution.create': ['admin'],
    });
  });
});
