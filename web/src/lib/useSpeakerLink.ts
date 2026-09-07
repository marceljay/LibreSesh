import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { takeSpeakerLink } from './inviteLink';
import { useMe } from './useMe';

export type SpeakerLinkStatus =
  /** The page was not opened with a speaker link. */
  | 'none'
  /** It was, and `/me` has not answered yet — we cannot tell who this device is. */
  | 'waiting'
  /** This device already holds a role here; switching would abandon it, so ask. */
  | 'ask'
  | 'redeeming'
  /** The code did not match: revoked, mistyped, or the profile is gone. */
  | 'failed'
  /** The cookie now points at the speaker; the caller reloads. */
  | 'done';

/**
 * A speaker link (`/e/:slug#c=<phrase>`) signs the device that opens it in as
 * that speaker — the same adoption `POST /me/link` does for a typed phrase,
 * done for you on arrival.
 *
 * With one exception. Adoption swaps the identity cookie, so a device that
 * already holds a role in this event would be signed out of it: an organiser
 * who opens the link they just made to see it work would lose their organiser
 * cookie to the speaker's, silently. So a device that is *already somebody
 * here* is asked; a stranger, which is what a speaker's own phone is, is
 * simply let in.
 */
export function useSpeakerLink(slug: string, onRedeemed: () => void) {
  const { me, refresh } = useMe();
  // Read once per page load; `takeSpeakerLink` has already scrubbed the URL.
  const [phrase] = useState(() => takeSpeakerLink()?.phrase);
  const [status, setStatus] = useState<SpeakerLinkStatus>(phrase ? 'waiting' : 'none');
  // A redemption must not run twice — a phrase is a credential, and in dev
  // StrictMode mounts effects twice.
  const started = useRef(false);

  const redeem = useCallback(async () => {
    if (!phrase || started.current) return;
    started.current = true;
    setStatus('redeeming');
    try {
      await api.linkDevice(phrase);
      // The cookie has moved; the identity, its roles and its name come with it.
      await refresh();
      setStatus('done');
      onRedeemed();
    } catch {
      setStatus('failed');
    }
  }, [phrase, refresh, onRedeemed]);

  useEffect(() => {
    if (status !== 'waiting' || me === null) return;
    if (me.roles[slug]) setStatus('ask');
    else void redeem();
  }, [status, me, slug, redeem]);

  /** "Stay as I am": the link is dropped and the page carries on as it was. */
  const decline = useCallback(() => setStatus('none'), []);

  return { status, redeem, decline };
}
