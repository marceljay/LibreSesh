import { useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { BundleDto, Me } from '@shared/types';
import { CalendarExportModal } from './CalendarExport';
import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';
import { ProfileMenu } from './ProfileMenu';

export interface EventBarProps {
  slug: string;
  bundle: BundleDto;
  me: Me | null;
  /**
   * The line under the event name. The schedule says whether it is live;
   * every other page says how to get back to the schedule, which is what it
   * gets when nothing is passed.
   */
  sub?: ReactNode;
  /** The bundle's notification counter, where the page has a live one. */
  ping?: number;
  /** The container width, matched to the page below so the bar's edges line
   *  up with the content's. */
  width?: string;
  /** What happens once the server has forgotten this device. */
  onSignOut: () => void;
  /** The coach-mark tour, which only the schedule has. */
  onTour?: () => void;
  /**
   * Asked before anything on the bar leaves the page — the logo, the way
   * back, the menu's own destinations, signing out. Manage Event's Settings
   * tab passes its unsaved-edits question here; a `false` keeps you where you
   * are.
   */
  beforeLeave?: () => Promise<boolean>;
}

/**
 * The row at the top of every page of an event: the logo, the event's name,
 * the notification bell and the menu behind your name. It used to be the
 * schedule's alone, which left every other page — agenda, search, a profile,
 * the pitch board, Manage Event — with no way to the menu except back through
 * the schedule. One component now, so the pages cannot drift apart, and so a
 * page that adds a control adds it everywhere.
 *
 * The bar is a row, not a `<header>`: the schedule's header holds more than
 * the bar (weeks, days, filters), and a header inside a header is not HTML.
 * Each page wraps it in its own.
 */
export function EventBar({
  slug,
  bundle,
  me,
  sub,
  ping = 0,
  width = 'max-w-6xl',
  onSignOut,
  onTour,
  beforeLeave,
}: EventBarProps) {
  const navigate = useNavigate();
  const [calendar, setCalendar] = useState<'download' | 'subscribe' | null>(null);
  const { event } = bundle;

  /** Runs `go` unless the page objects. */
  const guarded = (go: () => void) => {
    if (!beforeLeave) return go();
    void beforeLeave().then((ok) => {
      if (ok) go();
    });
  };
  /** A link that asks first. Plain otherwise, so the browser keeps its
   *  open-in-new-tab and copy-address behaviours. */
  const guardLink = (to: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!beforeLeave || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    guarded(() => navigate(to));
  };

  return (
    <>
      {/* Tighter below `sm`. The event name is the only thing here that
          truncates, so every pixel the padding and the gaps give back is a
          pixel of title — about three characters between them, which is the
          difference between reading a name and guessing it. */}
      <div className={`mx-auto flex ${width} items-center gap-2 px-3 py-3 sm:gap-3 sm:px-4`}>
        <Link
          to="/"
          onClick={guardLink('/')}
          className="flex shrink-0 items-center"
          aria-label="LibreSesh home"
        >
          {/* Below `sm` the wordmark's width belongs to the event name, so
              the phone header gets the near-square mark instead. The swap
              lives on wrappers because Logo spends its own display classes
              on the theme. */}
          <span className="flex items-center sm:hidden">
            <Logo variant="mark" className="h-6 w-auto" />
          </span>
          <span className="hidden items-center sm:flex">
            <Logo variant="oneline" className="h-6 w-auto" />
          </span>
        </Link>
        <span
          aria-hidden="true"
          className="hidden h-6 w-px shrink-0 bg-stone-300 dark:bg-stone-700 sm:block"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">{event.name}</div>
          {sub ?? (
            <Link
              to={`/e/${slug}`}
              onClick={guardLink(`/e/${slug}`)}
              className="text-xs text-stone-500 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
            >
              ← Back to the schedule
            </Link>
          )}
        </div>
        <div className="ms-auto flex items-center justify-end gap-1.5 sm:gap-2">
          <NotificationBell slug={slug} ping={ping} />
          <ProfileMenu
            onTour={onTour}
            // This event, not the instance: a demo instance also hosts real
            // events, and those are neither open nor ever reseeded.
            demoEvent={me?.demoEventSlugs?.includes(slug) === true}
            onCalendar={setCalendar}
            displayName={bundle.displayName}
            slug={slug}
            role={bundle.role}
            userLabel={event.userRoleLabel}
            people={bundle.people}
            publicId={me?.uid ?? ''}
            beforeNavigate={beforeLeave}
            onSignOut={() => guarded(onSignOut)}
          />
        </div>
      </div>

      {calendar && (
        <CalendarExportModal
          slug={slug}
          starredCount={bundle.starredSessionIds.length}
          section={calendar}
          onClose={() => setCalendar(null)}
        />
      )}
    </>
  );
}
