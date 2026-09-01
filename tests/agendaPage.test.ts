import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The schedule answers "what is on?" one day at a time — that is what a grid of
 * rooms is for. My Agenda answers "where am I going?", which is the whole event
 * at once: at a fortnight-long conference it is the only view of your own plan
 * that is not fourteen page-loads.
 *
 * There is no DOM in this suite, so what is pinned is where the list comes
 * from and the two things that make it more than a filtered day: it spans the
 * programme, and it shows you what you have double-booked.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const agenda = readFileSync(join(WEB_SRC, 'pages', 'AgendaPage.tsx'), 'utf8');
const app = readFileSync(join(WEB_SRC, 'App.tsx'), 'utf8');
const profile = readFileSync(join(WEB_SRC, 'components', 'ProfileMenu.tsx'), 'utf8');

describe('my agenda is the whole event, not a day of it', () => {
  it('is a page of its own, reached from the personal menu', () => {
    expect(app).toMatch(/<Route path="\/e\/:slug\/agenda" element=\{<AgendaPage \/>\} \/>/);
    expect(profile).toContain('My agenda');
    expect(profile).toMatch(/navigate\(`\/e\/\$\{slug\}\/agenda`\)/);
  });

  it('takes every starred session, in programme order', () => {
    // Every day, sorted by date first — the grouping into days happens after,
    // so nothing is filtered to the day on screen the way the grid is.
    expect(agenda).toContain('new Set(bundle.starredSessionIds)');
    expect(agenda).toMatch(/a\.date < b\.date \? -1 : a\.date > b\.date \? 1 : a\.startMin - b\.startMin/);
    expect(agenda).not.toMatch(/filter\(\(p\) => p\.date === day\)/);
  });

  it('says which of them you cannot both attend', () => {
    // The same helper the schedule's clash banner uses, over the flat list —
    // so a clash is found before the list is cut into days.
    expect(agenda).toContain('timeClashPairs(mine)');
    expect(agenda).toContain('clashIds.has(session.id)');
  });

  it('takes a session off the list without waiting for the server', () => {
    // Stars are private: there is no broadcast to wait for and nobody to
    // contradict us. A refusal puts it back.
    expect(agenda).toMatch(/setStarred\(session\.id, false\);\n\s*try \{/);
    expect(agenda).toMatch(/setStarred\(session\.id, true\);/);
  });

  it('hands the whole list to a calendar in one press', () => {
    expect(agenda).toContain('calendar.ics?mine=1');
  });
});
