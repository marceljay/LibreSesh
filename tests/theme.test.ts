import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * With the theme on "System", the OS going dark left the page light until the
 * profile menu was opened: the `prefers-color-scheme` listener lived inside
 * `useTheme`, which only the toggle calls, and the toggle is mounted only
 * while that menu is open. The listener has to belong to the always-mounted
 * root. No DOM here, so the ownership is what is pinned.
 */
const WEB_SRC = join(__dirname, '..', 'web', 'src');
const hook = readFileSync(join(WEB_SRC, 'lib', 'useTheme.ts'), 'utf8');
const app = readFileSync(join(WEB_SRC, 'App.tsx'), 'utf8');

describe('the page follows the OS from the root, not from a menu', () => {
  it('mounts the follower in App, which is never unmounted', () => {
    expect(app).toContain("import { useFollowSystemTheme } from './lib/useTheme';");
    expect(app).toMatch(/export function App\(\) \{\s*(?:\/\/[^\n]*\n\s*)*useFollowSystemTheme\(\);/);
  });

  it('listens for the OS switch and for another tab, and reads the choice at that moment', () => {
    const follower = hook.slice(hook.indexOf('export function useFollowSystemTheme'), hook.indexOf('export function useTheme'));
    expect(follower).toContain("mq.addEventListener('change', sync);");
    expect(follower).toContain("window.addEventListener('storage', sync);");
    // Read when it fires, not captured when it mounted: an explicit "dark"
    // chosen later must beat the OS flipping to light.
    expect(follower).toContain('const sync = (): void => applyTheme(readStored());');
  });

  it('leaves the toggle with no listener of its own', () => {
    const toggle = hook.slice(hook.indexOf('export function useTheme'));
    expect(toggle).not.toContain('addEventListener');
  });
});
