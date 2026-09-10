// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomDto, SessionDto } from '../server/src/shared/types';
import { SessionModal, type SessionModalProps } from '../web/src/components/SessionModal';
import type { SessionWrite } from '../web/src/lib/api';
import { installBrowserShims } from './dom';

/**
 * The Draft switch in the session form: offered to whoever may take the
 * session off the schedule, and sent only by them. The server holds the same
 * line (`sessionDrafts.test.ts`); this is the form not offering what it would
 * refuse.
 */

const DAY = '2026-06-01';
const room = { id: 1, name: 'Open Room', openBooking: true, sortOrder: 0 } as RoomDto;
const parked: SessionDto = {
  id: 7,
  roomId: 1,
  trackId: null,
  type: 'open',
  formatId: null,
  blocksOpenBooking: false,
  title: 'Parked',
  description: '',
  speakers: [],
  livestreams: [],
  startsAt: '2026-06-01T08:00:00.000Z',
  endsAt: '2026-06-01T09:00:00.000Z',
  tagIds: [],
  createdBy: 1,
  createdByName: 'drafter',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  seriesId: null,
  draft: true,
};

let saved: SessionWrite[];
const props = (over: Partial<SessionModalProps> = {}): SessionModalProps => ({
  rooms: [room],
  tags: [],
  formats: [],
  tracks: [],
  people: [],
  role: 'user',
  canCreditOthers: false,
  timezone: 'Europe/Berlin',
  days: [DAY],
  dayLabels: { [DAY]: 'Monday' },
  defaultDay: DAY,
  dayStartMin: 480,
  dayEndMin: 1320,
  saving: false,
  onCancel: () => {},
  onSave: (body) => saved.push(body),
  ...over,
});
const toggle = () => screen.queryByRole('checkbox', { name: 'Keep this off the schedule for now' });

beforeEach(() => {
  installBrowserShims();
  saved = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Draft switch', () => {
  it('saves a new session as a draft', () => {
    render(<SessionModal {...props()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Maybe later' },
    });
    fireEvent.click(toggle()!);
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ title: 'Maybe later', draft: true });
  });

  it('publishes a draft when it is switched off', () => {
    render(<SessionModal {...props({ session: parked, onDelete: () => {} })} />);
    expect((toggle() as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle()!);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(saved[0]).toMatchObject({ draft: false });
  });

  it('is not offered to someone who may edit the session but not delete it', () => {
    render(<SessionModal {...props({ session: { ...parked, draft: false } })} />);
    expect(toggle()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saved[0]).not.toHaveProperty('draft');
  });
});
