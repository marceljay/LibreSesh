import { errorText } from '../lib/errorText';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExportPart } from '@shared/exportParts';
import { api } from '../lib/api';
import {
  ControlShell,
  Field,
  FormStack,
  PrimaryButton,
  Section,
  TextInput,
  linkClass,
  secondaryButtonClass,
  useToast,
} from '../components/ui';

/**
 * The four parts an export can leave out, in the order they are offered. The
 * frame — settings, rooms, tracks, tags, formats, breaks — is not a choice:
 * it is a few hundred bytes and nothing in it is anyone's but the organiser's.
 */
const EXPORT_CHOICES: { id: ExportPart; label: string; hint: string }[] = [
  {
    id: 'sessions',
    label: 'Sessions',
    hint: 'The programme itself — every session with its speakers, tags, streams and star count.',
  },
  {
    id: 'people',
    label: 'People',
    hint: 'Every profile: name, bio and links. Never who holds one.',
  },
  {
    id: 'proposals',
    label: 'Pitches',
    hint: 'The pitch board, with how many are interested in each.',
  },
  {
    id: 'contributions',
    label: 'Contributions',
    hint: 'Notes, links and questions posted on sessions, with the name that wrote them.',
  },
];

/**
 * The two backups, which are deliberately not the same thing.
 *
 * The event JSON is a *document*: the programme, with no secrets in it, safe
 * to email to a co-organiser. The whole-database download is a *credential*:
 * it carries live identity tokens and the hashes of every link and speaker
 * code, so it is gated by the instance password and never leaves unencrypted.
 * Saying so on the page is the point — the two files look equally innocuous in
 * a downloads folder.
 */
export function AdminBackup({ slug, eventName }: { slug: string; eventName: string }) {
  const toast = useToast();
  const [instanceKey, setInstanceKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [parts, setParts] = useState<Set<ExportPart>>(
    () => new Set(EXPORT_CHOICES.map((c) => c.id)),
  );

  const togglePart = (id: ExportPart) =>
    setParts((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // A contribution is a note *on a session*, addressed by that session's id;
  // without the sessions it would point at nothing.
  const chosen = EXPORT_CHOICES.map((c) => c.id).filter(
    (id) => parts.has(id) && (id !== 'contributions' || parts.has('sessions')),
  );

  const ready = instanceKey.length > 0 && passphrase.length >= 12 && passphrase === confirm;

  const download = async (): Promise<void> => {
    setBusy(true);
    try {
      const { blob, filename } = await api.downloadBackup(instanceKey, passphrase);
      // The response is binary and behind a POST, so the browser cannot be
      // pointed at it — hand it an object URL to save instead.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setPassphrase('');
      setConfirm('');
      toast.show(`Saved ${filename} — keep the passphrase with it`);
    } catch (err) {
      toast.show(
        errorText(err, 'The backup could not be made'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        title="Export this event"
        description="One JSON file, with no passwords, identity tokens or speaker codes in it — safe to hand to a co-organiser. The event's settings, rooms, tracks, tags, formats and breaks are always in it; choose what else goes."
        className="mb-6"
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {EXPORT_CHOICES.map(({ id, label, hint }) => {
            const disabled = id === 'contributions' && !parts.has('sessions');
            return (
              <label
                key={id}
                className={`flex items-start gap-2 rounded-lg border border-stone-200 px-3 py-2 text-xs dark:border-stone-700 ${
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                }`}
              >
                {/* eslint-disable-next-line no-restricted-syntax -- checkbox, not a text field */}
                <input
                  type="checkbox"
                  checked={chosen.includes(id)}
                  disabled={disabled}
                  onChange={() => togglePart(id)}
                  className="mt-0.5 shrink-0 accent-stone-900 dark:accent-stone-100"
                />
                <span className="min-w-0">
                  <span className="block font-semibold text-stone-700 dark:text-stone-200">
                    {label}
                  </span>
                  <span className="block text-stone-500 dark:text-stone-400">
                    {disabled ? 'Only with the sessions they were posted on.' : hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <a
          href={api.exportUrl(slug, chosen)}
          download
          className={`${secondaryButtonClass} no-underline`}
        >
          Download {eventName} as JSON
        </a>
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          Deleted sessions and contributions are left out — they are still in
          Trash until you empty it. The file can be imported back as a new event
          from{' '}
          <Link to="/import" className={`${linkClass} underline`}>
            Import a schedule
          </Link>
          : the programme comes across; people, pitches and contributions do not.
        </p>
      </Section>

      <Section
        title="Back up the whole instance"
        description="An encrypted copy of the entire database — every event on this instance, not just this one. Needs the instance password, and a passphrase you choose now to seal the file."
      >
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <strong className="font-semibold">This file is a credential, not a document.</strong>{' '}
          It contains the sign-in token of everyone who has ever opened an event
          here, and the hashes of every device and speaker code. Anyone who opens
          it can become any of them. Store it where you would store the instance
          password — and nowhere else.
        </div>

        <FormStack>
          <Field label="Instance password">
            <ControlShell>
              <TextInput
                type="password"
                autoComplete="off"
                value={instanceKey}
                onChange={(e) => setInstanceKey(e.target.value)}
              />
            </ControlShell>
          </Field>
          <Field
            label="Backup passphrase"
            hint="At least 12 characters. Nothing on earth rate-limits guesses against a file, so make it long."
          >
            <ControlShell>
              <TextInput
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
            </ControlShell>
          </Field>
          <Field label="Repeat the passphrase">
            <ControlShell>
              <TextInput
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </ControlShell>
          </Field>
          {confirm.length > 0 && passphrase !== confirm && (
            <p className="text-xs text-red-600 dark:text-red-400">
              Those two do not match.
            </p>
          )}
          <div>
            <PrimaryButton onClick={() => void download()} disabled={!ready || busy}>
              {busy ? 'Sealing the backup…' : 'Download encrypted backup'}
            </PrimaryButton>
          </div>
        </FormStack>

        <p className="mt-4 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
          Lose the passphrase and the file is gone — there is no recovery, by
          design. To open one, run{' '}
          <code className="rounded-sm bg-stone-100 px-1 dark:bg-stone-800">
            npm run decrypt-backup -- backup.lsbk restored.db
          </code>{' '}
          on the server. Do it once now, while nothing is on fire: a backup you
          have never restored is a guess.
        </p>
      </Section>
    </>
  );
}
