import { errorText } from '../lib/errorText';
import { useMemo, useRef, useState } from 'react';
import type { Role } from '@shared/types';
import { ApiError, api } from '../lib/api';
import { buildInviteUrl, normalizeBaseUrl } from '../lib/inviteLink';
import { QrCode } from '../components/QrCode';
import {
  ControlShell,
  Field,
  FormStack,
  PrimaryButton,
  RoleBadge,
  SecondaryButton,
  Section,
  TextInput,
  useToast,
} from '../components/ui';

const STORAGE_KEY = 'libresesh:invite-base';

/**
 * The address the QR should point at, which is not reliably the one the
 * organiser is looking at. Behind Caddy they match; in a dev container the app
 * is reached through a forwarded port, and on a laptop plugged into the
 * projector it can be a LAN address no phone can resolve. So it is remembered
 * per browser and editable, with the current origin as the starting guess.
 */
function readBase(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? window.location.origin;
  } catch {
    // Private windows and blocked site data throw on access.
    return window.location.origin;
  }
}

function writeBase(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Nothing to persist; the field simply starts from the origin next time.
  }
}

/** A password the server has confirmed, and the role it answers to. */
interface Verified {
  password: string;
  role: Role;
}

/**
 * What a leaked code actually costs, said in front of the code rather than in
 * a doc nobody opens.
 *
 * Deliberately loudest for the two roles that can *write*. A viewer code
 * getting out means a stranger reads the schedule, which is a smaller thing
 * than the panel shouting at every organiser who prints one and teaching them
 * to ignore the box. An attendee code gets someone into the programme; an
 * organiser code hands over the whole event, including the other passwords —
 * so that one is a different sentence, not a louder version of the same one.
 */
function ShareWarning({ role, userLabel }: { role: Role; userLabel?: string }) {
  const attendee = userLabel ?? 'attendee';
  if (role === 'viewer') {
    return (
      <p className="text-xs text-stone-500 dark:text-stone-400">
        This one is the read-only password, so a code that travels further than you meant costs
        least — but it is still the schedule, and the schedule is not public.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-semibold">Don’t share this code outside the event.</p>
      {role === 'admin' ? (
        <p className="mt-1">
          It carries the <strong>organiser</strong> password. Anyone who scans it — from a photo, a
          screenshot, a slide left on a projector — gets full control of the event: they can edit
          and delete anything, see the audit log, change the roster, and change these passwords.
          Hand it to the people running the event and nobody else.
        </p>
      ) : (
        <p className="mt-1">
          It carries the <strong>{attendee}</strong> password, which is permission to write: to
          book sessions, post notes and change the programme. Put it where the people at the event
          are — a badge, a lanyard, the door — and not anywhere it outlives the room. Posting it
          publicly hands the programme to people who were never here.
        </p>
      )}
      <p className="mt-1">
        If it does get out, the fix is <strong>Change passwords</strong> above; everyone already
        inside keeps their role, and a fresh code has to reach whoever hasn’t scanned yet.
      </p>
    </div>
  );
}

/**
 * Turn an event password into a QR an attendee can scan at the door.
 *
 * The organiser has to type the password, and there is no way around that:
 * `events` stores bcrypt hashes and nothing else, so the server cannot produce
 * a plaintext to encode even for an admin who is entitled to it. What the
 * server can do is confirm the typing, which is why the code is only drawn
 * after `POST /password-role` answers — a QR is printed once and scanned by
 * everyone, and a typo in it is discovered at the worst possible moment.
 */
export function AdminInvite({ slug, userRoleLabel }: { slug: string; userRoleLabel?: string }) {
  const toast = useToast();
  const linkRef = useRef<HTMLInputElement>(null);
  const [base, setBase] = useState(readBase);
  const [password, setPassword] = useState('');
  const [verified, setVerified] = useState<Verified | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Derived, not stored: editing the base address after the check should move
  // the QR, and re-verifying to do that would be a pointless round trip.
  const url = useMemo(
    () =>
      verified && normalizeBaseUrl(base)
        ? buildInviteUrl({ baseUrl: base, slug, password: verified.password, role: verified.role })
        : null,
    [verified, base, slug],
  );

  const check = async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { role } = await api.passwordRole(slug, password);
      setVerified({ password, role });
    } catch (err) {
      setVerified(null);
      setError(
        err instanceof ApiError && (err.status === 403 || err.status === 429)
          ? errorText(err)
          : 'Could not check that password.',
      );
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      // Rejects on insecure origins — fall back to a manual selection.
      await navigator.clipboard.writeText(url);
      toast.show('Invite link copied');
    } catch {
      linkRef.current?.select();
      toast.show('Press Ctrl/Cmd+C to copy the selected link');
    }
  };

  return (
    <Section
      title="Invite by QR"
      description="A code that carries one role's password, for a badge, a poster or the door."
      className="mb-6"
    >
      <FormStack>
        <Field
          label="Password to encode"
          hint="Type the viewer, attendee or organiser password. The role is whichever one it turns out to be — this event stores only hashes, so it has to be checked rather than looked up."
        >
          <ControlShell>
            <TextInput
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                // The old QR encodes the old password; keeping it on screen
                // while the box says something else invites printing the wrong one.
                setVerified(null);
                setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void check()}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </ControlShell>
        </Field>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {!verified && (
          <div>
            <PrimaryButton onClick={() => void check()} disabled={busy || !password.trim()}>
              {busy ? 'Checking…' : 'Make QR'}
            </PrimaryButton>
          </div>
        )}

        {verified && url && (
          <>
            <div className="flex flex-wrap items-start gap-4">
              <QrCode
                value={url}
                title={`Invite QR for ${slug}`}
                className="shrink-0 border border-stone-200 dark:border-stone-700"
              />
              <div className="min-w-[14rem] flex-1 space-y-2">
                <p className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                  <span>Scanning enters as</span>
                  <RoleBadge role={verified.role} userLabel={userRoleLabel} />
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  The password rides in the part of the URL after <code>#</code>, which browsers
                  never send to the server. Whoever scans it is asked for a name and let in; the
                  address bar is then rewritten to a plain <code>/e/{slug}</code>, so the link they
                  can copy and forward does not carry the password.
                </p>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  The code itself does, though. Anyone who photographs it holds that password until
                  you change it — treat it exactly like printing the password on the poster.
                </p>
                <ShareWarning role={verified.role} userLabel={userRoleLabel} />
              </div>
            </div>

            <Field
              label="Link"
              hint="Select and copy if you'd rather send the link than print the code."
            >
              <ControlShell>
                <TextInput ref={linkRef} readOnly value={url} className="font-mono text-xs" />
              </ControlShell>
            </Field>
            <div className="flex flex-wrap gap-2">
              <SecondaryButton onClick={() => void copy()}>Copy link</SecondaryButton>
            </div>

            <Field
              label="Address the code points at"
              hint="Remembered on this device. Change it when the address you're browsing from isn't the one attendees will use — a forwarded dev port, or a laptop on the local network."
            >
              <ControlShell>
                <TextInput
                  value={base}
                  onChange={(e) => {
                    setBase(e.target.value);
                    writeBase(e.target.value);
                  }}
                  placeholder="https://schedule.example.org"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </ControlShell>
            </Field>
          </>
        )}
      </FormStack>
    </Section>
  );
}
