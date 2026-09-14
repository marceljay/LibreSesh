// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PersonDto, SessionDto } from '../server/src/shared/types';
import { SessionDetail, type SessionDetailProps } from '../web/src/components/SessionDetail';
import { installBrowserShims } from './dom';

/**
 * The history line under a session's time and room: who created it, when on
 * the event's clock, and whether it has been edited since. The speakers say
 * who gives a session; this says who booked it, which is often someone else.
 * It is public, but where it shows depends on who is looking: the full page
 * carries it for everyone, the sheet for organisers alone, so the quick look
 * an attendee opens is not one line of small print longer.
 */

const ada: PersonDto = {
  id: 7,
  username: 'ada',
  name: 'Ada Lovelace',
} as PersonDto;

const session = {
  id: 1,
  roomId: 1,
  type: 'open',
  title: 'Analytical engines',
  description: '',
  speakers: [],
  livestreams: [],
  startsAt: '2026-06-01T08:00:00.000Z',
  endsAt: '2026-06-01T09:00:00.000Z',
  tagIds: [],
  createdBy: 3,
  createdByName: 'ada',
  createdAt: '2026-05-20T08:00:00.000Z',
  updatedAt: '2026-05-20T08:00:00.000Z',
  seriesId: null,
  draft: false,
} as unknown as SessionDto;

const detail = (over: Partial<SessionDetailProps> = {}) =>
  render(
    <MemoryRouter>
      <SessionDetail
        session={session}
        slug="testconf"
        rooms={[{ id: 1, name: 'Open Room' } as SessionDetailProps['rooms'][number]]}
        tags={[]}
        formats={[]}
        people={[ada]}
        contributions={[]}
        displayName="grace"
        timezone="Europe/Berlin"
        canEdit={false}
        canDelete={false}
        canContribute={false}
        upgradeUnlocksContributions={false}
        canModerate={false}
        canRemoveContribution={() => false}
        archived={false}
        starred={false}
        userLabel="attendee"
        isAdmin={false}
        layout="page"
        collapseAt={null}
        onEdit={() => {}}
        onDelete={() => {}}
        onAdd={async () => {}}
        onRemoveContribution={() => {}}
        onToggleHidden={() => {}}
        {...over}
      />
    </MemoryRouter>,
  );

const historyLine = () => screen.getByText(/Created by/).textContent ?? '';

beforeEach(() => installBrowserShims());
afterEach(() => cleanup());

describe('the history line', () => {
  it('names the creator as a username linking to the profile, with the moment', () => {
    detail();
    const link = screen.getByRole('link', { name: '@ada' });
    expect(link.getAttribute('href')).toBe('/e/testconf/p/7');
    // 08:00Z is 10:00 in Berlin: the event's clock, not UTC or the reader's.
    expect(historyLine()).toMatch(/^Created by @ada .*10:00/);
    expect(historyLine()).not.toContain('edited');
  });

  it('is plain text when the name has no profile behind it', () => {
    detail({ people: [] });
    expect(screen.queryByRole('link', { name: '@ada' })).toBeNull();
    expect(historyLine()).toContain('@ada');
  });

  it('says so once the session has been edited', () => {
    detail({ session: { ...session, updatedAt: '2026-05-21T08:00:00.000Z' } });
    expect(historyLine()).toMatch(/· edited /);
  });

  it('is kept off the sheet for an attendee, and on it for an organiser', () => {
    detail({ layout: 'sheet' });
    expect(screen.queryByText(/Created by/)).toBeNull();
    cleanup();
    detail({ layout: 'sheet', isAdmin: true });
    expect(historyLine()).toMatch(/^Created by @ada /);
  });
});
