import { plural } from '../lib/plural';
import { errorText } from '../lib/errorText';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Me, Role } from '@shared/types';
import { ApiError, api } from '../lib/api';
import { takeInvite } from '../lib/inviteLink';
import { useMe } from '../lib/useMe';
import { DevicesIcon, SpeakerIcon } from './icons';
import { Logo } from './Logo';
import {
  ControlShell,
  Field,
  InlineForm,
  PasswordInput,
  PrimaryButton,
  RoleBadge,
  SecondaryButton,
  TextInput,
  linkClass,
} from './ui';

export interface LoginProps {
  slug: string;
  eventName?: string;
  me: Me | null;
  onEntered: () => void;
  /**
   * The page was opened with a speaker link whose code did not redeem. The
   * login page then opens on the speaker-code form with that said, rather than on a
   * password box the speaker was never given.
   */
  speakerLinkFailed?: boolean;
}

/** The two phrase-shaped ways in. Same endpoint; different words on screen. */
type LinkMode = 'none' | 'device' | 'speaker';

const SPEAKER_CODE_FAILED =
  'That speaker code didn’t match — it may have been revoked or replaced. Ask your organiser for a new one.';
const DEVICE_PHRASE_FAILED = 'That phrase didn’t match — it may have expired or been revoked.';

