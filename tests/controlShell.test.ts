import { readFileSync, readdirSync } from 'node:fs';
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
    // On focus the field hides its own border and shows one flush ring in its
    // place, so border + ring never read as two concentric lines.
    expect(ui).toContain('focus-within:ring-2');
    expect(ui).toContain('focus-within:border-transparent');
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

  it('opts out of the global :focus-visible ring, so it draws no ring inside the shell', () => {
    // index.css rings every :focus-visible element; on the wrapped input that
    // ring lands *inside* the shell — the "ugly inner border". The input must
    // suppress it and let the shell (focus-within) carry the ring instead. This
    // is the guard that keeps the inner border from coming back.
    const css = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'index.css'), 'utf8');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*ring-2/); // the global ring still exists
    expect(input).toContain('focus-visible:ring-0');
  });

  it('forwards a ref, so a call site can select or focus the node', () => {
    expect(input).toContain('forwardRef');
    expect(input).toContain('ref={ref}');
  });
});

describe('TextArea owns its own border', () => {
  const area = ui.slice(ui.indexOf('export const TextArea'), ui.indexOf('export function ControlAdornment'));

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
    // The verdict is data; the sentence is rendered from it at the boundary.
    expect(nf).toContain('error={shown ? numberFieldMessage(shown) : undefined}');
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

  it('has deleted selectClass along with the last native select', () => {
    // Every `<select>` is a Base UI Select now (`ui/select.tsx`), so the class
    // that skinned the native ones has nothing left to skin.
    expect(ui).not.toContain('selectClass');
  });

  it('keeps the field and the Select trigger the same height', () => {
    // Tailwind scans source text, so an arbitrary value cannot come from a
    // shared constant — `h-[${x}]` generates nothing. The height is therefore
    // written out in both files, and this is what stops the two drifting: a
    // field and a select on one row must align.
    const select = readFileSync(
      join(import.meta.dirname, '..', 'web', 'src', 'components', 'ui', 'select.tsx'),
      'utf8',
    );
    const height = (src: string, prefix: string): string | undefined =>
      new RegExp(`(?:^|[\\s'"\`])${prefix}-\\[([\\d.]+rem)\\]`).exec(src)?.[1];
    expect(height(ui, 'min-h')).toBe('2.375rem');
    expect(height(select, 'h')).toBe('2.375rem');
  });
});

