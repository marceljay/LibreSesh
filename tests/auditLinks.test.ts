import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuditEntryDto } from '../server/src/shared/types.js';
import { auditActorHref, auditSubjectHref } from '../web/src/lib/auditLinks.js';

/**
 * The audit log named who did what and left you to find both: the person, the
 * session, or the bin it went to (reported 2026-09-07). Every one of those is a
 * page the app already has, so the line links there. What is pinned here is
 * where each kind of line goes — and that a thing the server could not look up
 * goes nowhere, because a link to a missing row is worse than none.
 */
const base: AuditEntryDto = {
  id: 1,
  at: '2026-09-07T10:00:00Z',
  actorName: 'ada',
  actorUid: 'a3f9c',
  actorPersonId: 7,
  action: 'update',
  entity: 'session',
  entityId: 42,
  entityLabel: 'Opening keynote',
  entityState: 'live',
  entityParentId: null,
};
const line = (over: Partial<AuditEntryDto>): AuditEntryDto => ({ ...base, ...over });

describe('where an audit line opens', () => {
  it('a live session opens the session; one in the bin opens Trash', () => {
    expect(auditSubjectHref('conf', line({}))).toBe('/e/conf/s/42');
    expect(auditSubjectHref('conf', line({ entityState: 'trashed' }))).toBe(
      '/e/conf/admin?tab=trash',
    );
  });

  it('a note opens the session it was left on, or Trash once deleted', () => {
    const note = line({ entity: 'contribution', entityId: 9, entityParentId: 42 });
    expect(auditSubjectHref('conf', note)).toBe('/e/conf/s/42');
    expect(auditSubjectHref('conf', { ...note, entityState: 'trashed' })).toBe(
      '/e/conf/admin?tab=trash',
    );
    expect(auditSubjectHref('conf', { ...note, entityParentId: null })).toBeNull();
  });

  it('a person opens their profile; an archived one, the People tab', () => {
    expect(auditSubjectHref('conf', line({ entity: 'person', entityId: 7 }))).toBe('/e/conf/p/7');
    expect(
      auditSubjectHref('conf', line({ entity: 'person', entityId: 7, entityState: 'trashed' })),
    ).toBe('/e/conf/admin?tab=people');
  });

  it('a pitch opens the board, and a withdrawn one goes nowhere — the board has no bin', () => {
    expect(auditSubjectHref('conf', line({ entity: 'proposal' }))).toBe('/e/conf/proposals');
    expect(
      auditSubjectHref('conf', line({ entity: 'proposal', entityState: 'trashed' })),
    ).toBeNull();
  });

  it('rooms, tags, tracks and formats open the Programme tab while they exist', () => {
    for (const entity of ['room', 'tag', 'track', 'format']) {
      expect(auditSubjectHref('conf', line({ entity }))).toBe('/e/conf/admin?tab=programme');
      expect(auditSubjectHref('conf', line({ entity, entityState: 'trashed' }))).toBeNull();
    }
  });

  it('links nowhere when the server could not look the thing up', () => {
    expect(auditSubjectHref('conf', line({ entityState: null }))).toBeNull();
    expect(auditSubjectHref('conf', line({ entityId: null }))).toBeNull();
    expect(auditSubjectHref('conf', line({ entity: 'permissions', entityId: 1 }))).toBeNull();
  });

  it('the actor opens their profile, when they have one here', () => {
    expect(auditActorHref('conf', line({}))).toBe('/e/conf/p/7');
    expect(auditActorHref('conf', line({ actorPersonId: null }))).toBeNull();
  });
});

describe('the audit tab uses them', () => {
  const tab = readFileSync(join(__dirname, '..', 'web', 'src', 'pages', 'AdminAudit.tsx'), 'utf8');

  it('for the actor and for the subject, in the folded members too', () => {
    expect(tab).toContain('auditActorHref(slug, entry)');
    expect(tab).toContain('auditSubjectHref(slug, entry)');
    expect(tab).toContain('<What slug={slug} entry={member} />');
  });

  it('says where a link goes when that is the bin', () => {
    expect(tab).toContain("entry.entityState === 'trashed' ? 'Open in Trash' : 'Open'");
  });
});
