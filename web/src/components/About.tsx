import { Modal } from './Modal';
import { linkClass } from './ui';

/** Where the code lives — the answer to "can I run this myself?", which is
 *  most of the point of it being open source. */
const REPO_URL = 'https://github.com/marceljay/LibreSesh';

/**
 * Which build you are looking at, stamped by vite at build time.
 *
 * Defaulted rather than asserted: a missing stamp should read "unknown", not
 * take the page down with it.
 */
function build(): { tag: string; commit: string; built: string } {
  const dirty = import.meta.env.VITE_BUILD_DIRTY === 'true';
  const at = new Date(import.meta.env.VITE_BUILD_TIME ?? '');
  return {
    tag: import.meta.env.VITE_BUILD_TAG ?? 'unknown',
    commit: (import.meta.env.VITE_BUILD_COMMIT ?? 'unknown') + (dirty ? '-dirty' : ''),
    built: Number.isNaN(at.getTime())
      ? 'unknown'
      : `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  };
}

/**
 * What this thing is, and which build of it you are looking at.
 *
 * The version used to live in a pill pinned to the bottom-right of every page —
 * a permanent fixture for a question asked twice a year, sitting over the
 * corner of the grid on a phone. It is here instead, reached from the profile
 * menu, which is where someone who wants it will look and out of everyone
 * else's way.
 */
export function AboutModal({ demo, onClose }: { demo: boolean; onClose: () => void }) {
  const { tag, commit, built } = build();

  return (
    <Modal title="About LibreSesh" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-stone-600 dark:text-stone-300">
          A simple, open-source scheduling tool for conferences and
          unconferences. Everyone reads the same live schedule; anyone with a
          link can follow it, and nobody needs an account.
        </p>
        {demo && (
          <p className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            demo instance — the data here is reset
          </p>
        )}
        {/* `select-all`: the first thing anyone is asked for when they report
            something is which build they were on. */}
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-stone-500 dark:text-stone-400">Version</dt>
          <dd className="select-all font-mono">{tag}</dd>
          <dt className="text-stone-500 dark:text-stone-400">Commit</dt>
          <dd className="select-all font-mono">{commit}</dd>
          <dt className="text-stone-500 dark:text-stone-400">Built</dt>
          <dd className="select-all font-mono">{built}</dd>
        </dl>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          MIT licensed ·{' '}
          {/* `noreferrer` with `noopener`: a link out of a schedule should not
              hand the destination the address of the event it came from. */}
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkClass} font-medium`}
          >
            Source on GitHub
          </a>
        </p>
      </div>
    </Modal>
  );
}
