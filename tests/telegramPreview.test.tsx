// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDto, RoomDto, SessionDto } from '../server/src/shared/types';
import { TelegramPreview } from '../web/src/components/TelegramPreview';
import { installBrowserShims } from './dom';

/**
 * Every other setting in Manage Event changes something the organiser can look
 * at. These change what a message in somebody else's Telegram will say
 * tomorrow morning, so the example is the only way to check the choice before
 * a roomful of people gets it.
 */

const event = {
  slug: 'testconf',
  name: 'TestConf',
  timezone: 'Europe/Berlin',
} as EventDto;

const rooms = [
  { id: 1, name: 'Main Hall' },
  { id: 2, name: 'Room 2' },
] as RoomDto[];

const session = (over: Partial<SessionDto>): SessionDto =>
  ({
    id: 1,
    roomId: 1,
    title: 'Scaling an unconference',
    startsAt: '2099-06-01T08:00:00.000Z',
    endsAt: '2099-06-01T08:30:00.000Z',
    speakers: [{ id: 1, name: 'Ada Lovelace' }],
    livestreams: [],
    draft: false,
    ...over,
  }) as SessionDto;

const show = (mode: string, sessions: SessionDto[] = [session({})], livestreams = false) =>
  render(
    <TelegramPreview
      mode={mode}
      leadMin={15}
      livestreams={livestreams}
      event={event}
      sessions={sessions}
      rooms={rooms}
      onClose={() => {}}
    />,
  );

beforeEach(() => installBrowserShims());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Telegram example', () => {
  it('shows the up-next message, and says when it goes out', () => {
    show('up_next');
    expect(screen.getByText(/up next/)).toBeTruthy();
    expect(screen.getByText(/15 minutes before each start time/)).toBeTruthy();
  });

  it('draws no message that the app cannot actually send', () => {
    // The modal exists to stop somebody discovering the real behaviour in a
    // roomful of people. Drawing an unbuilt trigger would be the same fault in
    // reverse: a promise of a message that never arrives.
    show('up_next');
    expect(screen.queryByText(/Each morning/)).toBeNull();
    expect(screen.queryByText(/Just added/)).toBeNull();
  });

  it('shows a livestream link only when that is switched on', () => {
    const streamed = [
      session({ livestreams: [{ label: 'Main camera', url: 'https://stream.example/main' }] }),
    ];
    show('up_next', streamed);
    expect(screen.queryByText(/Main camera/)).toBeNull();
    cleanup();
    show('up_next', streamed, true);
    expect(screen.getByText(/Main camera/)).toBeTruthy();
  });

  it('says plainly that off sends nothing', () => {
    show('off');
    expect(screen.getByText(/Nothing\./)).toBeTruthy();
    expect(screen.queryByText(/up next/)).toBeNull();
  });

  it('draws the event’s own sessions, in the event’s timezone', () => {
    show('up_next');
    // 08:00 UTC is 10:00 in Berlin — the venue's clock, not the server's.
    expect(screen.getByText(/10:00 — up next/)).toBeTruthy();
    expect(screen.getByText('Scaling an unconference')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
  });

  it('puts every room of one start time in the same message', () => {
    show('up_next', [
      session({}),
      session({ id: 2, roomId: 2, title: 'Hallway track', speakers: [] }),
    ]);
    expect(screen.getByText('Main Hall')).toBeTruthy();
    expect(screen.getByText('Room 2')).toBeTruthy();
  });

  it('never previews a draft, because one is never posted', () => {
    show('up_next', [session({ id: 3, title: 'Secret plans', draft: true })]);
    expect(screen.queryByText('Secret plans')).toBeNull();
  });

  it('falls back to stand-in names on an event with nothing scheduled, and says so', () => {
    show('up_next', []);
    expect(screen.getByText(/stand-in names/)).toBeTruthy();
    expect(screen.getByText('Scaling an unconference')).toBeTruthy();
  });
});
