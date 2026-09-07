import type { AuditEntryDto } from '@shared/types';

/**
 * Where a line in the audit log can be opened, if anywhere.
 *
 * The log said "deleted session — Opening keynote" and left you to find it:
 * the session if it was still there, the bin if it was not, the person's
 * profile if the line was about them. Each is a page the app already has, so
 * the line links to it. A thing in the bin opens Trash, where it can be put
 * back — the reason an organiser is reading the log in the first place. A
 * thing the server could not look up (`state` null) links nowhere: a link to
 * a row that no longer exists is worse than none.
 */
export function auditSubjectHref(slug: string, e: AuditEntryDto): string | null {
  if (e.entityId === null || e.entityState === null) return null;
  const trashed = e.entityState === 'trashed';
  const admin = (tab: string) => `/e/${slug}/admin?tab=${tab}`;
  switch (e.entity) {
    case 'session':
      return trashed ? admin('trash') : `/e/${slug}/s/${e.entityId}`;
    case 'contribution':
      // A note has no page of its own; it lives on the session it was left on.
      if (trashed) return admin('trash');
      return e.entityParentId === null ? null : `/e/${slug}/s/${e.entityParentId}`;
    case 'person':
      // An archived profile is still on the People tab, under its filter.
      return trashed ? admin('people') : `/e/${slug}/p/${e.entityId}`;
    case 'proposal':
      // The board holds no bin: a withdrawn pitch is gone.
      return trashed ? null : `/e/${slug}/proposals`;
    case 'room':
    case 'tag':
    case 'track':
    case 'format':
      return trashed ? null : admin('programme');
    default:
      return null;
  }
}

/** The actor's profile, when they have one in this event. */
export function auditActorHref(slug: string, e: AuditEntryDto): string | null {
  return e.actorPersonId === null ? null : `/e/${slug}/p/${e.actorPersonId}`;
}
