import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A link to a route that does not exist fails silently. `App.tsx` ends in a
 * `path="*"` that redirects to `/`, which is right for a stale event link
 * someone pastes — and wrong as the answer to our own dead link, because the
 * visitor lands on the landing page with no error anywhere and the bug looks
 * like "the button does nothing".
 *
 * That is exactly what happened: the notification bell sent a pitch
 * notification to `/e/:slug/pitches` while the route has always been
 * `/e/:slug/proposals`, so opening one bounced you to the front door. The
 * suite could not see it — there is no DOM here, and a route table is not the
 * kind of thing an integration test walks.
 *
 * So this checks the two lists agree: every first path segment the app builds
 * under `/e/${slug}/` has to be a segment `App.tsx` declares.
 */

const WEB = join(import.meta.dirname, '..', 'web', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** `<Route path="/e/:slug/agenda">` → `agenda`. Routes with no segment after
 *  the slug (`/e/:slug` itself) contribute nothing and need nothing. */
function declaredSegments(app: string): Set<string> {
  const found = new Set<string>();
  for (const [, path] of app.matchAll(/path="([^"]+)"/g)) {
    const m = /^\/e\/:slug\/([^/]+)/.exec(path);
    if (m) found.add(m[1].startsWith(':') ? ':' : m[1]);
  }
  return found;
}

/** Every `` `/e/${slug}/agenda` `` in the app, wherever it is built — a
 *  `navigate()`, a `<Link to>`, or a string handed to either. Only the literal
 *  first segment matters; `${...}` right after the slash is an id, which the
 *  `:sessionId`-style routes cover. */
function usedSegments(source: string): string[] {
  return [...source.matchAll(/`\/e\/\$\{[a-zA-Z.?]+\}\/([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1]);
}

describe('every route the app links to exists', () => {
  const declared = declaredSegments(readFileSync(join(WEB, 'App.tsx'), 'utf8'));

  it('finds the route table', () => {
    // If this ever empties, the two regexes have drifted from App.tsx and the
    // test below would pass by knowing nothing.
    expect(declared.size).toBeGreaterThan(3);
  });

  it('has a route for every /e/:slug/<segment> the app builds', () => {
    for (const file of sources(WEB)) {
      for (const segment of usedSegments(readFileSync(file, 'utf8'))) {
        expect(declared, `${file.slice(WEB.length + 1)} links to /e/:slug/${segment}`).toContain(
          segment,
        );
      }
    }
  });
});
