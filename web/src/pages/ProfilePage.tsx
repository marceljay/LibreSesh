import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PersonDetailDto, PersonDto, PersonLink } from '@shared/types';
import { ApiError, api } from '../lib/api';
import { dayLabel, fmtMin, place, rowId, todayInZone } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useEventData } from '../lib/useEventData';
import {
  EmptyState,
  Field,
  FormStack,
  Modal,
  PrimaryButton,
  SecondaryButton,
  Spinner,
  inputClass,
  useToast,
} from '../components/ui';

type Status = 'loading' | 'ok' | 'notfound' | 'error';

// Same wrappers DetailSheet uses for session descriptions.
const PROSE =
  'prose-sm text-sm leading-relaxed text-stone-700 dark:text-stone-300 [&_a]:text-blue-700 dark:[&_a]:text-blue-400 [&_a]:underline [&_code]:rounded [&_code]:bg-stone-100 dark:[&_code]:bg-stone-800 [&_code]:px-1 [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2';

/** A speaker or host profile with their sessions (follow-up to SPEC §4). */
export function ProfilePage() {
  const { slug = '', personId = '' } = useParams();
  const id = Number(personId);
  const navigate = useNavigate();
  // The bundle gives us the viewer's role, the timezone and live edits.
  const data = useEventData(slug);

  const [detail, setDetail] = useState<PersonDetailDto | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);

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
          setError((err as Error).message);
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

  return (
    <div className="min-h-screen bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link to={`/e/${slug}`} className="text-xs text-stone-500 dark:text-stone-400 underline">
          ← Schedule
        </Link>

        <div className="mt-4 rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight">{person.name}</h1>
              {/* Profile names are checked for clashes but are not the thing
                  that identifies anyone — this id is, and it is the one in the
                  address bar. Per event on purpose: a number that followed a
                  person between events would tie their names together, which
                  is exactly what per-event names exist to avoid. */}
              <p className="mt-0.5 font-mono text-xs text-stone-400 dark:text-stone-500">
                ({rowId(person.id)})
              </p>
            </div>
            {isAdmin && (
              <SecondaryButton className="shrink-0 py-1.5" onClick={() => setMerging(true)}>
                Merge…
              </SecondaryButton>
            )}
            {canEdit && (
              <SecondaryButton className="shrink-0 py-1.5" onClick={() => setEditing(true)}>
                Edit profile
              </SecondaryButton>
            )}
          </div>

          {bioHtml && (
            <div
              className={`mt-3 ${PROSE}`}
              // Markdown is escaped before parsing, so no author markup survives.
              dangerouslySetInnerHTML={{ __html: bioHtml }}
            />
          )}

          {person.links.length > 0 && (
            <ul className="mt-3 space-y-1">
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
          )}

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
          <p className="text-sm text-stone-400 dark:text-stone-500">No sessions yet.</p>
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
                    className="block rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3 py-2 shadow-sm hover:shadow"
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

      {editing && (
        <ProfileEditor
          slug={slug}
          person={person}
          asAdmin={!!isAdmin && !person.isMine}
          mine={person.isMine}
          displayName={bundle?.displayName ?? ''}
          onRenamed={() => void data.reload()}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            setDetail((d) => (d ? { ...d, person: updated } : d));
            data.apply({ type: 'person.updated', entity: updated });
          }}
        />
      )}
    </div>
  );
}

/** Name, bio and a capped label+URL link editor. Mounted fresh on each open, so
 *  its fields seed straight from the person. */
