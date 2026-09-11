import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * **Add a session** and **Pitch a session** were two controls a row apart,
 * then two side by side, and they are the same question asked twice: do you
 * have a room and a time, or only an idea?
 *
 * That is a choice to make *after* deciding to contribute, not before, and
 * somebody who has never seen an unconference cannot make it from two button
 * labels. Behind one `+ Session ▾` the two sit together with room for a
 * sentence each, which is the only place the difference can be explained
 * rather than guessed at.
 *
 * Layout and composition, so there is no DOM here; the accessible names are
 * exercised for real in controlsByRole and roleChangeLive. LIB-193.
 */
const WEB = join(__dirname, '..', 'web', 'src');
const menu = readFileSync(join(WEB, 'components', 'NewSessionMenu.tsx'), 'utf8');
const schedule = readFileSync(join(WEB, 'pages', 'SchedulePage.tsx'), 'utf8');

describe('one button for both ways in', () => {
  it('offers each with a sentence, not just a label', () => {
    expect(menu).toContain('Add a session');
    expect(menu).toContain('In a room, at a time, on the grid.');
    expect(menu).toContain('Pitch a session');
    expect(menu).toContain('Just an idea — no room, no time.');
  });

  it('names itself for what it opens onto', () => {
    // Computed now that drafts can join the menu; with none, and both ways
    // in open, it is still exactly this.
    expect(menu).toContain("? 'Add or pitch a session'");
    expect(menu).toContain('aria-label={label}');
  });

  it('keeps the open-pitch count the board link carried', () => {
    // The one thing on that button that is news rather than an instruction.
    expect(menu).toMatch(
      /\{pitchCount > 0 && <span className="opacity-60">\{pitchCount\}<\/span>\}/,
    );
    expect(schedule).toContain('pitchCount={openPitchCount}');
  });
});

describe('one option is never a menu', () => {
  it('falls back to a plain button when only adding is open', () => {
    expect(menu).toContain('if (pitchHref === null)');
    // No chevron: an arrow promising a choice that is not there is worse than
    // no arrow at all.
    const addOnly = menu.slice(menu.indexOf('if (pitchHref === null)'));
    expect(addOnly.slice(0, addOnly.indexOf('  return ('))).not.toContain('ChevronDownIcon');
  });

  it('falls back to the board link when only pitching is open', () => {
    expect(menu).toContain('if (!canAdd) {');
  });

  it('renders nothing when neither is', () => {
    expect(menu).toContain('if (!canAdd && pitchHref === null) return null;');
  });

  it('takes the board switch as a null href, not a missing sibling', () => {
    expect(schedule).toMatch(
      /pitchHref=\{event\.pitchesEnabled \? `\/e\/\$\{slug\}\/proposals` : null\}/,
    );
    expect(schedule).toContain('canAdd={canWrite}');
  });
});

describe('the full-page session view gets it too', () => {
  /** From the way back out to the detail panel below it. */
  const page = schedule.slice(
    schedule.indexOf('{fullPage && selected ? ('),
    schedule.indexOf('<SessionDetail'),
  );

  it('rides along with the way back rather than earning a row', () => {
    // That page drops the header's rows, so until now the only way out of it
    // was backwards — and reading somebody else's session is one of the
    // likelier moments to want one of your own.
    expect(page).toContain('Back to the schedule');
    expect(page).toContain('<NewSessionMenu');
    expect(page).toContain('flex items-center justify-between');
  });

  it('opens the same modal, which lives outside the page branch', () => {
    // `setEditing` renders SessionModal at the top level, not inside the
    // schedule branch, so the button works from here without a second mount.
    expect(page).toContain('onAdd={() => setEditing({})}');
    const modal = schedule.indexOf('{editing && (');
    expect(modal).toBeGreaterThan(schedule.indexOf('<SessionDetail'));
  });

  it('is the same control, not a second copy of its markup', () => {
    expect(schedule.match(/<NewSessionMenu/g)).toHaveLength(2);
    expect(schedule).not.toContain('const addButton');
  });
});

describe('the tour follows the merge', () => {
  it('walks the two as one step', () => {
    expect(schedule).toContain("title: 'Add or pitch a session'");
    // The old pair is gone: two steps for one button would stop twice on it.
    expect(schedule).not.toContain("title: 'Pitch a session'");
    expect(schedule).not.toContain("title: 'Add a session'");
  });

  it('only offers the step when the control is there', () => {
    // `data-tour="pitches"` lives inside the panel now, which does not exist
    // until the menu is opened — an unconditional step would point at nothing.
    expect(schedule).toMatch(/\.\.\.\(canWrite \|\| event\.pitchesEnabled/);
  });

  it('spreads it in place rather than pushing it to the end', () => {
    // Pushed steps run after the static ones, so the tour would walk back up
    // the page to reach a control in the view/axis row.
    const step = schedule.indexOf("title: 'Add or pitch a session'");
    const now = schedule.indexOf("title: 'Jump to now'");
    expect(step).toBeGreaterThan(-1);
    expect(step).toBeLessThan(now);
  });
});
