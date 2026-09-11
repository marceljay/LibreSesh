// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomDto, SessionDto } from '../server/src/shared/types';
import { DraftsModal } from '../web/src/components/DraftsModal';
import { NewSessionMenu } from '../web/src/components/NewSessionMenu';
import { installBrowserShims } from './dom';

/**
 * *View drafts* in the + Session menu, and the list it opens. The row is there
 * only while the reader has drafts to go back to: at zero the menu is exactly
 * the one it was, plain button and all.
 */

type MenuProps = Parameters<typeof NewSessionMenu>[0];
const menu = (over: Partial<MenuProps> = {}) =>
  render(
    <MemoryRouter>
      <NewSessionMenu
        canAdd
        pitchHref={null}
        pitchCount={0}
        draftCount={0}
        onAdd={() => {}}
        onDrafts={() => {}}
        {...over}
      />
    </MemoryRouter>,
  );

beforeEach(() => installBrowserShims());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the + Session menu', () => {
  it('does not mention drafts while there are none', () => {
    menu({ pitchHref: '/e/testconf/proposals' });
    fireEvent.click(screen.getByRole('button', { name: 'Add or pitch a session' }));
    expect(screen.getByText('Add a session')).toBeTruthy();
    expect(screen.queryByText('View drafts')).toBeNull();
  });

  it('stays a plain button when adding is the only thing, and there are no drafts', () => {
    const onAdd = vi.fn();
    menu({ onAdd });
    fireEvent.click(screen.getByRole('button', { name: 'Add session' }));
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it('offers the drafts once there are some, even with the board off', () => {
    const onDrafts = vi.fn();
    menu({ draftCount: 2, onDrafts });
    fireEvent.click(screen.getByRole('button', { name: 'Add a session, or open a draft' }));
    expect(screen.getByText('Add a session')).toBeTruthy();
    fireEvent.click(screen.getByText('View drafts'));
    expect(onDrafts).toHaveBeenCalledOnce();
  });

  it('is a plain Drafts button for someone who may only see a draft', () => {
    const onDrafts = vi.fn();
    menu({ canAdd: false, draftCount: 1, onDrafts });
    fireEvent.click(screen.getByRole('button', { name: 'Your drafts' }));
    expect(onDrafts).toHaveBeenCalledOnce();
  });
});

describe('the drafts list', () => {
  const room = { id: 1, name: 'Open Room' } as RoomDto;
  const session = (id: number, title: string, startsAt: string, draft: boolean): SessionDto =>
    ({
      id,
      roomId: 1,
      title,
      startsAt,
      endsAt: startsAt.replace('T08', 'T09'),
      draft,
    }) as SessionDto;

  it('lists only drafts, in running order, and opens the one pressed', () => {
    const onOpen = vi.fn();
    render(
      <DraftsModal
        sessions={[
          session(1, 'Later draft', '2026-06-02T08:00:00.000Z', true),
          session(2, 'Published', '2026-06-01T08:00:00.000Z', false),
          session(3, 'Earlier draft', '2026-06-01T08:00:00.000Z', true),
        ]}
        rooms={[room]}
        timezone="Europe/Berlin"
        onOpen={onOpen}
        onClose={() => {}}
      />,
    );
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Earlier draft');
    expect(rows[0]).toContain('10:00–11:00 · Open Room');
    expect(rows[1]).toContain('Later draft');
    fireEvent.click(screen.getByText('Later draft'));
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('says so when the last one has gone', () => {
    render(
      <DraftsModal
        sessions={[]}
        rooms={[room]}
        timezone="Europe/Berlin"
        onOpen={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('No drafts left.')).toBeTruthy();
  });
});
