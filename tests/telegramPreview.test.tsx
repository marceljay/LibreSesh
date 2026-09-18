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
    trackId: null,
    formatId: null,
    tagIds: [],
    draft: false,
    ...over,
  }) as SessionDto;

const show = (
  mode: string,
  sessions: SessionDto[] = [session({})],
  template = '{title}[, by {speakers}]',
) =>
  render(
    <TelegramPreview
      mode={mode}
      leadMin={15}
      template={template}
      digest="08:00"
      event={event}
      sessions={sessions}
      rooms={rooms}
      tracks={[{ id: 1, name: 'Practice' }]}
      formats={[{ id: 1, name: 'Workshop' }]}
      tags={[{ id: 1, name: 'facilitation' }]}
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
    show('light');
    expect(screen.getByText(/up next/)).toBeTruthy();
    expect(screen.getByText(/15 minutes before each start time/)).toBeTruthy();
  });

  it('draws each rung, and nothing from a rung above it', () => {
    // The modal exists to stop somebody discovering the real behaviour in a
    // roomful of people, so every bubble has to belong to the chosen setting.
    show('light');
    expect(screen.queryByText(/Each morning/)).toBeNull();
    expect(screen.queryByText(/Just pitched/)).toBeNull();
    cleanup();

    show('medium');
    expect(screen.getByText(/Each morning at 08:00/)).toBeTruthy();
    expect(screen.queryByText(/Just added/)).toBeNull();
    cleanup();

    show('heavy');
    expect(screen.getByText(/Just added/)).toBeTruthy();
    expect(screen.getByText(/Moved on the schedule/)).toBeTruthy();
  });

  it('draws the digest from the whole day, not one slot repeated', () => {
    show('medium', [
      session({}),
      session({ id: 2, title: 'Later on', startsAt: '2099-06-01T10:00:00.000Z' }),
    ]);
    expect(screen.getByText(/10:00 · Main Hall — Scaling an unconference/)).toBeTruthy();
    expect(screen.getByText(/12:00 · Main Hall — Later on/)).toBeTruthy();
  });

  it('shows a livestream link only when that is switched on', () => {
    const streamed = [
      session({ livestreams: [{ label: 'Main camera', url: 'https://stream.example/main' }] }),
    ];
    show('light', streamed);
    expect(screen.queryByText(/Main camera/)).toBeNull();
    cleanup();
    show('light', streamed, '{title}[\nStream: {streams}]');
    expect(screen.getByText(/Main camera/)).toBeTruthy();
    expect(document.body.textContent).toContain('Stream:');
  });

  it('says plainly that off sends nothing', () => {
    show('off');
    expect(screen.getByText(/Nothing\./)).toBeTruthy();
    expect(screen.queryByText(/up next/)).toBeNull();
  });

  it('draws the event’s own sessions, in the event’s timezone', () => {
    show('light');
    // 08:00 UTC is 10:00 in Berlin — the venue's clock, not the server's.
    expect(screen.getByText(/10:00 — up next/)).toBeTruthy();
    expect(screen.getByText('Scaling an unconference')).toBeTruthy();
  });

  it('puts every room of one start time in the same message', () => {
    show('light', [
      session({}),
      session({ id: 2, roomId: 2, title: 'Hallway track', speakers: [] }),
    ]);
    expect(screen.getByText('Scaling an unconference')).toBeTruthy();
    expect(screen.getByText('Hallway track')).toBeTruthy();
  });

  it('draws the organiser’s own line, words and all', () => {
    // The whole point of the modal: what is on screen is what the group gets.
    show('light', [session({})], 'Annnoooounciiiiiing: {title}!');
    expect(document.body.textContent).toContain('Annnoooounciiiiiing: Scaling an unconference!');
  });

  it('drops a bracketed part with nothing in it, the way the server does', () => {
    // The preview and `renderTemplate` implement one grammar twice, so this is
    // what catches them drifting until the renderer is shared (LIB-214).
    show('light', [session({ speakers: [] })], '{title}[, by {speakers}]');
    expect(document.body.textContent).toContain('Scaling an unconference');
    expect(document.body.textContent).not.toContain(', by');
  });

  it('falls back to the title when the line comes out empty, the way the server does', () => {
    show('light', [session({ speakers: [] })], '[, by {speakers}]');
    expect(document.body.textContent).toContain('Scaling an unconference');
  });

  it('fills every placeholder the panel offers', () => {
    show(
      'light',
      [session({ trackId: 1, formatId: 1, tagIds: [1] })],
      '{time} {room} {track} {title} {speakers} {format} {tags}',
    );
    expect(document.body.textContent).toContain(
      '10:00 Main Hall Practice Scaling an unconference Ada Lovelace Workshop #facilitation',
    );
  });

  it('previews a pitch on medium and an organiser’s session only on heavy', () => {
    show('medium');
    expect(screen.getByText(/Just pitched/)).toBeTruthy();
    expect(screen.queryByText(/Just added/)).toBeNull();
    cleanup();
    show('heavy');
    expect(screen.getByText(/Just pitched/)).toBeTruthy();
    expect(screen.getByText(/Just added/)).toBeTruthy();
  });

  it('never previews a draft, because one is never posted', () => {
    show('light', [session({ id: 3, title: 'Secret plans', draft: true })]);
    expect(screen.queryByText('Secret plans')).toBeNull();
  });

  it('falls back to stand-in names on an event with nothing scheduled, and says so', () => {
    show('light', []);
    expect(screen.getByText(/stand-in names/)).toBeTruthy();
    expect(screen.getByText('Scaling an unconference')).toBeTruthy();
  });
});
