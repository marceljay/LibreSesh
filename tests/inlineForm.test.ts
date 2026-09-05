import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 4 of the form-layer overhaul: form semantics for the loose controls.
 *
 * The add-rows, the unlock box, the invite check and the gate were inputs and
 * a button with no `<form>` around them, so Enter did whatever each field's
 * own `onKeyDown` said — fourteen hand-rolled handlers at Phase 0, some fields
 * submitting and their neighbours not. A real form submits from any field in
 * it, and a `type="submit"` button is what a phone's keyboard and a screen
 * reader can name.
 *
 * There is no DOM in this suite, so what is pinned is the shape: the primitive
 * exists, every loose section uses it, and the hand-rolled Enter-to-submit
 * handler is gone from `web/src` for good — that is the regression a new
 * section would otherwise reintroduce.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const read = (...parts: string[]) => readFileSync(join(WEB_SRC, ...parts), 'utf8');
const ui = read('components', 'ui.tsx');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('InlineForm is a real form that validates nothing natively', () => {
  const form = ui.slice(ui.indexOf('export function InlineForm'), ui.indexOf('export function NumberField'));

  it('renders a <form noValidate> and hands submit to the caller', () => {
    expect(form).toMatch(/<form\s+noValidate/);
    expect(form).toContain('e.preventDefault();');
    expect(form).toContain('onSubmit();');
  });

  it('carries no layout of its own', () => {
    // A row or a stack goes inside it; the form is the contract, not the grid.
    expect(form).not.toContain('flex');
    expect(form).not.toContain('grid');
  });
});

describe('the dialog form raises no native bubbles either', () => {
  it('sets noValidate on the Modal form', () => {
    const modal = read('components', 'Modal.tsx');
    expect(modal).toContain('noValidate: true,');
  });
});

describe('every loose section is a form', () => {
  const sections = [
    ['pages', 'AdminInvite.tsx'],
    ['pages', 'AdminBreaks.tsx'],
    ['pages', 'AdminRooms.tsx'],
    ['pages', 'AdminPermissions.tsx'],
  ] as const;

  it.each(sections)('%s/%s submits through InlineForm with a submit button', (dir, file) => {
    const src = read(dir, file);
    expect(src).toContain('<InlineForm');
    expect(src).toMatch(/<PrimaryButton\s+type="submit"/);
  });

  it('InlineCreate submits through the same form, and only Escape is hand-rolled', () => {
    const ic = ui.slice(ui.indexOf('export function InlineCreate'), ui.indexOf('export function DangerButton'));
    expect(ic).toContain('<InlineForm');
    expect(ic).toContain('<PrimaryButton type="submit"');
    expect(ic).not.toContain("e.key === 'Enter'");
  });

  it('NumberField no longer takes a keydown handler — the form around it submits', () => {
    const nf = ui.slice(ui.indexOf('export function NumberField'), ui.indexOf('export const roleTagColor'));
    expect(nf).not.toContain('onKeyDown');
  });
});

describe('no field submits on its own Enter any more', () => {
  it('has no hand-rolled Enter-to-submit handler in the converted sections', () => {
    // The shape every section had: `onKeyDown={(e) => e.key === 'Enter' && void save()}`.
    // A combobox's Enter (pick the active row) is a different thing and is
    // not this pattern — it does not `void` a save.
    const SUBMIT_ON_ENTER = /e\.key === ["']Enter["'] && void /;
    const offenders = tsxFiles(WEB_SRC)
      .filter((path) => SUBMIT_ON_ENTER.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(WEB_SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});

describe('the gate is a login a password manager can see', () => {
  const gate = read('components', 'Gate.tsx');

  it('puts the password and the name in one form', () => {
    // A manager only recognises a login when the password field and the
    // username field share a <form>; the gate had neither, so the event
    // password could not be saved or filled. Phase 0 finding 8.
    expect(gate).toContain('<InlineForm onSubmit={() => void submit()}>');
    expect(gate).toMatch(/type="password"\s+name="password"\s+autoComplete="current-password"/);
    expect(gate).toMatch(/name="username"\s+autoComplete="username"/);
  });

  it('keeps the link phrase out of the manager, in a form of its own', () => {
    // A one-time phrase is not a password to remember. And it must not nest
    // inside the entry form, which HTML forbids and browsers silently flatten.
    expect(gate).toContain('<InlineForm onSubmit={() => void link()}>');
    const phrase = gate.slice(gate.indexOf('value={phrase}'), gate.indexOf('placeholder="house-dog-erratic"'));
    expect(gate.slice(gate.indexOf('value={phrase}'))).toContain('autoComplete="off"');
    expect(phrase).not.toContain("e.key === 'Enter'");
  });

  it('says so when Enter arrives with no name, since the browser no longer will', () => {
    expect(gate).toContain("setError('Pick a username to enter');");
  });
});

describe("a phone's keyboard labels the Enter key for what it does", () => {
  // `enterKeyHint` only relabels the key — the form or handler still has to
  // exist (forms strategy, Phase 4). So it goes only where Enter has one clear
  // meaning: Go at the gate, Search in a search box, Done on a single-line
  // inline edit. Never on a multi-line field, where Enter is a newline.
  it.each([
    ['components', 'Gate.tsx', 'go', 3],
    ['components', 'SearchBox.tsx', 'search', 1],
    ['pages', 'AdminSearch.tsx', 'search', 1],
    ['pages', 'ProfilePage.tsx', 'done', 2],
  ] as const)('%s/%s says %s', (dir, file, hint, times) => {
    const src = read(dir, file);
    expect(src.match(new RegExp(`enterKeyHint="${hint}"`, 'g'))?.length ?? 0).toBe(times);
  });

  it('never labels a textarea, where Enter is a newline', () => {
    for (const path of tsxFiles(WEB_SRC)) {
      const src = readFileSync(path, 'utf8');
      for (const el of src.match(/<TextArea\b[\s\S]*?\/>/g) ?? []) {
        expect(el, path).not.toContain('enterKeyHint');
      }
    }
  });
});
