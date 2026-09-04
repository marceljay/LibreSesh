import { useEffect, useMemo, useState } from 'react';
import type { SessionDto } from '@shared/types';
import { api } from '../lib/api';
import { fmtMin, place } from '../lib/format';
import { Modal, PrimaryButton, SecondaryButton } from './ui';

/**
 * Pick which of your same-titled sessions to link into one series. The list is
 * exactly what the server will accept — sessions you may edit that share this
 * one's title — so nothing offered here is refused on confirm. The anchor is
 * always part of the link; the checklist chooses who joins it.
 */
export function LinkSessionsModal({
  session,
  slug,
  timezone,
  onClose,
  onLinked,
  reportError,
}: {
  session: SessionDto;
  slug: string;
  timezone: string;
  onClose: () => void;
  onLinked: (sessions: SessionDto[]) => void;
  reportError: (err: unknown) => void;
}) {
  const [candidates, setCandidates] = useState<SessionDto[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .sessionLinkCandidates(slug, session.id)
      .then((r) => {
        if (!live) return;
        setCandidates(r.candidates);
        // Anything already sharing this session's series starts ticked, so
        // opening the picker on a linked session shows its current members.
        setChosen(
          new Set(
            r.candidates.filter((c) => c.seriesId && c.seriesId === session.seriesId).map((c) => c.id),
          ),
        );
      })
      .catch((err) => {
        if (live) reportError(err);
      });
    return () => {
      live = false;
    };
  }, [slug, session.id, session.seriesId, reportError]);

  const allChosen = !!candidates && candidates.length > 0 && chosen.size === candidates.length;
  const toggleAll = () =>
    setChosen(allChosen ? new Set() : new Set((candidates ?? []).map((c) => c.id)));
  const toggle = (id: number) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const when = useMemo(
    () => (s: SessionDto) => {
      const p = place(s, timezone);
      const date = new Date(`${p.date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      return `${date} · ${fmtMin(p.startMin)}`;
    },
    [timezone],
  );

  const link = async () => {
    if (chosen.size === 0) return;
    setLinking(true);
    try {
      const { sessions } = await api.linkSessions(slug, [session.id, ...chosen]);
      onLinked(sessions);
    } catch (err) {
      reportError(err);
    } finally {
      setLinking(false);
    }
  };

  return (
    <Modal
      title="Link matching sessions"
      description={
        <>
          Link the other times you run <span className="font-medium">{session.title}</span>, so an
          edit to one can apply to them all. Each keeps its own slot.
        </>
      }
      onClose={onClose}
      onSubmit={() => void link()}
      footer={
        <>
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" disabled={linking || chosen.size === 0}>
            {linking ? 'Linking…' : `Link ${chosen.size + 1} sessions`}
          </PrimaryButton>
        </>
      }
    >
      {candidates === null && (
        <p className="text-sm text-stone-500 dark:text-stone-400">Finding matches…</p>
      )}
      {candidates !== null && candidates.length === 0 && (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          No other session of yours shares this title yet. Place another under the same name and it
          will show up here.
        </p>
      )}
      {candidates !== null && candidates.length > 0 && (
        <>
          <label className="mb-2 flex cursor-pointer items-center gap-2 border-b border-stone-200 pb-2 text-sm font-medium text-stone-700 dark:border-stone-700 dark:text-stone-200">
            {/* eslint-disable-next-line no-restricted-syntax -- checkbox, not a text field */}
            <input type="checkbox" checked={allChosen} onChange={toggleAll} className="h-4 w-4" />
            Select all
          </label>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {candidates.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 text-sm text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800">
                  {/* eslint-disable-next-line no-restricted-syntax -- checkbox, not a text field */}
                  <input
                    type="checkbox"
                    checked={chosen.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="h-4 w-4"
                  />
                  <span>{when(c)}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
