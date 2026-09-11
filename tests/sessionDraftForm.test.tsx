// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomDto, SessionDto } from '../server/src/shared/types';
import { SessionModal, type SessionModalProps } from '../web/src/components/SessionModal';
import type { SessionWrite } from '../web/src/lib/api';
import { installBrowserShims } from './dom';

/**
 * The draft button in the session form's footer, between Cancel and the
 * primary: offered to whoever may take the session off the schedule, and the
 * only way the form ever sends `draft: true`. The server holds the same line
 * (`sessionDrafts.test.ts`); this is the form not offering what it would
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
const onSchedule: SessionDto = { ...parked, draft: false };

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
const button = (name: string) => screen.getByRole('button', { name });
/** The footer's buttons, in the order they are drawn. */
const footer = () =>
  screen
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((t) => /Cancel|draft|Add session|Publish|Save|Delete/.test(t));

beforeEach(() => {
  installBrowserShims();
  saved = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a new session', () => {
  const withTitle = () => {
    render(<SessionModal {...props()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Maybe later' },
    });
  };

  it('is added by the primary button, with Save as draft between it and Cancel', () => {
    withTitle();
    expect(footer()).toEqual(['Cancel', 'Save as draft', 'Add session']);
    fireEvent.click(button('Add session'));
    expect(saved[0]).toMatchObject({ title: 'Maybe later', draft: false });
  });

  it('is kept off the schedule by Save as draft', () => {
    withTitle();
    fireEvent.click(button('Save as draft'));
    expect(saved[0]).toMatchObject({ title: 'Maybe later', draft: true });
  });

  it('has no checkbox for it any more', () => {
    withTitle();
    expect(screen.queryByRole('checkbox', { name: /off the schedule/i })).toBeNull();
  });
});

describe('an existing session, for someone who may delete it', () => {
  it('publishes a draft, or saves it as one', () => {
    render(<SessionModal {...props({ session: parked, onDelete: () => {} })} />);
    expect(footer()).toEqual(['Delete', 'Cancel', 'Save draft', 'Publish']);
    fireEvent.click(button('Save draft'));
    fireEvent.click(button('Publish'));
    expect(saved.map((b) => b.draft)).toEqual([true, false]);
  });

  it('moves a published session to the drafts without deleting it', () => {
    render(<SessionModal {...props({ session: onSchedule, onDelete: () => {} })} />);
    expect(footer()).toEqual(['Delete', 'Cancel', 'Move to drafts', 'Save']);
    fireEvent.click(button('Move to drafts'));
    expect(saved[0]).toMatchObject({ draft: true });
  });
});

it('offers no draft button to someone who may edit the session but not delete it', () => {
  render(<SessionModal {...props({ session: parked })} />);
  expect(footer()).toEqual(['Cancel', 'Save']);
  fireEvent.click(button('Save'));
  expect(saved[0]).not.toHaveProperty('draft');
});
