import { fold, scoreField, searchTerms } from './search';

/**
 * The map of Manage Event, and a search over it.
 *
 * Manage is seven unrelated jobs behind seven tabs, and the cost of that shape
 * is that knowing what you want to change tells you nothing about where it is:
 * "how long do we keep the log" and "can attendees pitch" are one click apart in
 * the interface and nowhere near each other in anybody's head. So there is an
 * index — every setting, what it is called, which tab holds it — and a box that
 * searches it.
 *
 * Pure and DOM-free, so the ranking can be tested without a browser and so the
 * index reads as a list rather than as JSX scattered over 2,000 lines.
 */

export const ADMIN_TABS = [
  { id: 'programme', label: 'Programme' },
  { id: 'people', label: 'People' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'settings', label: 'Settings' },
  { id: 'backup', label: 'Backup' },
  { id: 'trash', label: 'Trash' },
  { id: 'audit', label: 'Audit' },
] as const;

export type AdminTabId = (typeof ADMIN_TABS)[number]['id'];

export const tabLabel = (id: AdminTabId): string =>
  ADMIN_TABS.find((t) => t.id === id)?.label ?? id;

export interface AdminSetting {
  /** Unique within the index; not necessarily an anchor — see `anchor`. */
  id: string;
  /** What it is called on screen. Keep the two in step — a search that finds a
   *  label nobody can see is worse than one that finds nothing. */
  label: string;
  tab: AdminTabId;
  /**
   * What somebody might type instead of the label. This is where the index
   * earns its keep: nobody searching for "how long we keep the log" types
   * "audit entries to keep", and nobody looking for the pitch board types
   * "board" first.
   */
  keywords?: string;
  /**
   * The element the page scrolls to, marked `setting-<anchor>` in the JSX.
   * Absent when opening the tab is all there is to do — a tab that is one
   * screen about one thing has nowhere further to go. Two settings may share
   * an anchor when they sit in the same row of a form.
   */
  anchor?: string;
}

/**
 * Every setting worth finding.
 *
 * The Settings tab is indexed field by field, because that is where a named
 * setting lives and where "which of these twelve boxes was it" actually bites.
 * The other tabs are indexed as jobs — Rooms, Tags, Trash — because each is a
 * whole screen about one thing, and landing on the tab *is* landing on it.
 */
export const ADMIN_SETTINGS: AdminSetting[] = [
  {
    id: 'name',
    label: 'Name',
    tab: 'settings',
    keywords: 'event title rename what it is called',
    anchor: 'name',
  },
  {
    id: 'slug',
    label: 'Slug',
    tab: 'settings',
    keywords: 'url address link web path rename',
    anchor: 'slug',
  },
  {
    id: 'dates',
    label: 'Start and end date',
    tab: 'settings',
    keywords: 'when dates first last day length runs',
    // The four date and time boxes are one row of the form, so both entries
    // land on it; which of the four you meant is obvious once you are there.
    anchor: 'when',
  },
  {
    id: 'hours',
    label: 'Day starts and ends',
    tab: 'settings',
    keywords: 'hours opening closing earliest latest time grid top bottom',
    anchor: 'when',
  },
  {
    id: 'week-rail',
    label: 'Group days into weeks past',
    tab: 'settings',
    keywords: 'weeks rail long event day tabs strip',
    anchor: 'week-rail',
  },
  {
    id: 'default-view',
    label: 'Default view',
    tab: 'settings',
    keywords: 'opens in list calendar grid landing first view',
    anchor: 'default-view',
  },
  {
    id: 'official-badge',
    label: 'Mark the official programme',
    tab: 'settings',
    keywords: 'official badge tag programme open sessions distinguish',
    anchor: 'official-badge',
  },
  {
    id: 'pitches',
    label: 'Pitch board',
    tab: 'settings',
    keywords: 'pitches proposals unconference propose suggest board interest',
    anchor: 'pitches',
  },
  {
    id: 'audit-keep',
    label: 'Audit entries to keep',
    tab: 'settings',
    keywords: 'log retention history prune how long trim',
    anchor: 'audit-keep',
  },
  {
    id: 'role-label',
    label: 'What you call your participants',
    tab: 'settings',
    keywords: 'attendee participant member delegate role label wording',
    anchor: 'role-label',
  },
  {
    id: 'passwords',
    label: 'Passwords',
    tab: 'settings',
    keywords: 'password viewer user admin sign in access code entry gate',
    anchor: 'passwords',
  },
  {
    id: 'invite',
    label: 'Invite links',
    tab: 'settings',
    keywords: 'invite qr code share join link poster',
    anchor: 'invite',
  },
  {
    id: 'duplicate',
    label: 'Duplicate event',
    tab: 'settings',
    keywords: 'clone copy next year reuse repeat same again',
    anchor: 'duplicate',
  },
  {
    id: 'archive',
    label: 'Archive',
    tab: 'settings',
    keywords: 'close finish read only over freeze lock',
    anchor: 'archive',
  },
  {
    id: 'rooms',
    label: 'Rooms',
    tab: 'programme',
    keywords: 'room capacity seats colour booking where directions space',
  },
  {
    id: 'tags',
    label: 'Tags',
    tab: 'programme',
    keywords: 'tag label colour topic subject',
  },
  {
    id: 'tracks',
    label: 'Tracks',
    tab: 'programme',
    keywords: 'track strand theme stream columns hours',
  },
  {
    id: 'formats',
    label: 'Formats',
    tab: 'programme',
    keywords: 'format kind workshop talk panel jam type',
  },
  {
    id: 'breaks',
    label: 'Breaks',
    tab: 'programme',
    keywords: 'break lunch coffee pause gap band',
  },
  {
    id: 'people',
    label: 'People',
    tab: 'people',
    keywords: 'person profile speaker attendee claim username archive merge',
  },
  {
    id: 'permissions',
    label: 'Permissions',
    tab: 'permissions',
    keywords: 'role capability who can allow forbid rights',
  },
  {
    id: 'backup',
    label: 'Backup and import',
    tab: 'backup',
    keywords: 'export import json download restore file document',
  },
  {
    id: 'trash',
    label: 'Trash',
    tab: 'trash',
    keywords: 'deleted restore recover bin undo removed',
  },
  {
    id: 'audit',
    label: 'Audit log',
    tab: 'audit',
    keywords: 'log history who did what changes trail',
  },
];

/**
 * Settings matching a query, best first.
 *
 * Terms are ANDed, as everywhere else in the app, so typing more always
 * narrows. The weights say: the label is what it is called, a keyword is what
 * you might have called it, and the tab name is the weakest signal of all —
 * typing "settings" should not put all fourteen settings above a real match.
 */
export function findSettings(query: string, limit = 8): AdminSetting[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const scored: { setting: AdminSetting; score: number }[] = [];
  for (const setting of ADMIN_SETTINGS) {
    const label = fold(setting.label);
    const keywords = fold(setting.keywords ?? '');
    const tab = fold(tabLabel(setting.tab));
    let total = 0;
    for (const term of terms) {
      const best = Math.max(
        label === term ? 60 : scoreField(label, term, 40, 24),
        scoreField(keywords, term, 20, 12),
        scoreField(tab, term, 10, 0),
      );
      if (best === 0) {
        total = 0;
        break;
      }
      total += best;
    }
    if (total > 0) scored.push({ setting, score: total });
  }
  // Stable sort, so an equal score keeps the index's own order — which runs
  // Settings first and then the tabs left to right, the way the page reads.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.setting);
}
