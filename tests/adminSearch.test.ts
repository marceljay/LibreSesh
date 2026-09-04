import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_SETTINGS,
  ADMIN_TABS,
  findSettings,
  tabLabel,
} from '../web/src/lib/adminSearch.js';

/**
 * Manage Event is seven tabs of unrelated jobs, so knowing what you want to
 * change says nothing about where it is. The search box is the way past that,
 * and it is only as good as the index behind it — which is why the index is a
 * plain list in one file rather than JSX scattered over 2,000 lines.
 */
describe('findSettings', () => {
  const idsFor = (q: string) => findSettings(q).map((s) => s.id);

  it('finds a setting by its label', () => {
    expect(idsFor('default view')[0]).toBe('default-view');
    expect(idsFor('slug')[0]).toBe('slug');
  });

  it('finds one by a word nobody put on the label', () => {
    // The whole point of the keywords: nobody types "audit entries to keep".
    expect(idsFor('retention')[0]).toBe('audit-keep');
    expect(idsFor('unconference')[0]).toBe('pitches');
    expect(idsFor('qr')[0]).toBe('invite');
    expect(idsFor('clone')[0]).toBe('duplicate');
    expect(idsFor('url')[0]).toBe('slug');
  });

  it('ranks a label hit above a keyword hit', () => {
    // "Archive" is a label on one setting and a keyword on another (People,
    // where profiles are archived). The label wins.
    const hits = idsFor('archive');
    expect(hits[0]).toBe('archive');
    expect(hits).toContain('people');
  });

  it('lets the tab name find its own tab, but only just', () => {
    // Typing a tab's name should not float every setting on it above a real
    // match elsewhere.
    expect(idsFor('trash')[0]).toBe('trash');
    expect(idsFor('backup')[0]).toBe('backup');
  });

  it('ANDs its terms, so typing more narrows', () => {
    expect(idsFor('day starts')).toContain('hours');
    expect(idsFor('day zzz')).toEqual([]);
  });

  it('is empty for an empty query', () => {
    expect(findSettings('')).toEqual([]);
    expect(findSettings('   ')).toEqual([]);
  });

  it('caps what it returns', () => {
    expect(findSettings('e', 3).length).toBeLessThanOrEqual(3);
  });
});

describe('the index and the page agree', () => {
  const admin = readFileSync(
    join(__dirname, '..', 'web', 'src', 'pages', 'AdminPage.tsx'),
    'utf8',
  );

  it('every setting that claims an anchor has one in the page', () => {
    // A search that scrolls to nothing is worse than one that only opens the
    // tab, because it looks like it worked.
    for (const setting of ADMIN_SETTINGS) {
      if (setting.anchor === undefined) continue;
      expect(admin, `${setting.id} → setting-${setting.anchor}`).toContain(
        `<SettingAnchor id="${setting.anchor}" flashed={flashed}>`,
      );
    }
  });

  it('every anchor in the page is one the index knows about', () => {
    const claimed = new Set(
      ADMIN_SETTINGS.map((s) => s.anchor).filter((a): a is string => a !== undefined),
    );
    const inPage = [...admin.matchAll(/<SettingAnchor id="([a-z-]+)"/g)].map((m) => m[1]);
    expect(inPage.length).toBeGreaterThan(0);
    for (const id of inPage) expect(claimed).toContain(id);
  });

  it('names every tab it sends people to', () => {
    const ids = new Set(ADMIN_TABS.map((t) => t.id));
    for (const setting of ADMIN_SETTINGS) expect(ids).toContain(setting.tab);
    expect(tabLabel('settings')).toBe('Settings');
  });

  it('indexes every tab, so no part of Manage is unreachable by search', () => {
    for (const tab of ADMIN_TABS) {
      expect(
        ADMIN_SETTINGS.some((s) => s.tab === tab.id),
        `nothing in the index lives on the ${tab.label} tab`,
      ).toBe(true);
    }
  });

  it('has no duplicate ids', () => {
    const ids = ADMIN_SETTINGS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
