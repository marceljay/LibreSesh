import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Link another device" was a plain row of text between Calendar and Theme,
 * and the one thing in the profile menu nobody found. It now wears the same
 * two-device glyph as the gate's "I'm already here on another device" — the
 * item mints the phrase that door takes, so the two ends of one flow are
 * marked the same way.
 *
 * No DOM here: what is pinned is that both ends share one glyph.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const read = (...p: string[]) => readFileSync(join(WEB_SRC, ...p), 'utf8');

describe('device linking wears one glyph at both ends', () => {
  const menu = read('components', 'ProfileMenu.tsx');
  const gate = read('components', 'Gate.tsx');

  it('marks the menu item with the devices icon', () => {
    expect(menu).toMatch(/<DevicesIcon[^>]*\/>\s*Link another device/);
  });

  it('is the same icon the gate door uses', () => {
    expect(gate).toMatch(/<DevicesIcon[^>]*\/>\s*I’m already here on another device/);
    for (const src of [menu, gate]) {
      expect(src).toMatch(/import \{[^}]*\bDevicesIcon\b[^}]*\} from '\.\/icons'/);
    }
  });
});
