import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What somebody is at this event is one fact, and it should look like one
 * fact everywhere it appears.
 *
 * It did not. The People list showed the role as a bare `<select>` — four
 * identical grey boxes down the one column an organiser scans to answer "who
 * runs this event" — while the header chip, the merge dialog and the invite
 * page all showed the same fact as a coloured badge. The profile page showed
 * it not at all, so an organiser who opened a profile to check a role had to
 * go back to the row they came from to change it.
 *
 * There is no DOM in this suite, so what is pinned here is the wiring: one
 * colour map, one control, and the three places that must use them.
 */
const WEB = join(import.meta.dirname, '..', 'web', 'src');
const read = (...parts: string[]) => readFileSync(join(WEB, ...parts), 'utf8');

const ui = read('components', 'ui.tsx');
const control = read('components', 'RoleControl.tsx');
const admin = read('pages', 'AdminPeople.tsx');
const profile = read('pages', 'ProfilePage.tsx');

describe('the role tag', () => {
  it('takes its colours from the badge, rather than a second copy of them', () => {
    // The map is defined once, in ui.tsx, and the editable tag imports it.
    expect(ui).toContain('export const roleTagColor: Record<Role, string>');
    expect(control).toMatch(/import \{[^}]*roleTagColor[^}]*\} from '\.\/ui'/s);
    // A second literal colour map in the control is the drift this guards.
    expect(control).not.toContain("admin: 'bg-stone-900");
  });

  it('carries the pencil inside the pill, and every role in the menu', () => {
    // The pencil is what says the badge is also the way to change it.
    expect(control).toContain('<EditIcon');
    expect(control).toMatch(/roleTagShape[\s\S]{0,600}<EditIcon[\s\S]{0,120}<\/button>/);
    for (const role of ['viewer', 'user', 'speaker', 'admin']) {
      expect(control, role).toContain(`${role}:`);
    }
  });

  it('names the person, so a column of them is not four identical controls', () => {
    expect(control).toContain('Role for ${personName}');
  });
});

describe('where the role can be changed', () => {
  it('is the People list, and no longer through a select', () => {
    expect(admin).toContain('<RoleControl');
    // The old control: `<select value={person.role …>`.
    expect(admin).not.toMatch(/<select[\s\S]{0,80}person\.role/);
  });

  it('is the profile page too, for organisers only', () => {
    expect(profile).toContain('<RoleControl');
    expect(profile).toMatch(/isAdmin && \([\s\S]{0,600}<RoleControl/);
    // An unheld profile has no role to change; it says so instead.
    expect(profile).toMatch(/person\.claimed \?[\s\S]{0,400}<PersonStatusBadge/);
  });

  it('reports the server refusing to demote the last organiser', () => {
    // The server owns that rule; both callers surface the refusal rather than
    // predicting it, so the button is never wrongly disabled.
    expect(profile).toMatch(/setPersonRole[\s\S]{0,200}catch[\s\S]{0,120}toast\.show/);
    expect(admin).toMatch(/setPersonRole[\s\S]{0,200}catch[\s\S]{0,80}fail\(err\)/);
  });
});

/**
 * `codePending` answered "are they still waiting to use it?" and nothing else,
 * so the profile page could not tell an organiser whether a phrase had ever
 * been sent. It offered "Generate phrase" either way, and the only way to find
 * out was to mint a second one — which silently invalidates the first.
 */
describe('whether a speaker code was ever generated', () => {
  it('is three states on the person, not a boolean', () => {
    const types = readFileSync(
      join(import.meta.dirname, '..', 'server', 'src', 'shared', 'types.ts'),
      'utf8',
    );
    expect(types).toContain("export type CodeState = 'none' | 'pending' | 'used'");
    expect(types).toContain('codeState?: CodeState');
    expect(types).not.toContain('codePending?: boolean');
  });

  it('is shown on the profile page, and says which of the three it is', () => {
    expect(profile).toContain('person.codeState');
    expect(profile).toContain('code unused');
    expect(profile).toContain('code used');
    // Nothing to revoke when no phrase exists — off, not hidden.
    expect(profile).toMatch(/disabled=\{busy \|\| state === 'none'\}/);
  });

  it('still badges only the outstanding one on a person line', () => {
    // "used" is a fact for the profile page, not a badge beside a name.
    expect(read('components', 'PersonLine.tsx')).toContain("person.codeState === 'pending'");
  });

  /**
   * The People table dropped it. A column of two hundred rows is read down,
   * and an outstanding code is a fact about one person that says nothing
   * about who they are or what they may do — which is what every other cell
   * on that row is for. The profile page still says it, where the code is
   * minted and revoked, and says which of the three states it is in.
   */
  it('is not a badge in the People table', () => {
    expect(admin).not.toContain("person.codeState === 'pending'");
  });
});
