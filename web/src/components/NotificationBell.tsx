import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FloatingFocusManager } from '@floating-ui/react';
import type { InboxDto, NotificationDto, NotificationKind } from '@shared/types';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { popoverPanelClass, usePopover } from './Popover';
import { Toggle } from './ui';

/** What each kind is called where a person switches it off. Kept beside the
 *  panel rather than imported from the server module: this is the wording, and
 *  the server's copy is the rule. */
const KIND_LABELS: { kind: NotificationKind; label: string; hint: string }[] = [
  { kind: 'mention', label: 'Mentions', hint: 'Someone writes @you in a comment' },
  { kind: 'session_changed', label: 'Your sessions', hint: 'A session you speak at moves' },
  { kind: 'starred_changed', label: 'Starred sessions', hint: 'A session you starred moves' },
  { kind: 'pitch_scheduled', label: 'Your pitches', hint: 'A pitch of yours gets a slot' },
  { kind: 'pitch_posted', label: 'New pitches', hint: 'Someone pitches a session' },
];

/** Nine digits of unread is a number nobody reads; past that it is "lots". */
const badge = (n: number) => (n > 9 ? '9+' : String(n));

/**
 * The bell in the header, and the inbox behind it.
 *
 * It sits in the slot the "?" gave up, which is the point: help is asked for
 * twice a visit and belongs in a menu, while this is the one control that has
 * something to say on its own.
 *
 * **Opening the panel is the read.** There is no "mark all read" — a second
 * control for what the first already did is one nobody presses. The count goes
 * to zero on open, and the rows keep an unread tint until it closes, so what
 * was new is still visible while you look at it.
 *
 * The live nudge is contentless (`notification.ping`, addressed to one person
 * by `Broker.publishTo`): the page refetches its own inbox over an
 * authenticated request rather than being told what is in it over a channel
 * every reader of the schedule is subscribed to.
 */
export function NotificationBell({
  slug,
  /** Increments when a ping arrives for this person. */
  ping,
}: {
  slug: string;
  ping: number;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [inbox, setInbox] = useState<InboxDto | null>(null);
  /** Frozen at open, so a row does not lose its tint under the cursor. */
  const [wasUnread, setWasUnread] = useState<Set<number>>(new Set());

  const { refs, floatingStyles, context, getReferenceProps, getFloatingProps } = usePopover({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    role: 'dialog',
  });

  const load = useCallback(() => {
    void api
      .notifications(slug)
      .then(setInbox)
      // A bell that cannot load is a bell that says nothing, not an error over
      // the schedule: nothing here is what the reader came for.
      .catch(() => undefined);
  }, [slug]);

  useEffect(load, [load, ping]);

  const openPanel = () => {
    setOpen(true);
    setSettings(false);
    setWasUnread(new Set(inbox?.items.filter((i) => i.readAt === null).map((i) => i.id) ?? []));
    void api
      .readNotifications(slug)
      .then(setInbox)
      .catch(() => undefined);
  };

  const go = (n: NotificationDto) => {
    setOpen(false);
    if (n.subjectType === 'proposal') navigate(`/e/${slug}/pitches`);
    else navigate(`/e/${slug}/s/${n.subjectId}`);
  };

  const toggle = (kind: NotificationKind, muted: boolean) => {
    // Optimistic: a switch that waits for a round trip feels broken, and the
    // server's answer replaces this a moment later either way.
    setInbox((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            muted: muted ? [...prev.muted, kind] : prev.muted.filter((k) => k !== kind),
          },
    );
    void api
      .muteNotification(slug, kind, muted)
      .then(setInbox)
      .catch(() => load());
  };

  const unread = inbox?.unread ?? 0;

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        {...getReferenceProps({ onClick: () => (open ? setOpen(false) : openPanel()) })}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-500 hover:border-stone-400 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-500"
      >
        <BellIcon />
        {unread > 0 && (
          <span
            // `aria-hidden`: the count is already in the button's label, and a
            // screen reader announcing "3" beside "3 unread" says it twice.
            aria-hidden="true"
            className="absolute -end-1 -top-1 min-w-4 rounded-full bg-blue-600 px-1 text-[10px] font-semibold leading-4 text-white"
          >
            {badge(unread)}
          </span>
        )}
      </button>

      {open && (
        <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            aria-label="Notifications"
            // No viewport-width cap: `usePopover`'s `size` middleware sets
            // maxWidth from the space actually left beside the bell, which is
            // the measurement `100vw` gets wrong for anything not at x=0.
            className={`${popoverPanelClass} flex w-80 flex-col`}
          >
            <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2 dark:border-stone-700">
              <span className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                {settings ? 'What to tell me about' : 'Notifications'}
              </span>
              <button
                type="button"
                onClick={() => setSettings((v) => !v)}
                className="text-xs font-medium text-stone-500 hover:underline dark:text-stone-400"
              >
                {settings ? 'Back' : 'Settings'}
              </button>
            </div>

            {settings ? (
              <div className="flex flex-col gap-3 p-3">
                {KIND_LABELS.map((k) => (
                  <Toggle
                    key={k.kind}
                    checked={!(inbox?.muted ?? []).includes(k.kind)}
                    onChange={(on) => toggle(k.kind, !on)}
                    label={
                      <span className="flex flex-col">
                        <span className="font-medium">{k.label}</span>
                        <span className="text-[11px] font-normal text-stone-500 dark:text-stone-400">
                          {k.hint}
                        </span>
                      </span>
                    }
                  />
                ))}
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  These are yours, in this event only. Nothing is sent by email.
                </p>
              </div>
            ) : (inbox?.items.length ?? 0) === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-stone-500 dark:text-stone-400">
                Nothing yet. When someone writes <span className="font-medium">@you</span>, or a
                session you are in moves, it lands here.
              </p>
            ) : (
              <ul className="max-h-96 overflow-y-auto py-1">
                {inbox?.items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => go(n)}
                      className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-start hover:bg-stone-100 dark:hover:bg-stone-800 ${
                        wasUnread.has(n.id) ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''
                      }`}
                    >
                      <span className="text-xs font-medium text-stone-900 dark:text-stone-100">
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="line-clamp-2 text-xs text-stone-600 dark:text-stone-300">
                          {n.body}
                        </span>
                      )}
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">
                        {relativeTime(n.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FloatingFocusManager>
      )}
    </>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4" fill="currentColor">
      <path d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5v2.2L3.3 9.4a.6.6 0 0 0 .5.95h8.4a.6.6 0 0 0 .5-.95L11.5 7.2V5A3.5 3.5 0 0 0 8 1.5Zm0 12.6a1.8 1.8 0 0 0 1.7-1.25H6.3A1.8 1.8 0 0 0 8 14.1Z" />
    </svg>
  );
}
