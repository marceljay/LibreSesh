import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A dialog opened from the schedule header — About, device linking — was laid
 * out inside the header instead of over the page: the backdrop covered a strip
 * at the top and the panel, which sits at the bottom of its container on a
 * phone, was pushed off the screen.
 *
 * `position: fixed` is only fixed to the viewport while no ancestor has a
 * transform, a filter or a `backdrop-filter`; any of those become the
 * containing block for fixed descendants instead. The header has
 * `backdrop-blur`. There is no layout in this suite to measure that with, so
 * what is pinned is the escape hatch — the portal — and the fact that the
 * header still blurs, which is what makes the portal necessary.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const ui = readFileSync(join(WEB_SRC, 'components', 'ui.tsx'), 'utf8');
const schedule = readFileSync(join(WEB_SRC, 'pages', 'SchedulePage.tsx'), 'utf8');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('a dialog escapes whatever opened it', () => {
  it('renders into the body rather than where it was written', () => {
    expect(ui).toContain("import { createPortal } from 'react-dom';");
    expect(ui).toMatch(/return createPortal\(\n\s*<div className="fixed inset-0 z-50"/);
    expect(ui).toMatch(/\n\s*document\.body,\n\s*\);/);
  });

  it('is still the header that makes this necessary', () => {
    // If the blur ever leaves the header, this rule stops being load-bearing —
    // and something else in the app will have grown one by then.
    expect(schedule).toMatch(/<header className="[^"]*backdrop-blur/);
  });

  it('is the only dialog in the app, so nothing else has to know', () => {
    // Every dialog goes through `Modal`; a second hand-rolled `fixed inset-0`
    // overlay would have the same bug and none of the fix.
    const strays = tsxFiles(WEB_SRC)
      .filter((path) => !path.endsWith(join('components', 'ui.tsx')))
      .filter((path) => readFileSync(path, 'utf8').includes('fixed inset-0 z-50'));
    expect(strays).toEqual([]);
  });
});
