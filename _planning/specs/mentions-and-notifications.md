# Mentioning a person, and somewhere for a mention to land

**Status:** first cut in progress (2026-09-04). Clickable authors and `@username`
links ship now; notifications are the second half and are **not** built yet.

## Why

Nothing in the app addresses anyone. A name in a comment, a description, a pitch
or a bio is plain text, so the way to tell a co-host their room moved is to find
them in the hallway. Two halves, and the second is the larger: **resolving**
`@name`, and **delivering** a resolved mention somewhere it survives a closed tab.

## What resolution can lean on

- Display names (usernames) are **unique per event** — migration 009 on
  `event_identities.display_name`. So `@ada` means exactly one person inside one
  event and nothing outside it: no global user table, no disambiguation.
- `people` rows are per event (migration 010), addressed at `/e/:slug/p/:personId`.
  A speaker link already uses this shape (`SessionDetail.tsx`).
- A contribution's `createdByName` **is** that username (both come from
  `event_identities.display_name`), so an author resolves to a person by username
  with no new field on the DTO.
- The client already holds the whole directory: `bundle.people` carries
  `{ id, name, username }` for everyone in the event.

## First cut (this change) — link only, no delivery

Scope is **comments** (contributions), because that is where people talk to each
other and the body renders as React text rather than through the markdown HTML
pipeline, so rendering a `<Link>` is clean.

1. **The author's name is a link.** `createdByName` becomes a link to that
   person's profile when a `people` row matches it by username; otherwise it stays
   plain text (an author whose name fell back to a UID has no profile to point at).
2. **`@username` in a comment body is a link.** A shared, pure tokenizer
   (`shared/mentions.ts`) splits the body into text and mention segments; the
   component renders each mention as a `<Link>` to the profile.

### Mention grammar

`@` immediately followed by a known username, where:

- the `@` sits at a boundary — start of string or after a non-word character — so
  `a@b.com` is an email, not a mention;
- matching is **case-insensitive longest-match** against the set of usernames in
  the event, so multi-word usernames ("Ada Lovelace", allowed — a username is
  `trimmed(40)`) resolve, and `@ann` does not steal the front of `@anna`;
- the match must end on a word boundary; an `@` that resolves to nothing is left
  as literal text.

Resolution is by **username only** in this cut. Unclaimed profiles (name, no
username) and full-name aliases are deferred — they matter for delivery, not for
a link.

## Second half (next) — delivery

Not built. When it lands it changes where the parse lives.

- **Parse moves to the server, once.** Today the client tokenizes for rendering.
  A notification needs the server to know who was mentioned, so the parse becomes
  a server step over the shared tokenizer (`shared/mentions.ts` is written to be
  callable from both), feeding both the stored mention and the rendered link, so
  a mention in a bio and one in a description cannot disagree about what parses.
- **A `notifications` table** — recipient, event, source, read-at. `sse.ts` is the
  right transport (in-process broker per event slug) and the wrong storage: a
  mention must survive a closed tab.
- **A header panel** with an unread count.
- **What else creates one** besides a mention: being added as a speaker, a starred
  session moving, a pitch of yours being scheduled.
- **Pruning**, with `pruneAudit` as the precedent for a table that would otherwise
  grow forever.
- **No mail.** Nothing leaves the app by email today; adding it changes what this
  project stores about people, and is out of scope for this feature.

### Two edges specific to this app (design before building delivery)

- **Merging.** Identities merge (`mergePeople.ts`) and profiles archive
  (migration 013), so a notification must follow a person through a merge the way
  authorship does — or an organiser tidying duplicates silently deletes someone's
  inbox.
- **Unclaimed profiles.** An organiser can type a speaker's name onto a session
  before that person arrives, so a mention can be addressed to a profile with no
  identity behind it. It should wait and be delivered on adoption (`adoptProfile`
  in `people.ts`), not be dropped for having nowhere to go.

## Later, once comments have it

The same shared tokenizer extends to session descriptions, bios and pitches —
those render through `renderMarkdown` (an HTML string), so wiring mentions there is
a separate, messier step (post-processing HTML) and waits until the comment path
has been used in anger.

## Username rules — an open decision

**Undecided as of 2026-09-04.** Prod already holds usernames with emoji, so any
rule has to reckon with names that exist, not just names we would allow. A
visual side-by-side of the options is at
`_planning/specs/username-mentions-decision.html` — decide from that.

### What a username is today

`displayNameSchema = trimmed(40)`: any non-empty string up to 40 characters.
Spaces, emoji, punctuation — all allowed. There is no separate "handle". The
mention target *is* this free-form name, resolved against the set of names the
event actually holds.

Emoji and spaces are **not** a problem for the tokenizer as built, because it
matches against the real directory, not a character class: `@🎉party` links if
"🎉party" is a real username, and `@Ada Lovelace` links if that exact name
exists (longest-match). The character class in `shared/mentions.ts` is only for
*boundaries* (is this the start of a word), never for defining what a name may
contain. So "allow emoji" and "resolve mentions" do not conflict.

### The case-sensitivity point, precisely (it is narrow)

This is **not** "restrict case but allow other special characters." It is one
question and nothing more: **may two names that differ only in capitalisation
both exist in one event?**

- Today: **yes.** The uniqueness index (`event_identities_name`) has no
  `COLLATE NOCASE`, so "Ada" and "ada" are two different, co-existing names.
- But the mention matcher is **case-insensitive**, so `@ada` matches *both*.
- Therefore, *if* both exist, `@ada` is ambiguous — it resolves to whichever
  row is found first.

Emoji, spaces and every other character are irrelevant to this; it is only about
letter-case collision. Two ways to make the two halves agree:

1. **Match case-sensitively** — `@ada` links only to "ada", never "Ada". No
   migration, nothing restricted, but a mention must be typed in exact case
   (awkward on a phone that auto-capitalises).
2. **Fold case for uniqueness** — add `COLLATE NOCASE` so "Ada" and "ada" cannot
   both be claimed; keep matching case-insensitive. Forgiving to type; a small
   migration; must check no live event already has a colliding pair.

Recommendation: **(2)**, because typing `@ada` and reaching Ada is the whole
point, and case-collision is a latent bug regardless of mentions. It restricts
nothing about emoji or symbols.

### The bigger question: free-form vs. a handle

- **A — Leave free-form (what shipped).** Names stay human; emoji prod names keep
  working; resolve against the directory. Weakness: a *freely typed* multi-word
  name is fragile (needs exact spelling), which an autocomplete later removes.
- **B — Add a restricted handle** beside the display name, mention by handle.
  Industry-standard and unambiguous to parse, but reintroduces the account/handle
  concept this app deliberately avoids, needs a migration, and an emoji-only name
  has no handle without deriving an ASCII one.
- **C — Structured mentions via an autocomplete picker.** No grammar change: the
  composer inserts a *resolved* mention, so whitespace/emoji never enter the
  parse. Best UX; depends on the composer work (after form-overhaul Phase 2) and
  pairs naturally with the server-side parse that delivery needs.

Recommendation: **A now, C later, skip B** — free-form respects both the app's
ethos and the emoji names already in prod; the autocomplete is the durable fix
for typed-name ambiguity and lands with notifications, not before.

## Cross-references

- Backlog pointer: `STATUS.md` → High Priority → "Mentioning a person…".
- The shared link-safety rule the same renderer already honours: `shared/links.ts`.
- Username decision, visual: `_planning/specs/username-mentions-decision.html`.
