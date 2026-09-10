import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The schedule header ends with the organiser's actions — Manage and Arrange —
 * in a `basis-full` block, so that below `sm` they get a line of their own
 * rather than crowding the search box.
 *
 * Both need `role === 'admin'`. Add used to end that block too, so an attendee
 * fell through to a full-width line holding nothing but a right-aligned `+`,
 * hanging under the Now button with no neighbour and no label. A whole row of
 * a phone's first screenful, spent on one glyph. (LIB-190.)
 *
 * Add then moved beside Pitch a session, and the two have since merged into
 * one `+ Session ▾` control — they were the same question asked twice. So the
 * organiser block is Manage and Arrange alone now, and it renders only for an
 * organiser: left in place for anyone else it was still a flex item, and
 * `basis-full` with no children is a full-width line of zero height — the gap
 * without even the button in it.
 *
 * Layout, so there is no DOM here. LIB-190, with LIB-193's merge on top.
 */
const SCHEDULE = readFileSync(
  join(__dirname, '..', 'web', 'src', 'pages', 'SchedulePage.tsx'),
  'utf8',
);

/** The organiser block, from its guard to the end of the row after it. */
const BLOCK = SCHEDULE.slice(SCHEDULE.indexOf('basis-full items-center justify-end'));

describe("an attendee's actions do not get a row to themselves", () => {
  it('gives the organiser block the role, not just its buttons', () => {
    // The guard has to sit outside the div, or the empty flex item survives.
    expect(SCHEDULE).toMatch(
      /\{role === 'admin' && \(\s*<div className="flex basis-full items-center justify-end/,
    );
  });

  it('holds only what an organiser has', () => {
    const untilArrange = BLOCK.slice(0, BLOCK.indexOf('data-tour="arrange"'));
    expect(untilArrange).toContain('data-tour="manage"');
    // Two guards for one condition is one of them rotting: the block carries
    // the role now, so Manage does not repeat it.
    expect(untilArrange).not.toContain("role === 'admin'");
    // And Add has left the block entirely.
    expect(BLOCK.slice(0, BLOCK.indexOf('</div>'))).not.toContain('NewSessionMenu');
  });

  it('puts the way in beside the other ways of reading the programme', () => {
    // Up in the view/axis row, where the board link already lived — not down
    // in the organiser block it used to end.
    const menu = SCHEDULE.indexOf('<NewSessionMenu');
    const organiserBlock = SCHEDULE.indexOf('basis-full items-center justify-end');
    expect(menu).toBeGreaterThan(-1);
    expect(menu).toBeLessThan(organiserBlock);
  });

  it('leaves no second definition of the button behind', () => {
    // It used to be an `addButton` const of inline markup, mounted in one of
    // two places. A component now, so its two mounts — the header, and the
    // full-page session view, which are never on screen together — cannot
    // drift apart the way two copies of the markup could.
    expect(SCHEDULE).not.toContain('const addButton');
    expect(SCHEDULE.match(/<NewSessionMenu/g)).toHaveLength(2);
  });
});
