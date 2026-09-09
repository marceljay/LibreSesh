import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The schedule header ends with the organiser's actions — Manage, Arrange,
 * Add — in a `basis-full` block, so that below `sm` the three of them get a
 * line of their own rather than crowding the search box.
 *
 * Manage and Arrange both need `role === 'admin'`. An attendee therefore fell
 * through to a full-width line holding nothing but a right-aligned `+`,
 * hanging under the Now button with no neighbour and no label — `Add session`
 * is `hidden sm:inline`, which is exactly the width where the empty row
 * appears. A whole row of a phone's first screenful, spent on one glyph.
 *
 * So the block is organiser-only now, and Add renders beside **Pitch a
 * session** for everyone else: the two ways an attendee puts a session into
 * the world, which had been a row apart.
 *
 * Layout, so there is no DOM here — what is pinned is which branch renders
 * the button and what guards the block. LIB-190.
 */
const SCHEDULE = readFileSync(
  join(__dirname, '..', 'web', 'src', 'pages', 'SchedulePage.tsx'),
  'utf8',
);

describe("an attendee's + does not get a row to itself", () => {
  it('defines the button once, so neither placement can drift from the other', () => {
    expect(SCHEDULE).toMatch(/const addButton = canWrite \? \(/);
    // One definition, two mount points. Two copies of the markup is how the
    // label, the tour target or the handler end up disagreeing.
    expect(SCHEDULE.match(/data-tour="add"/g)).toHaveLength(1);
  });

  it('gives the organiser block the role, not just its buttons', () => {
    // The guard has to sit outside the div. Inside it, an attendee still got
    // the flex item — `basis-full` with no children is a full-width line of
    // zero height, which is the gap without the button.
    expect(SCHEDULE).toMatch(
      /\{role === 'admin' && \(\s*<div className="flex basis-full items-center justify-end/,
    );
  });

  it('drops the guard that the block now carries', () => {
    // Manage was `{role === 'admin' && <Link …>}` inside a block that is now
    // itself admin-only. Two guards for one condition is one of them rotting.
    const block = SCHEDULE.slice(SCHEDULE.indexOf('basis-full items-center justify-end'));
    const manage = block.slice(0, block.indexOf('data-tour="arrange"'));
    expect(manage).toContain('data-tour="manage"');
    expect(manage).not.toContain("role === 'admin'");
  });

  it('puts Add beside Pitch for anyone who is not an organiser', () => {
    expect(SCHEDULE).toMatch(/\{role !== 'admin' && addButton\}/);
    // In the row that holds the board link, not the one below it.
    const pitch = SCHEDULE.indexOf('data-tour="pitches"');
    const beside = SCHEDULE.indexOf("{role !== 'admin' && addButton}");
    const organiserBlock = SCHEDULE.indexOf('basis-full items-center justify-end');
    expect(pitch).toBeGreaterThan(-1);
    expect(beside).toBeGreaterThan(pitch);
    expect(beside).toBeLessThan(organiserBlock);
  });

  it('still hides its label below sm, where the row it saved was worst', () => {
    const add = SCHEDULE.slice(SCHEDULE.indexOf('const addButton = canWrite'));
    expect(add.slice(0, add.indexOf(') : null;'))).toContain(
      '<span className="hidden sm:inline">Add session</span>',
    );
  });
});
