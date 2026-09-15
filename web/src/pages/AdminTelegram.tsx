import { useCallback, useEffect, useState } from 'react';
import type { TelegramStatus } from '@shared/types';
import { api } from '../lib/api';
import { errorText } from '../lib/errorText';
import {
  Field,
  FormError,
  FormStack,
  PrimaryButton,
  SecondaryButton,
  Section,
  TextInput,
  useToast,
} from '../components/ui';

/** The presets, in the order they are offered: quietest first. */
const MODES: { id: string; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Connected, but saying nothing.' },
  { id: 'light', label: 'Light', hint: 'One message each morning with the day’s programme.' },
  { id: 'medium', label: 'Medium', hint: 'The morning digest, plus what is coming up next.' },
  {
    id: 'heavy',
    label: 'Heavy',
    hint: 'Everything, including sessions as they are placed and when they move.',
  },
];

/**
 * Connecting an event to a Telegram group.
 *
 * The group is never typed in. A private group has no `@name`, and its numeric
 * id is not something an organiser can find without going off to a third-party
 * bot first — so they mint a code here and say it in the group, and the bot
 * reads its own `chat.id` off the message.
 */
export function AdminTelegram({ slug }: { slug: string }) {
  const toast = useToast();
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [lead, setLead] = useState('15');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api.telegram(slug);
      setStatus(next);
      setLead(String(next.leadMin));
    } catch (err) {
      setProblem(errorText(err));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<TelegramStatus>, done?: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const next = await work();
      setStatus(next);
      setLead(String(next.leadMin));
      if (done) toast.show(done);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.telegramTest(slug);
      toast.show('Sent. Check the group.');
    } catch (err) {
      // Telegram's own words, deliberately: "bot was kicked from the group
      // chat" is the whole diagnosis, and anything we write instead is worse.
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  if (!status.available) {
    return (
      <Section
        title="Telegram"
        description="Announcing this event’s schedule into a Telegram group."
        className="mb-6"
      >
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Whoever runs this instance has not set up a Telegram bot, so there is nothing to connect
          to. It needs <code>TELEGRAM_BOT_TOKEN</code> on the server.
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="Telegram"
      description="Announcing this event’s schedule into a Telegram group."
      className="mb-6"
    >
      <FormStack>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-semibold">Anyone in that group will see these sessions.</p>
          <p className="mt-1">
            Titles, speakers, rooms and times are posted into the group as plain messages. Drafts
            are never posted, and the links still need the event password to open — but the messages
            themselves do not.
          </p>
        </div>

        {problem && <FormError className="mb-2">{problem}</FormError>}

        {status.connected ? (
          <>
            <p className="text-sm text-stone-600 dark:text-stone-300">
              Connected to a group. It will be told what is coming up.
            </p>

            <Field label="How much it says">
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <SecondaryButton
                    key={m.id}
                    aria-pressed={status.mode === m.id}
                    className={
                      status.mode === m.id ? 'ring-2 ring-stone-400 dark:ring-stone-500' : undefined
                    }
                    disabled={busy}
                    onClick={() => void run(() => api.telegramSettings(slug, { mode: m.id }))}
                  >
                    {m.label}
                  </SecondaryButton>
                ))}
              </div>
            </Field>
            <p className="-mt-2 text-xs text-stone-500 dark:text-stone-400">
              {MODES.find((m) => m.id === status.mode)?.hint ??
                'A combination of triggers that is not one of the presets.'}
            </p>

            <Field
              label="How early it says it"
              hint="Minutes before a session starts. Everything starting at the same time goes out in one message."
            >
              <TextInput
                value={lead}
                inputMode="numeric"
                onChange={(e) => setLead(e.target.value)}
                onBlur={() => {
                  const value = Number(lead);
                  if (Number.isInteger(value) && value !== status.leadMin) {
                    void run(() => api.telegramSettings(slug, { leadMin: value }));
                  }
                }}
              />
            </Field>

            <div className="flex flex-wrap gap-2">
              <SecondaryButton disabled={busy} onClick={() => void test()}>
                Send test message
              </SecondaryButton>
              <SecondaryButton
                disabled={busy}
                onClick={() =>
                  void run(() => api.telegramDisconnect(slug), 'Disconnected from the group.')
                }
              >
                Disconnect
              </SecondaryButton>
            </div>
          </>
        ) : (
          <>
            <ol className="list-decimal space-y-1 ps-5 text-sm text-stone-600 dark:text-stone-300">
              <li>Add the bot to your Telegram group.</li>
              <li>Generate a code below.</li>
              <li>
                Type <code>/bind &lt;code&gt;</code> in the group.
              </li>
            </ol>

            {status.bindCode ? (
              <Field
                label="Say this in the group"
                hint={
                  status.bindExpires
                    ? `Expires ${new Date(status.bindExpires).toLocaleTimeString()}. Single use.`
                    : undefined
                }
              >
                <TextInput readOnly value={`/bind ${status.bindCode}`} />
              </Field>
            ) : null}

            <div>
              <PrimaryButton disabled={busy} onClick={() => void run(() => api.telegramCode(slug))}>
                {status.bindCode ? 'Generate a new code' : 'Generate code'}
              </PrimaryButton>
            </div>
          </>
        )}
      </FormStack>
    </Section>
  );
}
