import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 1 of the form-layer overhaul: the field primitives in `ui.tsx`.
 *
 * There is no DOM in this suite (see `vitest.config.ts` — `environment: node`),
 * so what is pinned here is the wiring, as text. Two things it guards:
 *
 * - **Label association.** `Field` associated its label with nothing at 95 of
 *   96 call sites — it rendered `<label>` as a sibling and passed `htmlFor` to
 *   no control. Now `Field` owns an id and hands it down through context, so a
 *   control cannot be left unlabelled by a call site that forgot.
 * - **One owner per concern.** The border, height, focus ring and invalid
 *   state live in `ControlShell`; the bare input in `TextInput`; the id, hint
 *   and error in `Field`. `NumberField` is the proof: it wires none of it now.
 */
const ui = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'components', 'ui.tsx'), 'utf8');

describe('Field owns the id and the label points at it', () => {
  it('generates an id when the call site gives none', () => {
    expect(ui).toContain('const generated = useId();');
    expect(ui).toContain('const id = htmlFor ?? generated;');
    // The label is wired to that id, not to a `htmlFor` the call site forgot.
    expect(ui).toMatch(/<label\s+htmlFor=\{id\}/);
  });

  it('hands id, describedBy and invalid down through context', () => {
    expect(ui).toContain('FieldContext.Provider');
    expect(ui).toMatch(/value=\{\{ id, describedBy, invalid: Boolean\(error\) \}\}/);
  });

  it('builds aria-describedby from whichever of hint and error exist', () => {
    expect(ui).toContain('const hintId = hint ? `${id}-hint` : undefined;');
    expect(ui).toContain('const errorId = error ? `${id}-error` : undefined;');
    expect(ui).toContain("[hintId, errorId].filter(Boolean).join(' ') || undefined");
  });

  it('renders the error under the control, announced', () => {
    expect(ui).toMatch(/export function FieldError/);
    expect(ui).toContain('role="alert"');
  });
});

describe('ControlShell is the only field border', () => {
  it('owns border, a height floor, focus-within ring and invalid state', () => {
    const shell = ui.slice(ui.indexOf('export function ControlShell'), ui.indexOf('export const TextInput'));
    expect(shell).toContain('min-h-[2.375rem]');
    expect(shell).toContain('flex-wrap'); // chips and adornments sit inside the border
    expect(shell).toContain('fieldFocusRing'); // the shared ring token, applied here
    // Invalid comes from the Field unless the caller overrides it.
    expect(shell).toContain('invalid ?? ctx?.invalid ?? false');
    // Phase 3 contrast: the border clears 3:1 in both themes and the error
    // state is red-500 (red-400 failed light at 2.77:1).
    expect(shell).toContain('border-stone-500');
    expect(shell).toContain("'border-red-500 dark:border-red-500'");
    // The ring itself is a 2px offset halo, not a flush inner line.
    expect(ui).toContain('focus-within:ring-2');
    expect(ui).toContain('focus-within:ring-offset-2');
  });

  it('focuses its input when its own padding is clicked', () => {
    const shell = ui.slice(ui.indexOf('export function ControlShell'), ui.indexOf('export const TextInput'));
    expect(shell).toContain('if (e.target !== ref.current) return;');
    expect(shell).toMatch(/querySelector<HTMLElement>\(\s*'input, textarea, select/);
  });
});

describe('TextInput is bare and wired from context', () => {
  const input = ui.slice(ui.indexOf('export const TextInput'), ui.indexOf('export const TextArea'));

  it('takes its id and aria wiring from the Field, not the call site', () => {
    expect(input).toContain('id={props.id ?? ctx?.id}');
    expect(input).toContain("aria-invalid={props['aria-invalid'] ?? (ctx?.invalid || undefined)}");
    expect(input).toContain("aria-describedby={props['aria-describedby'] ?? ctx?.describedBy}");
  });

  it('is 16px on a phone, so iOS does not zoom the viewport on focus', () => {
    expect(input).toContain('text-base');
    expect(input).toContain('sm:text-sm');
    // The bare input draws no border or background of its own — the shell does.
    expect(input).toContain('bg-transparent');
  });

  it('forwards a ref, so a call site can select or focus the node', () => {
    expect(input).toContain('forwardRef');
    expect(input).toContain('ref={ref}');
  });
});

describe('TextArea owns its own border', () => {
  const area = ui.slice(ui.indexOf('export const TextArea'), ui.indexOf('export const selectClass'));

  it('is a multi-line field wired from context, unlike TextInput it is not shell-bound', () => {
    expect(area).toContain('<textarea');
    expect(area).toContain('id={props.id ?? ctx?.id}');
    expect(area).toContain('rounded-lg border'); // draws its own border, no ControlShell
  });

  it('carries the same 16px-on-mobile fix', () => {
    expect(area).toContain('text-base');
    expect(area).toContain('sm:text-sm');
  });
});

describe('NumberField is the proof, rebuilt on the primitives', () => {
  const nfStart = ui.indexOf('export function NumberField');
  const nf = ui.slice(nfStart, ui.indexOf('roleTagColor', nfStart));

  it('wires no id, no aria and no field border of its own', () => {
    expect(nf).toContain('<ControlShell');
    expect(nf).toContain('<TextInput');
    expect(nf).not.toContain('inputClass');
    expect(nf).not.toContain('aria-describedby');
    expect(nf).not.toMatch(/id=\{id\}/);
  });

  it('keeps "empty is not yet wrong" and hands the error to Field', () => {
    expect(nf).toContain("const shown = value.trim() === '' ? null : error;");
    expect(nf).toContain('error={shown ?? undefined}');
  });

  it("keeps the running-text suffix beside the box, not inside a w-32 shell", () => {
    // The suffix here is a sentence, not a unit — it would wrap inside the box.
    expect(nf).toMatch(/<\/ControlShell>\s*\{suffix &&/);
  });
});

describe('the old skin is gone', () => {
  it('has deleted inputClass now that Phase 2 converted every call site', () => {
    expect(ui).not.toContain('inputClass');
  });

  it('keeps selectClass for the native selects Phase 0 left native', () => {
    expect(ui).toContain('export const selectClass =');
  });
});
