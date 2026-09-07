import type { Role } from '@shared/types';
import { PrimaryButton, RoleBadge, SecondaryButton } from './ui';

export interface SpeakerLinkPromptProps {
  eventName: string;
  /** What this device currently is here — the thing it would give up. */
  displayName: string;
  role: Role;
  userRoleLabel?: string;
  onSwitch: () => void;
  onStay: () => void;
}

/**
 * The one case a speaker link does not simply act on: this device already
 * holds a role in the event. Redeeming swaps the identity cookie, so
 * continuing signs the device out of whoever it is now — usually the
 * organiser who made the link and opened it to check it works. Same card as
 * the gate, so it reads as part of entering rather than a warning dialog.
 */
export function SpeakerLinkPrompt({
  eventName,
  displayName,
  role,
  userRoleLabel,
  onSwitch,
  onStay,
}: SpeakerLinkPromptProps) {
  const initial = eventName.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4 py-10 dark:bg-stone-950">
      <div className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-xs dark:border-stone-700 dark:bg-stone-900">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-stone-900 text-sm font-bold text-white dark:bg-stone-100 dark:text-stone-900">
            {initial}
          </div>
          <h1 className="truncate text-lg font-semibold tracking-tight">{eventName}</h1>
        </div>
        <p className="text-sm text-stone-700 dark:text-stone-200">
          This is a speaker link. Opening it signs this device in as that speaker — but this device
          is already here as <span className="font-semibold">{displayName}</span>{' '}
          <RoleBadge role={role} userLabel={userRoleLabel} />.
        </p>
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
          Switching signs this device out of {displayName}. Nothing is lost — their sessions, stars
          and notes stay with that identity — but to be them again here you would link this device
          back from one of their others, or re-enter with the password.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <PrimaryButton className="w-full py-2 text-sm" onClick={onSwitch}>
            Switch to the speaker
          </PrimaryButton>
          <SecondaryButton className="w-full py-2 text-sm" onClick={onStay}>
            Stay as {displayName}
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}
