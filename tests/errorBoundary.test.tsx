// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary, clearReloadMark } from '../web/src/components/AppErrorBoundary';

/**
 * The boundary, rendered for real rather than read as source. A component that
 * throws is the whole point of it, and nothing but a render proves what a
 * visitor is left looking at: React's own machinery decides whether the
 * fallback appears, and `staleChunk.test.ts` pinning the message list cannot
 * say that the fallback ever replaces a blank page.
 *
 * The crash this exists for (2026-08-30, a build stamp that threw on every
 * render) passed the whole suite green, because nothing in the suite rendered
 * anything.
 */

const STALE = 'Failed to fetch dynamically imported module: /assets/AdminPage-4f2a.js';

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

/** React reports every caught error through console.error, twice under
 *  StrictMode. Captured rather than silenced: "did it log?" is part of the
 *  contract — an error the boundary swallows is one nobody can debug. */
let logged: unknown[][];
let reload: ReturnType<typeof vi.fn>;
const realLocation = window.location;

beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args);
  });
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: realLocation.href, reload },
  });
  clearReloadMark();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('a component that throws', () => {
  it('leaves the fallback on screen instead of a blank page', () => {
    render(
      <AppErrorBoundary>
        <Boom message="Cannot read properties of undefined (reading 'slug')" />
      </AppErrorBoundary>,
    );

    expect(screen.getByText(/didn’t load/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
    // The reassurance matters as much as the heading: the reader is at an
    // event, and the question they actually have is whether the programme is
    // gone.
    expect(screen.getByText(/nothing was saved or lost/i)).toBeTruthy();
  });

  it('reports it, so it is debuggable rather than merely survived', () => {
    render(
      <AppErrorBoundary>
        <Boom message="Maximum update depth exceeded" />
      </AppErrorBoundary>,
    );

    expect(
      logged.some((args) => String(args[0]).includes('Unhandled error in the React tree')),
    ).toBe(true);
  });

  it('does not reload the page for an ordinary error', () => {
    render(
      <AppErrorBoundary>
        <Boom message="Maximum update depth exceeded" />
      </AppErrorBoundary>,
    );

    // A reload would lose whatever the visitor had typed and land them right
    // back on the same broken render.
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps rendering children while nothing throws', () => {
    render(
      <AppErrorBoundary>
        <p>the schedule</p>
      </AppErrorBoundary>,
    );

    expect(screen.getByText('the schedule')).toBeTruthy();
    expect(screen.queryByText(/didn’t load/i)).toBeNull();
  });
});

describe('a stale chunk', () => {
  it('reloads once, silently — no error is shown for a reload in flight', () => {
    render(
      <AppErrorBoundary>
        <Boom message={STALE} />
      </AppErrorBoundary>,
    );

    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/didn’t load/i)).toBeNull();
  });

  it('shows the error the second time, rather than looping', () => {
    render(
      <AppErrorBoundary>
        <Boom message={STALE} />
      </AppErrorBoundary>,
    );
    cleanup();
    reload.mockClear();

    // The reload happened; the tab came back on the new bundle and the chunk
    // still fails. Reloading again is a boot loop with no way out of it.
    render(
      <AppErrorBoundary>
        <Boom message={STALE} />
      </AppErrorBoundary>,
    );

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/a new version was published/i)).toBeTruthy();
  });
});

describe('navigating away from a page that threw', () => {
  it('clears the error when the reset key changes', () => {
    const { rerender } = render(
      <AppErrorBoundary resetKey="/e/testconf/admin">
        <Boom message="Cannot read properties of undefined (reading 'slug')" />
      </AppErrorBoundary>,
    );
    expect(screen.getByText(/didn’t load/i)).toBeTruthy();

    rerender(
      <AppErrorBoundary resetKey="/e/testconf">
        <p>the schedule</p>
      </AppErrorBoundary>,
    );

    // Without this the fallback outlives the page that caused it: Back from a
    // route that threw shows the same apology, and the app reads as dead.
    expect(screen.getByText('the schedule')).toBeTruthy();
    expect(screen.queryByText(/didn’t load/i)).toBeNull();
  });

  it('stays put while the key does not change', () => {
    const { rerender } = render(
      <AppErrorBoundary resetKey="/e/testconf/admin">
        <Boom message="Cannot read properties of undefined (reading 'slug')" />
      </AppErrorBoundary>,
    );

    rerender(
      <AppErrorBoundary resetKey="/e/testconf/admin">
        <p>the schedule</p>
      </AppErrorBoundary>,
    );

    // A re-render for any other reason must not quietly retry the render that
    // threw — that is the loop the fallback exists to stop.
    expect(screen.getByText(/didn’t load/i)).toBeTruthy();
  });
});
