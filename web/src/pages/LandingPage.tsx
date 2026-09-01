import { Link } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { linkClass, primaryButtonClass, secondaryButtonClass } from '../components/ui';
import { BoardPreview } from './BoardPreview';

/** Where the code lives. Same answer the About dialog gives, asked here by
 *  someone who has not gone through a gate yet. */
const REPO_URL = 'https://github.com/marceljay/LibreSesh';

/**
 * The front door.
 *
 * `/` used to be the list of every event on the instance, which said nothing
 * about what LibreSesh is — the explanation lived in the About dialog, behind
 * a "?" you only reach once you are already inside an event. It also meant a
 * public instance published its whole event list to anyone who loaded the
 * root. This page answers "what is this" first and links to the list, which
 * now lives at `/events`; the list is still one click away for the people who
 * actually want it (an organiser on their own box, mostly).
 *
 * Copy and layout come from the design draft in `_planning`. What that draft
 * shows as a flat screenshot is `BoardPreview` here instead — see the note
 * there for why.
 */
export function LandingPage() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* The logo artwork carries the wordmark and the tagline, so the page's
            real heading is the one below it, not this. */}
        <Logo className="h-11 w-auto sm:h-14" />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="grid flex-1 items-start gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="flex flex-col gap-7">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            Live schedule for (un)conferences and other community-focused events
          </h1>

          <p className="max-w-[42ch] text-base leading-7 text-stone-600 dark:text-stone-300">
            One link, one board. Anyone in the room can claim an empty slot, and the
            schedule updates for everyone at once. No accounts, no app, open source.
          </p>

          <div className="flex flex-wrap gap-3">
            {/* `inline-flex items-center` here rather than in the shared
                class: an `<a>` is inline, so the button's vertical padding
                would not size its box, and a `<button>` does not want to be a
                flex container (it left-aligns its own label). */}
            <Link to="/events" className={`inline-flex items-center ${primaryButtonClass}`}>
              Browse events on this instance
            </Link>
            {/* `noreferrer` with `noopener`: a link out should not hand the
                destination the address it came from. */}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={secondaryButtonClass}
            >
              Self-host it
            </a>
          </div>

          {/* Most people who load this page were handed a link to one event and
              nothing else. Tell them they are already done rather than making
              them hunt for their event in a list they have no business in. */}
          <p className="max-w-[46ch] text-sm leading-6 text-stone-500 dark:text-stone-400">
            Holding a link to an event? Open it — that link is the whole way in.
            You will be asked for the event&rsquo;s password once, and nothing else.
          </p>

          <p className="text-xs text-stone-500 dark:text-stone-400">
            MIT licensed ·{' '}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`${linkClass} font-medium`}
            >
              Source on GitHub
            </a>
          </p>
        </div>

        <BoardPreview />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-stone-200 pt-5 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">
        <span>Two links, two roles: viewers read the board, attendees add sessions.</span>
        <span className="flex items-center gap-4">
          <Link to="/new" className={linkClass}>
            New event
          </Link>
          <Link to="/import" className={linkClass}>
            Import a schedule
          </Link>
        </span>
      </footer>
    </div>
  );
}
