// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrStatus } from '../server/src/shared/types';
import { installBrowserShims } from './dom';

/**
 * The Nostr section of the Publish tab, against a faked API. What matters
 * here is the gate — nothing goes out until the organiser has read what
 * leaves and ticked — and that the destructive actions ask first.
 */

const nostr = vi.fn();
const nostrEnable = vi.fn();
const nostrDisable = vi.fn();
const nostrSettings = vi.fn();
const nostrRetract = vi.fn();
const nostrTest = vi.fn();
const nostrExportKey = vi.fn();
const nostrExample = vi.fn();

vi.mock('../web/src/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: {
    nostr: (...a: unknown[]) => nostr(...a) as unknown,
    nostrEnable: (...a: unknown[]) => nostrEnable(...a) as unknown,
    nostrDisable: (...a: unknown[]) => nostrDisable(...a) as unknown,
    nostrSettings: (...a: unknown[]) => nostrSettings(...a) as unknown,
    nostrRetract: (...a: unknown[]) => nostrRetract(...a) as unknown,
    nostrResync: vi.fn(),
    nostrTest: (...a: unknown[]) => nostrTest(...a) as unknown,
    nostrImportKey: vi.fn(),
    nostrExportKey: (...a: unknown[]) => nostrExportKey(...a) as unknown,
    nostrExample: (...a: unknown[]) => nostrExample(...a) as unknown,
  },
}));

const confirm = vi.fn();
vi.mock('../web/src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/src/components/ui')>();
  return { ...actual, useConfirm: () => confirm };
});

const { AdminNostr } = await import('../web/src/pages/AdminNostr');

const off = (over: Partial<NostrStatus> = {}): NostrStatus => ({
  enabled: false,
  npub: null,
  relays: [],
  triggers: ['placed', 'up_next', 'digest'],
  counts: { published: 0, dirty: 0, pending: 0, deleted: 0 },
  relayStatus: [],
  ...over,
});
const on = (over: Partial<NostrStatus> = {}): NostrStatus =>
  off({
    enabled: true,
    npub: 'npub1' + 'q'.repeat(58),
    relays: ['wss://relay.test'],
    counts: { published: 3, dirty: 0, pending: 1, deleted: 0 },
    relayStatus: [{ url: 'wss://relay.test', pending: 1, lastError: 'wss://relay.test: blocked' }],
    ...over,
  });

const show = () => render(<AdminNostr slug="testconf" />);

beforeEach(() => {
  installBrowserShims();
  nostr.mockResolvedValue(off());
  nostrEnable.mockResolvedValue({ npub: 'npub1x' });
  nostrDisable.mockResolvedValue(undefined);
  nostrSettings.mockResolvedValue({ relays: [], triggers: [] });
  nostrRetract.mockResolvedValue(undefined);
  nostrTest.mockResolvedValue({ relays: [{ url: 'wss://relay.test', ok: true, message: 'ok' }] });
  nostrExportKey.mockResolvedValue({ nsec: 'nsec1' + 'q'.repeat(58) });
  nostrExample.mockResolvedValue({ content: 'Up next at 14:00 at TestConf' });
  confirm.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the Nostr section', () => {
  it('lists what leaves and keeps the switch behind the tick', async () => {
    show();
    const button = await screen.findByRole('button', { name: 'Publish to Nostr' });
    expect(screen.getByText(/Everything already written goes out too/)).toBeTruthy();
    expect(screen.getByText(/Relays keep copies/)).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I understand what leaves this instance'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    nostr.mockResolvedValue(on());
    fireEvent.click(button);
    await waitFor(() => expect(nostrEnable).toHaveBeenCalledWith('testconf'));
    await screen.findByLabelText('The event’s npub');
  });

  it('shows the identity, the relays, the triggers and the delivery table once on', async () => {
    nostr.mockResolvedValue(on());
    show();
    const npub = (await screen.findByLabelText('The event’s npub')) as HTMLInputElement;
    expect(npub.value).toMatch(/^npub1/);
    expect((screen.getByLabelText('Relays') as HTMLTextAreaElement).value).toBe('wss://relay.test');
    expect(
      (screen.getByLabelText('A pitch is placed on the grid') as HTMLInputElement).checked,
    ).toBe(true);
    expect((screen.getByLabelText('A session is added') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('wss://relay.test: blocked')).toBeTruthy();
    expect(screen.getByText(/3 published · 0 waiting · 1 not yet accepted/)).toBeTruthy();
    expect(
      (screen.getByRole('link', { name: 'Open on njump' }) as HTMLAnchorElement).href,
    ).toContain('njump.me/npub1');
  });

  it('saves only what changed, and refuses a bad relay', async () => {
    nostr.mockResolvedValue(on());
    show();
    const save = (await screen.findByRole('button', { name: 'Save' })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('A session is added'));
    expect(save.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Relays'), {
      target: { value: 'wss://relay.test\nhttps://nope' },
    });
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/is not a relay address/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Relays'), {
      target: { value: 'wss://relay.test\nwss://two.test' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(nostrSettings).toHaveBeenCalledWith('testconf', {
        relays: ['wss://relay.test', 'wss://two.test'],
        triggers: ['placed', 'up_next', 'digest', 'added'],
      }),
    );
  });

  it('shows an example for a trigger', async () => {
    nostr.mockResolvedValue(on());
    show();
    await screen.findByLabelText('The event’s npub');
    fireEvent.click(screen.getAllByRole('button', { name: 'Example' })[1]!);
    await waitFor(() => expect(nostrExample).toHaveBeenCalledWith('testconf', 'up_next'));
    expect((await screen.findByLabelText(/^Example:/)).textContent).toContain('Up next at 14:00');
  });

  it('asks before retracting, switching off and showing the key', async () => {
    nostr.mockResolvedValue(on());
    show();
    await screen.findByLabelText('The event’s npub');

    confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retract everything' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(nostrRetract).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retract everything' }));
    await waitFor(() => expect(nostrRetract).toHaveBeenCalledWith('testconf'));

    fireEvent.click(screen.getByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(nostrDisable).toHaveBeenCalledWith('testconf'));

    fireEvent.click(screen.getByRole('button', { name: 'Export key' }));
    const nsec = (await screen.findByLabelText('The event’s nsec')) as HTMLInputElement;
    expect(nsec.value).toMatch(/^nsec1/);
    expect(screen.getByText(/Keep a copy: if this instance’s secret changes/)).toBeTruthy();
  });

  it('reports what each relay said to a test', async () => {
    nostr.mockResolvedValue(on());
    nostrTest.mockResolvedValue({
      relays: [
        { url: 'wss://relay.test', ok: true, message: 'ok' },
        { url: 'wss://two.test', ok: false, message: 'blocked: pow required' },
      ],
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test' }));
    const list = await screen.findByLabelText('What each relay said');
    expect(list.textContent).toContain('wss://relay.test: accepted');
    expect(list.textContent).toContain('blocked: pow required');
  });
});
