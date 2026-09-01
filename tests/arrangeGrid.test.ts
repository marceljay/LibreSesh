import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Arrange is a grid mode. `Calendar` reads the `arrange` flag; `ListView` has
 * no such prop and no geometry to drag against, so in the list the button was
 * a toggle for nothing — it lit up, said "Done arranging", and left the page
 * under it unchanged.
 *
 * No DOM here, so what is pinned is the gate itself and the fact that the list
 * has nothing to gate.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const schedule = readFileSync(join(WEB_SRC, 'pages', 'SchedulePage.tsx'), 'utf8');
const listView = readFileSync(join(WEB_SRC, 'components', 'ListView.tsx'), 'utf8');
const calendar = readFileSync(join(WEB_SRC, 'components', 'Calendar.tsx'), 'utf8');

describe('Arrange belongs to the grid', () => {
  it('is offered only in the grid view', () => {
    const gate = schedule.match(/const canArrange = ([^;]+);/);
    expect(gate).not.toBeNull();
    expect((gate as RegExpMatchArray)[1]).toContain('view === "cal"');
  });

  it('is still admin-only and still off for an archived event', () => {
    const gate = (schedule.match(/const canArrange = ([^;]+);/) as RegExpMatchArray)[1] as string;
    expect(gate).toContain('role === "admin"');
    expect(gate).toContain('!event.archived');
  });

  it('draws the button only behind that gate', () => {
    expect(schedule).toContain('{canArrange && (');
    expect(schedule).toContain('data-tour="arrange"');
  });

  it('turns the mode off on the way out of the grid', () => {
    // Otherwise the drag mode stays open behind a button that is no longer on
    // screen to close it.
    expect(schedule).toContain('if (v !== "cal") setArrange(false);');
  });

  it('is read by the grid and by nothing in the list', () => {
    expect(calendar).toContain('arrange');
    expect(listView).not.toContain('arrange');
  });
});
