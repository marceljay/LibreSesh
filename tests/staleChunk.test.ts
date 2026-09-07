import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isStaleChunkError } from '../web/src/lib/staleChunk.js';

/**
 * Every route is a `React.lazy` chunk. Before this, nothing caught a chunk that
 * failed to load: React unmounted the whole tree and the visitor got a blank
 * page that only a manual refresh fixed. In production the usual cause is a
 * deploy — hashed filenames change, and a tab left open all morning asks for
 * one that no longer exists the next time someone navigates.
 */

const WEB = join(import.meta.dirname, '..', 'web', 'src');
const read = (...parts: string[]) => readFileSync(join(WEB, ...parts), 'utf8');

describe('recognising a stale chunk', () => {
  // Wording differs per browser and none of them set a code, which is exactly
  // why this is worth pinning: a reworded match silently stops auto-reloading.
  const realMessages = [
    'Failed to fetch dynamically imported module: https://example.org/assets/AdminPage-4f2a.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    "Unexpected token '<'",
  ];

  it('matches what browsers actually say', () => {
    for (const message of realMessages) {
      expect(isStaleChunkError(new Error(message)), message).toBe(true);
    }
  });

  it('is case-insensitive, because the browsers disagree on that too', () => {
    expect(isStaleChunkError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'))).toBe(true);
  });

  it('leaves ordinary errors alone, so they surface instead of reloading', () => {
    for (const message of [
      "Cannot read properties of undefined (reading 'slug')",
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Maximum update depth exceeded',
    ]) {
      expect(isStaleChunkError(new Error(message)), message).toBe(false);
    }
  });

  it('survives being handed something that is not an Error', () => {
    expect(isStaleChunkError(undefined)).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError('failed to fetch dynamically imported module')).toBe(true);
  });
});

describe('the boundary is actually mounted', () => {
  const app = read('App.tsx');

  it('wraps the routes, not just sits in the file', () => {
    // Above <Suspense>: a lazy chunk's rejection propagates out of the
    // suspense boundary, so a boundary inside it would never see one.
    expect(app.indexOf('<AppErrorBoundary>')).toBeGreaterThan(-1);
    expect(app.indexOf('<AppErrorBoundary>')).toBeLessThan(app.indexOf('<Suspense'));
    expect(app.indexOf('</Suspense>')).toBeLessThan(app.indexOf('</AppErrorBoundary>'));
  });

  it('reloads at most once before showing the error', () => {
    const boundary = read('components', 'AppErrorBoundary.tsx');
    // A boundary that reloads on every failure is a boot loop with no way out.
    expect(boundary).toContain('reloadedJustNow');
    expect(boundary).toMatch(/!reloadedJustNow\(\)[\s\S]{0,80}window\.location\.reload/);
  });
});
