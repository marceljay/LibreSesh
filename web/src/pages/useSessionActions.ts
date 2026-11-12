import { useCallback, useState } from 'react';
import type { ContributionDto, ContributionKind, SessionDto } from '@shared/types';
import { ApiError, api, type SessionWrite } from '../lib/api';
import { errorText } from '../lib/errorText';
import { zonedTimeToUtc } from '@shared/time';
import { fmtMin, place } from '../lib/format';
import type { EventData } from '../lib/useEventData';
import type { SaveOpts } from '../components/SessionModal';
import { useConfirm, useToast } from '../components/ui';

/** The session form's subject: a session being edited, or `{}` for a new one. */
export type EditingSession = { session?: SessionDto } | null;

/**
 * Everything the schedule can do to a session or its contributions: star,
 * move, save, unlink, delete, and add, remove or hide a contribution.
 *
 * Called once, by `SchedulePage`, which mounts both the panel and the
 * full-page view of a session — so the two presentations share one set of
 * handlers (ARCHITECTURE.md §Frontend). Each handler applies the server's
 * answer to the bundle itself rather than waiting for the SSE echo.
 */
export function useSessionActions({
  slug,
  data,
  timezone,
  editing,
  setEditing,
  selected,
  closeSession,
}: {
  slug: string;
  data: EventData;
  timezone: string;
  /** What the session form is open on; a save updates it or creates one. */
  editing: EditingSession;
  setEditing: (next: EditingSession) => void;
  /** The session whose detail is open, which contributions are added to. */
  selected: SessionDto | undefined;
  closeSession: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);

  const reportError = useCallback(
    (err: unknown) => {
      toast.show(errorText(err));
    },
    [toast],
  );

  /** Optimistic star toggle; stars are private so there is no SSE echo to wait
   *  for. Revert and toast if the server rejects it. */
  const toggleStar = useCallback(
    async (session: SessionDto) => {
      const wasStarred = data.bundle?.starredSessionIds.includes(session.id) ?? false;
      data.setStarred(session.id, !wasStarred);
      try {
        if (wasStarred) await api.unstarSession(slug, session.id);
        else await api.starSession(slug, session.id);
      } catch (err) {
        data.setStarred(session.id, wasStarred);
        reportError(err);
      }
    },
    [data, reportError, slug],
  );

  /** PATCH on drop; a rejected move snaps back because we never mutated locally. */
  const moveSession = useCallback(
    async (session: SessionDto, startMin: number, durMin: number, roomId: number) => {
      const date = place(session, timezone).date;
      try {
        const updated = await api.updateSession(slug, session.id, {
          roomId,
          startsAt: zonedTimeToUtc(date, startMin, timezone).toISOString(),
          endsAt: zonedTimeToUtc(date, startMin + durMin, timezone).toISOString(),
          expectedUpdatedAt: session.updatedAt,
        });
        data.apply({ type: 'session.updated', entity: updated });
        toast.show(`Moved to ${fmtMin(startMin)}`);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'stale') {
          toast.show('Someone else moved that session — reloading');
          void data.reload();
        } else {
          reportError(err);
        }
      }
    },
    [data, reportError, slug, timezone, toast],
  );

  const saveSession = useCallback(
    async (body: SessionWrite, opts?: SaveOpts) => {
      setSaving(true);
      try {
        if (editing?.session) {
          const updated = await api.updateSession(slug, editing.session.id, {
            ...body,
            expectedUpdatedAt: editing.session.updatedAt,
            ...(opts?.applyTo ? { applyTo: opts.applyTo } : {}),
          });
          data.apply({ type: 'session.updated', entity: updated });
          // Siblings the edit reached arrive over the live channel; a series
          // edit says how far it got, since some may not have been the user's.
          const reach = updated.seriesApply;
          if (reach && reach.applied < reach.considered) {
            toast.show(
              `Applied to ${reach.applied} of ${reach.considered} — the rest weren't yours to change`,
            );
          } else if (reach) {
            toast.show(`Applied to ${reach.applied} linked sessions`);
          } else {
            toast.show('Session updated');
          }
        } else if (opts?.repeat) {
          // One request, then every session it made applied here: the server
          // broadcasts them too, and `apply` is idempotent, but a grid that
          // waited for the echo would sit empty on a slow connection.
          const { sessions } = await api.createSessionRepeat(slug, {
            ...body,
            repeat: opts.repeat,
            ...(opts.link ? { link: true } : {}),
          });
          for (const created of sessions) {
            data.apply({ type: 'session.created', entity: created });
          }
          toast.show(
            opts.link
              ? `${sessions.length} linked sessions added`
              : `${sessions.length} sessions added`,
          );
        } else {
          const created = await api.createSession(slug, body);
          data.apply({ type: 'session.created', entity: created });
          toast.show('Session added');
        }
        setEditing(null);
      } catch (err) {
        reportError(err);
      } finally {
        setSaving(false);
      }
    },
    [data, editing, reportError, setEditing, slug, toast],
  );

  const unlinkSession = useCallback(
    async (session: SessionDto) => {
      try {
        const { sessions } = await api.unlinkSession(slug, session.id);
        for (const updated of sessions) {
          data.apply({ type: 'session.updated', entity: updated });
        }
        // Keep the form open on the now-unlinked session, so its own DTO is
        // fresh and the linked controls fall away.
        const mine = sessions.find((s) => s.id === session.id);
        if (mine) setEditing({ session: mine });
        toast.show('Unlinked from its series');
      } catch (err) {
        reportError(err);
      }
    },
    [data, reportError, setEditing, slug, toast],
  );

  const deleteSession = useCallback(
    async (session: SessionDto) => {
      const ok = await confirm({
        title: `Delete “${session.title}”?`,
        body: 'It moves to the bin, with its notes and questions. An organiser can put it back from Manage Event, under Trash.',
      });
      if (!ok) return;
      try {
        await api.deleteSession(slug, session.id);
        data.apply({ type: 'session.deleted', entity: { id: session.id } });
        setEditing(null);
        closeSession();
        toast.show('Session deleted');
      } catch (err) {
        reportError(err);
      }
    },
    [closeSession, confirm, data, reportError, setEditing, slug, toast],
  );

  const addContribution = useCallback(
    async (kind: ContributionKind, body: string, url?: string) => {
      if (!selected) return;
      try {
        const created = await api.addContribution(slug, selected.id, {
          kind,
          body,
          url,
        });
        data.apply({ type: 'contribution.created', entity: created });
        toast.show('Added — everyone sees it live');
      } catch (err) {
        reportError(err);
      }
    },
    [data, reportError, selected, slug, toast],
  );

  const removeContribution = useCallback(
    async (id: number) => {
      if (!selected) return;
      try {
        await api.deleteContribution(slug, id);
        data.apply({
          type: 'contribution.deleted',
          entity: { id, sessionId: selected.id },
        });
      } catch (err) {
        reportError(err);
      }
    },
    [data, reportError, selected, slug],
  );

  const toggleHidden = useCallback(
    async (contribution: ContributionDto) => {
      try {
        const updated = await api.setContributionHidden(
          slug,
          contribution.id,
          !contribution.hidden,
        );
        data.apply({ type: 'contribution.hidden', entity: updated });
      } catch (err) {
        reportError(err);
      }
    },
    [data, reportError, slug],
  );

  return {
    saving,
    reportError,
    toggleStar,
    moveSession,
    saveSession,
    unlinkSession,
    deleteSession,
    addContribution,
    removeContribution,
    toggleHidden,
  };
}
