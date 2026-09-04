# Identity and access

LibreSesh has no user accounts. This page is the mechanism behind that
sentence. The threat model lives in [ARCHITECTURE.md](../ARCHITECTURE.md)
(start with **§What a cookie is, exactly**).

## What you are

Your identity is an anonymous browser cookie. You pick a **display name**
when you enter an event. That name is unique *inside that event*, not across
the instance — the same person can be "Ada" at one event and "A. Lovelace"
at another.

Opening the event on a second device: the menu behind your name mints a
short phrase; type it on the other device and it becomes you — same name,
role and starred agenda.

## Two kinds of password

One password belongs to the **server**. Three belong to each **event**.

- The **instance password** (`INSTANCE_ADMIN_PASSWORD`) is set by whoever
  deploys the instance and is shared by everyone allowed to create events on
  it. It gates exactly two things: creating an event, and cloning one you
  are not already an admin of. It grants nothing *inside* any event —
  holding it does not make you an organiser of anything.
- The **event passwords** — viewer, attendee and organiser — are chosen per
  event and handed out to the people coming. They decide what each person
  can do once they are in. All three must differ from each other: they are
  the only thing telling the roles apart, so two roles sharing one password
  would grant whichever is higher.

The three event password fields are optional when you create one: leave any
of them blank and a four-word phrase is generated for it and shown once, on
the confirmation screen. They are stored hashed, so that screen is the only
place they can ever be read.

Switching role means signing out and entering a different event password.

## Speaker is not a password

The fourth role, **speaker**, has no shared password. An organiser mints a
personal four-word phrase from a speaker's profile page. Typing it at any
gate signs that device in as the speaker, on as many devices as they like,
until the phrase is revoked.

An event can rename its middle role freely ("attendee", "participant",
"member"). Docs use the default.

## What this is not

- There is no site-wide username. A name is claimed per event.
- There is no email reset. Lose the cookie and the device phrase and you
  are a new person at that event; an organiser can merge you if needed
  (see [ARCHITECTURE.md](../ARCHITECTURE.md)).
- Schedules are never public. Viewing an event requires the viewer
  password.

Role capabilities: [using.md](using.md). Organiser tools:
[managing.md](managing.md).