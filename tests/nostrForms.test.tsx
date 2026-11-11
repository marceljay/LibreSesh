// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProposalDto, SessionDto } from '../server/src/shared/types';
import { ProposalModal } from '../web/src/components/ProposalModal';
import { SessionModal } from '../web/src/components/SessionModal';
import { installBrowserShims } from './dom';

/**
 * The notice and the opt-out on both forms: present only while the event
 * publishes to Nostr, ticked by default, and written into the body as the
 * opt-out the server stores.
 */

const NOTICE = 'This event publishes its programme and pitch board to Nostr.';

const sessionProps = {
  rooms: [
    {
      id: 1,
      name: 'Room A',
      description: '',
      capacity: null,
      openBooking: true,
      sortOrder: 0,
      color: '#BFD7E8',
    },
  ],
  tags: [],
  formats: [],
  tracks: [],
  people: [],
  role: 'admin' as const,
  canCreditOthers: true,
  timezone: 'Europe/Berlin',
  days: ['2026-06-01'],
  dayLabels: { '2026-06-01': 'Mon 1 June' },
  defaultDay: '2026-06-01',
  dayStartMin: 480,
  dayEndMin: 1320,
  saving: false,
  onCancel: () => undefined,
};

beforeEach(() => installBrowserShims());
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the session form', () => {
  it('says nothing about Nostr while the event has it off', () => {
    render(<SessionModal {...sessionProps} onSave={() => undefined} />);
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(screen.queryByLabelText('Publish to Nostr')).toBeNull();
  });

  it('shows the notice before the first field, ticked, and writes the opt-out', () => {
    const onSave = vi.fn();
    render(<SessionModal {...sessionProps} nostrEnabled onSave={onSave} />);
    const notice = screen.getByText(NOTICE);
    const title = screen.getByLabelText('Title');
    expect(notice.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const box = screen.getByLabelText('Publish to Nostr') as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.change(title, { target: { value: 'Quiet' } });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({ title: 'Quiet', nostrOptOut: true });
  });

  it('starts unticked on a session already kept off, and offers no box to a co-speaker', () => {
    const session = {
      id: 5,
      roomId: 1,
      trackId: null,
      type: 'official',
      formatId: null,
      blocksOpenBooking: false,
      title: 'Kept off',
      description: '',
      speakers: [],
      livestreams: [],
      startsAt: '2026-06-01T08:00:00.000Z',
      endsAt: '2026-06-01T08:30:00.000Z',
      tagIds: [],
      createdBy: 1,
      createdByName: 'x',
      createdAt: '',
      updatedAt: '',
      seriesId: null,
      draft: false,
      nostrOptOut: true,
      nostr: null,
    } as SessionDto;
    const { unmount } = render(
      <SessionModal
        {...sessionProps}
        nostrEnabled
        session={session}
        onSave={() => undefined}
        onDelete={() => undefined}
      />,
    );
    expect((screen.getByLabelText('Publish to Nostr') as HTMLInputElement).checked).toBe(false);
    unmount();
    // Without onDelete the editor may change the words but not the session's
    // standing: the notice stays, the box goes.
    render(
      <SessionModal {...sessionProps} nostrEnabled session={session} onSave={() => undefined} />,
    );
    expect(screen.getByText(NOTICE)).toBeTruthy();
    expect(screen.queryByLabelText('Publish to Nostr')).toBeNull();
  });
});

describe('the pitch form', () => {
  const props = {
    people: [],
    role: 'user' as const,
    canCreditOthers: false,
    tags: [],
    saving: false,
    onCancel: () => undefined,
  };

  it('shows the notice only while Nostr is on, and writes the opt-out', () => {
    const { unmount } = render(<ProposalModal {...props} onSave={() => undefined} />);
    expect(screen.queryByText(NOTICE)).toBeNull();
    unmount();
    const onSave = vi.fn();
    render(<ProposalModal {...props} nostrEnabled onSave={onSave} />);
    expect(screen.getByText(NOTICE)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Zines' } });
    fireEvent.click(screen.getByLabelText('Publish to Nostr'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0]![0]).toMatchObject({ title: 'Zines', nostrOptOut: true });
  });

  it('remembers a pitch kept off', () => {
    const proposal = {
      id: 3,
      title: 'Quiet',
      description: '',
      speaker: '',
      speakerId: null,
      tagIds: [],
      createdBy: 1,
      createdByName: 'x',
      placedSessionId: null,
      interestCount: 0,
      interested: false,
      nostrOptOut: true,
      createdAt: '',
      updatedAt: '',
    } as ProposalDto;
    render(<ProposalModal {...props} nostrEnabled proposal={proposal} onSave={() => undefined} />);
    expect((screen.getByLabelText('Publish to Nostr') as HTMLInputElement).checked).toBe(false);
  });
});
