import { CAPABILITIES } from '@shared/capabilities';
import type { AuditChangeDto, AuditValue } from '@shared/types';
import { fmtMin } from './format';

/**
 * How a line in the audit log says what an edit changed.
 *
 * The server stores each change by the setting's API name with the value
 * before and after, and says nothing about how to read it: `dayStartMin`
 * holds minutes, `auditKeep` holds a count whose zero means "everything",
 * `pitchesEnabled` is a boolean. This turns each into the words the Settings
 * form uses for the same thing — the organiser reading the log is the one
 * who made the edit on that form, and the line should read the way they
 * remember it.
 */

/** One change, in words: its label and the values as the form would show
 *  them. `from` is null for a creation (nothing came before) and both are
 *  null for a secret, which is reported by its label alone. */
export interface ChangeText {
  label: string;
  from: string | null;
  to: string | null;
}

/** The form's label for each setting the log itemises. */
const SETTING_LABELS: Record<string, string> = {
  name: 'Name',
  slug: 'Slug',
  timezone: 'Timezone',
  startDate: 'Start date',
  endDate: 'End date',
  dayStartMin: 'Day starts',
  dayEndMin: 'Day ends',
  weekRailFrom: 'Group days into weeks past',
  defaultView: 'Default view',
  userRoleLabel: 'What you call your participants',
  auditKeep: 'Audit entries to keep',
  showOfficialBadge: 'Mark the official programme',
  pitchesEnabled: 'Pitch board',
  archived: 'Archived',
  viewerPassword: 'Viewer password',
  userPassword: 'Attendee password',
  adminPassword: 'Organiser password',
};

/** What each role is called in a permissions line. Plural, because the value
 *  is who may do a thing: "viewers, attendees". */
const ROLE_NAMES: Record<string, string> = {
  viewer: 'viewers',
  user: 'attendees',
  speaker: 'speakers',
  admin: 'organisers',
};

const onOff = (v: AuditValue): string => (v === true ? 'on' : v === false ? 'off' : String(v));

/** A value as the Settings form would show it. */
function settingValue(field: string, value: AuditValue): string {
  if (value === null) return '—';
  switch (field) {
    case 'dayStartMin':
    case 'dayEndMin':
      return typeof value === 'number' ? fmtMin(value) : String(value);
    case 'weekRailFrom':
      return typeof value === 'number' ? `${value} days` : String(value);
    case 'defaultView':
      return value === 'cal' ? 'Calendar' : value === 'list' ? 'List' : String(value);
    case 'auditKeep':
      return value === 0 ? 'everything' : Number(value).toLocaleString();
    case 'archived':
      return value === true ? 'yes' : value === false ? 'no' : String(value);
    case 'showOfficialBadge':
    case 'pitchesEnabled':
      return onOff(value);
    default:
      return typeof value === 'string' ? `“${value}”` : String(value);
  }
}

/** The roles in a permissions value — a comma-joined list, or empty for
 *  nobody — as words. */
function rolesValue(value: AuditValue): string {
  if (typeof value !== 'string' || value === '') return 'nobody';
  return value
    .split(',')
    .map((role) => ROLE_NAMES[role] ?? role)
    .join(', ');
}

export function describeChange(entity: string, change: AuditChangeDto): ChangeText {
  if (entity === 'permissions') {
    const label = CAPABILITIES.find((cap) => cap.id === change.field)?.label ?? change.field;
    return {
      label,
      from: change.from === undefined ? null : rolesValue(change.from),
      to: change.to === undefined ? null : rolesValue(change.to),
    };
  }
  return {
    label: SETTING_LABELS[change.field] ?? change.field,
    from: change.from === undefined ? null : settingValue(change.field, change.from),
    to: change.to === undefined ? null : settingValue(change.field, change.to),
  };
}

/** The whole change as one string, for the filter box and for a title. */
export function changeText(entity: string, change: AuditChangeDto): string {
  const { label, from, to } = describeChange(entity, change);
  if (from === null && to === null) return `${label} changed`;
  if (from === null) return `${label}: ${to}`;
  return `${label}: ${from} → ${to}`;
}
