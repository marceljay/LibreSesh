import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { GeneratedPasswords } from '../../../server/src/shared/types';
import { Field, FormGrid, FormStack, PrimaryButton, inputClass } from '../components/ui';
import { useToast } from '../components/ui';

const browserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Creating an event needs the instance password (SPEC §3.3) — the server's own
 * password, not an event's. See the copy below for what that means to a user.
 */
export function NewEventPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [instanceKey, setInstanceKey] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [timezone, setTimezone] = useState(browserTimezone());
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [userRoleLabel, setUserRoleLabel] = useState('attendee');
  const [viewerPassword, setViewerPassword] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    slug: string;
    generated: GeneratedPasswords;
  } | null>(null);

  const slugify = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api.createEvent(instanceKey, {
        name: name.trim(),
        slug: slug || slugify(name),
        timezone,
        startDate,
        endDate,
        // Blank means "generate one" — sending '' would fail the 6-character
        // minimum instead.
        ...(viewerPassword ? { viewerPassword } : {}),
        ...(userPassword ? { userPassword } : {}),
        ...(adminPassword ? { adminPassword } : {}),
        userRoleLabel: userRoleLabel.trim() || 'attendee',
      });
      const generated = created.generatedPasswords ?? {};
      if (Object.keys(generated).length > 0) {
        // Hashed on the way in, so this screen is the only chance to read
        // them. Don't navigate away from it on the creator's behalf.
        setCreated({ slug: created.slug, generated });
        setBusy(false);
        return;
      }
      toast.show('Event created — you are its admin');
      navigate(`/e/${created.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  if (created) {
    const rows: [string, string | undefined][] = [
      ['Viewer', created.generated.viewerPassword],
      [userRoleLabel.trim() || 'Attendee', created.generated.userPassword],
      ['Admin', created.generated.adminPassword],
    ];
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">Event created</h1>
        <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
          You are its admin already. These passwords were generated for the roles you
          left blank. No need to write them down: a password this instance generated
          stays readable in <strong>Manage Event → Settings → Event passwords</strong>.
          Only one you type yourself is stored hashed and unrecoverable.
        </p>
        <dl className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-5 shadow-sm">
          {rows.map(([label, value]) =>
            value ? (
              <div key={label} className="mb-3 last:mb-0">
                <dt className="text-xs font-medium text-stone-600 dark:text-stone-300">
                  {label}
                </dt>
                <dd className="mt-1 select-all break-all font-mono text-sm">{value}</dd>
              </div>
            ) : null,
          )}
        </dl>
        <PrimaryButton
          className="mt-4 w-full py-2 text-sm"
          onClick={() => navigate(`/e/${created.slug}`)}
        >
          I have written them down — open the event
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <Link to="/events" className="text-xs text-stone-500 dark:text-stone-400 underline">
        ← All events
      </Link>
      <h1 className="mb-1 mt-3 text-lg font-semibold tracking-tight">Create an event</h1>
      <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
        Two different kinds of password are involved. The{' '}
        <strong>instance password</strong> belongs to this server and lets you create an
        event at all. The three <strong>event passwords</strong> are the ones you hand out
        afterwards, and they decide what each person can do inside your event.
      </p>

      <div className="rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-5 shadow-sm">
        <FormStack>
        <Field
          label="Instance password"
          hint="Set by whoever runs this server, shared by everyone allowed to create events here. It is not one of your event’s passwords and grants nothing inside an event — if you don’t have it, ask the person hosting this instance."
        >
          <input
            type="password"
            value={instanceKey}
            onChange={(e) => setInstanceKey(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Event name">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug) setSlug('');
            }}
            maxLength={120}
            className={inputClass}
          />
        </Field>
        <Field label="Slug" hint={`Used in the URL: /e/${slug || slugify(name) || 'your-event'}`}>
          <input
            value={slug}
            onChange={(e) => setSlug(slugify(e.target.value))}
            placeholder={slugify(name) || 'your-event'}
            className={inputClass}
          />
        </Field>
        <Field label="Timezone" hint="IANA name, e.g. Europe/Berlin.">
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={inputClass}
          />
        </Field>

        <FormGrid>
          <Field label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }}
              className={inputClass}
            />
          </Field>
          <Field label="End date">
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputClass}
            />
          </Field>
        </FormGrid>

        <Field
          label="What you call your participants"
          hint="Shown on role badges and in prompts. “attendee”, “participant”, “member”…"
        >
          <input
            value={userRoleLabel}
            onChange={(e) => setUserRoleLabel(e.target.value)}
            maxLength={24}
            className={inputClass}
          />
        </Field>

        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
          Event passwords
        </p>
        <p className="-mt-2 text-xs text-stone-500 dark:text-stone-400">
          Leave any of them blank and one is generated for you, shown on the next screen
          and readable afterwards under Manage Event → Settings. A password you type is
          stored hashed and cannot be read back. All three must differ — they are what
          tell the roles apart.
        </p>
        <Field label="Viewer — read the schedule" hint="Optional — blank generates one.">
          <input
            value={viewerPassword}
            onChange={(e) => setViewerPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field
          label={`${userRoleLabel.trim() || 'Attendee'} — add contributions and open sessions`}
          hint="Optional — blank generates one."
        >
          <input
            value={userPassword}
            onChange={(e) => setUserPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Admin — full control" hint="Optional — blank generates one.">
          <input
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        </FormStack>

        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
        <PrimaryButton className="mt-4 w-full py-2 text-sm" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Creating…' : 'Create event'}
        </PrimaryButton>
      </div>

      <p className="mt-4 text-xs text-stone-500 dark:text-stone-400">
        Already have the programme written down?{' '}
        <Link to="/import" className="underline">
          Import a schedule
        </Link>{' '}
        instead — it builds the rooms, tracks and sessions in one go.
      </p>
    </div>
  );
}
