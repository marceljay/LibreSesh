import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isStaleChunkError } from '../lib/staleChunk';
import { PrimaryButton } from './ui';

/**
 * Every route is a `React.lazy` chunk, and a chunk that fails to load throws
 * during render. With no boundary above it React unmounts the whole tree — the
 * page goes blank, nothing is logged where a visitor would see it, and only a
 * manual refresh brings the app back. That is the worst possible failure for
 * this app's audience: someone in a hallway who now believes the schedule is
 * down.
 *
 * The common cause is not a bug at all. Built chunk filenames carry a content
 * hash, so a deploy replaces them; a tab someone left open all morning still
 * holds the old `index.html` and asks for a filename that no longer exists the
 * next time they navigate. Same shape in dev, when Vite re-optimises deps or
 * the server restarts under an open tab.
 *
 * So a stale chunk is not an error to report, it is an app that needs its new
 * bundle: reload once, silently. `once` matters — if the reload does not fix
 * it, the cause was something else, and a boundary that keeps reloading is a
 * boot loop with no way out. The second failure shows the error instead.
 */

/** Per tab, and cleared when the tab closes. */
const RELOAD_KEY = 'libresesh:reloaded-for-stale-chunk';

/** A timestamp, not a flag. "Did reloading help?" is the question, and only a
 *  failure that comes straight back answers no — a tab left open across two
 *  deploys hours apart deserves the silent reload both times. */
const RECENTLY = 10_000;

function reloadedJustNow(): boolean {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < RECENTLY;
  } catch {
    // Private mode, or storage disabled. Treat it as "already tried", so a
    // browser that cannot remember can never loop.
    return true;
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* nothing to do; reloadedJustNow's fallback already prevents the loop */
  }
}

export function clearReloadMark(): void {
  try {
    sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isStaleChunkError(error) && !reloadedJustNow()) {
      markReloaded();
      window.location.reload();
      return;
    }
    console.error('Unhandled error below the router:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    // React renders with the error in state before `componentDidCatch` runs, so
    // this is the frame just before the reload is asked for. Showing an error
    // for it would be a lie about what is about to happen.
    if (isStaleChunkError(error) && !reloadedJustNow()) return null;

    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-start justify-center gap-3 px-4">
        <h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          This page didn&rsquo;t load
        </h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {isStaleChunkError(error)
            ? 'A new version was published while this tab was open, and reloading once did not pick it up. Your schedule is fine — this is the app, not your data.'
            : 'Something went wrong rendering this page. Your schedule is fine — nothing was saved or lost.'}
        </p>
        <PrimaryButton
          onClick={() => {
            clearReloadMark();
            window.location.reload();
          }}
        >
          Reload
        </PrimaryButton>
      </div>
    );
  }
}
