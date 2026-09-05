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
 *
 * The portal is Base UI's `Dialog.Portal` now rather than React's
 * `createPortal`; the guarantee is identical and still load-bearing, so this
 * pins the mechanism that provides it rather than the one that used to.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const MODAL = join('components', 'Modal.tsx');
/** `Modal` lives outside `ui.tsx` so Base UI's Dialog stays out of the
 *  first-paint chunk — see the note in the component. */
const modal = readFileSync(join(WEB_SRC, MODAL), 'utf8');
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
    expect(modal).toContain("import { Dialog } from '@base-ui/react/dialog';");
    // The panel and the backdrop both sit inside the portal, so neither is laid
    // out in the blurred header's containing block.
    expect(modal).toMatch(/<Dialog\.Portal>[\s\S]*<Dialog\.Backdrop[\s\S]*<Dialog\.Popup/);
  });

  it('leaves the trap, inert and scroll lock to Base UI rather than hand-rolling them', () => {
    // The hand-rolled version had none of these — Phase 0 flagged the missing
    // focus trap. If Modal ever grows its own Escape listener or focus juggling
    // again, that is the regression this catches.
    expect(modal).not.toContain("if (e.key === 'Escape') onClose();");
    expect(modal).not.toContain('panel.current?.focus()');
  });

  it('keeps Base UI out of the first-paint chunk', () => {
    // `ui.tsx` is imported by the app shell for its providers, so a static
    // import of the dialog there would ship ~20 kB gzipped to every visitor,
    // including the ones who only read the schedule. ConfirmProvider therefore
    // reaches it through a dynamic import, not a static one.
    const ui = readFileSync(join(WEB_SRC, 'components', 'ui.tsx'), 'utf8');
    expect(ui).not.toContain('@base-ui/react/dialog');
    expect(ui).toMatch(/lazy\(\(\) => import\('\.\/Modal'\)/);
  });

  it('is still the header that makes this necessary', () => {
    // If the blur ever leaves the header, this rule stops being load-bearing —
    // and something else in the app will have grown one by then.
    expect(schedule).toMatch(/<header className="[^"]*backdrop-blur/);
  });

  it('never hides a focused field behind the footer', () => {
    // SC 2.4.11 Focus Not Obscured (AA). The body is the only scroll region and
    // the footer is a flex sibling *after* it — `shrink-0`, not sticky, absolute
    // or fixed — so the body's own scroll-into-view keeps a focused field in
    // the clear. Phase 0 flagged this as plausible and unproven; the layout
    // makes it impossible, and this is what keeps the layout.
    const body = modal.indexOf('overflow-y-auto');
    const footer = modal.indexOf('{footer && (');
    expect(body).toBeGreaterThan(-1);
    expect(footer).toBeGreaterThan(body);
    const footerDiv = modal.slice(footer, modal.indexOf('</div>', footer));
    expect(footerDiv).toContain('shrink-0');
    expect(footerDiv).not.toMatch(/\b(?:sticky|absolute|fixed)\b/);
    // And the body is the *only* scroll region, so nothing inside it scrolls
    // under a sibling of its own.
    expect(modal.match(/overflow-y-auto/g)?.length).toBe(1);
  });

  it('is the only dialog in the app, so nothing else has to know', () => {
    // Every dialog goes through `Modal`; a second hand-rolled `fixed inset-0`
    // overlay would have the same bug and none of the fix.
    const strays = tsxFiles(WEB_SRC)
      .filter((path) => !path.endsWith(MODAL))
      .filter((path) => readFileSync(path, 'utf8').includes('fixed inset-0 z-50'));
    expect(strays).toEqual([]);
  });
});
