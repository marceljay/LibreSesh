import { plural } from '../lib/plural';
import type { PersonDto } from '@shared/types';
import { relativeTime, uid } from '../lib/format';
import { personStatus } from '../lib/people';
import { ROLE_HELP } from './RoleControl';
import { RoleBadge } from './ui';

/**
 * The one badge a person wears, and what it means on hover.
 *
 * Shared so the People list and the merge dialog never disagree about what
 * somebody is. "signed out" is the state nobody can guess from the words —
 * it is not "left the building", it is "holds the profile, holds no role" —
 * so it carries the longest explanation.
 */
export function PersonStatusBadge({
  person,
  userLabel,
}: {
  person: PersonDto;
  userLabel?: string;
}) {
  const status = personStatus(person);
  return (
    <>
      {status.kind === 'role' && (
        <span title={`They are ${ROLE_HELP[status.role]}`}>
          <RoleBadge role={status.role} userLabel={userLabel} />
        </span>
      )}
      {status.kind === 'unclaimed' && (
        <span
          title="Nobody holds this profile. An organiser added the name, or a session credited it, and that person has not entered under it yet."
          className="rounded-full border border-dashed border-stone-300 px-2 py-0.5 text-xs text-stone-500 dark:border-stone-600 dark:text-stone-400"
        >
          unclaimed
        </span>
      )}
      {status.kind === 'signed-out' && (
        <span
          title="Someone holds this profile but has no role here now — they signed out, an organiser took the role away, or a merge moved their work elsewhere. They cannot see the event until they are given a role or enter again with the password."
          className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-300"
        >
          signed out
        </span>
      )}
      {person.archivedAt !== null && (
        <span
          title="An organiser filed this profile away: it keeps its sessions, its role and its holder, and is out of the People list and the speaker picker until somebody takes it back out."
          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
        >
          archived
        </span>
      )}
      {person.codeState === 'pending' && (
        <span
          title="A speaker code was minted for them and has never been redeemed — the phrase is still sitting in an unread message."
          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
        >
          code unused
        </span>
      )}
    </>
  );
}

/**
 * One person, as the facts that tell two people apart: full name, username,
 * UID, what they are here as, how much they are giving, and when they were
 * last around.
 *
 * Shared by the People list and the merge dialog on purpose. Merging is the
 * one irreversible thing an organiser can do, and it must not be decided from
 * less information than the list they came from showed — "Ada Lovelace @ada
 * A1B2C, 3 sessions, seen 2m ago" and "Ada Lovelace, unclaimed, no sessions"
 * are one click apart and are not the same record.
 *
 * The fields keep fixed widths so a column of rows lines up and the eye can
 * compare down it; an absent one is an em dash rather than a gap, so nothing
 * shifts left into a neighbour's place.
 */
export function PersonLine({
  person,
  userLabel,
}: {
  person: PersonDto;
  /** What this event calls its `user` role, for the badge. */
  userLabel?: string;
}) {
  const sessions = person.sessionCount ?? 0;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium">{person.name}</span>

      <span
        title={person.username === null ? 'Nobody holds this profile yet' : 'Their username here'}
        className="w-24 shrink-0 truncate text-xs text-stone-500 dark:text-stone-400"
      >
        {person.username === null ? '—' : `@${person.username}`}
      </span>

      <span
        title="Identity holding this profile — the same at every event on this instance"
        className="hidden w-24 shrink-0 font-mono text-xs text-stone-400 sm:block dark:text-stone-500"
      >
        {person.holderUid == null ? '—' : uid(person.holderUid)}
      </span>

      <span className="flex w-28 shrink-0 flex-wrap items-center gap-1">
        <PersonStatusBadge person={person} userLabel={userLabel} />
      </span>

      <span className="hidden w-20 shrink-0 text-xs tabular-nums text-stone-500 sm:block dark:text-stone-400">
        {sessions === 0 ? '—' : plural(sessions, { one: 'session', other: 'sessions' })}
      </span>

      <span
        title={person.lastSeenAt == null ? undefined : new Date(person.lastSeenAt).toLocaleString()}
        className="hidden w-24 shrink-0 text-xs text-stone-400 sm:block dark:text-stone-500"
      >
        {person.lastSeenAt == null ? '—' : `seen ${relativeTime(person.lastSeenAt)}`}
      </span>
    </div>
  );
}
