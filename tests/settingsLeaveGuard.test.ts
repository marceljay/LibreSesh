import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EventDto } from '../server/src/shared/types.js';
import { settingsChanged, type SettingsDraft } from '../web/src/lib/settingsDraft.js';

/**
 * Manage Event → Settings is the one form on the page with a Save button, so
 * it is the one place where switching tab or going back to the schedule could
 * drop edits silently — and did (reported 2026-09-07). The guard has two
 * halves: knowing whether the form holds anything unsaved, and standing in
 * every doorway out of the tab.
 */
const saved: EventDto = {
  id: 1,
  slug: 'valley',
  name: 'Valley of the Commons',
  startDate: '2026-09-10',
  endDate: '2026-09-12',
  archived: false,
  timezone: 'Europe/Berlin',
  dayStartMin: 9 * 60,
  dayEndMin: 18 * 60,
  weekRailFrom: 8,
  userRoleLabel: 'attendee',
  auditKeep: 1000,
  showOfficialBadge: false,
  defaultView: 'list',
  pitchesEnabled: true,
};

const clean: SettingsDraft = {
  name: 'Valley of the Commons',
  slug: 'valley',
  startDate: '2026-09-10',
  endDate: '2026-09-12',
  dayStart: '09:00',
  dayEnd: '18:00',
  weekRailFrom: '8',
  auditKeep: '1000',
  defaultView: 'list',
  showOfficialBadge: false,
  pitchesEnabled: true,
  userRoleLabel: 'attendee',
  viewerPassword: '',
  userPassword: '',
  adminPassword: '',
};

describe('whether the settings form holds unsaved edits', () => {
  it('reads a freshly loaded form as clean', () => {
    expect(settingsChanged(clean, saved)).toBe(false);
  });

  it('notices every field the form can change', () => {
    const edits: Partial<SettingsDraft>[] = [
      { name: 'Valley' },
      { slug: 'valley-2027' },
      { startDate: '2026-09-11' },
      { endDate: '2026-09-13' },
      { dayStart: '08:30' },
      { dayEnd: '18:30' },
      { weekRailFrom: '10' },
      { auditKeep: '0' },
      { defaultView: 'cal' },
      { showOfficialBadge: true },
      { pitchesEnabled: false },
      { userRoleLabel: 'participant' },
    ];
    for (const edit of edits) {
      expect(settingsChanged({ ...clean, ...edit }, saved), JSON.stringify(edit)).toBe(true);
    }
  });

  it('counts a typed password as an edit — nothing saved can vouch for it', () => {
    expect(settingsChanged({ ...clean, viewerPassword: 'sunset' }, saved)).toBe(true);
    expect(settingsChanged({ ...clean, userPassword: 'sunset' }, saved)).toBe(true);
    expect(settingsChanged({ ...clean, adminPassword: 'sunset' }, saved)).toBe(true);
  });

  it('compares the way Save sends it, so a trailing space is not an edit', () => {
    expect(settingsChanged({ ...clean, name: 'Valley of the Commons  ' }, saved)).toBe(false);
    expect(settingsChanged({ ...clean, userRoleLabel: ' attendee' }, saved)).toBe(false);
  });
});

describe('every way off the Settings tab asks first', () => {
  const page = readFileSync(join(__dirname, '..', 'web', 'src', 'pages', 'AdminPage.tsx'), 'utf8');

  it('the tab bar, by click and by arrow key', () => {
    expect(page).toContain('onClick={() => switchTab(t.id)}');
    expect(page).toContain('switchTab(next.id);');
    expect(page).not.toContain('onClick={() => setTab(t.id)}');
  });

  it('a search result on another tab', () => {
    expect(page).toMatch(
      /const openSetting = useCallback\(\s*\(setting: AdminSetting\) => \{\s*void confirmLeaveSettings\(\)/,
    );
  });

  it('the way back to the schedule', () => {
    expect(page).toMatch(
      /void confirmLeaveSettings\(\)\.then\(\(ok\) => \{\s*if \(ok\) navigate\(`\/e\/\$\{slug\}`\);/,
    );
  });

  it('only when there is something to lose, and leaving drops it', () => {
    expect(page).toContain("if (tab !== 'settings' || !settingsDirty || !event) return true;");
    expect(page).toContain("title: 'Leave without saving?',");
    expect(page).toContain('if (ok) loadSettingsFrom(event);');
  });

  it("and a reload or a closed tab gets the browser's own warning", () => {
    expect(page).toContain("window.addEventListener('beforeunload', warn);");
  });
});
