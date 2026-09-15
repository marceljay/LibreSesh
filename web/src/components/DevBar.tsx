import { useEffect, useState } from 'react';
import type { DevInfo } from '../../devInfo';

/**
 * A strip along the bottom of every page while `npm run dev` serves it: which
 * worktree and branch this is, the commit the tree sits on, and when the dev
 * server came up. With several worktrees each running a server, the tab alone
 * does not say which checkout is on screen; this does.
 *
 * Mounted only under `import.meta.env.DEV` (see App.tsx), so a production
 * bundle carries neither the component nor the fetch.
 */
/** The divider between the bar's fields. Decorative: a screen reader gets the
 *  fields as separate spans already. */
const Sep = () => (
  <span aria-hidden="true" className="text-amber-400 dark:text-amber-600">
    |
  </span>
);

const COLLAPSED_KEY = 'libresesh.devbar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts until the next load, which is fine.
  }
}

/** Local calendar date as YYYY-MM-DD, next to the local time. */
function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function DevBar() {
  const [info, setInfo] = useState<DevInfo | null>(null);
  // Collapsed rather than gone: a small tab stays in the corner to bring the
  // bar back, and the choice survives reloads.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const collapse = (next: boolean) => {
    setCollapsed(next);
    writeCollapsed(next);
  };

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/__dev-info', { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<DevInfo>) : null))
      .then((i) => i && setInfo(i))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  if (!info) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => collapse(false)}
        aria-label="Show the dev bar"
        title="Show the dev bar"
        className="fixed bottom-0 end-0 z-[70] rounded-ts-md border-s border-t border-amber-300 bg-amber-50/95 px-2 py-0.5 font-mono text-[11px] font-semibold leading-tight text-amber-950 backdrop-blur-sm hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-100 dark:hover:bg-amber-900"
      >
        dev
      </button>
    );
  }

  const started = new Date(info.startedAt);
  const startedText = `${started.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })} (${isoDate(started)})`;

  return (
    <div
      role="status"
      aria-label="Dev server"
      className="fixed inset-x-0 bottom-0 z-[70] flex items-center gap-x-3 overflow-x-auto whitespace-nowrap border-t border-amber-300 bg-amber-50/95 px-2 py-0.5 font-mono text-[11px] leading-tight text-amber-950 backdrop-blur-sm dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-100"
    >
      <span className="font-semibold">dev</span>
      <Sep />
      {/* Git's own terms, spelled out so "main" cannot be read as the branch:
          a repository has one "main working tree" (the checkout that owns
          `.git`) and any number of "linked working trees" made with
          `git worktree add`. */}
      {info.worktreePath === null ? (
        <span>not a git checkout</span>
      ) : info.mainWorktree ? (
        <span>
          main working tree <b className="font-semibold">{info.worktreePath}</b>
        </span>
      ) : (
        <span title={info.worktreePath}>
          linked working tree <b className="font-semibold">{info.worktree}</b>{' '}
          <span className="text-amber-800 dark:text-amber-300">({info.worktreePath})</span>
        </span>
      )}
      <Sep />
      <span>
        branch <b className="font-semibold">{info.branch ?? 'detached'}</b>
      </span>
      <Sep />
      <span>
        commit <b className="font-semibold">{info.commit ?? 'none'}</b>
        {info.dirty && ' with uncommitted changes'}
      </span>
      <Sep />
      <span title={`Dev server started ${started.toISOString()}`}>started {startedText}</span>
      <button
        type="button"
        onClick={() => collapse(true)}
        aria-label="Collapse the dev bar to a corner tab"
        title="Collapse to a corner tab"
        className="ms-auto px-1 hover:text-amber-700 dark:hover:text-amber-300"
      >
        ×
      </button>
    </div>
  );
}
