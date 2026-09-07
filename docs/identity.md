# Identity and access

LibreSesh has no user accounts. This page is the mechanism behind that
sentence. The threat model, and what every code and link you can hand out
grants and for how long, is [SECURITY.md](../SECURITY.md); the mechanism is
**§What a cookie is, exactly** in [ARCHITECTURE.md](../ARCHITECTURE.md).

## What you are

Your identity is an anonymous browser cookie. You pick a **display name**
when you enter an event. That name is unique *inside that event*, not across
the instance — the same person can be "Ada" at one event and "A. Lovelace"
at another.

Opening the event on a second device: the menu behind your name mints a
short phrase; on the other device choose **I'm already here on another
device** at the gate and type it, and that device becomes you — same name,
role and starred agenda. The phrase works once and dies after ten minutes.

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
personal four-word phrase from a speaker's profile page, and gets it three
ways at once: the words, a link, and a QR of that link. Typing the words
under **I have a speaker code** at the gate, or opening the link, signs that
device in as the speaker — on as many devices as they like, until the phrase
is revoked. The link carries the code in the part of the address a browser
never sends to a server, and it is taken out of the address bar as the page
opens, so a link copied from the address bar afterwards does not carry it.

Whoever holds the words or the link *is* that speaker until an organiser
revokes the code. Revoking stops the code and the link; it does not sign out
devices that already used it — changing the person's role does that. Send
the code to the speaker and nobody else, and prefer sending the words with
the link: some mail systems rewrite links and lose the code, and the words
still work.

A device that is already in the event under another name — an organiser
opening a link to check it — is asked whether to switch before anything
changes.

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