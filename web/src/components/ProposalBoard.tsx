import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { BundleDto, ProposalDto } from '@shared/types';
import { dateRange } from '@shared/time';
import { readableInk } from '@shared/tagColors';
import { ApiError, api, type PlaceWrite, type ProposalWrite } from '../lib/api';
import { dayLabel, todayInZone } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import { useMe } from '../lib/useMe';
import { PlaceProposalModal } from './PlaceProposalModal';
import { ProposalModal } from './ProposalModal';
import { EmptyState, PrimaryButton, SecondaryButton, Spinner, useToast } from './ui';

type Status = 'loading' | 'gate' | 'error' | 'ready';

/** The unconference pitch board (SPEC §8). A self-contained page: it fetches
 *  the bundle itself and is reached at `/e/:slug/proposals`. */
export function ProposalBoard() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useMe();

  const [bundle, setBundle] = useState<BundleDto | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ proposal?: ProposalDto } | null>(null);
  const [placing, setPlacing] = useState<ProposalDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyInterest, setBusyInterest] = useState<number | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setBundle(await api.bundle(slug));
      setStatus('ready');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setStatus('gate');
      } else {
        setError((err as Error).message);
        setStatus('error');
      }
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const event = bundle?.event;
  const timezone = event?.timezone ?? 'UTC';

  const days = useMemo(
    () => (event ? dateRange(event.startDate, event.endDate) : []),
    [event],
  );
  const today = useMemo(() => (event ? todayInZone(timezone) : ''), [event, timezone]);
  const dayLabels = useMemo(
    () =>
      Object.fromEntries(
        days.map((d) => {
          const label = dayLabel(d, today);
          return [d, `${label.top} ${label.sub}`];
        }),
      ),
    [days, today],
  );

  // Popular pitches need a room first, so they sort to the top; placed ones no
  // longer compete for a slot and drop to the bottom.
  const sorted = useMemo(() => {
    if (!bundle) return [];
    return bundle.proposals.slice().sort((a, b) => {
      const aPlaced = a.placedSessionId !== null ? 1 : 0;
      const bPlaced = b.placedSessionId !== null ? 1 : 0;
      return aPlaced - bPlaced || b.interestCount - a.interestCount || a.id - b.id;
    });
  }, [bundle]);

  const patchProposal = useCallback(
    (next: ProposalDto) =>
      setBundle((prev) =>
        prev
          ? { ...prev, proposals: prev.proposals.map((p) => (p.id === next.id ? next : p)) }
          : prev,
      ),
    [],
  );

  const toggleInterest = useCallback(
    async (proposal: ProposalDto) => {
      if (busyInterest !== null) return;
      setBusyInterest(proposal.id);
      const want = !proposal.interested;
      // Optimistic — the count is a soft signal, not programme content.
      patchProposal({
        ...proposal,
        interested: want,
        interestCount: proposal.interestCount + (want ? 1 : -1),
      });
      try {
        if (want) await api.addProposalInterest(slug, proposal.id);
        else await api.removeProposalInterest(slug, proposal.id);
      } catch (err) {
        patchProposal(proposal);
        toast.show((err as Error).message);
      } finally {
        setBusyInterest(null);
      }
    },
    [busyInterest, patchProposal, slug, toast],
  );

  const saveProposal = useCallback(
    async (body: ProposalWrite) => {
      setSaving(true);
      try {
        if (editing?.proposal) {
          patchProposal(await api.updateProposal(slug, editing.proposal.id, body));
          toast.show('Pitch updated');
        } else {
          const created = await api.createProposal(slug, body);
          setBundle((prev) =>
            prev ? { ...prev, proposals: [...prev.proposals, created] } : prev,
          );
          toast.show('Pitch posted');
        }
        setEditing(null);
      } catch (err) {
        toast.show((err as Error).message);
      } finally {
        setSaving(false);
      }
    },
    [editing, patchProposal, slug, toast],
  );

  const withdrawProposal = useCallback(
    async (proposal: ProposalDto) => {
      if (!window.confirm(`Withdraw “${proposal.title}”?`)) return;
      try {
        await api.deleteProposal(slug, proposal.id);
        setBundle((prev) =>
          prev
            ? { ...prev, proposals: prev.proposals.filter((p) => p.id !== proposal.id) }
            : prev,
        );
        setEditing(null);
        toast.show('Pitch withdrawn');
      } catch (err) {
        toast.show((err as Error).message);
      }
    },
    [slug, toast],
  );

  const placeProposal = useCallback(
    async (body: PlaceWrite) => {
      if (!placing) return;
      setSaving(true);
      try {
        const { session } = await api.placeProposal(slug, placing.id, body);
        toast.show('Placed on the grid');
        navigate(`/e/${slug}/s/${session.id}`);
      } catch (err) {
        toast.show(
          err instanceof ApiError && err.code === 'overlap'
            ? 'That slot is already taken'
            : (err as Error).message,
        );
      } finally {
        setSaving(false);
      }
    },
    [navigate, placing, slug, toast],
  );

  if (status === 'loading') return <Spinner label="Loading pitches…" />;
  if (status === 'gate') {
    return (
      <EmptyState>
        You need this event&rsquo;s password.{' '}
        <Link to={`/e/${slug}`} className="underline">
          Go to the schedule
        </Link>
      </EmptyState>
    );
  }
  if (status === 'error' || !bundle || !event) {
    return (
      <EmptyState>
        {error ?? 'Could not load this event.'}
        <div className="mt-3">
          <Link to={`/e/${slug}`} className="underline">
            Back to the schedule
          </Link>
        </div>
      </EmptyState>
    );
  }

  const role = bundle.role;
  const canPitch = role !== 'viewer' && !event.archived;
  const mayManage = (proposal: ProposalDto): boolean =>
    !event.archived &&
    proposal.placedSessionId === null &&
    (role === 'admin' || proposal.createdBy === me?.id);

  return (
    <div className="min-h-screen bg-stone-100 dark:bg-stone-950 text-stone-900 dark:text-stone-100">
      <header className="border-b border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-900">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-4 py-4">
          <Link to={`/e/${slug}`} className="text-xs text-stone-500 dark:text-stone-400 underline">
            ← Schedule
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Proposal pool</h1>
          {canPitch && (
            <PrimaryButton className="ml-auto" onClick={() => setEditing({})}>
              Pitch a session
            </PrimaryButton>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">
          Sessions people want to run. Say you&rsquo;d come along, and organisers place the
          popular ones on the grid.
        </p>

        {sorted.length === 0 ? (
          <EmptyState>
            No pitches yet.{canPitch ? ' Be the first to pitch one.' : ''}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {sorted.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                slug={slug}
                tags={bundle.tags}
                interestBusy={busyInterest === proposal.id}
                canPlace={role === 'admin' && !event.archived}
                canManage={mayManage(proposal)}
                onToggleInterest={() => void toggleInterest(proposal)}
                onEdit={() => setEditing({ proposal })}
                onWithdraw={() => void withdrawProposal(proposal)}
                onPlace={() => setPlacing(proposal)}
              />
            ))}
          </ul>
        )}
      </main>

      {editing && (
        <ProposalModal
          proposal={editing.proposal}
          people={bundle.people}
          tags={bundle.tags}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={(body) => void saveProposal(body)}
          onDelete={
            editing.proposal ? () => void withdrawProposal(editing.proposal as ProposalDto) : undefined
          }
        />
      )}

      {placing && (
        <PlaceProposalModal
          proposal={placing}
          rooms={bundle.rooms}
          timezone={timezone}
          days={days}
          dayLabels={dayLabels}
          defaultDay={days.includes(today) ? today : (days[0] ?? '')}
          dayStartMin={event.dayStartMin}
          saving={saving}
          onCancel={() => setPlacing(null)}
          onPlace={(body) => void placeProposal(body)}
        />
      )}
    </div>
  );
}

