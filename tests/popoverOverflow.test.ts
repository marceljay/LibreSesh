import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The filter panel used to run off the right edge of a phone: `absolute left-0`
 * inside a wrapper that sits mid-row, sized `w-[min(22rem,calc(100vw-2rem))]`,
 * so its right edge landed at `wrapper.left + 100vw`. Nothing clipped it, the
 * document grew wider than the viewport, and the browser shrank the whole page
 * to fit.
 *
 * There is no DOM in this suite, let alone layout, so none of that can be
 * measured here. What *can* be pinned is the shape of the mistake — a panel
 * wider than its anchor, positioned by hand — and the three properties of
 * `usePopover` that make it impossible. A new popdown written the old way fails
 * these before anyone opens a phone.
 */

const WEB_SRC = join(__dirname, '..', 'web', 'src');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith('.tsx') ? [path] : [];
  });
}

/** These rules are about what the markup does, and the files explaining why it
 *  does it quote the very patterns being banned. Read the code, not the prose. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const files = tsxFiles(WEB_SRC).map((path) => ({
  path,
  name: path.slice(WEB_SRC.length + 1),
  source: readFileSync(path, 'utf8'),
  code: code(readFileSync(path, 'utf8')),
}));

/**
 * Panels that are absolutely positioned by hand but provably cannot overhang,
 * each for a reason that has to keep being true. Anything else with the
 * popdown signature has to go through `usePopover`.
 */
const HAND_POSITIONED = new Map([
  // Anchored to its own right edge and narrower than any phone, in a wrapper
  // that is already flush right in the header.
  ['components/ProfileMenu.tsx', 'end-0 w-48'],
  // `w-full`: it is exactly as wide as the input it drops from, so it cannot
  // stick out any further than the field already does.
  ['components/SpeakerCombobox.tsx', 'w-full'],
]);

describe('popdown panels cannot widen the page', () => {
  it('sizes nothing by viewport width', () => {
    // `100vw` is the anchor-agnostic width, and that is the bug: it is only
    // ever right when the element starts at x=0. It also ignores the
    // scrollbar. `usePopover`'s `size` middleware measures the space actually
    // left beside the anchor instead.
    const offenders = files
      .filter((f) => /\b(?:max-)?w-\[[^\]]*100vw/.test(f.code))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('routes every anchored panel through usePopover', () => {
    // The signature of a popdown: taken out of flow, lifted above the page,
    // and given a card's shadow.
    const isPanel = /className=[^\n]*\babsolute\b[^\n]*\bz-(?:40|50)\b[^\n]*\bshadow-lg\b/;
    const offenders = files
      .filter((f) => isPanel.test(f.code) && !HAND_POSITIONED.has(f.name))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('keeps the hand-positioned exemptions honest', () => {
    // An exemption is only worth having while the reason for it holds. If one
    // of these grows past its anchor, it needs usePopover like the rest.
    for (const [name, why] of HAND_POSITIONED) {
      const file = files.find((f) => f.name === name);
      expect(file, `${name} is exempted but no longer exists`).toBeDefined();
      for (const token of why.split(' ')) {
        expect(file!.code, `${name} no longer has ${token}`).toContain(token);
      }
    }
  });
});

describe('usePopover', () => {
  const source = code(readFileSync(join(WEB_SRC, 'components', 'Popover.tsx'), 'utf8'));

  it('positions off the viewport, not the document', () => {
    // The one line that makes an overhang unable to widen the page at all.
    expect(source).toMatch(/strategy:\s*'fixed'/);
  });

  it('slides a panel back inside the viewport and caps it to the room left', () => {
    expect(source).toMatch(/\bshift\(/);
    expect(source).toMatch(/\bflip\(/);
    expect(source).toMatch(/\bsize\(/);
    expect(source).toMatch(/maxWidth\s*=\s*`\$\{Math\.max\(0, availableWidth\)\}px`/);
    expect(source).toMatch(/maxHeight\s*=\s*`\$\{Math\.max\(0, availableHeight\)\}px`/);
  });

});

describe('nothing is measured in vh', () => {
  it('leaves no plain-vh arbitrary value in the app', () => {
    // `vh` counts the strip behind the mobile address bar, so the panel's old
    // `max-h-[70vh]` was taller than 70% of what you can actually see and its
    // last rows sat under the browser chrome. `dvh` is the honest unit, and
    // `usePopover` needs no unit at all — it caps against measured space.
    const offenders = files.filter((f) => /\[[\d.]+vh\]/.test(f.code)).map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});
