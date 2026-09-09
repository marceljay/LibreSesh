import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { LoginHealthDto } from '../../../server/src/shared/types';

/**
 * What an organiser is told about people failing to get in (D3 §1c).
 *
 * A quiet event shows nothing at all — this is a notice, not a dashboard,
 * and an amber band that is always there stops being read. It appears when
 * the hour has held more than a handful of failures, or when the login
 * actually closed, which is the case an organiser has to know about because
 * it is the one where real arrivals are being turned away.
 *
 * Since the passwords an event uses are the organiser's own choice (D3 §1d),
 * this is how a weak one becomes visible: nothing refused it, so something
 * has to say when it is being hammered.
 */
const NOISE_FLOOR = 10;

export function LoginHealthNotice({ slug }: { slug: string }) {
  const [health, setHealth] = useState<LoginHealthDto | null>(null);

  useEffect(() => {
    let live = true;
    api
      .loginHealth(slug)
      .then((h) => {
        if (live) setHealth(h);
      })
      .catch(() => {
        // A notice that cannot load is not worth an error: the log below it
        // carries the same failures, line by line.
      });
    return () => {
      live = false;
    };
  }, [slug]);

  if (!health) return null;
  const closed = health.closedSecondsRemaining > 0;
  if (!closed && health.failuresLastHour <= NOISE_FLOOR) return null;

  return (
    <div
      className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
      role="status"
    >
      <p>
        <span className="font-medium">
          {health.failuresLastHour} failed password attempts in the last hour.
        </span>{' '}
        {closed
          ? `This event stopped letting new people in ${Math.ceil(health.closedSecondsRemaining / 60)} minutes from now at the latest — everyone already here is unaffected.`
          : 'Everyone already here is unaffected.'}
      </p>
      <p className="mt-1 text-xs">
        If this is not your own attendees mistyping, change the passwords in Settings. The attempts
        are in the log below.
      </p>
    </div>
  );
}
