# Forms in LibreSesh — briefing for evaluation

A short map of how forms are built in this app, for an agent evaluating them.
Written 2026-09-03 against `dev` (`ee4f6dd`). Line references are to that commit.

## Stack

- **React 18 + TypeScript**, Vite, React Router 6. No SSR, no meta-framework.
- **No form library.** No react-hook-form, Formik, TanStack Form, or anything
  like it. Every form is `useState` per field plus a hand-written submit.
- **Tailwind 3** for all styling. No component library; the design system is
  ~15 exported primitives in `web/src/components/ui.tsx`.
- **`@floating-ui/react`** for popovers/menus (`components/Popover.tsx`), used
  by comboboxes and dropdowns that sit inside forms.
- **Zod 3 — server only.** `server/src/validation.ts` holds every schema; the
  web bundle never imports zod. Client-side checks are hand-rolled.
- Not actually a PWA in the installable sense: no web manifest and no service
  worker (`web/index.html` links only icons). Treat "PWA" as "mobile-first SPA".

## The primitives (`web/src/components/ui.tsx`)

| Export | What it is |
| --- | --- |
| `inputClass` | The one input skin. Applied by hand at every call site. |
| `Field` | Label + optional hint + `children`. Takes an optional `htmlFor`. |
| `FormStack` / `FormRow` / `FormGrid` | Spacing and alignment only. |
| `FieldGroup` | A titled run of fields inside a long form. |
| `NumberField` | The only self-validating field (see `lib/numberField.ts`). |
| `Modal` | Portal dialog; with `onSubmit` it renders a real `<form>`. |
| `FormError` | The red box for a rejected save. |
| `Toggle`, `ColorPicker`, `Chip`, `PrimaryButton`/`SecondaryButton`/`DangerButton` | Controls and actions. |
| `useToast`, `useConfirm` | Async confirm dialog; transient success/failure messages. |

`Field` deliberately carries no margin (spacing belongs to the parent) and
`FormRow` bottom-aligns while `FormGrid` top-aligns — both decisions are
documented in-file with the bug that motivated them.

## The house pattern

1. One `useState` per field, seeded from the entity or a default.
2. A `save()`/`submit()` that validates in sequence, `setError(...)` and
   `return`s on the first failure, then calls `api.*`.
3. `lib/api.ts` throws `ApiError` carrying the server's machine code
   (`stale`, `overlap`, `name_taken`, `rate_limited`, …).
4. The caller either renders `<FormError>` inline or calls `toast.show(...)`.
5. Success applies an optimistic change frame via `useEventData.apply(...)`,
   and SSE broadcasts the same change to everyone else.

Validation is therefore **duplicated by design**: zod on the server is the
authority, and the client repeats the rules it can express so the message
arrives before the round trip. `SessionModal.tsx:213-252` is the canonical
example — seven ordered checks, each with a written sentence, before `onSave`.

## Stated design philosophy

Legible from the comments, and fairly consistently held:

- **Errors go where the action was**, not to the top of a scrolled form.
  `FormError` sits in the modal footer beside the button you just pressed;
  `ProfilePage`'s `FieldForm` puts it under the control with your text intact.
- **Messages are sentences, not codes.** "A session runs between 5 minutes and
  8 hours, in 5-minute steps", not "invalid duration".
- **A field you have not filled in yet is not a field you got wrong** —
  `NumberField` withholds its error until there is something to be wrong about
  (`ui.tsx:129-131`).
- **Empty states are the field**, with the button that fills it on the same
  line (`ProfilePage.tsx:706-714`).
- **One question per control.** Session `format` deliberately carries no
  duration because "a format that retimes the session makes one field answer
  two questions".
- **Comments carry the rejected alternative.** Nearly every primitive says what
  it replaced and why. This is the strongest convention in the codebase.

## Where principles are mixed

This is the part most worth evaluating. All verified in the tree:

1. **Three different form shells.**
   - *Modal-as-form*: `Modal onSubmit` → real `<form>`, Enter submits
     (`SessionModal`, `ProposalModal`, `MergeModal`, `PlaceProposalModal`).
   - *Field-at-a-time*: `ProfilePage` opens one field, each with its own Save,
     Cancel, error and request (`ProfilePage.tsx:640-760`).
   - *Loose controls in a Section*: `AdminPage`, `AdminRooms`, `AdminBreaks`,
     `Gate`, `NewEventPage`, `ImportPage` — inputs and a button, no `<form>`.
2. **Enter-to-submit is hand-rolled 14 times** (`e.key === 'Enter'`) across
   10 files, for the forms that are not real `<form>`s. Behaviour therefore
   varies: some fields submit on Enter, neighbouring ones do not.
3. **Labels are mostly not associated with their controls.** `Field` supports
   `htmlFor`, there are 96 `<Field>` call sites, and the only one that passes it
   is `NumberField` (`ui.tsx:138`). `Field` renders `<label>` as a *sibling* of
   `children`, so there is no implicit association either. Clicking a label does
   nothing; screen readers get the placeholder or nothing.
4. **`aria-invalid` / `role="alert"` on the field appear only in `NumberField`.**
   Every other field signals failure with a red border or a message elsewhere.
5. **Native form semantics are barely used.** `required` appears once
   (`Gate.tsx:220`); no `type="email"`, no `pattern`, no constraint validation.
6. **Autofill hints are inconsistent.** `AdminBackup` uses `autoComplete`
   correctly; the event password field at the gate (`Gate.tsx:355`) has none and
   is not in a `<form>`, so password managers will not reliably fill or save it.
7. **Failure is a toast in some places and inline in others.** `AdminPage` funnels
   everything through `const fail = (err) => toast.show(err.message)`
   (`AdminPage.tsx:543`) while modals render `FormError`. Same class of failure,
   two very different levels of persistence.
8. **Create affordances differ per entity.** Rooms, tracks, tags and formats each
   get an always-open "New …" row; sessions get a modal; people get a permanently
   open "Expect someone" field (`AdminPage.tsx:1699-1716`). Already filed as
   backlog work under `STATUS.md` → Backlog → Medium → **Forms**.
9. **Optimistic concurrency exists on the server and no form uses it.** The
   session write accepts an optional `expectedUpdatedAt`
   (`server/src/validation.ts:347`) and `assertNotStale` rejects with code
   `stale` (`server/src/sessionRules.ts:337-343`). It is optional, and nothing
   in `web/src` sends it or handles the code — so two organisers editing one
   session silently last-write-wins, on a mechanism already built to stop it.

## Where to look first

| Concern | File |
| --- | --- |
| Primitives and their rationale | `web/src/components/ui.tsx` |
| Longest, most complex form | `web/src/components/SessionModal.tsx` |
| The field-at-a-time pattern | `web/src/pages/ProfilePage.tsx` (600-760) |
| Loose-controls pattern, many instances | `web/src/pages/AdminPage.tsx` |
| Unauthenticated entry form | `web/src/components/Gate.tsx` |
| Numeric input and why not `type="number"` | `web/src/lib/numberField.ts` |
| Server-side truth | `server/src/validation.ts` |
| Error transport | `web/src/lib/api.ts` (1-80) |

## Testing note

There is no DOM testing in the suite (no jsdom, no Testing Library). Form
behaviour is pinned two ways: pure logic extracted to `web/src/lib/*` and unit
tested (`numberField`, `people`, `repeat`), and **source-text assertions** that
read the `.tsx` file and assert on strings (`tests/roleTag.test.ts`,
`tests/confirmDialog.test.ts`, `tests/peopleColumns.test.ts`). An evaluator
proposing form refactors should expect to update those string assertions, and
should know that no test actually renders or submits a form.
