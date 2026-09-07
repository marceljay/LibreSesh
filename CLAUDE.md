# LibreSesh

A simple, open-source scheduling tool for (un)conferences.

Dev port: 3000
Commit policy: atomic — one commit per feature or improvement
Commit messages: subject + body. The body says what was wrong, why this is
the fix and not another, and what the diff cannot show. Exempt: typos,
formatting, version bumps.
The body never continues the subject line. It opens with its own sentence and
reads whole on its own — `git log --oneline`, GitHub's list view and every
blame pane show the subject with no body attached, so a body that grammatically
depends on it is a fragment everywhere the subject is read alone.
No `Claude-Session:` trailer, ever — the link is dead to anyone but the machine
that made it, and it does not belong in a public history. `Co-Authored-By:`
stays.
Testing policy: tests-with-features

## Commands

<!-- Fill in once the toolchain is chosen. -->

- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Test: `npm test`

## Architecture

See `ARCHITECTURE.md`. Read **§What a cookie is, exactly** before touching
anything to do with identity, sign-in or `COOKIE_SECRET` — it is the concept
the rest hangs off, and the one most easily got wrong. The threat model, the
accepted risks and every code or link the app hands out live in `SECURITY.md`;
a change to what a credential grants, how long it lives or how it is revoked
updates that file in the same commit.

## Releases and versions

The `release` skill owns anything that touches a version number — cutting a
release, bumping, tagging, dependency upgrades, merging dev into main. It fires
on its own; it does not wait to be asked. Its first rule is the one that has
been broken twice: `git fetch` before concluding anything about what has
shipped, because a released version is frozen and a stale ref cannot tell you
which those are.

## Current Status

See `STATUS.md` for current work and `CHANGELOG.md` for completed milestones.
