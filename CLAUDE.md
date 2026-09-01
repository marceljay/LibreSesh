# LibreSesh

A simple, open-source scheduling tool for (un)conferences.

Dev port: 3000
Commit policy: atomic — one commit per feature or improvement
Commit messages: subject + body. The body says what was wrong, why this is
the fix and not another, and what the diff cannot show. Exempt: typos,
formatting, version bumps.
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
the rest hangs off, and the one most easily got wrong.

## Current Status

See `STATUS.md` for current work and `CHANGELOG.md` for completed milestones.
