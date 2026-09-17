// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventDto, RoomDto, SessionDto, TelegramStatus } from '../server/src/shared/types';
import { installBrowserShims } from './dom';

/**
 * The Telegram panel, against a faked API.
 *
 * Two of these pin regressions that were shipped and found by hand: the
 * options vanishing whenever the group binding was cleared, and a rejected
 * token being wiped out of the field the person had just typed it into.
 */

const telegram = vi.fn();
const telegramSettings = vi.fn();
const telegramCode = vi.fn();

vi.mock('../web/src/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    telegram: (...args: unknown[]) => telegram(...args) as unknown,
    telegramSettings: (...args: unknown[]) => telegramSettings(...args) as unknown,
    telegramCode: (...args: unknown[]) => telegramCode(...args) as unknown,
    telegramDisconnect: vi.fn(),
    telegramTest: vi.fn(),
  },
}));

const { AdminTelegram } = await import('../web/src/pages/AdminTelegram');

const status = (over: Partial<TelegramStatus> = {}): TelegramStatus => ({
  available: true,
  ownBot: false,
  ownBotHint: null,
  instanceBot: true,
  connected: false,
  mode: 'light',
  triggers: ['up_next'],
  leadMin: 15,
  livestreams: false,
  digestMin: 480,
  bindCode: null,
  bindExpires: null,
  ...over,
});

const event = { slug: 'testconf', name: 'TestConf', timezone: 'Europe/Berlin' } as EventDto;

const show = () =>
  render(
    <AdminTelegram
      slug="testconf"
      event={event}
      sessions={[] as SessionDto[]}
      rooms={[] as RoomDto[]}
    />,
  );

beforeEach(() => {
  installBrowserShims();
  telegram.mockResolvedValue(status());
  telegramSettings.mockResolvedValue(status());
  telegramCode.mockResolvedValue(status({ bindCode: 'abc123' }));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the Telegram panel', () => {
  it('offers the options and the Example before any group is connected', async () => {
    show();
    // The regression: these were gated on a connected group, so changing the
    // bot — which clears the binding — made them disappear.
    expect(await screen.findByRole('button', { name: 'Example' })).toBeTruthy();
    expect(screen.getByLabelText('How much it says')).toBeTruthy();
    expect(screen.getByText('How early it says it')).toBeTruthy();
  });

  it('keeps a rejected token in the field so it can be corrected', async () => {
    telegramSettings.mockRejectedValue(new Error('That does not look like a bot token'));
    show();
    const input = (await screen.findByPlaceholderText('123456789:AA…')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123456789:AA-nearly-right' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save bot' }));
    await waitFor(() => expect(telegramSettings).toHaveBeenCalled());
    expect(input.value).toBe('123456789:AA-nearly-right');
  });

  it('clears the field once the token is accepted', async () => {
    telegramSettings.mockResolvedValue(status({ ownBot: true, ownBotHint: '…pass' }));
    show();
    const input = (await screen.findByPlaceholderText('123456789:AA…')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '123456789:AA-a-real-looking-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save bot' }));
    await waitFor(() => expect(screen.queryByPlaceholderText('123456789:AA…')).toBeNull());
  });

  it('does not save the options until something has changed', async () => {
    show();
    await screen.findByRole('button', { name: 'Example' });
    // The bot's button is *Save bot*, so this one is unambiguous.
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('previews the lead time being typed, not the one already saved', async () => {
    // The Example is how somebody decides whether to press Save, so it has to
    // answer for what is on the screen. It read the stored value instead.
    show();
    const lead = (await screen.findByLabelText(/How early it says it/)) as HTMLInputElement;
    fireEvent.change(lead, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Example' }));
    expect(screen.getByText(/30 minutes before each start time/)).toBeTruthy();
  });

  it('says the instance has no bot rather than offering a dead form', async () => {
    telegram.mockResolvedValue(status({ available: false, instanceBot: false }));
    show();
    await screen.findByPlaceholderText('123456789:AA…');
    expect(screen.queryByRole('button', { name: 'Example' })).toBeNull();
  });
});
