# Publishing a session — a link that works without the gate

**Status:** designed, not built. No commit yet. Decision of 2026-09-02 recorded
below; open questions still to settle before implementation.

## The problem

Every read under `/api/e/:slug` sits behind `event.use(requireRole(db, 'viewer'))`
(`server/src/app.ts:69`), so today there is no way to show one session to someone
who has not been given a password. Sharing a session means sharing the event, and
the only link that exists — the invite QR — hands over a role, which is the
opposite of what "here is the talk I am giving" wants.

There is one precedent for reading before the gate, and it is worth copying the
shape of, not the substance: `calendarRoutes` is mounted _above_ the role check
(`app.ts:66`, route at `routes/agenda.ts:71`) and authenticates by
`identities.ics_token` in `?token=` instead of a cookie. It still refuses unless
that token's owner holds a role, so it is not public — a published session would
be the first genuinely unauthenticated read in the app, and the first place a
wrong decision leaks a real event.

## Decided 2026-09-02: the snapshot

Publishing copies the session into a table nothing else joins to, and the public
route reads only that table. Nothing private can leak by omission, because nothing
private is in there — which is the property worth paying for on the app's first
unauthenticated read.

The costs are known and accepted: a re-publish after every edit (an "update the
public copy" button, or a republish on save), and a second place a session's text
lives. The rejected alternative is kept below because it is the one to revisit if
the re-publish step turns out to annoy people more than the safety is worth.

### The two shapes that were on the table

- **Live, flagged (rejected):** a `published_at` on `sessions`, plus a route above
  the gate that reads the row now and strips what must not travel. Edits show up
  immediately; the stripping is a filter that has to stay correct as `SessionDto`
  grows.
- **Snapshot, copied (chosen):** publishing writes a frozen row into a table
  nothing else joins to — the "unprotected DB area" — and the public route reads
  only that table. Nothing private can leak by omission because nothing private is
  in there, at the cost of a re-publish after every edit and a second place a
  session's text lives.

## What must not travel — either way

Contributions are this app's comments — `ContributionDto` (`shared/types.ts:273`)
carries `kind` (`note` / `link` / `question`), a `body`, `createdBy`,
`createdByName` and a `hidden` flag — and none of them go on a public page. Nor do
stars, agendas, `createdBy` / `createdByName` on the session itself, or anything
about who is in the room.

Speakers are the exception a programme exists to show, but a `PersonRef` leads to a
profile carrying a bio, links and a claim state, so **decide what a public page
renders for a speaker** rather than linking to the profile page and finding out.
Anonymised contributions are a later question, not this one.

## Open questions to settle before building

- **Who may publish** — organiser only, or a speaker for their own session.
- **Unpublishing** — real revocation, or only a hidden link.
- **URL shape** — guessable (`/s/:id`) or a capability (a random token like the
  ics one).
- **What an unpublished-but-linked page says.**
- **Event visibility bounds it** — a session inside an archived event should not
  stay readable because a link was minted once.

## Cross-references

- Backlog pointer: `STATUS.md` → Medium Priority → "Publishing a session".
- The ics-token precedent for reading before the gate: `routes/agenda.ts:71`,
  mounted at `app.ts:66`.
