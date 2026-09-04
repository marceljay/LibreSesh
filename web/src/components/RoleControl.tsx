import { useState } from 'react';
import { FloatingFocusManager } from '@floating-ui/react';
import type { Role } from '@shared/types';
import { EditIcon } from './icons';
import { popoverPanelClass, usePopover } from './Popover';
import { roleTagColor, roleTagShape, roleWord } from './ui';

/** What each role is allowed to do here, in the words the gate uses. Every
 *  badge says what it means on hover; "signed out" is the one nobody can
 *  guess, so it gets the longest sentence. */
export const ROLE_HELP: Record<Role, string> = {
  admin: 'an organiser: full control of this event',
  speaker: 'a speaker: they can rewrite the talks they are giving',
  user: 'here to take part: they can post, and book open rooms',
  viewer: 'here to read the schedule and star sessions, nothing more',
};

/** Weakest first, so the menu reads as a ladder rather than an alphabet. */
const ROLES: Role[] = ['viewer', 'user', 'speaker', 'admin'];

/** The grey pill for somebody who holds a profile but no role. Not a `Role`,
 *  so it cannot live in the colour map with the four that are. */
const SIGNED_OUT = 'bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300';

/**
 * A person's role, as the badge everyone else sees, with a pencil in it.
 *
 * This replaced a bare `<select>` in the People list. The select was the only
 * control on the row that said what somebody is, so the one column an
 * organiser scans down for "who runs this event" was four identical grey boxes
 * whose text they had to read one at a time. The badge is the same object the
 * profile page, the merge dialog and the header chip already show, so the
 * colour means the same thing in all four places, and the pencil says the one
 * thing the badge alone cannot: that this is the place to change it.
 *
 * The menu spells out what each role may do rather than listing four bare
 * words, because "viewer" and "attendee" are not self-explanatory and the
 * choice between them is the one an organiser most often gets wrong.
 */
export function RoleControl({
  role,
  userLabel,
  personName,
  onChange,
  className = '',
}: {
  /** null when they hold the profile but no role here — "signed out". */
  role: Role | null;
  /** What this event calls its `user` role. */
  userLabel?: string;
  /** Named in the button's accessible name, so a column of these is not four
   *  controls all called "Role". */
  personName: string;
  onChange: (role: Role) => void | Promise<void>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    role: 'menu',
  });

  const pick = (next: Role) => {
    setOpen(false);
    void onChange(next);
  };

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={`Role for ${personName}: ${role === null ? 'signed out' : roleWord(role, userLabel)}. Change it`}
        title={
          role === null
            ? 'They hold no role here now, so they cannot see the event. Pick one to let them back in.'
            : `They are ${ROLE_HELP[role]}. Click to change it — it takes effect at once.`
        }
        {...getReferenceProps({ onClick: () => setOpen((o) => !o) })}
        className={`${roleTagShape} ${role === null ? SIGNED_OUT : `${roleTagColor[role]} capitalize`} inline-flex max-w-full items-center gap-1 hover:opacity-80 ${className}`}
      >
        <span className="truncate">{role === null ? 'signed out' : roleWord(role, userLabel)}</span>
        {/* Inside the pill, not beside it: beside it, the pencil reads as an
            action on the whole row — and the row already has three of those. */}
        <EditIcon className="h-3 w-3 shrink-0 opacity-70" />
      </button>

      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            aria-label={`Role for ${personName}`}
            {...getFloatingProps()}
            className={`${popoverPanelClass} w-64 p-1`}
          >
            {ROLES.map((option) => (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={option === role}
                onClick={() => pick(option)}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-stone-100 dark:hover:bg-stone-800 ${
                  option === role ? 'bg-stone-50 dark:bg-stone-800/60' : ''
                }`}
              >
                <span className={`${roleTagShape} ${roleTagColor[option]} mt-0.5 shrink-0 capitalize`}>
                  {roleWord(option, userLabel)}
                </span>
                <span className="min-w-0 flex-1 text-xs text-stone-500 dark:text-stone-400">
                  {ROLE_HELP[option]}
                </span>
                {/* A tick, not a highlight alone: which one they hold now is
                    the first thing the menu is asked. */}
                <span
                  aria-hidden="true"
                  className={`mt-0.5 shrink-0 text-xs ${option === role ? 'text-stone-900 dark:text-stone-100' : 'text-transparent'}`}
                >
                  ✓
                </span>
              </button>
            ))}
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}
