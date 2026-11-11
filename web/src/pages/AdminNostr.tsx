import { useCallback, useEffect, useState } from 'react';
import type { NostrRelayAnswer, NostrStatus, NostrTrigger } from '@shared/types';
import { api } from '../lib/api';
import { errorText } from '../lib/errorText';
import {
  ControlShell,
  DangerButton,
  Field,
  FormError,
  FormStack,
  InlineForm,
  PrimaryButton,
  SecondaryButton,
  Section,
  TextArea,
  TextInput,
  Toggle,
  useConfirm,
  useToast,
} from '../components/ui';

/** The six triggers, in the order the spec lists the defaults first. */
const TRIGGERS: { id: NostrTrigger; label: string }[] = [
  { id: 'placed', label: 'A pitch is placed on the grid' },
  { id: 'up_next', label: 'A slot is about to start' },
  { id: 'digest', label: 'The day’s programme, each morning' },
  { id: 'added', label: 'A session is added' },
  { id: 'changed', label: 'A session moves' },
  { id: 'pitched', label: 'A pitch is made on the board' },
];

/** What leaves the instance. Read before the switch; the wording is the spec's. */
export const LEAVES = [
  'For every session on the schedule: title, description, start and end, room, event name, format, tags, speaker names, livestream links, and a link back to the session.',
  'For a pitch that is placed, or made while that is switched on: title, description, the pitcher’s display name, and a link to the board.',
  'Everything already written goes out too, not only what is written from now on.',
  'Relays keep copies. A deletion is a request, and a relay may ignore it.',
];

export const KEEP_A_COPY = 'Keep a copy: if this instance’s secret changes, this key is gone.';

const isRelay = (url: string): boolean => /^wss?:\/\/[^\s/]+/.test(url);
const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Publishing to Nostr, beside Telegram on the Publish tab.
 *
 * Unlike Telegram there is no account and no group to bind: the event *is*
 * its key, and everything else is which relays carry it and which of the six
 * triggers post a note. The switch is deliberately behind a list of what
 * leaves and a tick, because once a relay has a copy nothing here can take
 * it back with certainty.
 */
