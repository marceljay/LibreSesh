import { errorText } from '../lib/errorText';
import { useCallback, useEffect, useState } from 'react';
import type { AuditEntryDto, AuditItemDto } from '@shared/types';
import { api } from '../lib/api';
import { relativeTime, rowId, uid } from '../lib/format';
import { plural, pluralForm } from '../lib/plural';
import { ControlShell, EmptyState, SecondaryButton, Section, Spinner, TextInput, useToast } from '../components/ui';

/**
 * The write log, which the server has kept since the first migration and
 * nobody could read. It is the other half of Trash: Trash puts a thing back,
 * this says who took it away — and for the actions with no undo (a rename, a
 * permission change, a merge) it is the only record there is.
 */

/** What the list counts: one line is one action, which may have written
 *  several rows. */
const LINES = { one: 'entry', other: 'entries' };

/** Past tense, because every row is something that already happened. */
const ACTIONS: Record<string, string> = {
  create: 'created',
  update: 'edited',
  rename: 'renamed',
  delete: 'deleted',
  restore: 'restored',
  place: 'scheduled',
  reorder: 'reordered',
  merge: 'merged',
  clone: 'duplicated',
  export: 'exported',
  import: 'imported',
  backup: 'backed up',
  auth_demo: 'entered (demo)',
  auth_failed: 'failed a password attempt on',
  link_mint: 'created a device phrase for',
  link_redeem: 'linked a device to',
  link_failed: 'failed a device phrase for',
  speaker_code_mint: 'minted a speaker code for',
  speaker_code_revoke: 'revoked the speaker code for',
  role_set: 'changed the role of',
  archive: 'archived',
  unarchive: 'took out of the archive',
  claim_request: 'asked to hold',
  claim_approve: 'agreed that they are',
  claim_decline: 'turned down a request to hold',
  invite_qr: 'made an invite QR for',
  permissions: 'changed',
  series_link: 'linked',
  series_unlink: 'unlinked',
};

/** Counted, because one action can write several rows — five sessions placed
 *  in one press. Forms rather than an appended "s": "person" pluralises to
 *  "people" and "pitch" to "pitches". */
const ENTITIES: Record<string, { one: string; other: string }> = {
  session: { one: 'session', other: 'sessions' },
  contribution: { one: 'contribution', other: 'contributions' },
  room: { one: 'room', other: 'rooms' },
  tag: { one: 'tag', other: 'tags' },
  format: { one: 'format', other: 'formats' },
  track: { one: 'track', other: 'tracks' },
  person: { one: 'person', other: 'people' },
  proposal: { one: 'pitch', other: 'pitches' },
  event: { one: 'event', other: 'events' },
  identity: { one: 'identity', other: 'identities' },
  permissions: { one: 'permissions', other: 'permissions' },
  instance: { one: 'instance', other: 'instances' },
};

/** Deletions and failures are what an organiser is scanning for. */
const TONE: Record<string, string> = {
  delete: 'text-red-700 dark:text-red-400',
  auth_failed: 'text-amber-700 dark:text-amber-400',
  link_failed: 'text-amber-700 dark:text-amber-400',
  merge: 'text-amber-700 dark:text-amber-400',
};

/** The actor, their UID and the time — the parts every line shares. */
function Who({ entry }: { entry: AuditEntryDto }) {
  return (
    <>
      <span className="font-medium">{entry.actorName || 'someone'}</span>
      {/* The UID, not just the name: names are editable and this log is read
          precisely when someone wants to know who did a thing. The same code
          identifies them at every event on this instance. */}
      {entry.actorUid !== null && (
        <span
          title="Identity — the same at every event on this instance"
          className="font-mono text-xs text-stone-400 dark:text-stone-500"
        >
          ({uid(entry.actorUid)})
        </span>
      )}
    </>
  );
}

function When({ at }: { at: string }) {
  return (
    <time
      dateTime={at}
      title={new Date(at).toLocaleString()}
      className="ms-auto shrink-0 text-xs text-stone-400 dark:text-stone-500"
    >
      {relativeTime(at)}
    </time>
  );
}

/** What was acted on: its name if it could still be looked up, and always its
 *  id — the name is what it is called now, the id is what was acted on. */
function What({ entry }: { entry: AuditEntryDto }) {
  return (
    <>
      {entry.entityLabel && (
        <span className="min-w-0 truncate font-medium">“{entry.entityLabel}”</span>
      )}
      {entry.entityId !== null && (
        <span className="font-mono text-xs text-stone-400 dark:text-stone-500">
          ({rowId(entry.entityId)})
        </span>
      )}
    </>
  );
}

/**
 * One line: usually one row, sometimes a whole bulk action.
 *
 * A repeat placed across a fortnight writes fourteen rows, and it must —
 * each is a session with its own id, and the edit that moves one of them next
 * week will name it alone. But fourteen lines for one press buries the rest of
 * the morning's history, so the batch reads as one line and opens to show every
 * member. Nothing is hidden; it is folded.
 */
