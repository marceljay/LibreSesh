import { useCallback, useEffect, useState } from 'react';
import type { AuditEntryDto } from '@shared/types';
import { api } from '../lib/api';
import { relativeTime, rowId, uid } from '../lib/format';
import { EmptyState, SecondaryButton, Section, Spinner, inputClass, useToast } from '../components/ui';

/**
 * The write log, which the server has kept since the first migration and
 * nobody could read. It is the other half of Trash: Trash puts a thing back,
 * this says who took it away — and for the actions with no undo (a rename, a
 * permission change, a merge) it is the only record there is.
 */

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
  invite_qr: 'made an invite QR for',
  permissions: 'changed',
};

const ENTITIES: Record<string, string> = {
  session: 'session',
  contribution: 'contribution',
  room: 'room',
  tag: 'tag',
  track: 'track',
  person: 'person',
  proposal: 'pitch',
  event: 'event',
  identity: 'identity',
  permissions: 'permissions',
  instance: 'instance',
};

/** Deletions and failures are what an organiser is scanning for. */
const TONE: Record<string, string> = {
  delete: 'text-red-700 dark:text-red-400',
  auth_failed: 'text-amber-700 dark:text-amber-400',
  link_failed: 'text-amber-700 dark:text-amber-400',
  merge: 'text-amber-700 dark:text-amber-400',
};

function Entry({ entry }: { entry: AuditEntryDto }) {
  const action = ACTIONS[entry.action] ?? entry.action;
  const entity = ENTITIES[entry.entity] ?? entry.entity;
  return (
    <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 border-b border-stone-100 py-2 text-sm last:border-0 dark:border-stone-800">
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
      <span className={TONE[entry.action] ?? 'text-stone-600 dark:text-stone-300'}>{action}</span>
      <span className="text-stone-500 dark:text-stone-400">{entity}</span>
      {entry.entityLabel && (
        <span className="min-w-0 truncate font-medium">“{entry.entityLabel}”</span>
      )}
      {/* Always, even when a name resolved — the name is what it is called
          now, the id is what was acted on. Two people can share a name, and a
          renamed thing would otherwise make its own history unreadable. */}
      {entry.entityId !== null && (
        <span className="font-mono text-xs text-stone-400 dark:text-stone-500">
          ({rowId(entry.entityId)})
        </span>
      )}
      <time
        dateTime={entry.at}
        title={new Date(entry.at).toLocaleString()}
        className="ml-auto shrink-0 text-xs text-stone-400 dark:text-stone-500"
      >
        {relativeTime(entry.at)}
      </time>
    </li>
  );
}

export function AdminAudit({ slug, auditKeep }: { slug: string; auditKeep: number }) {
  const toast = useToast();
  const [entries, setEntries] = useState<AuditEntryDto[] | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const loadFirst = useCallback(async () => {
    try {
      const page = await api.audit(slug);
      setEntries(page.entries);
      setCursor(page.nextCursor);
    } catch (err) {
      toast.show((err as Error).message);
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
      toast.show((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Filters what has been loaded, not the log — said plainly below, because a
  // search box that quietly ignores the other 900 rows is a trap.
  const needle = filter.trim().toLowerCase();
  const shown = (entries ?? []).filter((e) =>
    needle === ''
      ? true
      : [
          e.actorName,
          e.actorUid === null ? '' : uid(e.actorUid),
          e.action,
          e.entity,
          e.entityLabel,
          e.entityId === null ? '' : rowId(e.entityId),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle),
  );

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
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, id, action or title"
            aria-label="Filter the loaded entries"
            className={`${inputClass} mb-3`}
          />
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
              {entries.length} loaded
              {needle !== '' && `, ${shown.length} matching`}
              {cursor === null ? ' — that is the whole log.' : '. The filter searches these only.'}
            </p>
          </div>
        </>
      )}
    </Section>
  );
}
