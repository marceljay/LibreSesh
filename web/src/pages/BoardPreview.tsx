import { readableInk } from '@shared/tagColors';

/**
 * The board, as the landing page shows it.
 *
 * The design draft in `_planning` puts a PNG of the List view here. This is
 * that picture built out of the same markup the real `ListView` uses instead,
 * for one reason that decided it: the app has a dark theme and a screenshot
 * does not. A single PNG is wrong half the time, and a light/dark pair is two
 * files that go stale the first time a card changes and that nobody notices
 * are stale, because nothing renders them. This costs no bytes over the wire
 * beyond its own markup — the draft's PNG was 273 KB — stays legible when the
 * text is scaled, and cannot drift from the product in the one way that
 * matters, since it is built from the product's own classes.
 *
 * It is not the real `ListView`: that wants rooms, tags, sessions, breaks,
 * star counts, a timezone and five callbacks, none of which exist before you
 * are inside an event. This is a still life with the same clothes on.
 *
 * `aria-hidden`, and the caption does the describing: these are not real
 * sessions and a screen reader announcing them as if they were — times, rooms,
 * speakers, a star you cannot press — would be a worse lie than the picture it
 * replaces. `WindowFrame` below is the sighted half of the same problem: a
 * screen reader is told this is not a board, and the frame is what tells
 * everyone else.
 */

/** Okabe-Ito, the same palette the tag picker draws from (`shared/tagColors`). */
const BLUE = '#0072B2';
const GREEN = '#009E73';
const ORANGE = '#E69F00';

interface Slot {
  title: string;
  when: string;
  where: string;
  who?: string;
  tags?: { name: string; color: string }[];
  /** An unclaimed slot: dashed, and captioned rather than credited. */
  open?: boolean;
  /** The one card wearing the highlighter, as `nowMin` would put it there. */
  live?: boolean;
}

const GROUPS: { time: string; slots: Slot[] }[] = [
  {
    time: '11:00',
    slots: [
      {
        title: 'Commons governance',
        when: '11:00–12:00',
        where: 'Main Hall',
        who: 'Ada',
        tags: [{ name: 'Governance', color: BLUE }],
      },
      { title: 'Open slot', when: '11:00–12:00', where: 'Unconf Room', open: true },
    ],
  },
  {
    time: '14:00',
    slots: [
      {
        title: 'Value accounting, in practice',
        when: '14:00–15:00',
        where: 'Main Hall',
        who: 'Tomas',
        tags: [
          { name: 'Commons', color: GREEN },
          { name: 'Beginner', color: ORANGE },
        ],
        live: true,
      },
      { title: 'Zine workshop', when: '14:00–15:30', where: 'Workshop A', who: 'Rae' },
    ],
  },
];

function Card({ slot }: { slot: Slot }) {
  return (
    <div
      className={`rounded-xl border bg-white p-3 shadow-xs dark:bg-stone-900 ${
        slot.open
          ? 'border-dashed border-emerald-400 dark:border-emerald-500'
          : 'border-stone-200 dark:border-stone-700'
      } ${slot.live ? 'ring-2 ring-stone-900/10 dark:ring-stone-100/10' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{slot.title}</div>
          <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
            {slot.when} · {slot.where}
            {slot.who && ` · ${slot.who}`}
          </div>
        </div>
        {slot.live && (
          <span className="shrink-0 rounded-sm bg-highlight px-1.5 py-0.5 text-xs font-bold text-stone-900">
            now
          </span>
        )}
        <span
          className={`shrink-0 text-base leading-none ${
            slot.live ? 'text-amber-500 dark:text-amber-400' : 'text-stone-300 dark:text-stone-600'
          }`}
        >
          {slot.live ? '★' : '☆'}
        </span>
      </div>

      {(slot.tags?.length || slot.open) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {slot.tags?.map((tag) => (
            <span
              key={tag.name}
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ background: tag.color, color: readableInk(tag.color) }}
            >
              {tag.name}
            </span>
          ))}
          {slot.open && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
              anyone can claim this
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The window the picture sits in.
 *
 * The problem it solves: the preview is built from the app's own classes, so
 * its cards, its star and its "anyone can claim this" pill look exactly like
 * the real ones — because they are the real ones. On the landing page that is
 * the point and also the trap: people were reading it as the running app and
 * clicking at it. Nothing happened, and nothing said why.
 *
 * A browser frame is the cheapest possible answer. It is a convention people
 * already read fluently — chrome around a thing means "here is that thing,
 * pictured" — and it does the work at a glance, before any caption is read.
 * The address in the bar is `example` on purpose: a real-looking host would be
 * a new thing to click.
 *
 * `pointer-events-none` on the contents backs the frame up: no hover state
 * lights up under the cursor, so the picture does not answer as if it were
 * live. `select-none` for the same reason — dragging a selection across it is
 * the other way a picture betrays that it is made of text.
 */
function WindowFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-stone-300 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
      <div className="flex items-center gap-3 border-b border-stone-200 bg-stone-100 px-3 py-2.5 dark:border-stone-700 dark:bg-stone-800">
        <span className="flex shrink-0 gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300 dark:bg-stone-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300 dark:bg-stone-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-stone-300 dark:bg-stone-600" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-white px-2.5 py-1 text-center text-xs text-stone-500 dark:bg-stone-900 dark:text-stone-400">
          example.libresesh.org/e/longconf-2026
        </span>
        <span className="shrink-0 rounded-full border border-stone-300 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-stone-500 dark:border-stone-600 dark:text-stone-400">
          Example
        </span>
      </div>
      {/* The board's own surface, a step below the cards, the way `ListView`
          sits on the app background — without it the white cards vanish into
          the white window. */}
      <div className="select-none bg-stone-50 p-4 dark:bg-stone-950 [&_*]:pointer-events-none">
        {children}
      </div>
    </div>
  );
}

export function BoardPreview() {
  return (
    <figure className="m-0 flex flex-col gap-3">
      <WindowFrame>
        <div aria-hidden="true">
          {/* The chrome of a real day: the event, and how far through it you are. */}
          <div className="mb-4 flex items-center gap-2 border-b border-stone-200 pb-3 text-xs dark:border-stone-700">
            <span className="font-semibold">LongConf 2026</span>
            <span className="text-stone-500 dark:text-stone-400">· schedule is live</span>
            <span className="ms-auto rounded-sm bg-highlight px-1.5 py-0.5 font-bold text-stone-900">
              Now 14:12
            </span>
          </div>

          {GROUPS.map((group) => (
            <div key={group.time} className="mb-4 last:mb-0">
              <div className="mb-1.5 text-xs font-semibold text-stone-500 dark:text-stone-400">
                {group.time}
              </div>
              <div className="space-y-2">
                {group.slots.map((slot) => (
                  <Card key={slot.title} slot={slot} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </WindowFrame>

      <figcaption className="text-xs leading-5 text-stone-500 dark:text-stone-400">
        A live board, pictured: today&rsquo;s sessions, rooms and times — open slots
        marked for anyone to claim.
      </figcaption>
    </figure>
  );
}
