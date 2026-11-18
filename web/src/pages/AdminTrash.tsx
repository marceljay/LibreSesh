import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type TrashDto } from '../lib/api';
import { errorText } from '../lib/errorText';
import { relativeTime } from '../lib/format';
import type { EventData } from '../lib/useEventData';
import { SecondaryButton, Section, useToast } from '../components/ui';

/** The Trash tab: deleted sessions and contributions, each with a way back. */
export function AdminTrash({ slug, data }: { slug: string; data: EventData }) {
  const toast = useToast();
  const [trash, setTrash] = useState<TrashDto | null>(null);

  const fail = (err: unknown) => toast.show(errorText(err));

  const loadTrash = useCallback(async () => {
    try {
      setTrash(await api.trash(slug));
    } catch (err) {
      toast.show(errorText(err));
    }
  }, [slug, toast]);

  // On mount, which is when the tab opens — the bin is the one section most
  // visits never look at, and it is a request of its own.
  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  const restoreSession = async (id: number) => {
    try {
      data.apply({ type: 'session.created', entity: await api.restoreSession(slug, id) });
      toast.show('Session restored');
      await loadTrash();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'room_missing') {
        toast.show('That session’s room was deleted — recreate the room first, then restore.');
      } else {
        fail(err);
      }
    }
  };

  const restoreContribution = async (id: number) => {
    try {
      data.apply({ type: 'contribution.created', entity: await api.restoreContribution(slug, id) });
      toast.show('Contribution restored');
      await loadTrash();
    } catch (err) {
      fail(err);
    }
  };

  const trashEmpty =
    trash !== null && trash.sessions.length === 0 && trash.contributions.length === 0;

  return (
    <>
      <Section
        title="Trash"
        description="Deleted sessions and contributions. Restoring puts them back for everyone."
      >
        {trash === null ? (
          <p className="text-sm text-stone-400 dark:text-stone-500">Loading…</p>
        ) : trashEmpty ? (
          <p className="text-sm text-stone-400 dark:text-stone-500">Nothing has been deleted.</p>
        ) : (
          <div className="space-y-4">
            {trash.sessions.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                  Sessions
                </h3>
                <ul className="space-y-2">
                  {trash.sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 dark:bg-stone-800 px-3 py-2"
                    >
                      <span className="min-w-32 flex-1 text-sm font-medium">{s.title}</span>
                      <span className="text-xs text-stone-400 dark:text-stone-500">
                        deleted {relativeTime(s.deletedAt)} · {s.deletedByName}
                      </span>
                      <SecondaryButton className="py-1" onClick={() => void restoreSession(s.id)}>
                        Restore
                      </SecondaryButton>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {trash.contributions.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-400 dark:text-stone-500">
                  Contributions
                </h3>
                <ul className="space-y-2">
                  {trash.contributions.map((c) => (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-stone-50 dark:bg-stone-800 px-3 py-2"
                    >
                      <span className="min-w-32 flex-1 truncate text-sm">
                        <span className="text-stone-400 dark:text-stone-500">{c.kind}: </span>
                        {c.body}
                      </span>
                      <span className="text-xs text-stone-400 dark:text-stone-500">
                        deleted {relativeTime(c.deletedAt)} · {c.createdByName}
                      </span>
                      <SecondaryButton
                        className="py-1"
                        onClick={() => void restoreContribution(c.id)}
                      >
                        Restore
                      </SecondaryButton>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Section>
    </>
  );
}