interface ProposalCardProps {
  proposal: ProposalDto;
  slug: string;
  tags: BundleDto['tags'];
  interestBusy: boolean;
  canPlace: boolean;
  canManage: boolean;
  onToggleInterest: () => void;
  onEdit: () => void;
  onWithdraw: () => void;
  onPlace: () => void;
}

function ProposalCard({
  proposal,
  slug,
  tags,
  interestBusy,
  canPlace,
  canManage,
  onToggleInterest,
  onEdit,
  onWithdraw,
  onPlace,
}: ProposalCardProps) {
  const placed = proposal.placedSessionId !== null;
  const description = useMemo(
    () => (proposal.description ? renderMarkdown(proposal.description) : ''),
    [proposal.description],
  );

  return (
    <li
      className={`rounded-xl border bg-white dark:bg-stone-900 p-4 shadow-sm ${
        placed
          ? 'border-stone-200 dark:border-stone-800 opacity-60'
          : 'border-stone-200 dark:border-stone-700'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-snug tracking-tight">{proposal.title}</h2>
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            {proposal.speaker ? `${proposal.speaker} · ` : ''}pitched by {proposal.createdByName}
          </p>
        </div>
        {!placed && (
          <button
            type="button"
            onClick={onToggleInterest}
            disabled={interestBusy}
            aria-pressed={proposal.interested}
            aria-label={
              proposal.interested ? "I'm no longer interested" : "I'd come to this"
            }
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              proposal.interested
                ? 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                : 'border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 text-stone-600 dark:text-stone-300 hover:border-stone-400 dark:hover:border-stone-500'
            }`}
          >
            {/* An up-arrow, not a star: a star means "on my agenda" on the
                schedule, and the same glyph here would read as the same act. */}
            <span aria-hidden="true">{proposal.interested ? '▲' : '△'}</span>
            {proposal.interestCount}
          </button>
        )}
      </div>

      {description && (
        <div
          className="prose-sm mt-2 text-sm leading-relaxed text-stone-700 dark:text-stone-300 [&_a]:text-blue-700 dark:[&_a]:text-blue-400 [&_a]:underline [&_code]:rounded [&_code]:bg-stone-100 dark:[&_code]:bg-stone-800 [&_code]:px-1 [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2"
          // Markdown is escaped before parsing, so no author markup survives.
          dangerouslySetInnerHTML={{ __html: description }}
        />
      )}

      {proposal.tagIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {proposal.tagIds.map((id) => {
            const tag = tags.find((t) => t.id === id);
            if (!tag) return null;
            return (
              <span
                key={id}
                className="rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ background: tag.color, color: readableInk(tag.color) }}
              >
                {tag.name}
              </span>
            );
          })}
        </div>
      )}

      {placed ? (
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          On the grid ·{' '}
          <Link
            to={`/e/${slug}/s/${proposal.placedSessionId}`}
            className="text-blue-700 dark:text-blue-400 underline"
          >
            view the session
          </Link>
        </p>
      ) : (
        (canPlace || canManage) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {canPlace && (
              <PrimaryButton className="py-1.5" onClick={onPlace}>
                Place on the grid
              </PrimaryButton>
            )}
            {canManage && (
              <>
                <SecondaryButton className="py-1.5" onClick={onEdit}>
                  Edit
                </SecondaryButton>
                <button
                  type="button"
                  onClick={onWithdraw}
                  className="rounded-lg border border-red-200 dark:border-red-900 px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  Withdraw
                </button>
              </>
            )}
          </div>
        )
      )}
    </li>
  );
}
