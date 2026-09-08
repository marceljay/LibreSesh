# Permission integrity: prove the layer between predicate and pixel

**Written 2026-09-08** on `fix/matrix-gating`, after the composer bug: a
viewer granted `contribution.create` in the Permissions tab never got the
composer, because the page read the role's name and not the matrix. The fix
landed with a parity sweep (`tests/permissionParity.test.ts`, 54 cases) that
asks the page's predicate and the server the same question for every
capability, role and switch setting. This plan is what is still unproven
after that, and the order to prove it in.

## What is proven today

- Every capability switch, server side, for viewer, attendee and speaker,
  granted and withheld, through the real routes.
- Every client predicate agrees with the server for the same cases.
- Session edit, delete and move rules on both sides, including a credited
  speaker on an official session.
- One rendered case: the composer appears for a viewer once granted, and the
  password hint appears while withheld (jsdom, `tests/routes.test.tsx`).

## What is not

1. **Admin-only routes are not swept.** 35 routes carry `requireRole(admin)`
   or `adminWrite`. Many have a 403 case somewhere; nothing proves all do.
2. **Rendered controls are not swept.** The parity test checks predicates,
   not the DOM. Whether Star, Add session, Edit, Hide, Remove, Pitch and
   Register interest actually appear or vanish for each role and setting is
   covered by the one composer case and by reading.
3. **A role change does not reach an open page.** `PATCH /permissions`
   broadcasts `permissions.updated` and the page re-derives; `PUT
   /people/:id/role` broadcasts only `person.updated`, so the affected page
   keeps its old `bundle.role` until reload. A demoted attendee keeps buttons
   the server now refuses; a promoted one sees nothing new.

## Phases

Each phase is one commit with tests, ends with lint and the full suite
passing, and is independently mergeable.

### Phase 1 — sweep the admin-only routes

A table-driven test: enumerate the admin-guarded routes (the list in this
file, kept in the test as data, with a guard that fails when a new
`requireRole(admin)` route appears in `server/src/routes/` without an entry).
For each: viewer, attendee and speaker get 403; no cookie gets 401; an
organiser is not asserted (the existing feature tests own the happy path).
Bodies can be empty — the guard runs before validation, so 403 must arrive
before 400. Same shape as the parity test, same helpers.

Decision: keep the route list in the test rather than derived by parsing
source at test time. Parsing would pass silently on a route the regex missed;
a list plus a count check fails loudly.

### Phase 2 — sweep the rendered controls

A jsdom test that mounts the session page (schedule, detail sheet, full
page) and the pitch board as viewer, attendee and speaker, with each
capability granted and withheld, and asserts each control's presence by
accessible name: the star, Add session, Edit session, Delete, Hide, Remove,
Pitch a session, the interest button, the composer, Edit profile. Built on
`tests/routes.test.tsx`'s harness (real server through the fetch shim,
`console.error` fails the test).

Scope is the matrix-governed controls only. Fixed admin-only chrome (Manage
Event, Arrange, place a pitch) is gated by role on both sides and stays out.

Decision: assert by accessible name, not by test ids, so the sweep also
catches a control that renders but is unnamed.

### Phase 3 — push role changes live

`PUT /people/:id/role` publishes a per-identity event (`publishTo`, as the
notification ping already does) carrying the new role; the client applies it
to `bundle.role` and re-derives. A demotion below viewer closes the stream
and shows the gate. Test: server publishes on role change; client reducer
applies it; a jsdom case where an organiser changes a viewer's role and the
viewer's open page gains or loses the controls without a reload.

Decision: per-identity, not event-wide. A role is a fact about one person;
broadcasting it to the room would tell everyone who was promoted.

### Phase 4 — optional: new switches

Only after 1–3, and only those the user picks from the backlog item "Finer
permissions" (STATUS.md). Each is one line in `capabilities.ts`, a server
check, a client predicate, and rows in the parity and DOM sweeps. Nothing
else should need touching, which is the point of phases 1–3.

## Not doing

- Switches on rooms, tags, settings, trash, roles: administering an event is
  fixed admin work; the matrix's own comment says so.
- Playwright coverage of the same matrix: jsdom sees presence and absence;
  the browser pass exists for layout and input, not for permission logic.
