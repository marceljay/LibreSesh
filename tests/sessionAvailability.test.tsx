// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposalDto, RoomDto, SessionDto } from '../server/src/shared/types';
import { PlaceProposalModal } from '../web/src/components/PlaceProposalModal';
import { SessionModal, type SessionModalProps } from '../web/src/components/SessionModal';
import type { PlaceWrite, SessionWrite } from '../web/src/lib/api';
import { installBrowserShims } from './dom';

/**
 * A room's taken slots, said in the form rather than by the server after
 * Save. The lists grey them (`roomAvailability.test.ts` holds the rule, a
 * Chromium pass the rows); what is checked here is the part that also covers
 * a typed time: the clash is named, and whoever the server would refuse is
 * stopped before the request while an organiser, who may double-book, is not.
 */

const DAY = '2026-06-01';
const room = { id: 1, name: 'Open Room', openBooking: true, sortOrder: 0 } as RoomDto;
// 14:00–15:00 in Berlin: on top of the form's default start.
const taken = {
  id: 7,
  roomId: 1,
  trackId: null,
  type: 'open',
  formatId: null,
  blocksOpenBooking: false,
  title: 'Already here',
  description: '',
  speakers: [],
  livestreams: [],
  startsAt: '2026-06-01T12:00:00.000Z',
  endsAt: '2026-06-01T13:00:00.000Z',
  tagIds: [],
  createdBy: 2,
  createdByName: 'someone',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  seriesId: null,
  draft: false,
} as SessionDto;

let saved: SessionWrite[];
const props = (over: Partial<SessionModalProps> = {}): SessionModalProps => ({
  rooms: [room],
  sessions: [taken],
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
const title = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: text },
  });
const NAMED = /“Already here” \(14:00–15:00\) is already in this room/;

beforeEach(() => {
  installBrowserShims();
  saved = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('adding a session on a taken slot', () => {
  it('names the clash and does not send it for an attendee', () => {
    render(<SessionModal {...props()} />);
    expect(screen.getByRole('alert').textContent).toMatch(NAMED);
    title('Mine');
    fireEvent.click(button('Add session'));
    expect(saved).toEqual([]);
  });

  it('still saves it as a draft, which claims no slot', () => {
    render(<SessionModal {...props()} />);
    title('Mine');
    fireEvent.click(button('Save as draft'));
    expect(saved).toHaveLength(1);
    expect(saved[0]?.draft).toBe(true);
  });

  it('tells an organiser and lets them double-book', () => {
    render(<SessionModal {...props({ role: 'admin' })} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(NAMED);
    title('Mine');
    fireEvent.click(button('Add session'));
    expect(saved).toHaveLength(1);
  });

  it('says nothing when the room is free then', () => {
    render(<SessionModal {...props({ sessions: [{ ...taken, roomId: 2 }] })} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('holds an attendee off a session holding the floor in another room, not a speaker', () => {
    const hold = { ...taken, roomId: 2, type: 'official', blocksOpenBooking: true } as SessionDto;
    const { unmount } = render(<SessionModal {...props({ sessions: [hold] })} />);
    expect(screen.getByRole('alert').textContent).toMatch(/holds the floor then/);
    unmount();
    render(<SessionModal {...props({ sessions: [hold], role: 'speaker' })} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('editing a session', () => {
  const mine = { ...taken, id: 8, title: 'Mine', createdBy: 1 } as SessionDto;

  it('does not collide with itself', () => {
    render(<SessionModal {...props({ session: mine, sessions: [mine] })} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves one that was double-booked where it is saveable', () => {
    render(<SessionModal {...props({ session: mine, sessions: [mine, taken] })} />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(button('Save'));
    expect(saved).toHaveLength(1);
  });
});

describe('placing a pitch', () => {
  const proposal = { id: 3, title: 'Pitched' } as ProposalDto;
  const place = (sessions: SessionDto[]) => {
    const placed: PlaceWrite[] = [];
    render(
      <PlaceProposalModal
        proposal={proposal}
        rooms={[room]}
        sessions={sessions}
        timezone="Europe/Berlin"
        days={[DAY]}
        dayLabels={{ [DAY]: 'Monday' }}
        defaultDay={DAY}
        dayStartMin={480}
        dayEndMin={1320}
        saving={false}
        onCancel={() => {}}
        onPlace={(body) => placed.push(body)}
      />,
    );
    fireEvent.click(button('Place session'));
    return placed;
  };

  it('is stopped on a taken slot — the server refuses it to organisers too', () => {
    expect(place([taken])).toEqual([]);
    expect(screen.getAllByRole('alert')[0]?.textContent).toMatch(NAMED);
  });

  it('goes through on a free one', () => {
    expect(place([])).toHaveLength(1);
  });
});
