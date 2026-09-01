import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  ContributionDto,
  ContributionKind,
  Me,
  RoomDto,
  Role,
  SessionDto,
  TagDto,
} from '@shared/types';
import { fmtMin, place, relativeTime } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { EditIcon, HideIcon, RemoveIcon, UnhideIcon } from './icons';
import { IconButton, PrimaryButton, SecondaryButton, inputClass } from './ui';

const KIND_LABEL: Record<ContributionKind, string> = {
  question: 'Questions',
  note: 'Notes',
  link: 'Links',
};
const KINDS: ContributionKind[] = ['question', 'note', 'link'];

/** How many contributions of one kind the side panel shows before it collapses
 *  the rest behind a button. A busy open session gathers notes faster than
 *  anyone reads them, and three kinds x dozens of rows turns the panel into a
 *  page you must scroll past to reach the composer. The full-page view passes
 *  `null` instead: seeing all of it is what that route is for. */
export const COLLAPSED_COUNT = 3;

/** `sheet` is the side panel over the grid; `page` the full-width route. They
 *  differ in type scale and in how the sections are arranged — one stacked
 *  column against two — not in what they can do. */
export type SessionDetailLayout = 'sheet' | 'page';

export interface SessionDetailProps {
  session: SessionDto;
  slug: string;
  rooms: RoomDto[];
  tags: TagDto[];
  contributions: ContributionDto[] | undefined;
  role: Role;
  me: Me | null;
  timezone: string;
  canEdit: boolean;
  archived: boolean;
  /** Whether this session is on the current identity's personal agenda. */
  starred: boolean;
  /** The event's word for the middle role, used in the upgrade prompt. */
  userLabel: string;
  layout: SessionDetailLayout;
  /** Contributions per kind shown before collapsing; `null` shows all. */
  collapseAt: number | null;
  /** Sits at the top right of the header — the sheet's close button, the
   *  page's link back to the grid. */
  headerActions?: ReactNode;
  onToggleStar: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAdd: (kind: ContributionKind, body: string, url?: string) => Promise<void>;
  onRemoveContribution: (id: number) => void;
  onToggleHidden: (contribution: ContributionDto) => void;
}

/** Everything a session shows, independent of the frame around it. The sheet
 *  and the full page render this same component so the two cannot drift: a new
 *  field, a new permission rule or a new contribution control lands in both. */