function Entry({ entry }: { entry: AuditItemDto }) {
  const [open, setOpen] = useState(false);
  const action = ACTIONS[entry.action] ?? entry.action;
  const forms = ENTITIES[entry.entity] ?? { one: entry.entity, other: entry.entity };
  const members = entry.members;
  const tone = TONE[entry.action] ?? 'text-stone-600 dark:text-stone-300';

  if (members === undefined) {
    return (
      <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 border-b border-stone-100 py-2 text-sm last:border-0 dark:border-stone-800">
        <Who entry={entry} />
        <span className={tone}>{action}</span>
        <span className="text-stone-500 dark:text-stone-400">{pluralForm(1, forms)}</span>
        <What entry={entry} />
        <When at={entry.at} />
      </li>
    );
  }

  return (
    <li className="border-b border-stone-100 py-2 text-sm last:border-0 dark:border-stone-800">
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <Who entry={entry} />
        <span className={tone}>{action}</span>
        {/* The count, and the title they share — a repeat is the same session
            on several days, so one name covers the batch. */}
        <span className="text-stone-500 dark:text-stone-400">
          {plural(members.length, forms)}
        </span>
        {entry.entityLabel && (
          <span className="min-w-0 truncate font-medium">“{entry.entityLabel}”</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="rounded-sm text-xs font-medium text-stone-500 underline hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
        >
          {open ? 'Hide' : `Show all ${members.length}`}
        </button>
        <When at={entry.at} />
      </div>
      {open && (
        <ul className="mt-1.5 space-y-1 border-s border-stone-200 ps-3 dark:border-stone-700">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400"
            >
              <span>{pluralForm(1, forms)}</span>
              <What entry={member} />
              <When at={member.at} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function AdminAudit({ slug, auditKeep }: { slug: string; auditKeep: number }) {
  const toast = useToast();
  const [entries, setEntries] = useState<AuditItemDto[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const loadFirst = useCallback(async () => {
    try {
      const page = await api.audit(slug);
      setEntries(page.entries);
      setCursor(page.nextCursor);
    } catch (err) {
      toast.show(errorText(err));
      setEntries([]);
    }
  }, [slug, toast]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async (): Promise<void> => {
    if (cursor === null || busy) return;
    setBusy(true);
    try {
      const page = await api.audit(slug, cursor);
      setEntries((prev) => [...(prev ?? []), ...page.entries]);
      setCursor(page.nextCursor);
    } catch (err) {
      toast.show(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // Filters what has been loaded, not the log — said plainly below, because a
  // search box that quietly ignores the other 900 rows is a trap.
  const needle = filter.trim().toLowerCase();
  /** Everything about one line that is worth matching — including the members
   *  of a batch, so the id of a session placed in a run still finds the line
   *  that placed it, folded or not. */
  const haystack = (e: AuditItemDto): string =>
    [
      e.actorName,
      e.actorUid === null ? '' : uid(e.actorUid),
      e.action,
      e.entity,
      ...(e.members ?? [e]).flatMap((m) => [
        m.entityLabel,
        m.entityId === null ? '' : rowId(m.entityId),
      ]),
    ]
      .join(' ')
      .toLowerCase();
  const shown = (entries ?? []).filter((e) => needle === '' || haystack(e).includes(needle));

  return (
    <Section
      title="Audit log"
      description={
        auditKeep === 0
          ? 'Every write, kept forever: who created, edited, deleted or restored what, plus the password and device-phrase attempts that failed. Nobody can edit this list, including organisers.'
          : `Who created, edited, deleted or restored what, plus the password and device-phrase attempts that failed. Nobody can edit this list, including organisers — but it keeps the newest ${auditKeep.toLocaleString()} entries and drops the rest, which Settings can change.`
      }
    >
      {entries === null ? (
        <Spinner label="Loading the log…" />
      ) : entries.length === 0 ? (
        <EmptyState>Nothing has been written to this event yet.</EmptyState>
      ) : (
        <>
          <ControlShell className="mb-3">
            <TextInput
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, id, action or title"
              aria-label="Filter the loaded entries"
            />
          </ControlShell>
          <ul>
            {shown.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ul>
          {shown.length === 0 && (
            <p className="py-2 text-sm text-stone-500 dark:text-stone-400">
              Nothing loaded so far matches. Load older entries to search further back.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {cursor !== null && (
              <SecondaryButton onClick={() => void loadMore()} disabled={busy}>
                {busy ? 'Loading…' : 'Load older entries'}
              </SecondaryButton>
            )}
            <p className="text-xs text-stone-400 dark:text-stone-500">
              {plural(entries.length, LINES)} loaded
              {needle !== '' && `, ${shown.length} matching`}
              {cursor === null ? ' — that is the whole log.' : '. The filter searches these only.'}
            </p>
          </div>
        </>
      )}
    </Section>
  );
}
