import { useMemo, useState } from 'react';
import type { PersonDto } from '@shared/types';
import { api } from '../lib/api';
import { relativeTime, uid } from '../lib/format';
import { matchesSearch, mergeConsequence, sortPeople, suggestDuplicates } from '../lib/people';
import { PersonLine, PersonStatusBadge } from './PersonLine';
import { Modal, PrimaryButton, SecondaryButton, useToast } from './ui';

/**
 * Fold a duplicate profile into this one (identity spec, B2).
 *
 * Merging is the only irreversible thing an organiser can do — no `/trash`
 * path, no undo — and until now it asked for the decision through a bare
 * `<select>` of names. Two people called Ada Lovelace look identical in a
 * dropdown; one of them may be a real person with three talks and a device in
 * the room, the other a shell somebody typed last week. So this dialog does
 * two things a dropdown cannot: it shows the same facts the People list shows
 * on every row, and it makes you read what will happen to *these two* before
 * the button appears.
 */
export function MergeModal({
  slug,
  survivor,
  people,
  userLabel,
  onClose,
  onMerged,
}: {
  slug: string;
  /** The profile that remains — `:id` in the merge URL. */
  survivor: PersonDto;
  /** Everyone in the event; the survivor is filtered out here. */
  people: PersonDto[];
  userLabel?: string;
  onClose: () => void;
  onMerged: (updated: PersonDto, loserId: number) => void;
}) {
  const toast = useToast();
  const [chosenId, setChosenId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(
    () => people.filter((p) => p.id !== survivor.id),
    [people, survivor.id],
  );
  const suggestions = useMemo(
    () => suggestDuplicates(survivor, candidates),
    [survivor, candidates],
  );
  const suggested = new Set(suggestions.map((s) => s.person.id));
  const searching = query.trim() !== '';
  const matches = useMemo(
    () =>
      sortPeople(
        candidates.filter((p) => matchesSearch(p, query) && (searching || !suggested.has(p.id))),
      ),
    // `suggested` is derived from `suggestions` on every render; listing it
    // would defeat the memo without changing the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidates, query, searching, suggestions],
  );
  const chosen = candidates.find((p) => p.id === chosenId) ?? null;

  const merge = async () => {
    if (chosen === null || busy) return;
    setBusy(true);
    try {
      onMerged(await api.mergePerson(slug, survivor.id, chosen.id), chosen.id);
    } catch (err) {
      toast.show((err as Error).message);
      setBusy(false);
    }
  };

  const row = (person: PersonDto, why?: string) => (
    <li key={person.id}>
      <label
        className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 ${
          chosenId === person.id ? 'bg-stone-100 dark:bg-stone-800' : ''
        }`}
      >
        {/* eslint-disable-next-line no-restricted-syntax -- radio, not a text field */}
        <input
          type="radio"
          name="merge-duplicate"
          checked={chosenId === person.id}
          onChange={() => setChosenId(person.id)}
          className="shrink-0"
        />
        <PersonLine person={person} userLabel={userLabel} />
        {why !== undefined && (
          <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
            {why}
          </span>
        )}
      </label>
    </li>
  );

  if (candidates.length === 0) {
    return (
      <Modal
        title="Merge a duplicate"
        onClose={onClose}
        footer={<SecondaryButton onClick={onClose}>Close</SecondaryButton>}
      >
        <p className="text-sm text-stone-400 dark:text-stone-500">
          There is nobody else here to merge.
        </p>
      </Modal>
    );
  }

  if (confirming && chosen !== null) {
    const consequence = mergeConsequence(survivor, chosen);
    return (
      <Modal
        title="Merge these two?"
        description="This cannot be undone. There is no bin to take it out of."
        wide
        onClose={onClose}
        onSubmit={() => void merge()}
        footer={
          <>
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <SecondaryButton onClick={() => setConfirming(false)} disabled={busy}>
              Back
            </SecondaryButton>
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? 'Merging…' : 'Merge'}
            </PrimaryButton>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <PersonCard person={survivor} caption="Stays" userLabel={userLabel} />
          <PersonCard person={chosen} caption="Is folded in and removed" userLabel={userLabel} />
        </div>
        <p
          className={`mt-3 rounded-xl border p-3 text-sm ${
            consequence.kind === 'work-moves'
              ? 'border-amber-300 bg-amber-50 text-stone-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-stone-100'
              : 'border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300'
          }`}
        >
          {consequence.text}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Merge a duplicate"
      description={
        <>
          Pick the profile to fold into <span className="font-medium">{survivor.name}</span>
          {survivor.username !== null && (
            <>
              {' '}
              <span className="text-stone-500 dark:text-stone-400">
                @{survivor.username}
                {survivor.holderUid != null && ` · ${survivor.holderUid.toUpperCase()}`}
              </span>
            </>
          )}
          {survivor.username === null && (
            <span className="text-stone-500 dark:text-stone-400"> (nobody holds it yet)</span>
          )}
          . You will see what it does before anything happens.
        </>
      }
      wide
      onClose={onClose}
      onSubmit={() => chosenId !== null && setConfirming(true)}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={chosenId === null}>
            Continue
          </PrimaryButton>
        </>
      }
    >
      {suggestions.length > 0 && !searching && (
        <>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Likely the same person
          </h3>
          <ul role="radiogroup" aria-label="Likely duplicates" className="mb-4">
            {suggestions.map((s) => row(s.person, s.why))}
          </ul>
        </>
      )}

      {/* eslint-disable-next-line no-restricted-syntax -- compact search box; folds into a ControlShell adornment in a later phase */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search people"
        placeholder="Search by name, @username or UID"
        className="mb-2 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-700 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-200"
      />

      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
        {searching ? 'Matches' : 'Everyone else'}
      </h3>
      <ul
        role="radiogroup"
        aria-label={searching ? 'Search results' : 'Everyone else'}
        className="max-h-64 overflow-y-auto"
      >
        {matches.map((person) => row(person))}
        {matches.length === 0 && (
          <li className="px-2 py-2 text-sm text-stone-400 dark:text-stone-500">
            Nobody matches that.
          </li>
        )}
      </ul>
    </Modal>
  );
}

/** One side of the confirmation, stacked rather than in a row: the two are
 *  meant to be read against each other, fact by fact. */
function PersonCard({
  person,
  caption,
  userLabel,
}: {
  person: PersonDto;
  caption: string;
  userLabel?: string;
}) {
  const sessions = person.sessionCount ?? 0;
  return (
    <div className="rounded-xl border border-stone-200 p-3 dark:border-stone-700">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
        {caption}
      </p>
      <p className="mt-1 truncate text-sm font-semibold">{person.name}</p>
      <p className="text-xs text-stone-500 dark:text-stone-400">
        {person.username === null ? 'No username — nobody holds this' : `@${person.username}`}
      </p>
      {person.holderUid != null && (
        <p className="font-mono text-xs text-stone-400 dark:text-stone-500">
          {uid(person.holderUid)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PersonStatusBadge person={person} userLabel={userLabel} />
        <span className="text-xs text-stone-500 dark:text-stone-400">
          {sessions === 0 ? 'no sessions' : `${sessions} session${sessions === 1 ? '' : 's'}`}
        </span>
        {person.lastSeenAt != null && (
          <span className="text-xs text-stone-400 dark:text-stone-500">
            seen {relativeTime(person.lastSeenAt)}
          </span>
        )}
      </div>
    </div>
  );
}
