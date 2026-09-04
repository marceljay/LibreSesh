import { errorText } from '../lib/errorText';
import { useState } from 'react';
import { api } from '../lib/api';
import {
  ControlShell,
  Field,
  FormStack,
  PrimaryButton,
  Section,
  TextInput,
  secondaryButtonClass,
  useToast,
} from '../components/ui';

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
        description="Rooms, tracks, tags, people, sessions, pitches and contributions as one JSON file — the programme, with star and interest counts. It holds no passwords, no identity tokens and no speaker codes, so it is safe to hand to a co-organiser."
        className="mb-6"
      >
        <a
          href={api.exportUrl(slug)}
          download
          className={`${secondaryButtonClass} no-underline`}
        >
          Download {eventName} as JSON
        </a>
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          Deleted sessions and contributions are left out — they are still in
          Trash until you empty it.
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
