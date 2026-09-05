import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The demo gate hands out roles on a click, so it has no password box — but it
 * still needs a name, and the three role buttons are disabled until it has
 * one. The field was rendered *below* them, and only when there was no invite,
 * so the gate opened on three dead controls with nothing saying why, and an
 * invite to a demo event disabled them permanently by never drawing the field
 * at all.
 *
 * There is no DOM in this suite, so what is pinned here is the order of the
 * markup and the absence of the `!invite` guard.
 */
const gate = readFileSync(
  join(import.meta.dirname, '..', 'web', 'src', 'components', 'Gate.tsx'),
  'utf8',
);

/** The demo branch only: everything between `{demo ? (` and its `) : (`. */
const demoBranch = (() => {
  const start = gate.indexOf('{demo ? (');
  const end = gate.indexOf('        ) : (', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return gate.slice(start, end);
})();

describe('the demo gate asks for a name before it offers a role', () => {
  it('draws the name field above the role buttons', () => {
    const field = demoBranch.indexOf('{nameField}');
    const buttons = demoBranch.indexOf('roles.map');
    expect(field).toBeGreaterThan(-1);
    expect(buttons).toBeGreaterThan(-1);
    expect(field).toBeLessThan(buttons);
  });

  it('draws it under an invite too, which is the case that used to dead-end', () => {
    expect(demoBranch).not.toContain('{!invite && (');
  });

  it('still refuses to enter without one', () => {
    // The guard is the point of the ordering above, not something to drop:
    // entering with an empty name is what generated-name rosters are made of.
    expect(demoBranch).toContain('disabled={busy || nameMissing}');
    expect(gate).toContain("const nameMissing = name.trim() === '';");
  });

  it('says both steps in the blurb, in the order they happen', () => {
    expect(demoBranch).toContain('Pick a name, then a role to look around.');
  });
});