export function AdminNostr({ slug }: { slug: string }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<NostrStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [relaysText, setRelaysText] = useState('');
  const [triggers, setTriggers] = useState<Set<NostrTrigger>>(new Set());
  const [nsec, setNsec] = useState<string | null>(null);
  const [importing, setImporting] = useState('');
  const [answers, setAnswers] = useState<NostrRelayAnswer[] | null>(null);
  const [example, setExample] = useState<{ trigger: NostrTrigger; content: string | null } | null>(
    null,
  );

  const apply = useCallback((next: NostrStatus) => {
    setStatus(next);
    setRelaysText(next.relays.join('\n'));
    setTriggers(new Set(next.triggers));
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.nostr(slug));
    } catch (err) {
      setProblem(errorText(err));
    }
  }, [slug, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Do one thing, then read the status back. */
  const run = async (work: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      apply(await api.nostr(slug));
      if (done) toast.show(done);
      return true;
    } catch (err) {
      setProblem(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  const relays = relaysText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const badRelay = relays.find((r) => !isRelay(r));
  const chosen = TRIGGERS.map((t) => t.id).filter((t) => triggers.has(t));
  const dirty =
    !sameList(relays, status.relays) || !sameList(chosen, [...status.triggers].sort(byOrder));

  const save = () => {
    if (!dirty || badRelay || relays.length > 10) return;
    void run(() => api.nostrSettings(slug, { relays, triggers: chosen }), 'Saved.');
  };

  const turnOff = async () => {
    const ok = await confirm({
      title: 'Stop publishing to Nostr?',
      body: 'Nothing already on the relays is removed by this; it only stops updates and notes. Use Retract everything to ask the relays to delete what was published. Turning it back on keeps the same identity.',
      confirmLabel: 'Stop publishing',
    });
    if (ok) void run(() => api.nostrDisable(slug), 'Stopped.');
  };

  const retract = async () => {
    const ok = await confirm({
      title: 'Retract everything?',
      body: 'Asks every relay to delete every calendar event and the profile, and stops publishing. Relays may keep copies anyway. Turning Nostr on again republishes the programme under the same identity.',
      confirmLabel: 'Retract everything',
    });
    if (ok) void run(() => api.nostrRetract(slug), 'Deletion requests are on their way.');
  };

  const exportKey = async () => {
    const ok = await confirm({
      title: 'Show the private key?',
      body: `The nsec is the event’s identity. Anyone holding it can publish and delete as this event. ${KEEP_A_COPY}`,
      confirmLabel: 'Show it',
    });
    if (!ok) return;
    setBusy(true);
    setProblem(null);
    try {
      setNsec((await api.nostrExportKey(slug)).nsec);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const importKey = async () => {
    const value = importing.trim();
    if (!value) return;
    const ok = await confirm({
      title: 'Replace the signing key?',
      body: 'The event becomes a different identity on Nostr: followers of the old npub stop seeing it, and the programme is published again under the new one.',
      confirmLabel: 'Replace the key',
    });
    if (!ok) return;
    const done = await run(() => api.nostrImportKey(slug, value), 'Key replaced.');
    if (done) setImporting('');
  };

  const test = async () => {
    setBusy(true);
    setProblem(null);
    setAnswers(null);
    try {
      setAnswers((await api.nostrTest(slug)).relays);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const showExample = async (trigger: NostrTrigger) => {
    try {
      setExample({ trigger, content: (await api.nostrExample(slug, trigger)).content });
    } catch (err) {
      setProblem(errorText(err));
    }
  };

  const copy = async (text: string, said: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(said);
    } catch {
      setProblem('Could not copy. Select the text and copy it by hand.');
    }
  };

  return (
    <Section
      title="Nostr"
      description="Publish this event’s programme and pitch board to Nostr, under a key of its own, so anyone can follow it."
      className="mb-6"
    >
      {problem && <FormError className="mb-4">{problem}</FormError>}

      {!status.enabled && (
        <FormStack>
          <Field
            label={status.npub ? 'Switched off' : 'Before you switch it on'}
            hint={
              status.npub
                ? 'Nothing already published was removed when this was switched off. Switching it back on publishes the programme again under the same identity.'
                : 'Everything below is published under this event’s own key, to the relays you choose, for as long as those relays keep it.'
            }
          >
            <ul className="list-disc space-y-1 ps-5 text-xs text-stone-600 dark:text-stone-300">
              {LEAVES.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              checked={acknowledged}
              onChange={setAcknowledged}
              label="I understand what leaves this instance"
            />
            <PrimaryButton
              disabled={busy || !acknowledged}
              onClick={() => void run(() => api.nostrEnable(slug), 'Publishing to Nostr.')}
            >
              {status.npub ? 'Switch on again' : 'Publish to Nostr'}
            </PrimaryButton>
            {status.npub && (
              <DangerButton disabled={busy} onClick={() => void retract()}>
                Retract everything
              </DangerButton>
            )}
          </div>
        </FormStack>
      )}

      {status.enabled && status.npub && (
        <FormStack>
          <Field
            label="Identity"
            hint="What people follow. It belongs to the event, not to anyone in it, and it stays the same if you switch publishing off and on."
          >
            <div className="flex flex-wrap items-center gap-2">
              <ControlShell className="flex-1">
                <TextInput
                  readOnly
                  aria-label="The event’s npub"
                  className="w-full font-mono text-xs"
                  value={status.npub}
                />
              </ControlShell>
              <SecondaryButton onClick={() => void copy(status.npub!, 'npub copied.')}>
                Copy
              </SecondaryButton>
              <a
                className="text-xs underline underline-offset-2"
                href={`https://njump.me/${status.npub}`}
                target="_blank"
                rel="noopener"
              >
                Open on njump
              </a>
            </div>
          </Field>

          <InlineForm className="contents" onSubmit={save}>
            <Field
              label="Relays"
              hint="One per line, wss:// addresses, up to ten. A relay added later receives the whole programme."
              error={
                badRelay
                  ? `${badRelay} is not a relay address (wss://…)`
                  : relays.length > 10
                    ? 'Ten relays at most'
                    : undefined
              }
            >
              <TextArea
                rows={Math.max(3, relays.length + 1)}
                aria-label="Relays"
                spellCheck={false}
                value={relaysText}
                onChange={(e) => setRelaysText(e.target.value)}
              />
            </Field>

            <Field
              label="What it posts"
              hint="Each of these posts a short note when it happens. The calendar itself is always kept current, whatever is ticked here. Example shows the note as it would read today."
            >
              <div className="space-y-2">
                {TRIGGERS.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-3">
                    <Toggle
                      checked={triggers.has(t.id)}
                      onChange={(on) =>
                        setTriggers((prev) => {
                          const next = new Set(prev);
                          if (on) next.add(t.id);
                          else next.delete(t.id);
                          return next;
                        })
                      }
                      label={t.label}
                    />
                    <button
                      type="button"
                      className="text-xs underline underline-offset-2"
                      onClick={() => void showExample(t.id)}
                    >
                      Example
                    </button>
                  </div>
                ))}
              </div>
              {example && (
                <pre
                  aria-label={`Example: ${TRIGGERS.find((t) => t.id === example.trigger)?.label}`}
                  className="mt-3 break-all whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 font-mono text-xs dark:border-stone-700 dark:bg-stone-950"
                >
                  {example.content ?? 'Nothing to show yet: put a session on the schedule first.'}
                </pre>
              )}
            </Field>

            <div>
              <PrimaryButton type="submit" disabled={busy || !dirty || !!badRelay}>
                Save
              </PrimaryButton>
            </div>
          </InlineForm>

          <Field
            label="Delivery"
            hint={`${status.counts.published} published · ${status.counts.dirty} waiting · ${status.counts.pending} not yet accepted everywhere · ${status.counts.deleted} retracted`}
          >
            {status.relayStatus.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-start text-stone-500 dark:text-stone-400">
                      <th className="py-1 pe-3 font-medium">Relay</th>
                      <th className="py-1 pe-3 font-medium">Pending</th>
                      <th className="py-1 font-medium">Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.relayStatus.map((r) => (
                      <tr key={r.url} className="border-t border-stone-200 dark:border-stone-700">
                        <td className="py-1 pe-3 font-mono">{r.url}</td>
                        <td className="py-1 pe-3">{r.pending}</td>
                        <td className="py-1 text-stone-600 dark:text-stone-300">
                          {r.lastError ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <SecondaryButton
                disabled={busy || status.relays.length === 0}
                onClick={() => void test()}
              >
                Send a test
              </SecondaryButton>
              <SecondaryButton
                disabled={busy}
                onClick={() =>
                  void run(() => api.nostrResync(slug), 'Everything will be published again.')
                }
              >
                Resync
              </SecondaryButton>
            </div>
            {answers && (
              <ul className="mt-2 space-y-1 text-xs" aria-label="What each relay said">
                {answers.map((a) => (
                  <li key={a.url}>
                    <span className="font-mono">{a.url}</span>: {a.ok ? 'accepted' : a.message}
                  </li>
                ))}
              </ul>
            )}
          </Field>

          <Field
            label="Signing key"
            hint="The private key behind the identity. Export it to keep a copy; import one made elsewhere to publish as an identity you already have."
          >
            <div className="flex flex-wrap items-center gap-2">
              <SecondaryButton disabled={busy} onClick={() => void exportKey()}>
                Export key
              </SecondaryButton>
              {nsec && (
                <>
                  <ControlShell className="flex-1">
                    <TextInput
                      readOnly
                      aria-label="The event’s nsec"
                      className="w-full font-mono text-xs"
                      value={nsec}
                    />
                  </ControlShell>
                  <SecondaryButton onClick={() => void copy(nsec, 'nsec copied.')}>
                    Copy
                  </SecondaryButton>
                </>
              )}
            </div>
            {nsec && (
              <p className="mt-2 text-xs text-stone-600 dark:text-stone-300">{KEEP_A_COPY}</p>
            )}
            <InlineForm className="mt-3" onSubmit={() => void importKey()}>
              <div className="flex flex-wrap items-center gap-2">
                <ControlShell className="flex-1">
                  <TextInput
                    aria-label="An nsec to import"
                    placeholder="nsec1…"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full font-mono text-xs"
                    value={importing}
                    onChange={(e) => setImporting(e.target.value)}
                  />
                </ControlShell>
                <SecondaryButton type="submit" disabled={busy || importing.trim() === ''}>
                  Import key
                </SecondaryButton>
              </div>
            </InlineForm>
          </Field>

          <div className="flex flex-wrap gap-2">
            <SecondaryButton disabled={busy} onClick={() => void turnOff()}>
              Switch off
            </SecondaryButton>
            <DangerButton disabled={busy} onClick={() => void retract()}>
              Retract everything
            </DangerButton>
          </div>
        </FormStack>
      )}
    </Section>
  );
}

const ORDER = new Map(TRIGGERS.map((t, i) => [t.id, i]));
const byOrder = (a: NostrTrigger, b: NostrTrigger): number =>
  (ORDER.get(a) ?? 0) - (ORDER.get(b) ?? 0);
