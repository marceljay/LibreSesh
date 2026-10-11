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
