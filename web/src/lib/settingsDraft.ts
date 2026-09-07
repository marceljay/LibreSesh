import type { EventDto, ViewMode } from '@shared/types';
import { fmtMin } from './format';

/** The Settings form as the organiser has it: every box as it is typed. */
export interface SettingsDraft {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  dayStart: string;
  dayEnd: string;
  weekRailFrom: string;
  auditKeep: string;
  defaultView: ViewMode;
  showOfficialBadge: boolean;
  pitchesEnabled: boolean;
  userRoleLabel: string;
  viewerPassword: string;
  userPassword: string;
  adminPassword: string;
}

/**
 * Whether the form holds anything Save has not sent.
 *
 * Compared the way `saveSettings` sends it — the name and the role label
 * trimmed, the times as the boxes show them — so a trailing space is not an
 * edit, and a form that was saved reads as clean the moment the saved event
 * comes back. A password box is an edit while it holds anything: the saved
 * event never carries a password to compare against, and a typed one that
 * was never sent is exactly what leaving would lose.
 */
export function settingsChanged(draft: SettingsDraft, event: EventDto): boolean {
  return (
    draft.name.trim() !== event.name ||
    draft.slug !== event.slug ||
    draft.startDate !== event.startDate ||
    draft.endDate !== event.endDate ||
    draft.dayStart !== fmtMin(event.dayStartMin) ||
    draft.dayEnd !== fmtMin(event.dayEndMin) ||
    draft.weekRailFrom !== String(event.weekRailFrom) ||
    draft.auditKeep !== String(event.auditKeep) ||
    draft.defaultView !== event.defaultView ||
    draft.showOfficialBadge !== event.showOfficialBadge ||
    draft.pitchesEnabled !== event.pitchesEnabled ||
    draft.userRoleLabel.trim() !== event.userRoleLabel ||
    draft.viewerPassword !== '' ||
    draft.userPassword !== '' ||
    draft.adminPassword !== ''
  );
}
