# Linked sessions

Status: spec, approved 2026-09-03. Supersedes the "a repeat expands, it does
not persist" stance in ARCHITECTURE.md §Sessions — see *Reconciliation* below.

## What and why

A recurring session today (morning yoga, a daily standup, a plenary) is placed
one row per day, and those rows know nothing about each other. Editing the name,
room or description means editing every day by hand. Attendees feel this most:
someone offering yoga every morning uses `session.create_open` once per day and
then has no way to keep the five copies in step.

A **linked session** is a soft grouping — a shared `series_id` — that lets an
edit *offer* to apply to the rest. It never forces anything. Each row stays an
independent, draggable, last-write-wins session; the link only powers an opt-in
"apply to the linked ones too" affordance and an "unlink this one" escape.

Naming: the UI never says "series" (implies calendar recurrence). It says
**"Link"**, **"linked sessions"**, **"Apply to linked sessions"**,
**"Unlink this one"**. `series_id` is the internal column name only.

## Reconciliation with the existing decision

ARCHITECTURE.md §Sessions says a repeat "expands, it does not persist… a series
entity would have to answer *does moving Tuesday move all of them?* on the first
edit, and for an event whose sessions drift the answer is 'no' nearly every
time." Linked sessions do not reverse that; they answer the question the other
way round:

- The default on every edit stays **this session only**. Drift is handled
  per-row exactly as today.
- Propagation is **opt-in, per edit**, and **content only — never time**.
  Moving Tuesday never moves the rest unless you ask, and even then time is not
  a propagated field.

So the objection ("no, nearly every time") becomes the *default*, and the link
is just the occasional yes.

## Membership

A **candidate** for linking is any session in the same event with the **same
normalised title** where the actor is **the creator (`created_by`) or a speaker**
(`session_speakers`, the `speaksFor` check the PATCH route already uses). Title
normalisation: trim, collapse internal whitespace, case-insensitive.

Matching by name+identity only *populates the candidate list*. It never
auto-links: two same-named sessions that are really different things stay
separate because the actor simply does not tick them.

## Security invariant

**Linking and propagation never grant new edit rights.** They only batch edits
the actor could already make one at a time.

- To link a session into a series, the actor must be able to mutate it
  (`assertMayMutate`) — i.e. own it or speak at it.
- A propagated edit re-checks `assertMayMutate` on every target before touching
  it. Targets the actor may not edit are **skipped and reported**
  ("applied to 4 of 5; one wasn't yours to change"), not refused wholesale.

This is why no new capability is needed: attendee vs organiser reach falls out
of the existing per-session permission model.

## Entry points

1. **Link existing** (attendees and organisers). On a session, *"Link matching
   sessions…"* opens the candidate list — each a checkbox, plus **select all**.
   Confirming the subset stamps a shared `series_id`. Primary flow.
2. **Keep linked on Repeat** (organisers, programme-building). The existing
   Repeat control gains a *"Keep these linked"* checkbox, **default off** (so
   today's fire-and-forget stays the default). When on, `POST /sessions/repeat`
   mints one `series_id` and stamps every occurrence.

## Editing a linked session

- Default: **this session only** (unchanged, per-row last-write-wins).
- When `series_id` is set and siblings exist, the save dialog offers a scope:
  **This only** / **This and later** / **All in the series**. Default the
  propagate action to *This and later* ("from now on").
- **Propagated fields (v1): content only** — title, description, speakers, room,
  track, format, type, tags, livestreams. **Not** `starts_at`/`ends_at`:
  propagating an absolute instant across different days is meaningless, and
  wall-clock time-of-day propagation needs the per-day timezone resolution in
  `shared/repeat.ts`. That is a deliberate fast-follow, out of v1.
- Each affected row emits one `session.updated` broadcast + one audit row, as
  `POST /sessions/repeat` already does per created row.

## Unlinking

- *"Unlink this one"* sets `series_id = NULL` on that row only.
- When unlinking leaves a single remaining member, clear its `series_id` too — a
  series of one is just a session.

## Data model

- Migration 017: `ALTER TABLE sessions ADD COLUMN series_id TEXT` (nullable
  opaque id), plus `CREATE INDEX idx_sessions_series ON sessions(series_id)`.
  `NULL` = today's behaviour, untouched.
- `series_id` surfaces on the session DTO so the form knows whether to show the
  link affordances and how many siblings there are.

## Export / import

- Export includes `series_id` so a round-trip preserves links. Import-side id
  remapping is future, consistent with the existing "nothing reads an export
  back" note.

## Build order (atomic commits)

1. `feat(sessions): add series_id column and surface it on the DTO` — migration
   017, mappers/DTO read path, no behaviour yet.
2. `feat(sessions): link and unlink endpoints` — candidate query + `POST
   /sessions/link` / `POST /sessions/unlink`, security invariant, tests.
3. `feat(sessions): propagate content edits across a link` — PATCH scope param,
   skip-and-report, tests.
4. `feat(sessions): keep-linked option on repeat` — mint series_id in
   `/sessions/repeat`, tests.
5. `feat(ui): link/unlink and propagation controls in the session form`.
6. `docs: rewrite ARCHITECTURE §Sessions repeat stance; changelog`.

## Open / deferred

- Time-of-day propagation (tz-aware) — fast-follow after v1.
- Import-side `series_id` remapping.
