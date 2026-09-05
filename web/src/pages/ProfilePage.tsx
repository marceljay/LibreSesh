import { errorText } from '../lib/errorText';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { PersonDetailDto, PersonDto, LabelledLink, Role } from '@shared/types';
import { ApiError, api, type PersonWrite } from '../lib/api';
import { dayLabel, fmtMin, place, todayInZone } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useEventData } from '../lib/useEventData';
import { EditIcon } from '../components/icons';
import { MergeModal } from '../components/MergeModal';
import { PersonStatusBadge } from '../components/PersonLine';
import { RoleControl } from '../components/RoleControl';
import {
  ControlShell,
  EmptyState,
  FormError,
  IconButton,
  PrimaryButton,
  SecondaryButton,
  Spinner,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';

type Status = 'loading' | 'ok' | 'notfound' | 'error';

/** Which field is open. One at a time on purpose: each save is its own request,
 *  and two fields in flight at once is how a profile ends up saving half of
 *  what you wrote. */
type FieldKey = 'displayName' | 'name' | 'bio' | 'links';

// Same wrappers DetailSheet uses for session descriptions.
const PROSE =
  'prose-sm text-sm leading-relaxed text-stone-700 dark:text-stone-300 [&_a]:text-blue-700 dark:[&_a]:text-blue-400 [&_a]:underline [&_code]:rounded-sm [&_code]:bg-stone-100 dark:[&_code]:bg-stone-800 [&_code]:px-1 [&_li]:ms-4 [&_li]:list-disc [&_p]:mb-2';

/** A speaker or host profile with their sessions (follow-up to SPEC §4). */
export function ProfilePage() {
  const { slug = '', personId = '' } = useParams();
  const id = Number(personId);
  const navigate = useNavigate();
  /**
   * Where "back" goes. A profile is reached from two places that are nothing
   * like each other — the schedule, and Manage → People — and sending an
   * organiser who came from the People tab out to the schedule made them
   * navigate back in for every person they looked at. Whoever links here says
   * where here was; anyone who does not gets the schedule, as before.
   */
  const from = (useLocation().state as { back?: { to: string; label: string } } | null)?.back;
  // The bundle gives us the viewer's role, the timezone and live edits.
  const data = useEventData(slug);
  const toast = useToast();

  const [detail, setDetail] = useState<PersonDetailDto | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<FieldKey | null>(null);
  const [merging, setMerging] = useState(false);
  // Drafts live here rather than in each field so an open editor keeps what you
  // typed while the bundle refreshes underneath it.
  const [draftDisplayName, setDraftDisplayName] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [draftLinks, setDraftLinks] = useState<LabelledLink[]>([]);

  useEffect(() => {
    let live = true;
    setStatus('loading');
    api
      .person(slug, id)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setStatus('ok');
      })
      .catch((err: unknown) => {
        if (!live) return;
        if (err instanceof ApiError && err.status === 401) {
          navigate(`/e/${slug}`, { replace: true });
        } else if (err instanceof ApiError && err.status === 404) {
          setStatus('notfound');
        } else {
          setError(errorText(err));
          setStatus('error');
        }
      });
    return () => {
      live = false;
    };
  }, [slug, id, navigate]);

  const bundle = data.bundle;
  const timezone = bundle?.event.timezone ?? 'UTC';
  const today = todayInZone(timezone);

  // Prefer the live bundle copy so SSE edits show without a refetch.
  const person: PersonDto | null =
    bundle?.people.find((p) => p.id === id) ?? detail?.person ?? null;

  const sessions = useMemo(() => {
    if (bundle) {
      return bundle.sessions
        .filter((s) => s.speakers.some((p) => p.id === id))
        .slice()
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return detail?.sessions ?? [];
  }, [bundle, detail, id]);

  const bioHtml = useMemo(
    () => (person?.bio ? renderMarkdown(person.bio) : ''),
    [person?.bio],
  );

  const isAdmin = bundle?.role === 'admin';
  /**
   * Asking for a profile an organiser left for you. It stops at asking: a
   * shell is usually credited on sessions, and holding it is the right to
   * rewrite those talks, so an organiser agrees before anything moves.
   */
  const myClaim = bundle?.claims.find((c) => c.isMine && c.personId === id);
  const waitingElsewhere = bundle?.claims.find(
    (c) => c.isMine && c.personId !== id && c.declinedAt === null,
  );
  const claimAction = async (run: () => Promise<unknown>) => {
    try {
      await run();
      await data.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const canEdit = !!person && (person.isMine || isAdmin);

  if (status === 'loading') return <Spinner label="Loading profile…" />;
  if (status === 'notfound' || (status === 'ok' && !person)) {
    return (
      <EmptyState>
        No such profile.{' '}
        <Link to={`/e/${slug}`} className="underline">
          Back to the schedule
        </Link>
      </EmptyState>
    );
  }
  if (status === 'error' || !person) {
    return (
      <EmptyState>
        {error ?? 'Could not load this profile.'}
        <div className="mt-3">
          <Link to={`/e/${slug}`} className="underline">
            Back to the schedule
          </Link>
        </div>
      </EmptyState>
    );
  }

  const displayName = bundle?.displayName ?? '';
  // An organiser editing someone else's profile writes it through the admin
  // route; your own goes through /me/profile, which may still have to create it.
  const asAdmin = !!isAdmin && !person.isMine;
  const close = () => setOpen(null);

  /** Open one field, seeding its draft from what is on screen. Seeding here
   *  rather than at mount is what lets a field you never touched pick up an
   *  edit that arrived over SSE. */
  const edit = (key: FieldKey) => {
    if (key === 'displayName') setDraftDisplayName(displayName);
    if (key === 'name') setDraftName(person.name);
    if (key === 'bio') setDraftBio(person.bio);
    if (key === 'links') {
      setDraftLinks(person.links.length > 0 ? person.links : [{ label: '', url: '' }]);
    }
    setOpen(key);
  };

  /** One field, one PATCH carrying only that field. Both routes take a partial
   *  body, so saving a bio cannot quietly rewrite a name someone else changed
   *  while this page was open. */
  const savePerson = async (body: Partial<PersonWrite>) => {
    const updated = asAdmin
      ? await api.updatePerson(slug, person.id, body)
      : await api.updateMyProfile(slug, body);
    setDetail((d) => (d ? { ...d, person: updated } : d));
    data.apply({ type: 'person.updated', entity: updated });
  };

  /**
   * Put this profile away, or take it back out.
   *
   * Both directions are here because both callers are: an organiser tidying
   * up, and the person themselves finding out that they were tidied. The
   * server decides who may do which — an organiser either way, the holder
   * only outwards.
   */
  const toggleArchive = async () => {
    try {
      const updated =
        person.archivedAt === null
          ? await api.archivePerson(slug, person.id)
          : await api.unarchivePerson(slug, person.id);
      setDetail((d) => (d ? { ...d, person: updated } : d));
      data.apply({ type: 'person.updated', entity: updated });
    } catch (err) {
      toast.show(errorText(err));
    }
  };

  /**
   * Hand them a different role. The server refuses to demote the last
   * organiser — an event nobody can administer has no way back — so that
   * refusal arrives as a toast rather than being predicted here.
   */
  const changeRole = async (role: Role) => {
    try {
      const updated = await api.setPersonRole(slug, person.id, role);
      setDetail((d) => (d ? { ...d, person: updated } : d));
      data.apply({ type: 'person.updated', entity: updated });
    } catch (err) {
      toast.show(errorText(err));
    }
  };

  const setLink = (i: number, patch: Partial<LabelledLink>) =>
    setDraftLinks((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  return (
    <div className="min-h-screen bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            to={from?.to ?? `/e/${slug}`}
            className="text-xs text-stone-500 dark:text-stone-400 underline"
          >
            ← {from?.label ?? 'Schedule'}
          </Link>
          {/* A deep link into a profile arrives with no history to speak of,
              so an organiser gets the tab named outright rather than only as
              a back arrow they may not have. */}
          {isAdmin && from === undefined && (
            <Link
              to={`/e/${slug}/admin?tab=people`}
              className="text-xs text-stone-500 dark:text-stone-400 underline"
            >
              Manage → People
            </Link>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-5 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {open === 'name' ? (
                <FieldForm
                  onClose={close}
                  onSave={async () => {
                    const wanted = draftName.trim();
                    if (!wanted) throw new Error('A profile needs a name.');
                    await savePerson({ name: wanted });
                  }}
                  hint={
                    person.isMine
                      ? 'Your full name — what sessions you give are credited to. Need not be unique.'
                      : 'Their full name — what sessions they give are credited to.'
                  }
                >
                  <ControlShell>
                    <TextInput
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      aria-label="Full name"
                      enterKeyHint="done"
                      maxLength={120}
                      className="text-lg font-semibold"
                      autoFocus
                    />
                  </ControlShell>
                </FieldForm>
              ) : (
                <div className="flex items-center gap-1.5">
                  <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
                    {person.name}
                  </h1>
                  {canEdit && (
                    <IconButton
                      aria-label="Edit full name"
                      title="Edit full name"
                      className="shrink-0"
                      onClick={() => edit('name')}
                    >
                      <EditIcon className="h-3.5 w-3.5" />
                    </IconButton>
                  )}
                </div>
              )}
              {/* Two names, two jobs: the heading is the full name a session
                  is credited to, and under it the username the room actually
                  calls them. The profile's row id used to sit here; it is in
                  the address bar and nowhere else does anyone need it. */}
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                {person.username === null
                  ? 'Nobody holds this profile yet'
                  : `@${person.username}`}
              </p>
              {/* What this person is here, for organisers only — the same
                  badge the People list shows, changeable in the same way.
                  An organiser who opens a profile to read a bio is one click
                  from the reason they usually came: the role is wrong. Before
                  this, the only place to change it was the row they left. */}
              {isAdmin && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {person.claimed ? (
                    <RoleControl
                      role={person.role ?? null}
                      userLabel={bundle?.event.userRoleLabel}
                      personName={person.name}
                      onChange={(role) => void changeRole(role)}
                    />
                  ) : (
                    <PersonStatusBadge person={person} userLabel={bundle?.event.userRoleLabel} />
                  )}
                </div>
              )}
            </div>
            {isAdmin && (
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <SecondaryButton className="py-1.5" onClick={() => setMerging(true)}>
                  Merge…
                </SecondaryButton>
                {/* Only inwards. Coming back out is the notice below, which
                    is where the holder finds it too. */}
                {person.archivedAt === null && (
                  <SecondaryButton
                    className="py-1.5"
                    title="Take this profile out of the People list and the speaker picker. Nothing is lost, and it can come back."
                    onClick={() => void toggleArchive()}
                  >
                    Archive
                  </SecondaryButton>
                )}
              </div>
            )}
          </div>

          {/* Archived, said to the two people it concerns: whoever holds the
              profile, and whoever runs the event. A stranger arriving from a
              session's speaker link is shown nothing — the profile still
              works, and "archived" is an organiser's filing note, not a fact
              about the person.

              The holder's copy is the whole reason archiving is not deleting.
              Their cookie still works, their role is untouched, and this is
              where they find out that they were put away and take themselves
              back out without having to find an organiser. */}
          {person.archivedAt !== null && (person.isMine || isAdmin) && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-stone-700 dark:text-stone-300">
                  {person.isMine
                    ? 'This profile was archived, so it is out of the People list and the speaker picker. Nothing was lost — you keep your role, your sessions and everything you have posted.'
                    : `Archived ${new Date(person.archivedAt).toLocaleDateString()}. It is out of the People list and the speaker picker, and keeps its sessions, its role and its holder.`}
                </span>
                <PrimaryButton
                  className="ms-auto py-1 text-xs"
                  onClick={() => void toggleArchive()}
                >
                  {person.isMine ? 'I’m still here' : 'Take out of the archive'}
                </PrimaryButton>
              </div>
            </div>
          )}

          {!person.claimed && !isAdmin && (
            <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm dark:border-stone-700 dark:bg-stone-800/60">
              {myClaim && myClaim.declinedAt === null ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-stone-700 dark:text-stone-300">
                    You have asked to hold this profile. An organiser decides.
                  </span>
                  <SecondaryButton
                    className="ms-auto py-1 text-xs"
                    onClick={() => void claimAction(() => api.withdrawClaim(slug, myClaim.id))}
                  >
                    Withdraw
                  </SecondaryButton>
                </div>
              ) : myClaim ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-stone-700 dark:text-stone-300">
                    An organiser turned that request down.
                  </span>
                  <SecondaryButton
                    className="ms-auto py-1 text-xs"
                    onClick={() => void claimAction(() => api.withdrawClaim(slug, myClaim.id))}
                  >
                    Dismiss
                  </SecondaryButton>
                </div>
              ) : waitingElsewhere ? (
                <p className="text-stone-600 dark:text-stone-400">
                  You are already waiting on{' '}
                  <span className="font-medium">{waitingElsewhere.personName}</span>. Withdraw that
                  request before asking for this one.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-stone-600 dark:text-stone-400">
                    Nobody holds this profile. If it is you, an organiser can hand it over.
                  </span>
                  <PrimaryButton
                    className="ms-auto py-1 text-xs"
                    onClick={() => void claimAction(() => api.claimPerson(slug, person.id))}
                  >
                    This is me
                  </PrimaryButton>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 space-y-4 border-t border-stone-100 pt-4 dark:border-stone-800">
            {person.isMine && (
              /* Your display name is not part of this profile — it is your
                 identity in the event — so it saves through its own call, and
                 an organiser looking at your profile does not get to touch it. */
              <ProfileField
                label="Username"
                hint="How you appear in this event: the header chip, and anything you post. Unique here; not a login."
                canEdit
                filled={displayName !== ''}
                emptyText="You have no username in this event yet."
                addLabel="Set a username"
                editing={open === 'displayName'}
                onEdit={() => edit('displayName')}
                onClose={close}
                onSave={async () => {
                  const wanted = draftDisplayName.trim();
                  if (!wanted) throw new Error('A username cannot be empty.');
                  if (wanted === displayName) return;
                  await api.renameInEvent(slug, wanted);
                  await data.reload();
                }}
                editor={
                  <ControlShell>
                    <TextInput
                      value={draftDisplayName}
                      onChange={(e) => setDraftDisplayName(e.target.value)}
                      aria-label="Username"
                      enterKeyHint="done"
                      maxLength={40}
                      autoFocus
                    />
                  </ControlShell>
                }
              >
                <p className="text-sm">{displayName}</p>
              </ProfileField>
            )}

            <ProfileField
              label="Bio"
              canEdit={canEdit}
              filled={person.bio.trim() !== ''}
              emptyText={person.isMine ? 'Nothing about you yet.' : 'No bio yet.'}
              addLabel="Add a bio"
              editing={open === 'bio'}
              onEdit={() => edit('bio')}
              onClose={close}
              onSave={() => savePerson({ bio: draftBio.trim() })}
              editHint="Markdown is supported."
              editor={
                <TextArea
                  value={draftBio}
                  onChange={(e) => setDraftBio(e.target.value)}
                  aria-label="Bio"
                  rows={5}
                  maxLength={2000}
                  className="resize-none"
                  autoFocus
                />
              }
            >
              <div
                className={PROSE}
                // Markdown is escaped before parsing, so no author markup survives.
                dangerouslySetInnerHTML={{ __html: bioHtml }}
              />
            </ProfileField>

            <ProfileField
              label="Links"
              canEdit={canEdit}
              filled={person.links.length > 0}
              emptyText="No links yet."
              addLabel="Add a link"
              editing={open === 'links'}
              onEdit={() => edit('links')}
              onClose={close}
              onSave={async () => {
                // A row left blank is a row you added and changed your mind
                // about; a half-filled one is a mistake worth saying out loud,
                // because the server would only ever see it as missing.
                const kept = draftLinks.filter(
                  (l) => l.label.trim() !== '' || l.url.trim() !== '',
                );
                if (kept.some((l) => l.label.trim() === '' || l.url.trim() === '')) {
                  throw new Error('Every link needs both a label and an address.');
                }
                await savePerson({
                  links: kept.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
                });
              }}
              editor={
                <div className="space-y-2">
                  {draftLinks.map((link, i) => (
                    <div key={i} className="flex gap-2">
                      <ControlShell className="w-1/3">
                        <TextInput
                          value={link.label}
                          onChange={(e) => setLink(i, { label: e.target.value })}
                          placeholder="Label"
                          aria-label={`Link ${i + 1} label`}
                          maxLength={60}
                          autoFocus={i === 0}
                        />
                      </ControlShell>
                      <ControlShell className="flex-1">
                        <TextInput
                          value={link.url}
                          onChange={(e) => setLink(i, { url: e.target.value })}
                          placeholder="https://…"
                          aria-label={`Link ${i + 1} address`}
                          inputMode="url"
                        />
                      </ControlShell>
                      <button
                        type="button"
                        onClick={() => setDraftLinks((ls) => ls.filter((_, idx) => idx !== i))}
                        aria-label={`Remove link ${i + 1}`}
                        className="shrink-0 rounded-lg px-2 text-stone-400 dark:text-stone-500 hover:text-red-600 dark:hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {draftLinks.length < 10 && (
                    <button
                      type="button"
                      onClick={() => setDraftLinks((ls) => [...ls, { label: '', url: '' }])}
                      className="text-xs font-medium text-stone-600 dark:text-stone-300 underline hover:text-stone-900 dark:hover:text-stone-100"
                    >
                      Add another link
                    </button>
                  )}
                </div>
              }
            >
              <ul className="space-y-1">
                {person.links.map((link, i) => (
                  <li key={i}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-700 dark:text-blue-400 underline"
                    >
                      {link.label || link.url}
                    </a>
                  </li>
                ))}
              </ul>
            </ProfileField>
          </div>

          {isAdmin && (
            <SpeakerAccess
              slug={slug}
              person={person}
              onChanged={() => void data.reload()}
            />
          )}
        </div>

        <h2 className="mb-2 mt-6 text-sm font-semibold">Sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-stone-400 dark:text-stone-500">
            {person.isMine
              ? 'You are not hosting anything yet.'
              : `${person.name} is not hosting anything yet.`}
          </p>
        ) : (
          <ul className="space-y-2">
            {sessions.map((session) => {
              const { date, startMin, endMin } = place(session, timezone);
              const label = dayLabel(date, today);
              const room = bundle?.rooms.find((r) => r.id === session.roomId);
              return (
                <li key={session.id}>
                  <Link
                    to={`/e/${slug}/s/${session.id}`}
                    className="block rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 shadow-xs hover:shadow-sm"
                  >
                    <div className="text-xs text-stone-500 dark:text-stone-400">
                      {label.top} {label.sub} · {fmtMin(startMin)}–{fmtMin(endMin)} ·{' '}
                      {room?.name ?? 'unknown room'}
                    </div>
                    <div className="text-sm font-medium">{session.title}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {merging && bundle && (
        <MergeModal
          slug={slug}
          survivor={person}
          people={bundle.people}
          userLabel={bundle.event.userRoleLabel}
          onClose={() => setMerging(false)}
          onMerged={(updated, loserId) => {
            setDetail((d) => (d ? { ...d, person: updated } : d));
            data.apply({ type: 'person.deleted', entity: { id: loserId } });
            data.apply({ type: 'person.updated', entity: updated });
            void data.reload();
            setMerging(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * One line of a profile, read until you open that one line.
 *
 * There is no page-wide edit mode, and that is what makes an empty profile
 * legible: the bio you have not written can say so *where the bio goes*, with
 * the way to write it right there, instead of being an absence you would only
 * find by opening a dialog that edits everything at once. Each field also
 * saves alone, so a slow-typed bio is not holding a name hostage.
 *
 * Empty *and* not yours to fill is the one case that draws nothing — a
 * stranger reading a sparse profile should see a name and what there is, not a
 * column of blanks.
 */
function ProfileField({
  label,
  hint,
  editHint,
  canEdit,
  filled,
  emptyText,
  addLabel,
  editing,
  onEdit,
  onClose,
  onSave,
  editor,
  children,
}: {
  label: string;
  /** Shown at rest as well as in the editor — for a field whose meaning is not
   *  in its name. */
  hint?: string;
  /** Shown only while editing, for what you need while typing and never after. */
  editHint?: string;
  canEdit: boolean;
  /** Whether there is anything to read. Blank-but-present counts as empty. */
  filled: boolean;
  emptyText: string;
  addLabel: string;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  /** Rejecting keeps the editor open, with the message under the control. */
  onSave: () => Promise<void>;
  editor: ReactNode;
  /** The read view. Only rendered when `filled`. */
  children: ReactNode;
}) {
  if (!editing && !filled && !canEdit) return null;

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-xs font-medium text-stone-600 dark:text-stone-300">{label}</span>
        {!editing && filled && canEdit && (
          <IconButton
            aria-label={`Edit ${label.toLowerCase()}`}
            title={`Edit ${label.toLowerCase()}`}
            onClick={onEdit}
          >
            <EditIcon className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
      {editing ? (
        <FieldForm onClose={onClose} onSave={onSave} hint={editHint ?? hint}>
          {editor}
        </FieldForm>
      ) : filled ? (
        <>
          {children}
          {hint && <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{hint}</p>}
        </>
      ) : (
        /* The empty state is the field, not a gap where one would be: what is
           missing, named, with the button that fills it on the same line. */
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-stone-400 dark:text-stone-500">{emptyText}</p>
          {canEdit && (
            <SecondaryButton className="py-1" onClick={onEdit}>
              {addLabel}
            </SecondaryButton>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The editor half of a field: the control, its own Save and Cancel, and the
 * error its own save came back with. Shared so every field fails the same way
 * — inline, under the control, with what you typed still in it — rather than
 * as a toast that takes the message somewhere else on the page.
 */
function FieldForm({
  onSave,
  onClose,
  hint,
  children,
}: {
  onSave: () => Promise<void>;
  onClose: () => void;
  hint?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      // Escape leaves the field, not the page. It stops here so a field inside
      // a dialog does not close the dialog along with itself.
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onClose();
      }}
    >
      {children}
      {hint && <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{hint}</p>}
      {error && <FormError className="mt-2">{error}</FormError>}
      <div className="mt-2 flex gap-2">
        <PrimaryButton type="submit" className="py-1.5" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </PrimaryButton>
        <SecondaryButton className="py-1.5" onClick={onClose} disabled={busy}>
          Cancel
        </SecondaryButton>
      </div>
    </form>
  );
}

/**
 * Organiser-only: mint or revoke this person's speaker phrase. The phrase is
 * shown exactly once, at mint — the server keeps only a hash. Whoever types
 * it at any gate becomes this person with the speaker role, on any number of
 * devices, until it is revoked.
 */
function SpeakerAccess({
  slug,
  person,
  onChanged,
}: {
  slug: string;
  person: PersonDto;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mint = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await api.mintSpeakerCode(slug, person.id);
      setPhrase(res.phrase);
      onChanged();
    } catch (err) {
      toast.show(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.revokeSpeakerCode(slug, person.id);
      setPhrase(null);
      // Reload as minting does: the badge above is read off the person, and
      // a revoked code that still shows "code unused" is worse than no badge.
      onChanged();
      toast.show('Speaker phrase revoked');
    } catch (err) {
      toast.show(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Whether a phrase is out there, which this section could not say before.
   * It knew only about a phrase minted in this page's own lifetime, so an
   * organiser returning the next day was shown "Generate phrase" whether they
   * had sent one or not — and the only way to find out was to mint a second,
   * which silently invalidates the first.
   */
  const state = person.codeState ?? 'none';

  return (
    <div className="mt-4 border-t border-stone-100 pt-3 dark:border-stone-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-stone-500 dark:text-stone-400">
          Speaker access
        </span>
        {state === 'pending' && (
          <span
            title="The phrase has been generated and never typed at the gate — it is still sitting in an unread message."
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
          >
            code unused
          </span>
        )}
        {state === 'used' && (
          <span
            title="The phrase has been typed at the gate at least once, so a device is signed in as this profile."
            className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
          >
            code used
          </span>
        )}
        <span className="flex-1" />
        <SecondaryButton className="py-1 text-xs" onClick={() => void mint()} disabled={busy}>
          {state === 'none' ? 'Generate phrase' : 'New phrase'}
        </SecondaryButton>
        {/* Off when there is nothing to revoke, rather than hidden: the button
            disappearing would read as "you may not do this". */}
        <SecondaryButton
          className="py-1 text-xs"
          onClick={() => void revoke()}
          disabled={busy || state === 'none'}
          title={state === 'none' ? 'No phrase to revoke.' : undefined}
        >
          Revoke
        </SecondaryButton>
      </div>
      {phrase ? (
        <>
          <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-center font-mono text-sm font-semibold dark:border-stone-700 dark:bg-stone-800">
            {phrase}
          </div>
          <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
            Shown once — give it to {person.name}. Typing it at the event gate signs them in as
            this profile with the speaker role, from any device, until you revoke it.
          </p>
        </>
      ) : (
        <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
          {state === 'none'
            ? `No phrase exists for ${person.name}. Generate one and they can type it at the gate to become this profile, with the speaker role.`
            : state === 'pending'
              ? `A phrase exists and has not been used. It is shown only once, so if it did not reach ${person.name}, generate a new one — which replaces the old.`
              : `${person.name} has used their phrase. It still works on further devices; generating a new one replaces it, revoking cancels it without signing out the devices already in.`}
        </p>
      )}
    </div>
  );
}
