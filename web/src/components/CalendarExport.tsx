import { errorText } from '../lib/errorText';
import { Modal } from './Modal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { ControlShell, PrimaryButton, SecondaryButton, TextInput, useToast } from './ui';

/** Download a one-off .ics, or mint a personal subscription link for the feed
 *  that follows your starred agenda. */
export function CalendarExportModal({
  slug,
  starredCount,
  section,
  onClose,
}: {
  slug: string;
  starredCount: number;
  /** Which half the menu asked for. Both are always shown — they are two
   *  answers to the same question — but the one you picked is scrolled to. */
  section: 'download' | 'subscribe';
  onClose: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const downloadRef = useRef<HTMLDivElement>(null);
  const subscribeRef = useRef<HTMLDivElement>(null);
  const [subUrl, setSubUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const base = `/api/e/${encodeURIComponent(slug)}/calendar.ics`;

  // Both scopes are worth subscribing to: the whole programme, or only what
  // you starred. The token is the same either way.
  const subscribe = useCallback(
    async (mine: boolean) => {
      setLoading(true);
      try {
        const { token } = await api.calendarToken(slug);
        setSubUrl(
          `${window.location.origin}${base}?token=${encodeURIComponent(token)}${
            mine ? '&mine=1' : ''
          }`,
        );
      } catch (err) {
        toast.show(errorText(err, 'Could not create a subscription link'));
      } finally {
        setLoading(false);
      }
    },
    [base, slug, toast],
  );

  const copy = useCallback(async () => {
    if (!subUrl) return;
    try {
      // Rejects on insecure origins — fall back to a manual selection.
      await navigator.clipboard.writeText(subUrl);
      toast.show('Link copied');
    } catch {
      inputRef.current?.select();
      toast.show('Press Ctrl/Cmd+C to copy the selected link');
    }
  }, [subUrl, toast]);

  // The modal is short enough to show both halves at once on a desktop; on a
  // phone it is not, so the half the menu asked for is brought into view.
  useEffect(() => {
    const target = section === 'subscribe' ? subscribeRef : downloadRef;
    target.current?.scrollIntoView({ block: 'nearest' });
  }, [section]);

  return (
    <Modal title="Calendar" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div ref={downloadRef}>
          <p className="font-medium text-stone-800 dark:text-stone-200">Download</p>
          <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
            A one-off snapshot you can import into any calendar app.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={base}
              download
              className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
            >
              Whole schedule
            </a>
            {starredCount > 0 ? (
              <a
                href={`${base}?mine=1`}
                download
                className="rounded-lg border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-900 px-3 py-2 text-xs font-semibold text-stone-700 dark:text-stone-300 hover:border-stone-500 dark:hover:border-stone-400"
              >
                My agenda ({starredCount})
              </a>
            ) : (
              <span className="rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-3 py-2 text-xs font-semibold text-stone-400 dark:text-stone-500">
                My agenda — star some sessions first
              </span>
            )}
          </div>
        </div>

        <div ref={subscribeRef} className="border-t border-stone-200 dark:border-stone-700 pt-4">
          <p className="font-medium text-stone-800 dark:text-stone-200">Subscribe</p>
          <p className="mb-2 text-xs text-stone-500 dark:text-stone-400">
            A live link your calendar app refreshes on its own. It is personal to you — anyone who
            has it can read the schedule.
          </p>
          {subUrl ? (
            <div className="flex gap-2">
              <ControlShell className="flex-1">
                <TextInput
                  ref={inputRef}
                  readOnly
                  value={subUrl}
                  aria-label="Personal calendar subscription link"
                  onFocus={(e) => e.currentTarget.select()}
                />
              </ControlShell>
              <SecondaryButton className="shrink-0" onClick={() => void copy()}>
                Copy
              </SecondaryButton>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <PrimaryButton onClick={() => void subscribe(false)} disabled={loading}>
                {loading ? 'Creating…' : 'Link to the whole schedule'}
              </PrimaryButton>
              <SecondaryButton
                onClick={() => void subscribe(true)}
                disabled={loading || starredCount === 0}
              >
                Link to my agenda
              </SecondaryButton>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
