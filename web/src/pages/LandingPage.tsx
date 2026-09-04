import { Link } from 'react-router-dom';
import { GitHubMark } from '../components/icons';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { linkClass } from '../components/ui';
import { BoardPreview } from './BoardPreview';

/** Where the code lives. Same answer the About dialog gives, asked here by
 *  someone who has not gone through a gate yet. */
const REPO_URL = 'https://github.com/marceljay/LibreSesh';

/**
 * The landing page's own buttons.
 *
 * Deliberately *not* `primaryButtonClass` / `secondaryButtonClass`. Those are
 * the app's inline controls: 38px tall, `text-xs`, `rounded-lg`, sized to line
 * up beside a field in a toolbar. That restraint is right inside an event —
 * it is a working tool and the schedule is the thing you look at — and it is
 * wrong here, where the buttons *are* the content and the page has one job,
 * which is to be walked into by someone who has never seen it.
 *
 * So: bigger box, softer corner, a real shadow, and a hover that lifts. The
 * lift is off under `prefers-reduced-motion` — it is decoration, and this is
 * the one page a first-time visitor meets, which is exactly the audience whose
 * setting should be honoured. Focus is the global `:focus-visible` ring from
 * `index.css`; nothing here re-adds one.
 */
const ctaShape =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold no-underline ' +
  'transition duration-150 hover:-translate-y-0.5 active:translate-y-0 ' +
  'motion-reduce:transform-none motion-reduce:transition-none';

const ctaPrimaryClass =
  `${ctaShape} px-5 py-3 text-sm shadow-sm bg-stone-900 text-white hover:bg-stone-800 hover:shadow-lg ` +
  'dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white';

const ctaSecondaryClass =
  `${ctaShape} px-5 py-3 text-sm shadow-xs border border-stone-300 bg-white text-stone-800 hover:border-stone-400 hover:shadow-md ` +
  'dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:border-stone-500';

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
 *
 * **New event and Import are not on this page at all.** They were two
 * link-coloured words in the footer, then a block explaining that both want
 * the *instance* password (SPEC §3.3) — the server owner's, which almost
 * nobody loading this page has. The explanation was the tell: a front door
 * that has to define a password nobody attending an event will ever meet is
 * answering a question its audience did not ask, and spends the attention of
 * every visitor to reassure one. `/events` already carries both buttons, and
 * whoever deployed this box is going there anyway — so the caveat lives next
 * to them there, and this page keeps its one job.
 */
export function LandingPage() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-5xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* The logo artwork carries the wordmark and the tagline, so the page's
            real heading is the one below it, not this. */}
        <Logo className="h-11 w-auto sm:h-14" />
        <div className="ms-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="grid flex-1 items-start gap-8 lg:grid-cols-2 lg:gap-x-14">
        <div className="flex flex-col gap-6">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {/* The one flash of brand colour on the page, on the two words that
                are the claim. `--color-highlight` is the same yellow the board
                marks the current session with. */}
            <span className="underline decoration-highlight decoration-4 underline-offset-4">
              Live schedule
            </span>{' '}
            for (un)conferences and other community-focused events
          </h1>

          <p className="max-w-[42ch] text-base leading-7 text-stone-600 dark:text-stone-300">
            One link, one board. Anyone in the room can claim an empty slot, and the
            schedule updates for everyone at once. No accounts, no app, open source.
          </p>

          <div className="flex flex-wrap gap-3">
            {/* `inline-flex items-center` lives in `ctaShape` rather than on
                each of these: an `<a>` and a router `<Link>` are inline, so a
                button's vertical padding would not size their box. */}
            <Link to="/events" className={ctaPrimaryClass}>
              Browse events on this instance
            </Link>
            {/* `noreferrer` with `noopener`: a link out should not hand the
                destination the address it came from. */}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={ctaSecondaryClass}
            >
              <GitHubMark className="h-4 w-4" />
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

        </div>

        <BoardPreview />
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-stone-200 pt-5 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">
        <span>Two links, two roles: viewers read the board, attendees add sessions.</span>
        {/* The licence and the source, together, at the bottom — where a
            project's provenance is looked for. The mark rather than the word
            because a logo is recognised before it is read, and this is the
            claim in the paragraph above ("open source") being made good. */}
        <span className="flex items-center gap-4">
          <span>MIT licensed</span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${linkClass} inline-flex items-center gap-1.5 font-medium no-underline hover:underline`}
          >
            <GitHubMark className="h-4 w-4" />
            Source on GitHub
          </a>
        </span>
      </footer>
    </div>
  );
}
