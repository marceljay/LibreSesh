- **Reads are no longer rate limited.** Every `GET` — the bundle, a session,
  the calendar feed, the audit list, the per-event export, the landing page's
  event list, `/me` and the login prefill — is now served without being
  metered, and the `read` token bucket is gone. It allowed 300 a minute per
  person and, since the address bucket became 100× the personal one, 30,000 a
  minute per address. Neither number defends anything: the limiter runs inside
  the process it would protect and is not a denial-of-service defence, so the
  only thing a read ceiling could do was refuse a real room — a hundred people
  on one conference wifi opening pages, with their agents reading alongside
  them. Writes, password attempts and identity minting are limited as before.
  `SECURITY.md`, `/api.md`, `/agents.md` and the agent skill say so.
