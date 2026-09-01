import { useState } from 'react';
import type { EventPasswords } from '@shared/types';

import { ApiError, api } from '../lib/api';
import { FormError, SecondaryButton, Section, useToast } from '../components/ui';

type RoleKey = 'viewer' | 'user' | 'admin';

/** What each password actually opens, said where it is read rather than in a
 *  doc. The organiser one is a different sentence, not a louder version of the
 *  same one: it hands over the entire event, including the other two. */
const WHAT_IT_OPENS: Record<RoleKey, string> = {
  viewer: 'Reads the schedule.',
  user: 'Adds contributions and opens sessions.',
  admin: 'Full control of the event, including these passwords.',
};

/**
 * The event's three passwords, for the person whose job it is to hand them out.
 *
 * They are not on screen until asked for. An organiser reads this at a
 * registration desk with a queue in front of them, and the organiser password
 * is the one that hands over everything — a panel that showed all three by
 * default would put them on a projector the first time somebody opened
 * Settings to change a date.
 *
 * A password this server generated can be shown; one the organiser typed was
 * only ever hashed and says so (migration 010). Both can be replaced from
 * here, which is what makes this a recovery and not just a display: a typed
 * password nobody remembers is not lost work, it is one button.
 */
export function AdminPasswords({
  slug,
  userRoleLabel,
}: {
  slug: string;
  userRoleLabel: string;
}) {
  const toast = useToast();
  const [shown, setShown] = useState<EventPasswords | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label: Record<RoleKey, string> = {
    viewer: 'Viewer',
    user: userRoleLabel.trim() || 'Attendee',
    admin: 'Admin',
  };

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Could not reach the server');

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      setShown(await api.eventPasswords(slug));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const reset = async (role: RoleKey) => {
    // Not a dialog for the sake of one: the old password is on badges, in a
    // QR taped to a wall and in the pockets of everyone already here, and
    // none of that is undone by pressing this.
    if (
      !window.confirm(
        `Replace the ${label[role].toLowerCase()} password?\n\n` +
          'The current one stops working immediately. Anyone already signed in stays ' +
          'signed in — but every printed code and badge carrying it is out of date, ' +
          'and everyone who has not entered yet needs the new one.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { password } = await api.resetEventPassword(slug, role);
      // Only reachable from the revealed list, so `prev` is never null — and
      // if it somehow were, there is no panel on screen to update.
      setShown((prev) => (prev ? { ...prev, [role]: password } : prev));
      toast.show(`New ${label[role].toLowerCase()} password`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Event passwords"
      description="What people type at the gate. Three of them, and which one you give somebody is what decides their role."
      className="mb-6"
      actions={
        shown ? (
          <SecondaryButton className="shrink-0" onClick={() => setShown(null)}>
            Hide
          </SecondaryButton>
        ) : (
          <SecondaryButton className="shrink-0" onClick={() => void reveal()} disabled={busy}>
            {busy ? 'Reading…' : 'Show passwords'}
          </SecondaryButton>
        )
      }
    >
      {error && <FormError className="mb-3">{error}</FormError>}

      {shown ? (
        <ul className="space-y-2">
          {(['viewer', 'user', 'admin'] as const).map((role) => (
            <li
              key={role}
              className="rounded-xl border border-stone-200 px-3 py-2.5 dark:border-stone-700"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
                  {label[role]}
                </span>
                <SecondaryButton onClick={() => void reset(role)} disabled={busy}>
                  Replace
                </SecondaryButton>
              </div>
              {shown[role] === null ? (
                <p className="mt-1 text-sm text-stone-400 dark:text-stone-500">
                  Set by you — not stored. Only a password this instance generated can be
                  read back; one you typed was hashed and never kept. Replace it to get a
                  readable one.
                </p>
              ) : (
                <p className="mt-1 select-all break-all font-mono text-sm">{shown[role]}</p>
              )}
              <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
                {WHAT_IT_OPENS[role]}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Kept hidden until you ask, because this page gets opened at a registration desk
          with a queue in front of it — and the admin password hands over the whole event.
        </p>
      )}
    </Section>
  );
}