/** Full-screen password login page — an event's schedule is never public (SPEC §3.2). */
export function Login({ slug, eventName, me, onEntered, speakerLinkFailed = false }: LoginProps) {
  const { refresh } = useMe();
  /**
   * An invite QR puts the event password in the URL fragment. `takeInvite` has
   * already lifted it out of the address bar at startup (`main.tsx`) and holds
   * the one copy; this reads that copy rather than the URL, which by now is a
   * bare `/e/:slug`.
   */
  const [invite, setInvite] = useState(takeInvite);
  const [password, setPassword] = useState(invite?.password ?? '');
  /**
   * The username is typed here, every first time: nothing is generated for
   * you and nothing carries over from another event. A device that already
   * holds a name in *this* event (it signed out, or its role changed) gets it
   * back from `/login`, so re-entering is one tap.
   */
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(speakerLinkFailed ? SPEAKER_CODE_FAILED : null);
  const [busy, setBusy] = useState(false);
  /**
   * The login page's "is that you?": an organiser typed this exact name onto a
   * session before its owner arrived, and that unclaimed profile is on
   * offer. Adopting it silently would hand a namesake someone else's talks,
   * so it is a question with two answers, and the entry is retried with one.
   */
  const [namesake, setNamesake] = useState<{ name: string; sessionCount: number } | null>(null);

  useEffect(() => {
    let live = true;
    api
      .login(slug)
      .then((g) => {
        if (live && g.heldName) setName((current) => current || g.heldName || '');
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slug]);

  /** Every way in shares the two answers the server can give about a name. */
  const nameProblem = (err: unknown): boolean => {
    if (!(err instanceof ApiError)) return false;
    if (err.code === 'name_taken') {
      setError(errorText(err));
      setSuggestion(name.trim());
      return true;
    }
    if (err.code === 'profile_exists') {
      const d = err.details ?? {};
      setNamesake({
        name: typeof d.name === 'string' ? d.name : name.trim(),
        sessionCount: typeof d.sessionCount === 'number' ? d.sessionCount : 0,
      });
      return true;
    }
    return false;
  };
  /**
   * A free variant of the name that was refused, offered as one click.
   *
   * Names are unique inside an event and held by the identity that claimed
   * them, so "already called that" is a dead end for anyone who lost their
   * cookie — clearing site data, a second browser, or a server that restarted
   * with a new signing key. They are the same person and they cannot say so;
   * the server is right to refuse, and the login page should still let them in.
   */
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  /**
   * The phrase paths: a speaker code an organiser sent, or the device phrase
   * your other device shows. Both redeem through `/me/link` and both make
   * this browser *become* the identity the phrase names; the login page only says
   * different things, because a speaker holding a four-word code from an
   * email has no reason to recognise "link another device".
   */
  const [linkMode, setLinkMode] = useState<LinkMode>(speakerLinkFailed ? 'speaker' : 'none');
  const [phrase, setPhrase] = useState('');
  const openLink = (mode: LinkMode) => {
    setLinkMode(mode);
    setError(null);
  };

  const link = async () => {
    if (!phrase.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.linkDevice(phrase.trim());
      // The cookie now points at the other device's identity; its roles come
      // with it, so a re-fetch usually walks straight through the login page.
      await refresh();
      onEntered();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status !== 403
          ? errorText(err)
          : linkMode === 'speaker'
            ? SPEAKER_CODE_FAILED
            : DEVICE_PHRASE_FAILED,
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

  const submit = async (claimProfile?: boolean) => {
    if (busy || !password.trim()) return;
    // The form submits from the password box too, and `noValidate` means the
    // browser will not point at the empty name field — so this has to.
    if (!name.trim()) {
      setError('Pick a username to enter');
      return;
    }
    setBusy(true);
    setError(null);
    setSuggestion(null);
    setNamesake(null);
    try {
      // The name is claimed as part of entry: it has to be unique inside this
      // event, and the server grants no role if it is taken.
      await api.authenticate(slug, password.trim(), name.trim(), claimProfile);
      onEntered();
    } catch (err) {
      if (!nameProblem(err)) {
        setError(
          err instanceof ApiError && (err.status === 429 || err.status === 404)
            ? errorText(err)
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
      setError(errorText(err));
      setBusy(false);
    }
  };

  /** Demo events hand out roles on a click — there is no password to type. */
  const enterAs = async (role: Role, claimProfile?: boolean) => {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    setSuggestion(null);
    setNamesake(null);
    // Remembered so the retry below enters as the role they actually picked.
    setPendingRole(role);
    try {
      await api.authenticateAsRole(slug, role, name.trim(), claimProfile);
      onEntered();
    } catch (err) {
      if (!nameProblem(err)) setError(errorText(err));
      setBusy(false);
    }
  };

  /** "Yes, that's me": the same entry again, taking the profile this time. */
  const claimAndEnter = () => (demo ? enterAs(pendingRole ?? 'viewer', true) : submit(true));

  // Per event, not per instance: a demo instance can also be hosting a real
  // conference, and that login page must still ask for a password.
  const demo = me?.demoEventSlugs?.includes(slug) === true;
  const roles: { role: Role; label: string; blurb: string }[] = [
    { role: 'viewer', label: 'Viewer', blurb: 'Read the schedule, star sessions' },
    { role: 'user', label: 'Attendee', blurb: 'Add notes, propose sessions' },
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
    <Field
      label="Username"
      hint="What you'll be called in this event — unique here, remembered on this device. No account, no password."
    >
      <ControlShell>
        <TextInput
          name="username"
          autoComplete="username"
          enterKeyHint="go"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          required
          aria-required="true"
          placeholder="e.g. ada"
        />
      </ControlShell>
    </Field>
  );

  const namesakePrompt = namesake !== null && (
    <div
      role="group"
      aria-label="Is that you?"
      className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40"
    >
      <p className="text-stone-800 dark:text-stone-100">
        There is a speaker profile here called{' '}
        <span className="font-semibold">{namesake.name}</span>
        {namesake.sessionCount > 0 &&
          `, on ${plural(namesake.sessionCount, { one: 'session', other: 'sessions' })}`}
        . Is that you?
      </p>
      <div className="mt-2 flex gap-2">
        <PrimaryButton
          className="py-1.5 text-xs"
          onClick={() => void claimAndEnter()}
          disabled={busy}
        >
          Yes, that’s me
        </PrimaryButton>
        <SecondaryButton
          className="py-1.5 text-xs"
          onClick={() => {
            setNamesake(null);
            setName('');
          }}
          disabled={busy}
        >
          No, I’ll pick another name
        </SecondaryButton>
      </div>
    </div>
  );

  const nameMissing = name.trim() === '';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-100 dark:bg-stone-950 px-4 py-10">
      {/* The login page is the whole page, and it used to be a card with no way off
          it: no logo, no link, nothing to say what site this was or where the
          other events are. Someone with the wrong link, or the wrong password,
          was stuck. The same small header every other page has, above the
          card: the mark goes home, and the list of events is one link away. */}
      <header className="mb-4 flex w-full max-w-sm items-center justify-between">
        <Link to="/" className="flex items-center" aria-label="LibreSesh home">
          <Logo variant="oneline" className="h-6 w-auto" />
        </Link>
        <Link
          to="/events"
          className="text-xs font-medium text-stone-500 hover:text-stone-900 hover:underline dark:text-stone-400 dark:hover:text-stone-100"
        >
          All events
        </Link>
      </header>
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-6 shadow-xs">
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
              Pick a name, then a role to look around. Nothing here is private.
            </p>
            {/* Above the roles, and not behind `!invite`. The buttons are
                disabled until there is a name, so with the field below them
                the login page opened on three dead controls and no stated reason —
                and under an invite to a demo event the field was not rendered
                at all, which disabled them for good. A role is what you pick
                *with* a name, so the name comes first. */}
            <div className="mb-4">{nameField}</div>
            <div className="flex flex-col gap-2">
              {roles.map((r) => (
                <SecondaryButton
                  key={r.role}
                  className="flex w-full flex-col items-start gap-0.5 py-2.5 text-start"
                  onClick={() => void enterAs(r.role)}
                  disabled={busy || nameMissing}
                >
                  <span className="text-sm font-semibold">{r.label}</span>
                  <span className="text-xs font-normal text-stone-500 dark:text-stone-400">
                    {r.blurb}
                  </span>
                </SecondaryButton>
              ))}
            </div>
            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
            {namesakePrompt}
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
        ) : (
          /* One form for both ways in: the password box and the name box submit
             it, so Enter in either enters — and a password manager, which only
             sees a login when the fields share a form, can save and fill it. */
          <InlineForm onSubmit={() => void submit()}>
            {invite ? (
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
                {namesakePrompt}
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
                  type="submit"
                  disabled={busy || nameMissing}
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
                <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
                  This schedule needs the event password.
                </p>

                <Field label="Event password">
                  <ControlShell invalid={Boolean(error)}>
                    <PasswordInput
                      name="password"
                      autoComplete="current-password"
                      enterKeyHint="go"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      autoFocus
                    />
                  </ControlShell>
                </Field>
                {error && linkMode === 'none' && (
                  <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>
                )}
                {linkMode === 'none' && namesakePrompt}
                {suggestion !== null && linkMode === 'none' && (
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
                  type="submit"
                  disabled={busy || nameMissing}
                >
                  {busy ? 'Checking…' : 'Enter schedule'}
                </PrimaryButton>
              </>
            )}
            {!invite && (
              <div className="mt-5 border-t border-stone-100 dark:border-stone-800 pt-4">
                {nameField}
              </div>
            )}
          </InlineForm>
        )}

        <div className="mt-4 border-t border-stone-100 dark:border-stone-800 pt-4">
          {linkMode !== 'none' ? (
            <InlineForm onSubmit={() => void link()}>
              <Field
                label={linkMode === 'speaker' ? 'Speaker code' : 'Link phrase'}
                hint={
                  linkMode === 'speaker'
                    ? 'The four-word phrase your organiser sent you. It signs this device in as your speaker profile — no password, no name to pick.'
                    : 'From “Link another device” in the menu behind your name on your other device.'
                }
              >
                <ControlShell invalid={Boolean(error)}>
                  <TextInput
                    name={linkMode === 'speaker' ? 'speaker-code' : 'link-phrase'}
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder={
                      linkMode === 'speaker' ? 'pine-otter-lantern-bell' : 'house-dog-erratic'
                    }
                    autoComplete="off"
                    enterKeyHint="go"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                  />
                </ControlShell>
              </Field>
              {error && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{error}</p>}
              <PrimaryButton
                className="mt-3 w-full py-2 text-sm"
                type="submit"
                disabled={busy || !phrase.trim()}
              >
                {busy
                  ? linkMode === 'speaker'
                    ? 'Entering…'
                    : 'Linking…'
                  : linkMode === 'speaker'
                    ? 'Enter as speaker'
                    : 'Link this device'}
              </PrimaryButton>
              <button
                type="button"
                onClick={() => openLink('none')}
                className={`mt-3 text-xs font-semibold ${linkClass}`}
              >
                {demo ? 'Back' : 'Type a password instead'}
              </button>
            </InlineForm>
          ) : (
            /* Two doors, one endpoint. The speaker one comes first and says
               "speaker": the person holding a code was told they are a speaker
               and nothing else, and "already here on another device" is not a
               sentence they would recognise themselves in. */
            <div className="flex flex-col items-start gap-1.5">
              <button
                type="button"
                onClick={() => openLink('speaker')}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold ${linkClass}`}
              >
                <SpeakerIcon className="h-3.5 w-3.5" />I have a speaker code
              </button>
              <button
                type="button"
                onClick={() => openLink('device')}
                className="inline-flex items-center gap-1.5 text-xs text-stone-500 underline hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
              >
                <DevicesIcon className="h-3.5 w-3.5" />
                I’m already here on another device
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
