# Finding things

**Status:** spec (2026-09-04). Phase 1 built; phases 2–4 are not.

Search today is free text over sessions, in two places that agree on what
"matches" means (`web/src/lib/search.ts`): the header's popdown, which shows the
best five and hands off, and `/e/:slug/search`, which shows every hit grouped by
day and is shareable because the query is the URL. Filters — room, tag, track,
★ my agenda, now/next, and a mini free-text box — live in the schedule's filter
panel and narrow **the day on screen**.

## Why

Two things are missing, and they are the same thing seen from two sides.

**A filter cannot leave the day.** "Show me everything tagged *design*" is a
question about the event, and the only way to ask it is to set the tag and then
walk the day strip, re-reading the same panel on each day. The one exception is
telling: a free-text query already reaches across days, via `otherDayMatches` at
the foot of the schedule — because that is the case that looked broken enough to
patch. Every other filter has the same problem and no patch.

**Search cannot find a person.** `@ada` resolves in a comment (see
[mentions-and-notifications.md](mentions-and-notifications.md)) and a speaker's
name on a session opens their profile, so the app knows who people are — but the
only way to reach a profile is to find something they are already on. Typing a
name into the search box searches the *billing* on sessions, which finds their
sessions and not them.

## The line: search finds things, filters narrow things

The two halves are told apart by one question — **does it have a page?**

- A **session** has a sheet and a page. A **person** has a profile. These are
  *things*: search finds them, and picking one goes there.
- A **tag**, a **room**, a **track**, ★, now/next are *lenses*. They do not have
  a page and there is nothing to open. They narrow a set of things.

So the header box finds sessions and people and nothing else, and every lens
stays in the filter panel. What the app was missing is not a third control but a
**surface where a lens applies to the whole event** — which is what the search
page already is for text, and now is for lenses too.

This is why a matching tag is *not* offered as a row in the header popdown
(decided 2026-09-04, with the alternative on the table): a tag row would be a
result you cannot open, in a list of results you can, and it would put a second
tag control in the app a few pixels from the first.

## What is searched

| Entity | Fields | Where it goes |
| --- | --- | --- |
| Session | title, speakers' billed names, description | the session sheet, on its day |
| Person | username, name, bio (page only) | `/e/:slug/p/:id` |

A person's **username** is what the room calls them and is unique per event
(migration 009), so it is an address in a way a name is not. A person's **name**
is what their sessions are billed as. A **bio** is about them in general rather
than about the programme, which is why it is worth searching and worth ranking
below everything else.

Not searched, deliberately: **room and track names** (lenses — the filter panel
names them all, and there are a dozen of them, not a thousand); **a session's
`createdByName`** (who posted it is provenance, not a way in — the billing is
the speaker list); **comment bodies** (a search that returns a sentence from a
thread needs a result row that is a comment, which is a third entity and a
larger change than this).

## The hierarchy of results

Two ranked lists and a merge rule, rather than one score across both types. A
single scale would have to promise that 45 points of username mean the same as
45 points of session title, and that promise is not keepable — every tweak to
one side silently reorders the other.

**Sessions** keep the existing `scoreSession`: per term, the best field wins
(title exact 60, title word-start 40, mid-word 24; speaker 30/18; description
8/5), terms are ANDed so typing more always narrows, and a title containing the
whole query takes +25. Ties break chronologically, because `rankSessions` sorts
stably and the callers hand it programme order.

**People** get `scorePerson`, the same shape:

| Field | Word-start | Mid-word |
| --- | --- | --- |
| username (exact) | 60 | — |
| username | 45 | 20 |
| name | 40 | 20 |
| bio | 6 | 4 |

A username word-start (45) sits above a session title word-start (40) on
purpose: a handle is typed to reach a person. A bio sits below a session
description (8/5) for the mirror reason — it is the least likely thing you meant.

**The merge**, in order:

1. **An exact hit, whatever it is.** A folded query equal to a session title or
   to a username is row one. Without this rule an attendee whose username is
   `design` would sit above the session actually called "Design".
2. **People who were named** — every term matched their username or name at a
   word boundary. At most 3 in the popdown, all of them on the page. If you
   typed someone's handle you are looking for the person, and their profile is
   where their sessions already are.
3. **Sessions**, by score.
4. **People matched only in a bio.** Page only, under their own heading. Never
   in the popdown: a row there that cannot say why it is there reads as a bug,
   and the popdown has no room to show the sentence that would explain it.

A person leading the results does **not** replace their sessions — those still
appear below, matched through the speaker field, because "what is Ada giving" and
"who is Ada" are both live readings of the same two letters.

### `@handle`

A query whose first character is `@` is a people query: strip the `@`, match
usernames only, and show sessions only if no username matches. Same grammar as a
mention, which is where people learn it — `@` is already how this app says "a
person, by handle".

## The two surfaces

**The header popdown** answers "where is that talk?" without disturbing the
grid. Up to 3 people, then up to 5 sessions, then the hand-off row. It writes
nothing to the URL — this is the one control in the app that does not.

**The search page** is everything that matched, and it is also the **advanced
search**: it carries the same filter vocabulary as the schedule, applied to the
whole event, and its URL is the shareable form of a question. There is no third
"Advanced" mode — that would be a second filter vocabulary a few pixels from the
first, which is the mistake this spec exists to avoid.

Sections on the page, in order: **People**, then **Sessions grouped by day** in
programme order, then **bio-only people**. Grouping by day rather than by rank is
deliberate: a result carries its place in the programme, so "three of these are
on Wednesday" is readable at a glance.

## Filters, event-wide

The filter panel is the same component on both surfaces, so there is one filter
UI in the app. Off the day scope, one filter changes meaning and the rest do not:

- **room, tag, track, ★ my agenda** — unchanged. They never had anything to do
  with the day; the day scope was imposed by the surface around them.
- **now / next** — on the schedule it can only mean *this minute of this day*,
  because the grid draws one day and `nowMin` is null unless that day is today.
  Event-wide it means **has not ended yet**, measured against the real instant in
  the event's timezone across dates. That is the more useful reading of the same
  words, and the only one that survives a fortnight-long event.
- **the free-text box** in the panel writes `q`, and `q` is what the search page
  searches. So the query you were narrowing the day with is the query you arrive
  with — the hand-off keeps your place in the question.

**Getting there:** a **Search everywhere** button in the filter panel, beside
Clear all. Because every filter already lives in the query string (SPEC §7.3) it
is a link, not a state transfer: keep `room`/`tag`/`track`/`mine`/`soon`/`q`,
drop `day`/`view`/`axis`, which are facts about the grid and mean nothing on a
page that has no grid.

Rejected: an **"All days" toggle on the schedule** that drops the day scope in
place. The calendar cannot span a fortnight, so the toggle would have to force
the list view and leave the day strip inert — one surface with two behaviours,
and a day strip that lies. The page already exists; it should grow.

## Build order

1. **Event-wide filters on the search page, and the hand-off.** No ranking
   change, so it lands on its own. Extracts the filter predicate the schedule
   already computes into a shared pure module, which is what makes "the same
   filters" true rather than approximately true. **Built.**
2. **People in search.** `scorePerson`, the merge rule, person rows in both
   surfaces, People section on the page.
3. **`@handle`.**
4. **Bio-only matches** in their own section on the page.

## What this does not change

Search stays **on the client**. The whole event bundle is already there, so a
round trip per keystroke would buy nothing and cost the popdown its speed. The
day that stops being true is the day an event outgrows the bundle — the same
threshold that governs everything else in `useEventData`, and a decision for
that change, not this one.
