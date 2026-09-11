// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readLastView, writeLastView } from '../web/src/lib/lastView';

/**
 * The schedule remembers the view a reader last chose. Every way back to it
 * — a track's page, a profile, the admin pages, the event bar — links to the
 * bare `/e/:slug`, and a bare URL used to mean the organiser's default again,
 * so reading the grid, opening a track and coming back landed in the list.
 */

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the last view', () => {
  it('is nothing until something is chosen', () => {
    expect(readLastView('testconf')).toEqual({});
  });

  it('keeps the view and the axis separately, per event', () => {
    writeLastView('testconf', { view: 'cal' });
    writeLastView('testconf', { axis: 'track' });
    expect(readLastView('testconf')).toEqual({ view: 'cal', axis: 'track' });
    writeLastView('testconf', { view: 'list' });
    expect(readLastView('testconf')).toEqual({ view: 'list', axis: 'track' });
    expect(readLastView('otherconf')).toEqual({});
  });

  it('ignores anything that is not a view or an axis', () => {
    localStorage.setItem('libresesh:view:testconf', JSON.stringify({ view: 'x', axis: 3 }));
    expect(readLastView('testconf')).toEqual({});
    localStorage.setItem('libresesh:view:testconf', 'not json');
    expect(readLastView('testconf')).toEqual({});
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readLastView('testconf')).toEqual({});
    expect(() => writeLastView('testconf', { view: 'cal' })).not.toThrow();
  });
});

describe('the schedule reads it', () => {
  const schedule = readFileSync(
    join(__dirname, '..', 'web', 'src', 'pages', 'SchedulePage.tsx'),
    'utf8',
  );

  it('after the URL and before the organiser default', () => {
    expect(schedule).toContain("filters.view ?? remembered.view ?? event?.defaultView ?? 'list'");
    expect(schedule).toContain("(filters.axis ?? remembered.axis) === 'track'");
  });

  it('and writes every explicit choice back', () => {
    expect(schedule).toContain('writeLastView(slug, {');
    // Only what the URL actually says: a view chosen alone must not wipe the
    // axis last chosen, and the other way round.
    expect(schedule).toContain('filters.view !== null ? { view: filters.view } : {}');
    expect(schedule).toContain('filters.axis !== null ? { axis: filters.axis } : {}');
  });
});
