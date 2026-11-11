# Planning

Working documents that are not the product: what was decided, what is planned,
what was examined. The living queue is [`../STATUS.md`](../STATUS.md); the
public record of what shipped is [`../CHANGELOG.md`](../CHANGELOG.md).

One folder per kind of document, and a file is named for what it is:

| Folder | Holds | File names |
| --- | --- | --- |
| `specs/` | What a feature is and why, written before it is built | `kebab-case.md`; a spec that carries a numbered decision keeps its number, `D3-security-hardening.md` |
| `plans/` | How a spec is built, with the decisions settled on the way | `YYYY-MM-DD-name.md`, dated when written |
| `reviews/` | Audits, briefings and reviews of something that already exists | `YYYY-MM-DD-name.md` or `.html` for a rendered page |
| `backlog/` | Queues split out of STATUS.md at the user's request, one line there pointing here | `topic.md` |
| `deps/` | Dependency audits, kept as the baseline a plan measured against | `what-when.json` |
| `tools/` | One-off scripts written for planning work, not for the app | as the script is called |
| `design/` | Mockups, screenshots and the landing-page draft; the approved mockup is `mockup.jsx` and is never imported | `what-it-shows.ext` |

The brand assets the app ships — logos, marks, the favicon — are not planning
and live in [`../assets/`](../assets/).

## Frontmatter

Every Markdown file here except this one opens with YAML frontmatter. The date
in a plan's or review's filename is the day it was written and nothing more;
the frontmatter says the rest.

```yaml
---
title: Nostr publishing
kind: spec # spec | plan | review | backlog
status: built # draft | active | built | final | superseded | retired
written: 2026-09-16 # the day the document was written
updated: 2026-10-02 # the last day its content changed
decisions: [D6, D7] # the numbered decisions this document carries
linear: [P-LIB-32] # the Linear projects or issues it is the spec or plan for
---
```

- `status` means: **draft**, written but not agreed; **active**, agreed and
  being built or partly built; **built**, shipped and in CHANGELOG; **final**,
  a review or audit, complete as written; **superseded**, replaced by another
  document, named in `superseded_by`; **retired**, dropped without a successor.
- `decisions` and `linear` are always lists, empty when there is nothing to
  list. A document lists only the decisions decided inside it or filed from it,
  not every one it mentions. Where a Linear project exists for the document,
  list the project (`P-LIB-32`) rather than every issue in it; list an issue
  (`LIB-106`) where the document is the plan for that issue alone.
- A spec that carries one numbered decision may keep the decision in its name,
  as `D3-security-hardening.md` does; a new file is named for its subject and
  carries the decision in `decisions`.
- `.html` files take no frontmatter; a rendered page is named for its date and
  subject like the Markdown beside it.
