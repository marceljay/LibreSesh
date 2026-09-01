import { useState } from 'react';
import type { Me, Role } from '@shared/types';
import { ApiError, api } from '../lib/api';
import { takeInvite } from '../lib/inviteLink';
import { useMe } from '../lib/useMe';
import { Field, PrimaryButton, RoleBadge, SecondaryButton, inputClass, linkClass } from './ui';

export interface GateProps {
  slug: string;
  eventName?: string;
  me: Me | null;
  onEntered: () => void;
}

/** Full-screen password gate — an event's schedule is never public (SPEC §3.2). */
export function Gate({ slug, eventName, me, onEntered }: GateProps) {
  const { refresh } = useMe();
  /**
   * An invite QR puts the event password in the URL fragment. `takeInvite` has
   * already lifted it out of the address bar at startup (`main.tsx`) and holds
   * the one copy; this reads that copy rather than the URL, which by now is a
   * bare `/e/:slug`.
   */
  const [invite, setInvite] = useState(takeInvite);
  const [password, setPassword] = useState(invite?.password ?? '');
  const [name, setName] = useState(me?.displayName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * A free variant of the name that was refused, offered as one click.
   *
   * Names are unique inside an event and held by the identity that claimed
   * them, so "already called that" is a dead end for anyone who lost their
   * cookie — clearing site data, a second browser, or a server that restarted
   * with a new signing key. They are the same person and they cannot say so;
   * the server is right to refuse, and the gate should still let them in.
   */
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  // The device-link path: type the phrase your other device shows, become it.
  const [linkMode, setLinkMode] = useState(false);
  const [phrase, setPhrase] = useState('');
  /**
   * The lockout path: an event whose organisers can all no longer get in.
   *
   * Shared passwords have no "forgot it" flow by design — there is no address
   * to send one to, because there are no accounts. Until now that made a lost
   * organiser password terminal for everybody except whoever had shell access
   * to the database. The instance password is the answer: it is the deploy's
   * own secret, it already gates creating an event here, and it can now
   * replace this event's organiser password and show the replacement.
   *
   * It is a link at the bottom of the gate rather than a mode beside the
   * password box, because it is the rarest thing anyone does here and it is
   * not a way *in* — it hands back a password you then type above like anyone
   * else. Whoever holds the instance key could create their own event on this
   * instance regardless; what it deliberately does not become is a role.
   */
  const [recoverMode, setRecoverMode] = useState(false);
  const [instanceKey, setInstanceKey] = useState('');
  const [recovered, setRecovered] = useState<string | null>(null);

  const recover = async () => {
    if (!instanceKey.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { password: fresh } = await api.resetEventPassword(slug, 'admin', instanceKey.trim());
      setRecovered(fresh);
      // Straight into the box above, so the next step is pressing Enter rather
      // than copying a phrase between two fields on the same screen.
      setPassword(fresh);
      setInstanceKey('');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not reach the server',
      );
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    if (!phrase.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.linkDevice(phrase.trim());
      // The cookie now points at the other device's identity; its roles come
      // with it, so a re-fetch usually walks straight through the gate.
      await refresh();
      onEntered();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status !== 403
          ? err.message
          : 'That phrase didn’t match — it may have expired or been revoked.',
      );
      setBusy(false);
    }
  };

  /** `name 2`, `name 3`, … — the first one this event has not handed out. */
  const nextFreeName = async (taken: string, enter: (candidate: string) => Promise<unknown>) => {
    const base = taken.replace(/\s+\d+$/, '');
    for (let n = 2; n <= 9; n += 1) {
      const candidate = `${base} ${n}`.slice(0, 40);
      try {
        await enter(candidate);
        return candidate;
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'name_taken') throw err;
      }
    }
    return null;
  };

  const submit = async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSuggestion(null);
    try {
      // The name is claimed as part of entry: it has to be unique inside this
      // event, and the server grants no role if it is taken.
      await api.authenticate(slug, password.trim(), name.trim() || undefined);
      onEntered();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'name_taken') {
        setError(err.message);
        setSuggestion(name.trim());
      } else {
        setError(
          err instanceof ApiError && (err.status === 429 || err.status === 404)
            ? err.message
            : 'That password doesn’t match this event.',
        );
      }
      setBusy(false);
    }
  };

  /** Retry the last entry attempt under the next free variant of the name. */
  const enterWithSuffix = async (taken: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const used = await nextFreeName(taken, (candidate) =>
        demo
          ? api.authenticateAsRole(slug, pendingRole ?? 'viewer', candidate)
          : api.authenticate(slug, password.trim(), candidate),
      );
      if (used === null) {
        setError('Every variant of that name is taken here — try a different one.');
        setBusy(false);
        return;
      }
      setName(used);
      setSuggestion(null);
      onEntered();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  /** Demo events hand out roles on a click — there is no password to type. */
  const enterAs = async (role: Role) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuggestion(null);
    // Remembered so the retry below enters as the role they actually picked.
    setPendingRole(role);
    try {
      await api.authenticateAsRole(slug, role, name.trim() || undefined);
      onEntered();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'name_taken') setSuggestion(name.trim());
      setError((err as Error).message);
      setBusy(false);
    }
  };

  // Per event, not per instance: a demo instance can also be hosting a real
  // conference, and that gate must still ask for a password.
  const demo = me?.demoEventSlugs?.includes(slug) === true;
  const roles: { role: Role; label: string; blurb: string }[] = [
    { role: 'viewer', label: 'Viewer', blurb: 'Read the schedule, star sessions' },
    { role: 'user', label: 'Attendee', blurb: 'Add notes, propose open sessions' },
    { role: 'admin', label: 'Organiser', blurb: 'Full control of the event' },
  ];

  const initial = (eventName ?? slug).trim().charAt(0).toUpperCase() || '?';

  /**
   * Placed by each branch rather than once at the bottom. Under an invite the
   * only thing left to decide is the name, so it has to sit above the button
   * that submits it — a one-tap Enter with the name field below it is a
   * roster full of auto-generated names.
   */
  const nameField = (
    <Field label="You'll appear as" hint="Remembered on this device. No account needed.">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        className={inputClass}
      />
    </Field>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 dark:bg-stone-950 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-stone-900 dark:bg-stone-100 dark:text-stone-900 text-sm font-bold text-white">
            {initial}
          </div>
          <h1 className="truncate text-lg font-semibold tracking-tight">{eventName ?? slug}</h1>
        </div>
        {demo ? (
          <>
            <p className="mb-1 mt-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              Demo event
            </p>
            <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">
              Pick a role to look around. Nothing here is private.
            </p>
            <div className="flex flex-col gap-2">
              {roles.map((r) => (
                <SecondaryButton
                  key={r.role}
                  className="flex w-full flex-col items-start gap-0.5 py-2.5 text-left"
                  onClick={() => void enterAs(r.role)}
                  disabled={busy}
                >
                  <span className="text-sm font-semibold">{r.label}</span>
                  <span className="text-xs font-normal text-stone-500 dark:text-stone-400">
                    {r.blurb}
                  </span>
                </SecondaryButton>
              ))}
            </div>
            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {suggestion !== null && (
              <button
                type="button"
                onClick={() => void enterWithSuffix(suggestion)}
                disabled={busy}
                className={`mt-1.5 text-xs font-semibold ${linkClass}`}
              >
                Enter as “{suggestion.replace(/\s+\d+$/, '')} 2” instead
              </button>
            )}
          </>
        ) : invite ? (
          <>
            <div className="mb-1 mt-3 flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
              <span>Invited as</span>
              <RoleBadge role={invite.role ?? 'user'} />
            </div>
            <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">
              The code you scanned carries this event's password. Pick the name you'll appear
              under and you're in.
            </p>
            {nameField}
            {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {suggestion !== null && (
              <button
                type="button"
                onClick={() => void enterWithSuffix(suggestion)}
                disabled={busy}
                className={`mt-1.5 text-xs font-semibold ${linkClass}`}
              >
                Enter as “{suggestion.replace(/\s+\d+$/, '')} 2” instead
              </button>
            )}
            <PrimaryButton
              className="mt-4 w-full py-2 text-sm"
              onClick={() => void submit()}
              disabled={busy}
            >
              {busy ? 'Entering…' : 'Enter'}
            </PrimaryButton>
            {/* The password can have been changed since the code was printed,
                and then the QR is simply wrong. Leaving no way past it would
                strand whoever scanned it on a screen with one dead button. */}
            <button
              type="button"
              onClick={() => {
                setInvite(undefined);
                setPassword('');
                setError(null);
              }}
              className={`mt-3 text-xs font-semibold ${linkClass}`}
            >
              Type a password instead
            </button>
          </>
        ) : (
          <>
        <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">This schedule needs the event password.</p>

        <Field label="Event password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="••••••••"
            autoFocus
            className={`${inputClass} ${error ? 'border-red-400' : ''}`}
          />
        </Field>
        {error && !linkMode && (
          <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
        {suggestion !== null && !linkMode && (
          <button
            type="button"
            onClick={() => void enterWithSuffix(suggestion)}
            disabled={busy}
            className={`mt-1.5 text-xs font-semibold ${linkClass}`}
          >
            Enter as “{suggestion.replace(/\s+\d+$/, '')} 2” instead
          </button>
        )}

        <PrimaryButton className="mt-4 w-full py-2 text-sm" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Checking…' : 'Enter schedule'}
        </PrimaryButton>
          </>
        )}

        {!invite && (
          <div className="mt-5 border-t border-stone-100 dark:border-stone-800 pt-4">{nameField}</div>
        )}

        <div className="mt-4 border-t border-stone-100 dark:border-stone-800 pt-4">
          {linkMode ? (
            <>
              <Field
                label="Link phrase"
                hint="From “Link another device” in the menu behind your name on your other device — or the speaker phrase an organiser gave you."
              >
                <input
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void link()}
                  placeholder="house-dog-erratic"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </Field>
              {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
              <PrimaryButton
                className="mt-3 w-full py-2 text-sm"
                onClick={() => void link()}
                disabled={busy}
              >
                {busy ? 'Linking…' : 'Link this device'}
              </PrimaryButton>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setLinkMode(true);
                setError(null);
              }}
              className="text-xs text-stone-500 underline hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
            >
              I’m already here on another device
            </button>
          )}
        </div>

        <div className="mt-4 border-t border-stone-100 pt-4 dark:border-stone-800">
          {recovered ? (
            <>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                New organiser password for this event. It is in the box above — press
                Enter schedule. You can read it again later under Manage Event →
                Settings, so there is nothing to write down.
              </p>
              <p className="mt-1.5 select-all break-all font-mono text-sm">{recovered}</p>
            </>
          ) : recoverMode ? (
            <>
              <Field
                label="Instance password"
                hint="The one this server was deployed with — not an event password. It replaces this event’s organiser password with a fresh one and shows it to you. The old one stops working."
              >
                <input
                  type="password"
                  value={instanceKey}
                  onChange={(e) => setInstanceKey(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void recover()}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </Field>
              {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
              <PrimaryButton
                className="mt-3 w-full py-2 text-sm"
                onClick={() => void recover()}
                disabled={busy}
              >
                {busy ? 'Resetting…' : 'Reset the organiser password'}
              </PrimaryButton>
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setRecoverMode(true);
                setError(null);
              }}
              className="text-xs text-stone-500 underline hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
            >
              Nobody can get in as organiser
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