export function SessionDetail({
  session,
  slug,
  rooms,
  tags,
  contributions,
  role,
  me,
  timezone,
  canEdit,
  archived,
  starred,
  userLabel,
  layout,
  collapseAt,
  headerActions,
  onToggleStar,
  onEdit,
  onDelete,
  onAdd,
  onRemoveContribution,
  onToggleHidden,
}: SessionDetailProps) {
  const [kind, setKind] = useState<ContributionKind>('question');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [posting, setPosting] = useState(false);
  const [expandedKinds, setExpandedKinds] = useState<
    Partial<Record<ContributionKind, true>>
  >({});

  // Collapse again when pointed at a different session: one component instance
  // serves every session, so without this an expanded Notes list would stay
  // expanded for the next session opened.
  useEffect(() => setExpandedKinds({}), [session.id]);

  const page = layout === 'page';
  const room = rooms.find((r) => r.id === session.roomId);
  const { startMin, endMin } = place(session, timezone);
  const description = useMemo(
    () => (session.description ? renderMarkdown(session.description) : ''),
    [session.description],
  );

  const canContribute = role !== 'viewer' && !archived;

  const submit = async () => {
    if (!body.trim() || posting) return;
    setPosting(true);
    try {
      await onAdd(kind, body.trim(), kind === 'link' ? url.trim() : undefined);
      setBody('');
      setUrl('');
    } finally {
      setPosting(false);
    }
  };

  const header = (
    <div className={`flex items-start gap-2 ${page ? 'mb-6' : 'mb-3'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {session.type === 'open' ? (
            <span className="rounded-full bg-emerald-100 dark:bg-emerald-950/60 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              open session
            </span>
          ) : (
            <span className="rounded-full bg-stone-100 dark:bg-stone-800 px-2 py-0.5 text-xs font-semibold text-stone-600 dark:text-stone-300">
              official
            </span>
          )}
          {session.blocksOpenBooking && (
            <span
              title="While this runs, attendees cannot add a session anywhere"
              className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300"
            >
              everyone should be here
            </span>
          )}
          {session.tagIds.map((id) => {
            const tag = tags.find((t) => t.id === id);
            if (!tag) return null;
            return (
              <span
                key={id}
                className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ background: tag.color }}
              >
                {tag.name}
              </span>
            );
          })}
        </div>
        <h2
          className={`mt-1.5 font-semibold leading-snug tracking-tight ${
            page ? 'text-2xl sm:text-3xl' : 'text-lg'
          }`}
        >
          {session.title}
        </h2>
        <p
          className={`mt-1 text-stone-500 dark:text-stone-400 ${page ? 'text-base' : 'text-sm'}`}
        >
          {fmtMin(startMin)}–{fmtMin(endMin)} · {room?.name ?? 'unknown room'} ·{' '}
          {/* One link each: a name on the bill is a person with a profile,
              and a panel of four is four people to read about. */}
          {session.speakers.length === 0
            ? 'no speaker yet'
            : session.speakers.map((person, i) => (
                <span key={person.id}>
                  {i > 0 && ', '}
                  <Link
                    to={`/e/${slug}/p/${person.id}`}
                    className="text-blue-700 underline dark:text-blue-400"
                  >
                    {person.name}
                  </Link>
                </span>
              ))}
        </p>
      </div>
      {headerActions}
    </div>
  );

  // The primary way to star from the grid — the calendar blocks stay
  // display-only because their pointer handling is drag-sensitive.
  const starButton = (
    <button
      type="button"
      onClick={onToggleStar}
      aria-label={starred ? `Unstar ${session.title}` : `Star ${session.title}`}
      aria-pressed={starred}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
        page ? 'w-full justify-center' : 'mb-4'
      } ${
        starred
          ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
          : 'border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 hover:border-stone-400 dark:hover:border-stone-500'
      }`}
    >
      <span aria-hidden="true">{starred ? '★' : '☆'}</span>
      {starred ? 'On my agenda' : 'Add to my agenda'}
    </button>
  );

  const descriptionBlock = description ? (
    <div
      className={`prose-sm mb-4 leading-relaxed text-stone-700 dark:text-stone-300 [&_a]:text-blue-700 dark:[&_a]:text-blue-400 [&_a]:underline [&_code]:rounded [&_code]:bg-stone-100 dark:[&_code]:bg-stone-800 [&_code]:px-1 [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2 ${
        page ? 'text-base' : 'text-sm'
      }`}
      // Markdown is escaped before parsing, so no author markup survives.
      dangerouslySetInnerHTML={{ __html: description }}
    />
  ) : null;

  // Rendered only when set — most sessions have no stream, and an empty row
  // would be noise on a phone in a hallway.
  const livestream = session.livestreamUrl ? (
    <a
      href={session.livestreamUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-4 flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-stone-500"
    >
      <span aria-hidden>▶</span>
      Watch the livestream
    </a>
  ) : null;

  const ownerActions =
    canEdit && !archived ? (
      // In the page's rail the gap comes from `space-y-4`; in the sheet's
      // single stack it has to come from the row itself.
      <div className={`flex gap-2 ${page ? '' : 'mb-4'}`}>
        <SecondaryButton className="flex-1 justify-center gap-1.5 py-1.5" onClick={onEdit}>
          <EditIcon className="h-3.5 w-3.5" />
          Edit session
        </SecondaryButton>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          <RemoveIcon className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    ) : null;

  const contributionLists =
    contributions === undefined ? (
      <p className="mb-3 text-sm text-stone-400 dark:text-stone-500">
        Loading contributions…
      </p>
    ) : (
      <>
        {KINDS.map((k) => {
          const items = contributions.filter((c) => c.kind === k);
          if (items.length === 0) return null;
          // The server orders by `created_at`, so a collapsed list keeps the
          // *tail*: during a live session the newest notes are the ones being
          // read, and keeping the first three would hide exactly what the
          // panel is open for. The expander sits above the list, where the
          // rows it reveals will appear.
          const expanded = expandedKinds[k] === true;
          const hiddenCount =
            expanded || collapseAt === null
              ? 0
              : Math.max(0, items.length - collapseAt);
          const shown = hiddenCount > 0 ? items.slice(hiddenCount) : items;
          return (
            <div key={k} className="mb-3">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                {KIND_LABEL[k]}
                <span className="ml-1.5 font-normal tabular-nums">{items.length}</span>
              </h3>
              {collapseAt !== null && items.length > collapseAt && (
                <button
                  type="button"
                  onClick={() =>
                    setExpandedKinds((prev) => ({
                      ...prev,
                      [k]: expanded ? undefined : true,
                    }))
                  }
                  className="mb-1.5 text-xs font-medium text-stone-500 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
                >
                  {expanded
                    ? 'Show fewer'
                    : `Show ${hiddenCount} earlier ${k}${hiddenCount === 1 ? '' : 's'}`}
                </button>
              )}
              <ul className="space-y-1.5">
                {shown.map((c) => (
                  <li
                    key={c.id}
                    className={`group rounded-lg px-3 py-2 text-sm ${
                      c.hidden ? 'bg-red-50 dark:bg-red-950/40' : 'bg-stone-50 dark:bg-stone-800'
                    }`}
                  >
                    {c.kind === 'link' && c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-700 dark:text-blue-400 underline"
                      >
                        {c.body} ↗
                      </a>
                    ) : (
                      <span className="whitespace-pre-wrap text-stone-800 dark:text-stone-200">
                        {c.body}
                      </span>
                    )}
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
                      <span className="truncate">
                        {c.createdByName} · {relativeTime(c.createdAt)}
                        {c.hidden && ' · hidden'}
                      </span>
                      {/* Icon buttons rather than the underlined words these
                          were: two text links in a row this dense read as prose
                          and wrapped on a phone. `title` carries the wording
                          for a pointer, `aria-label` for everyone else. */}
                      <div className="ml-auto flex shrink-0 items-center gap-0.5">
                        {role === 'admin' && !archived && (
                          <IconButton
                            onClick={() => onToggleHidden(c)}
                            aria-label={c.hidden ? 'Unhide this contribution' : 'Hide this contribution'}
                            title={c.hidden ? 'Unhide' : 'Hide'}
                          >
                            {c.hidden ? <UnhideIcon /> : <HideIcon />}
                          </IconButton>
                        )}
                        {!archived && (role === 'admin' || c.createdBy === me?.id) && (
                          <IconButton
                            onClick={() => onRemoveContribution(c.id)}
                            aria-label="Remove this contribution"
                            title="Remove"
                            className="hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-900 dark:hover:bg-red-950/50 dark:hover:text-red-400"
                          >
                            <RemoveIcon />
                          </IconButton>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {contributions.length === 0 && (
          <p className="mb-3 text-sm text-stone-400 dark:text-stone-500">
            No notes, links or questions yet.
          </p>
        )}
      </>
    );

  const composer = archived ? (
    <p className="rounded-lg bg-stone-50 dark:bg-stone-800 px-3 py-2 text-xs text-stone-500 dark:text-stone-400">
      This event is archived — it is read-only now.
    </p>
  ) : !canContribute ? (
    <p className="rounded-lg bg-stone-50 dark:bg-stone-800 px-3 py-2 text-xs text-stone-500 dark:text-stone-400">
      Enter the {userLabel} password (tap your name, top right) to add notes, links and
      questions.
    </p>
  ) : (
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 p-3">
      <div className="mb-2 flex gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
              kind === k
                ? 'bg-stone-900 dark:bg-stone-100 dark:text-stone-900 text-white'
                : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300'
            }`}
          >
            {k}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={page ? 4 : 2}
        maxLength={2000}
        placeholder={kind === 'link' ? 'Link label' : `Add a ${kind}…`}
        className={`${inputClass} resize-none`}
      />
      {kind === 'link' && (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
          className={`${inputClass} mt-1.5`}
        />
      )}
      <PrimaryButton
        className="mt-2 w-full py-1.5"
        onClick={() => void submit()}
        disabled={!body.trim() || posting}
      >
        Post as {me?.displayName ?? 'you'}
      </PrimaryButton>
    </div>
  );

  if (!page) {
    return (
      <>
        {header}
        {starButton}
        {descriptionBlock}
        {livestream}
        {ownerActions}
        {contributionLists}
        {composer}
      </>
    );
  }

  // Two columns from `lg`: the discussion is the long half and gets the width,
  // while the things you act with — star, edit, composer — stay put in a
  // sticky rail rather than sitting below a hundred notes. Below `lg` it falls
  // back to the same single stack as the sheet, with the rail's contents
  // ahead of the lists.
  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:order-2 lg:col-span-1">
          <div className="lg:sticky lg:top-20 space-y-4">
            {starButton}
            {ownerActions}
            {composer}
          </div>
        </div>
        <div className="min-w-0 lg:order-1 lg:col-span-2">
          {descriptionBlock}
          {livestream}
          {contributionLists}
        </div>
      </div>
    </>
  );
}
