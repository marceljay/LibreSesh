// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewSwitch } from '../web/src/components/ViewSwitch';
import { installBrowserShims } from './dom';

/**
 * List │ Grid ▾ — and, on an event with tracks, the rooms-or-tracks question
 * asked from the Grid button rather than by a second control that appeared
 * beside it in the grid and vanished in the list, wrapping the row under it
 * on a phone every time it came.
 */

type Props = Parameters<typeof ViewSwitch>[0];
const mount = (over: Partial<Props> = {}) => {
  const onChange = vi.fn();
  render(<ViewSwitch view="list" axis="room" hasTracks={false} onChange={onChange} {...over} />);
  return onChange;
};

beforeEach(() => installBrowserShims());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the view switch', () => {
  it('puts List first and Grid last', () => {
    mount();
    const names = screen.getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['List', 'Grid']);
  });

  it('is two plain toggles without tracks — no chevron, no menu', () => {
    const onChange = mount({ view: 'cal' });
    const grid = screen.getByRole('button', { name: 'Grid' });
    expect(grid.getAttribute('aria-haspopup')).toBeNull();
    expect(grid.querySelector('svg')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(onChange).toHaveBeenLastCalledWith({ view: 'list' });
    fireEvent.click(grid);
    expect(onChange).toHaveBeenLastCalledWith({ view: 'cal' });
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });

  it('asks rooms or tracks on the way into the grid', () => {
    const onChange = mount({ hasTracks: true });
    const grid = screen.getByRole('button', { name: 'Grid' });
    expect(grid.getAttribute('aria-haspopup')).toBe('menu');
    expect(grid.querySelector('svg')).not.toBeNull();
    fireEvent.click(grid);
    expect(onChange).not.toHaveBeenCalled();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      'RoomsA column per room, side by side.',
      'TracksA column per track; each block says which room it is in.',
    ]);
    // In the list no axis is showing, so neither row claims to be it.
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    fireEvent.click(items[1]);
    expect(onChange).toHaveBeenCalledWith({ view: 'cal', axis: 'track' });
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });

  it('turns the columns the other way from inside the grid', () => {
    const onChange = mount({ hasTracks: true, view: 'cal', axis: 'track' });
    const grid = screen.getByRole('button', { name: 'Grid' });
    expect(grid.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(grid);
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    fireEvent.click(items[0]);
    expect(onChange).toHaveBeenCalledWith({ view: 'cal', axis: 'room' });
  });

  it('still leaves the grid in one press', () => {
    const onChange = mount({ hasTracks: true, view: 'cal' });
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(onChange).toHaveBeenCalledWith({ view: 'list' });
  });
});

describe('on the schedule page', () => {
  const schedule = readFileSync(
    join(__dirname, '..', 'web', 'src', 'pages', 'SchedulePage.tsx'),
    'utf8',
  );

  it('is the one control, with no axis toggle left beside it', () => {
    expect(schedule).toContain('<ViewSwitch');
    expect(schedule).not.toContain('data-tour="axis"');
    expect(schedule).not.toContain("(['room', 'track'] as const)");
  });

  it('writes view and axis to the URL in one step', () => {
    expect(schedule).toContain('filters.set(next)');
    // Leaving the grid still leaves Arrange.
    expect(schedule).toContain("if (next.view !== 'cal') setArrange(false);");
  });

  it('tells the tour in one stop, and only mentions tracks when there are some', () => {
    expect(schedule).not.toContain("target: 'axis'");
    expect(schedule).toContain("title: 'Grid or list'");
    expect(schedule).toMatch(/body: hasTracks\s*\?/);
  });
});
