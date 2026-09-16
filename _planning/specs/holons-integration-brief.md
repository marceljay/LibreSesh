# LibreSesh and Holons — a short brief

**Date:** 2026-09-16. Written for people who know the two projects as users or
collaborators, not as developers. A longer, source-level review exists for
anyone who wants the evidence behind each statement.

**The question:** should LibreSesh be folded into Holons, or connected to it,
or left alone? And is what LibreSesh does even necessary, given that
unconference groups tend to trust each other?

**The answer in three sentences.** Connect them; do not merge them. Holons is
good at identity and at moving data between communities, and it is already
writing the rules for exchanging schedules with LibreSesh. LibreSesh is good at
running an event with a room full of people, and today Holons has no place to
put that without losing what makes it work.

## Contents

- [What each project is](#what-each-project-is)
- [What LibreSesh's permission model actually is](#what-libreseshs-permission-model-actually-is)
- [What we found in Holons](#what-we-found-in-holons)
- [Bad idea, or just a lot of work](#bad-idea-or-just-a-lot-of-work)
- [What the LibreSesh interface is worth](#what-the-libresesh-interface-is-worth)
- [Recommended path](#recommended-path)
- [Open questions](#open-questions)

## What each project is

**Holons** is a toolkit for self-organising communities: tasks, offers and
needs, a shared calendar, voting, a kiosk display, and bots for Telegram and
Discord. Every member has a cryptographic key, every record is signed with one,
and records are shared between communities over Nostr, an open relay network.
It is built to be local-first and decentralised: there is no central server
that owns the data.

**LibreSesh** is a scheduling tool for unconferences and similar events: rooms,
time slots, tracks, a pitch board where people propose sessions, stars to build
a personal agenda, and questions and notes attached to sessions. It runs as an
ordinary web application with a small server that holds the programme and
decides who may change it.

They overlap less than the word "calendar" suggests. The Holons calendar shows
what is happening in a community over a month. LibreSesh shows what is
happening in six rooms over three days, and lets a hundred people rearrange it
without breaking it. Holons has no rooms, tracks, pitch board or personal
agenda.

## What LibreSesh's permission model actually is

It is easy to read "four roles times ten capabilities" and imagine a
bureaucracy. In practice the model is a dial with two settings and a middle.

- **Completely flat.** Every participant is an admin. Anyone can add, move
  or delete anything. This is the right setting for a small group that
  trusts each other, and it is a one-line choice by the organiser.
- **Tiered.** Viewers get a password and can read the schedule, star
  sessions, register interest in pitches and post questions, but cannot
  touch the programme itself. Participants can add and edit their own
  sessions and pitches. Organisers can do everything, including moderating.
  This is the setting for an event where the link ends up on a lanyard or in
  a public chat.

The point is not the granularity. The point is that the choice exists, that a
server enforces it rather than politely asking each app to, and that when
something goes wrong there is an undo: deletions are soft and restorable, and
an audit trail records who changed what. Trust between people does not remove
the need for undo; a thumb on a phone screen is not malice, and it still moves
the session.

One more distinction matters for the rest of this brief. **How you sign in**
(email, Telegram membership, a Nostr key, an Ethereum wallet) is
authentication. **What you may then do** is authorization. LibreSesh can grow
any of those sign-in methods, and none of them changes the model above. The
question "who is an organiser here?" is answered by the event's settings, not
by how the person proved who they are.

## What we found in Holons

Read from the source on the branch the project is actively developing, as of
today.

**There is no write boundary.** A record in Holons is accepted if it is
correctly signed by *any* key, and when two records disagree, the newer one
wins, regardless of who wrote it. Keys are free to create. The relay that
carries the data does not require login. In plain terms: anyone who finds the
relay address can move any session, in any community, and every member's
screen will show the move. There is a dormant admin/member mechanism in the
code that would narrow this, but no running part of Holons switches it on.

**Voting inherits the same gap.** Votes are weighted by reputation, and the
count includes anyone who voted, member or not. With free keys, ten fresh
identities are ten yes votes.

**Identity is well designed, and partly custodial.** Members who join through
Telegram get a key derived on the server, which means the server can sign as
any of them. Members with their own keys are not affected. This is documented
openly by the Holons team; it is a deliberate stage, not a hidden flaw.

**The code is competent and moving fast.** The core is cleanly layered and
well tested. The web interface is much less tested, has several very large
components, and its responsiveness is handled screen by screen rather than as
a system. In the last three weeks the project removed its old database layer
entirely and rebuilt on Nostr; that is a lot of change for a codebase that
also runs live communities. Two small security bugs were found in passing and
should be reported to them.

**They are already writing the interop rules.** A draft document in their
repository names LibreSesh, Elinor and Holons as three apps that publish
schedules to the same relays, and asks LibreSesh for two small additions to
what it already publishes. It also states, candidly, that Holons itself does
not yet follow two of its own five rules.

## Bad idea, or just a lot of work

"Integrate LibreSesh into Holons" means one of three things, and they get
different answers.

**Move the data into Holons.** A bad idea, not just a big one. The programme
would sit on a substrate where anyone with a key can rewrite it, with no
viewer tier, no moderation, no undo and no audit trail. For a private
community that may be fine. An unconference programme is the one thing the
community will hand to strangers.

**Connect them over Nostr.** Neither bad nor large. LibreSesh already has a
specification for publishing its programme as standard calendar events. The
Holons draft asks for two extra tags on top. LibreSesh stays the place where
the schedule is edited; Holons shows it, by its own rule, as read-only.

**Put the LibreSesh interface in front of Holons data.** Technically
possible, because the LibreSesh interface talks to its server through one
narrow, well-defined door. But the two projects use different front-end
frameworks, so "port" means embedding, not copying. And an interface that
shows grey "you can't do this" buttons over data anyone can edit through the
back is a picture of a permission model, not one. This becomes worth doing
the day Holons has a write boundary, and not before.

## What the LibreSesh interface is worth

A lot, and the comparison is not with Holons. The alternatives an organiser
actually faces are tools like Pretalx, which are built for curated
conferences with a programme committee, and fight you when the programme is
being made by the room in real time. LibreSesh's schedule grid, pitch board,
personal agenda and questions-under-sessions are the product. The permission
dial and the undo are what let that product be handed to a room without
fear.

That value does not depend on which sign-in method is in front of it or which
network carries the data out. It would survive a Nostr login, a Telegram
login, or publishing to a Holons community. It would not survive losing the
server that enforces the dial.

## Recommended path

1. **Connect.** Build the Nostr publishing that is already specified, add the
   two tags the Holons draft asks for, and let a Holons community subscribe to
   an event's programme.
2. **Reply to their draft.** Confirm the two tags, and pass on the two small
   security findings. This is the cheapest possible act of good faith and
   settles whether there is appetite on their side.
3. **Offer sign-in with a Nostr key** as a later step. It is useful on its
   own and it makes a Holons member's identity and a LibreSesh identity the
   same thing, without changing who is allowed to do what.
4. **Keep the interface where it is** until Holons enforces membership on
   writes. Revisit then; the narrow door in LibreSesh's interface is what
   makes that possible later.

## Open questions

- Would Holons turn on the admin/member mechanism it already has, and extend
  it to say which members may write which kinds of record? That is the single
  change that would reopen the third path.
- Is the "everyone is admin" setting used often enough that a flat mode
  deserves a simpler name and a one-click switch in LibreSesh? It costs
  nothing to make the flat case feel flat.
- Which sign-in method matters most to the communities that would use both:
  Telegram group membership, email, or a Nostr key?