describe('no hand-drawn field re-adds the global ring to its own border', () => {
  /** Every `.tsx` under `web/src`. */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return sources(path);
      return e.name.endsWith('.tsx') ? [path] : [];
    });
  }

  const WEB_SRC = join(import.meta.dirname, '..', 'web', 'src');

  it('gives every bordered raw input the shared bare-field ring', () => {
    // `index.css` rings every `:focus-visible` element with an *offset* ring.
    // On an element that draws its own border that ring sits outside it, a gap
    // away — border, gap, ring, three lines for one field. That was the "ugly
    // focus border" on the three search boxes. `bareFieldFocusRing` replaces
    // the border with one flush ring instead of stacking on it.
    //
    // Controls that are not fields (checkbox, radio, colour, file) keep the
    // global ring: they have nothing to replace it with.
    const NOT_A_FIELD = /type="(?:checkbox|radio|color|file)"/;
    const offenders: string[] = [];

    for (const path of sources(WEB_SRC)) {
      const src = readFileSync(path, 'utf8');
      for (const el of src.match(/<(?:input|textarea)\b[\s\S]*?\/>/g) ?? []) {
        if (NOT_A_FIELD.test(el)) continue;
        // Draws its own border, so the global offset ring would double it.
        if (!/\bborder\b|\bborder-/.test(el)) continue;
        if (el.includes('bareFieldFocusRing')) continue;
        offenders.push(path.slice(WEB_SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('a control and the button beside it are one line, the same height', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return sources(path);
      return e.name.endsWith('.tsx') ? [path] : [];
    });
  }
  const WEB_SRC = join(import.meta.dirname, '..', 'web', 'src');

  it('gives buttons the same 38px the fields have', () => {
    // 38px = 2.375rem, three ways of arriving at the same number:
    //   button  text-xs (16px line) + py-2.5 (20px) + border (2px) = 38
    //   field   ControlShell min-h-[2.375rem]
    //   select  trigger h-[2.375rem]
    // A button that changes its padding without changing the others breaks the
    // row, so the padding is pinned here rather than left to be noticed.
    for (const cls of ['primaryButtonClass', 'secondaryButtonClass']) {
      const decl = ui.slice(ui.indexOf(`export const ${cls}`));
      const body = decl.slice(0, decl.indexOf(';'));
      expect(body, cls).toContain('py-2.5');
      expect(body, cls).toContain('text-xs');
    }
  });

  it('never puts a hinted Field next to a button in the same row', () => {
    // A Field is label + control + hint stacked, so its bottom edge is the last
    // line of the hint. `items-end` then aligns a sibling button to *that* —
    // dropping it a hint's height below the box it belongs to. The button goes
    // inside the Field instead; see the FormRow doc comment.
    const offenders: string[] = [];
    for (const path of sources(WEB_SRC)) {
      const src = readFileSync(path, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        // Both spellings of a row: the primitive, and a hand-rolled flex that
        // bottom-aligns (which is what FormRow expands to).
        const isRow = line.includes('<FormRow') || /className="[^"]*items-end/.test(line);
        if (!isRow) return;
        const block = lines.slice(i, i + 24).join('\n');
        const field = block.indexOf('<Field');
        if (field === -1) return;
        // The hint must belong to the Field, not to something later in the row.
        const fieldBlock = block.slice(field, field + 400);
        if (!/hint=/.test(fieldBlock.slice(0, fieldBlock.indexOf('>')))) return;
        if (!/<(Primary|Secondary|Danger)Button/.test(block)) return;
        offenders.push(`${path.slice(WEB_SRC.length + 1)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('InlineCreate is a button that becomes its field', () => {
  const ic = ui.slice(ui.indexOf('export function InlineCreate'), ui.indexOf('export function DangerButton'));

  it('collapses to one button and opens into a row of the same height', () => {
    // The collapsed and open states must be the same height or the button
    // moves out from under the pointer that pressed it: SecondaryButton and
    // ControlShell are both 38px (pinned above), and the open row carries no
    // visible label, which would add one.
    expect(ic).toContain('if (!open) {');
    expect(ic).toContain('<SecondaryButton ref={opener}');
    expect(ic).toContain('<ControlShell className="min-w-40 flex-1">');
    expect(ic).toContain('aria-label={fieldLabel}'); // named without a visible label
    expect(ic).not.toContain('<Field'); // a Field would stack a label on top
  });

  it('puts the caret in the box on open and back on the button on cancel', () => {
    expect(ic).toContain('autoFocus');
    expect(ic).toContain('opener.current?.focus();');
    // Not on first render — only when this component closed the form.
    expect(ic).toContain('if (open || !restoreFocus.current) return;');
  });

  it('cancels on Escape without letting a surrounding dialog also close', () => {
    expect(ic).toMatch(/e\.key === 'Escape'[\s\S]{0,200}e\.stopPropagation\(\);[\s\S]{0,40}close\(\);/);
  });

  it('stays open after a save, and keeps the text after a failure', () => {
    // Adding one track is usually adding three, so Enter clears and stays.
    expect(ic).toContain('if (!saved) return;');
    expect(ic).toMatch(/setValue\(''\);\s*box\.current\?\.focus\(\);/);
  });
});

describe('every search box looks like a search box', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return sources(path);
      return e.name.endsWith('.tsx') ? [path] : [];
    });
  }
  const WEB_SRC = join(import.meta.dirname, '..', 'web', 'src');

  /** The four: the header combobox, the filter panel, People, and the merge
   *  dialog. Two of them had no icon at all, and the two that did drew it in a
   *  different grey from each other. */
  const searchFiles = () =>
    sources(WEB_SRC).filter((path) => {
      const src = readFileSync(path, 'utf8');
      return /type="search"|aria-label="Search /.test(src);
    });

  it('gives each one the leading icon, and room for it', () => {
    const offenders = searchFiles()
      .filter((path) => {
        const src = readFileSync(path, 'utf8');
        // The icon is absolutely placed, so the box has to reserve the space.
        return !src.includes('<SearchIcon') || !/\bps-8\b/.test(src);
      })
      .map((path) => path.slice(WEB_SRC.length + 1));
    expect(offenders).toEqual([]);
  });

  it('draws the icon in one grey, readable on white', () => {
    // stone-400 on white is 2.59 — see tests/formContrast.test.ts. The icon is
    // decorative (each box carries an aria-label), but it is the affordance
    // people look for, and four boxes should not be four different greys.
    const offenders = searchFiles()
      .filter((path) =>
        /<SearchIcon[^/]*text-stone-(?!500 dark:text-stone-400)/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => path.slice(WEB_SRC.length + 1));
    expect(offenders).toEqual([]);
  });
});

describe('HelpButton is a target a finger can hit', () => {
  it('is 24px square, the WCAG 2.2 minimum', () => {
    // SC 2.5.8 Target Size (Minimum) is AA and asks for 24×24 CSS px unless the
    // target is 24px clear of its neighbours; it sits in a chip row with a 6px
    // gap, so the size has to carry it. It was h-5 w-5 (20px) — Phase 0
    // finding 5, the one nobody picked up.
    const hb = ui.slice(ui.indexOf('export function HelpButton'), ui.indexOf('export function HelpNote'));
    expect(hb).toMatch(/\bh-6 w-6\b/);
    expect(hb).not.toMatch(/\bh-5 w-5\b/);
  });
});
