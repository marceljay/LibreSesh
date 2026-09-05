import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'libresesh.theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

// Private windows and blocked site data throw on storage access, so every read
// and write is guarded — the app must still render when persistence is gone.
function readStored(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return 'system';
}

function writeStored(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Nothing to persist; the choice lasts only for this session.
  }
}

function prefersDark(): boolean {
  try {
    return window.matchMedia(MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

function applyTheme(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

export interface ThemeControl {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

/**
 * Keeps the page following the OS (and the other tabs) for as long as the app
 * is open. Mount it **once, at the root**.
 *
 * This used to live inside `useTheme`, which only the toggle calls — and the
 * toggle sits in the profile menu, which is only mounted while the menu is
 * open. So the listener that noticed an OS switch existed for the few seconds
 * a menu was on screen: the OS went dark at sunset and the page stayed light
 * until somebody clicked their name. The listener has to belong to something
 * that is always mounted, and the only such thing is the app.
 *
 * It reads the stored choice at the moment of the change rather than
 * capturing it, so an explicit "dark" chosen after this mounted is honoured —
 * the OS flipping to light must not override a person who asked for dark.
 */
export function useFollowSystemTheme(): void {
  useEffect(() => {
    const sync = (): void => applyTheme(readStored());
    sync();
    const mq = window.matchMedia(MEDIA_QUERY);
    mq.addEventListener('change', sync);
    // A choice made in another tab of the same site.
    window.addEventListener('storage', sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
}

/** Theme choice with persistence. Following the OS while set to `'system'` is
 *  `useFollowSystemTheme`'s job, at the root; this only applies a choice. */
export function useTheme(): ThemeControl {
  const [theme, setThemeState] = useState<Theme>(readStored);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    writeStored(next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