function ProfileEditor({
  slug,
  person,
  asAdmin,
  mine,
  displayName,
  onRenamed,
  onClose,
  onSaved,
}: {
  slug: string;
  person: PersonDto;
  asAdmin: boolean;
  /** Whether this profile belongs to the caller — only then is the display
   *  name theirs to edit, since a rename always writes *your* identity. */
  mine: boolean;
  /** The caller's name in this event, seeding the field above. */
  displayName: string;
  onRenamed: () => void;
  onClose: () => void;
  onSaved: (person: PersonDto) => void;
}) {
  const toast = useToast();
  const [nextDisplayName, setNextDisplayName] = useState(displayName);
  const [name, setName] = useState(person.name);
  const [bio, setBio] = useState(person.bio);
  const [links, setLinks] = useState<PersonLink[]>(person.links);
  const [busy, setBusy] = useState(false);

  const setLink = (i: number, patch: Partial<PersonLink>) =>
    setLinks((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLink = () => setLinks((ls) => (ls.length >= 10 ? ls : [...ls, { label: '', url: '' }]));
  const removeLink = (i: number) => setLinks((ls) => ls.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      // Your display name and this profile are two separate records, so saving
      // makes two calls. The rename goes first: it is the one that can be
      // refused — names are unique inside an event — and a saved profile
      // followed by a rejected rename would leave the form half-applied.
      const wanted = nextDisplayName.trim();
      const renamed = mine && wanted !== '' && wanted !== displayName;
      if (renamed) await api.renameInEvent(slug, wanted);
      const body = {
        name: name.trim(),
        bio: bio.trim(),
        links: links
          .filter((l) => l.label.trim() && l.url.trim())
          .map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
      };
      const updated = asAdmin
        ? await api.updatePerson(slug, person.id, body)
        : await api.updateMyProfile(slug, body);
      onSaved(updated);
      if (renamed) onRenamed();
      onClose();
      toast.show('Profile saved');
    } catch (err) {
      toast.show((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit profile"
      onClose={onClose}
      onSubmit={() => void save()}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </PrimaryButton>
        </>
      }
    >
      <FormStack>
      {mine && (
        <Field
          label="Display name"
          hint="How you appear in this event, on the header chip and anything you post. Must be unlike anyone else's here."
        >
          <input
            value={nextDisplayName}
            onChange={(e) => setNextDisplayName(e.target.value)}
            maxLength={40}
            className={inputClass}
            autoFocus
          />
        </Field>
      )}
      <Field
        label="Name"
        hint={mine ? 'The name on this profile — what sessions you host are credited to.' : undefined}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className={inputClass}
          autoFocus={!mine}
        />
      </Field>
      <Field label="Bio" hint="Markdown is supported.">
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={4}
          maxLength={2000}
          className={`${inputClass} resize-none`}
        />
      </Field>
      <Field label="Links">
        <div className="space-y-2">
          {links.map((link, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={link.label}
                onChange={(e) => setLink(i, { label: e.target.value })}
                placeholder="Label"
                maxLength={60}
                className={`${inputClass} w-1/3`}
              />
              <input
                value={link.url}
                onChange={(e) => setLink(i, { url: e.target.value })}
                placeholder="https://…"
                inputMode="url"
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => removeLink(i)}
                aria-label="Remove link"
                className="shrink-0 rounded-lg px-2 text-stone-400 dark:text-stone-500 hover:text-red-600 dark:hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ))}
          {links.length === 0 && <p className="text-xs text-stone-400 dark:text-stone-500">No links yet.</p>}
          {links.length < 10 && (
            <button
              type="button"
              onClick={addLink}
              className="text-xs font-medium text-stone-600 dark:text-stone-300 underline hover:text-stone-900 dark:hover:text-stone-100"
            >
              Add a link
            </button>
          )}
        </div>
      </Field>
      </FormStack>
    </Modal>
  );
}

/**
 * Fold a duplicate profile into this one (identity spec, B2). The duplicate's
 * sessions and pitches move here, then it disappears — there is no undo, which
 * is why the sentence spells out the direction before the button.
 */
function MergeModal({
  slug,
  survivor,
  people,
  onClose,
  onMerged,
}: {
  slug: string;
  survivor: PersonDto;
  people: PersonDto[];
  onClose: () => void;
  onMerged: (updated: PersonDto, loserId: number) => void;
}) {
  const toast = useToast();
  const [fromId, setFromId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const candidates = people.filter((p) => p.id !== survivor.id);

  const merge = async () => {
    if (fromId === null || busy) return;
    setBusy(true);
    try {
      const updated = await api.mergePerson(slug, survivor.id, fromId);
      onMerged(updated, fromId);
    } catch (err) {
      toast.show((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Merge a duplicate"
      description={
        <>
          The profile you pick is folded into{' '}
          <span className="font-medium">{survivor.name}</span>: its sessions and pitches move
          here, then it is removed. This cannot be undone.
        </>
      }
      onClose={onClose}
      onSubmit={() => void merge()}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || fromId === null}>
            {busy ? 'Merging…' : 'Merge'}
          </PrimaryButton>
        </>
      }
    >
      {candidates.length === 0 ? (
        <p className="text-sm text-stone-400 dark:text-stone-500">
          There is no other profile to merge.
        </p>
      ) : (
        <FormStack>
          <Field label="Duplicate to fold in">
            <select
              value={fromId === null ? '' : String(fromId)}
              onChange={(e) => setFromId(e.target.value ? Number(e.target.value) : null)}
              className={inputClass}
            >
              <option value="">— pick a profile —</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.claimed ? ' (claimed)' : ''}
                </option>
              ))}
            </select>
          </Field>
        </FormStack>
      )}
    </Modal>
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
      toast.show((err as Error).message);
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
      toast.show('Speaker phrase revoked');
    } catch (err) {
      toast.show((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-stone-100 pt-3 dark:border-stone-800">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs font-semibold text-stone-500 dark:text-stone-400">
          Speaker access
        </span>
        <SecondaryButton className="py-1 text-xs" onClick={() => void mint()} disabled={busy}>
          {phrase ? 'New phrase' : 'Generate phrase'}
        </SecondaryButton>
        <SecondaryButton className="py-1 text-xs" onClick={() => void revoke()} disabled={busy}>
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
          A phrase {person.name} can type at the gate to become this profile, with the speaker
          role. Generating a new one replaces the old.
        </p>
      )}
    </div>
  );
}
