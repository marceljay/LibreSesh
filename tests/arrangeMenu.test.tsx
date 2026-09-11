// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewSessionMenu } from '../web/src/components/NewSessionMenu';
import { installBrowserShims } from './dom';

/**
 * *Arrange sessions* in the + Session menu. The button for it sits a row
 * further down and, on a phone, is a bare `↕`; the menu row is the same
 * toggle with its words and a sentence. It is offered only where there is a
 * grid to drag on — the page passes `onArrange` for an admin in the grid
 * view, and nowhere else — and only beside *Add a session*, so the menu is
 * never a menu of one.
 */

type MenuProps = Parameters<typeof NewSessionMenu>[0];
const menu = (over: Partial<MenuProps> = {}) =>
  render(
    <MemoryRouter>
      <NewSessionMenu canAdd pitchHref={null} pitchCount={0} onAdd={() => {}} {...over} />
    </MemoryRouter>,
  );

beforeEach(() => installBrowserShims());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Arrange in the + Session menu', () => {
  it('turns the plain Add button into a menu, and toggles the mode from it', () => {
    const onArrange = vi.fn();
    const onAdd = vi.fn();
    menu({ onAdd, onArrange });
    fireEvent.click(screen.getByRole('button', { name: 'Add a session, or arrange the grid' }));
    expect(screen.getByText('Add a session')).toBeTruthy();
    const row = screen.getByRole('button', { name: /Arrange sessions/ });
    expect(row.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(row);
    expect(onArrange).toHaveBeenCalledOnce();
    expect(onAdd).not.toHaveBeenCalled();
    // Chosen, so closed — the banner at the foot of the page says it is on.
    expect(screen.queryByText('Add a session')).toBeNull();
  });

  it('reads as the way out while the mode is on', () => {
    menu({ onArrange: () => {}, arranging: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add a session, or arrange the grid' }));
    const row = screen.getByRole('button', { name: /Done arranging/ });
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('Arrange sessions')).toBeNull();
  });

  it('sits under the rule, after the drafts', () => {
    menu({ onArrange: () => {}, draftCount: 2, onDrafts: () => {} });
    fireEvent.click(
      screen.getByRole('button', { name: 'Add a session, or open a draft, or arrange the grid' }),
    );
    const rows = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    const drafts = rows.findIndex((t) => t.startsWith('View drafts'));
    const arrange = rows.findIndex((t) => t.includes('Arrange sessions'));
    expect(drafts).toBeGreaterThan(-1);
    expect(arrange).toBe(drafts + 1);
  });

  it('is not offered to somebody who may not add', () => {
    // A guard, not a case the page produces: `onArrange` only comes with the
    // admin role, which may always add. Without adding, the row would be a
    // menu of one — so the component does not build one.
    menu({ canAdd: false, onArrange: () => {} });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is still a plain Add button without it', () => {
    const onAdd = vi.fn();
    menu({ onAdd });
    fireEvent.click(screen.getByRole('button', { name: 'Add session' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
});

describe('where the page offers it', () => {
  const schedule = readFileSync(
    join(__dirname, '..', 'web', 'src', 'pages', 'SchedulePage.tsx'),
    'utf8',
  );
  const header = schedule.slice(0, schedule.indexOf('{fullPage && selected ? ('));
  const fullPage = schedule.slice(schedule.indexOf('{fullPage && selected ? ('));

  it('gates the row on the same rule as the button', () => {
    // Admin, grid view, event not archived — one `canArrange`, read twice.
    expect(header).toContain('onArrange={canArrange ? () => setArrange((a) => !a) : undefined}');
    expect(header).toContain('arranging={arrange}');
  });

  it('leaves it off the full-page session, which has no grid to drag on', () => {
    const copy = fullPage.slice(fullPage.indexOf('<NewSessionMenu'), fullPage.indexOf('/>'));
    expect(copy).not.toContain('onArrange');
  });
});
