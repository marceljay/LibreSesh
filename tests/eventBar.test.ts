import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The row at the top of an event — logo, event name, bell, the menu behind
 * your name — used to be the schedule's alone. The agenda and search had the
 * logo and name with no menu; a profile, the pitch board and Manage Event had
 * a "← Schedule" link and nothing else. Anyone on those pages who wanted their
 * agenda, their calendar, another device or the way out had to find the
 * schedule first, and the profile menu's one row nobody found was the least
 * of it.
 *
 * One component now, on every page of an event. There is no DOM in this
 * suite, so what is pinned is that every page mounts it and what each hands
 * it.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const read = (...p: string[]) => readFileSync(join(WEB_SRC, ...p), 'utf8');
const bar = read('components', 'EventBar.tsx');

const PAGES = [
  ['pages', 'SchedulePage.tsx'],
  ['pages', 'AgendaPage.tsx'],
  ['pages', 'SearchPage.tsx'],
  ['pages', 'ProfilePage.tsx'],
  ['pages', 'AdminPage.tsx'],
  ['components', 'ProposalBoard.tsx'],
] as const;

describe('one event bar, on every page of an event', () => {
  it.each(PAGES)('%s/%s mounts it', (dir, file) => {
    expect(read(dir, file)).toMatch(/<EventBar\n/);
  });

  it('carries the logo, the name, the bell and the menu', () => {
    expect(bar).toMatch(/<Link\s+to="\/"[\s\S]{0,200}?aria-label="LibreSesh home"/);
    expect(bar).toContain('{event.name}');
    expect(bar).toContain('<NotificationBell slug={slug} ping={ping} />');
    expect(bar).toMatch(/<ProfileMenu\n/);
    // And the calendar dialog the menu opens, so no page has to.
    expect(bar).toMatch(/<CalendarExportModal\n/);
  });

  it('says how to get back to the schedule unless the page says otherwise', () => {
    expect(bar).toMatch(/\{sub \?\? \(\s*<Link\s+to=\{`\/e\/\$\{slug\}`\}/);
    expect(bar).toContain('← Back to the schedule');
    // The schedule is the one page with nothing to go back to: its line says
    // whether it is live.
    expect(read('pages', 'SchedulePage.tsx')).toMatch(/sub=\{\s*<div\s+data-tour="live"/);
  });

  it('leaves no page with a bar of its own', () => {
    for (const [dir, file] of PAGES) {
      const src = read(dir, file);
      expect(src).not.toContain('aria-label="LibreSesh home"');
      expect(src).not.toContain('<ProfileMenu');
      expect(src).not.toContain('<NotificationBell');
    }
  });

  it('signs out to somewhere that still makes sense', () => {
    // A page that renders the gate itself reloads into it; a page that
    // cannot — a profile, the board, Manage Event — goes to the schedule,
    // which can.
    for (const file of ['SchedulePage.tsx', 'AgendaPage.tsx', 'SearchPage.tsx']) {
      expect(read('pages', file)).toMatch(
        /onSignOut=\{\(\) => void api\.logout\(slug\)\.then\(\(\) => void data\.reload\(\)\)\}/,
      );
    }
    for (const [dir, file] of [
      ['pages', 'ProfilePage.tsx'],
      ['pages', 'AdminPage.tsx'],
      ['components', 'ProposalBoard.tsx'],
    ] as const) {
      expect(read(dir, file)).toMatch(
        /onSignOut=\{\(\) => void api\.logout\(slug\)\.then\(\(\) => navigate\(`\/e\/\$\{slug\}`\)\)\}/,
      );
    }
  });

  it('is a row, not a header', () => {
    // The schedule's header holds more than the bar, and a header inside a
    // header is not HTML. Each page wraps the row in its own.
    expect(bar).not.toMatch(/<header className/);
    for (const [dir, file] of PAGES) {
      expect(read(dir, file)).toMatch(/<header className[\s\S]*?<EventBar/);
    }
  });
});
