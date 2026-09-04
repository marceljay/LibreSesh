import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrast in the form layer, computed rather than eyeballed.
 *
 * The palette is Tailwind v4's, which states stone in OKLCH (a perceptual
 * colour space, where L is lightness rather than a channel average). WCAG's
 * ratio is defined on sRGB relative luminance, so the values are converted
 * here and the ratios come out of the same arithmetic a checker would use.
 *
 * What this guards is the pair *chosen*, not merely the class name: a later
 * edit that swaps stone-600 back to stone-400 fails on the number, and the
 * number is the thing that matters to somebody reading a hint on a phone in
 * daylight.
 */
const ui = readFileSync(join(import.meta.dirname, '..', 'web', 'src', 'components', 'ui.tsx'), 'utf8');

/** Tailwind v4 stone, as published: [L, C, H]. */
const STONE: Record<number, [number, number, number]> = {
  100: [0.97, 0.001, 106.424],
  200: [0.923, 0.003, 48.717],
  300: [0.869, 0.005, 56.366],
  400: [0.709, 0.01, 56.259],
  500: [0.553, 0.013, 58.071],
  600: [0.444, 0.011, 73.639],
  700: [0.374, 0.01, 67.558],
  900: [0.216, 0.006, 56.043],
};

function oklchToSrgb([L, C, H]: [number, number, number]): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  }) as [number, number, number];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast between two stone steps; `null` means white. */
function contrast(a: number | null, b: number | null): number {
  const rgb = (k: number | null): [number, number, number] =>
    k === null ? [1, 1, 1] : oklchToSrgb(STONE[k] as [number, number, number]);
  const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The stone step a class string picks for a given prefix, light or dark. */
function step(source: string, prefix: string): number | null {
  const m = new RegExp(`(?:^|[\\s'"\`])${prefix}-stone-(\\d+)`).exec(source);
  return m ? Number(m[1]) : null;
}

const TEXT = 4.5; // WCAG AA, body text
const UI = 3.0; // WCAG AA, non-text: borders, icons

describe('the arithmetic is the arithmetic', () => {
  it('reproduces two ratios a checker agrees on', () => {
    // Sanity: if the OKLCH conversion above drifts, every other test lies.
    expect(contrast(500, null)).toBeCloseTo(4.81, 1);
    expect(contrast(400, 900)).toBeCloseTo(6.76, 1);
  });
});

describe('form text clears AA on the surface it sits on', () => {
  // A modal and a panel are white in light, stone-900 in dark.
  const decl = (name: string): string => {
    const at = ui.indexOf(`export const ${name} =`);
    return ui.slice(at, ui.indexOf(';', at));
  };

  it('hints are readable, not merely compliant', () => {
    const hint = decl('hintClass');
    const light = step(hint, 'text');
    const dark = step(hint, 'dark:text');
    expect(contrast(light, null)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(dark, 900)).toBeGreaterThanOrEqual(TEXT);
    // The old stone-500 passed at 4.81 and still read as thin grey. This is
    // the deliberate margin: a hint is prose, and it is read.
    expect(contrast(light, null)).toBeGreaterThan(6);
  });

  it('placeholders are readable — the old pair failed outright', () => {
    // stone-400 on white was 2.59, and stone-500 on stone-900 was 3.64:
    // both under 4.5, in the one piece of text that tells you what to type.
    const input = ui.slice(ui.indexOf('export const TextInput'), ui.indexOf('export const TextArea'));
    const area = ui.slice(ui.indexOf('export const TextArea'), ui.indexOf('export function ControlAdornment'));
    for (const [what, src] of [['TextInput', input], ['TextArea', area]] as const) {
      expect(contrast(step(src, 'placeholder:text'), null), `${what} light`).toBeGreaterThanOrEqual(TEXT);
      expect(contrast(step(src, 'dark:placeholder:text'), 900), `${what} dark`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it('labels clear AA in both themes', () => {
    const field = ui.slice(ui.indexOf('export function Field'), ui.indexOf('export function FieldError'));
    const label = field.slice(field.indexOf('<label'), field.indexOf('</label>'));
    expect(contrast(step(label, 'text'), null)).toBeGreaterThanOrEqual(TEXT);
    expect(contrast(step(label, 'dark:text'), 900)).toBeGreaterThanOrEqual(TEXT);
  });

  it('the field border clears the 3:1 floor for a non-text control', () => {
    const shell = ui.slice(ui.indexOf('export function ControlShell'), ui.indexOf('export const TextInput'));
    const border = shell.slice(shell.indexOf('border-stone'));
    expect(contrast(step(border, 'border'), null)).toBeGreaterThanOrEqual(UI);
    expect(contrast(500, 900)).toBeGreaterThanOrEqual(UI); // dark side, same step
  });
});

describe('nobody writes their own hint colour', () => {
  it('keeps the hint pair in one place', () => {
    // SessionModal had this pair written out five times; each copy is a place
    // the contrast can be quietly lowered again.
    const modal = readFileSync(
      join(import.meta.dirname, '..', 'web', 'src', 'components', 'SessionModal.tsx'),
      'utf8',
    );
    expect(modal).not.toContain('text-stone-500 dark:text-stone-400');
    expect(modal).toContain('hintClass');
  });
});
