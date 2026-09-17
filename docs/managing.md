# Managing an event

**Manage Event** — the link beside your name, organisers only — is seven
tabs. The open tab lives in the URL as `?tab=`, so a link lands a
co-organiser on the same one.

| Tab | What it holds |
| --- | --- |
| Programme | Rooms, tracks and tags |
| People | Everyone who has joined, plus speaker and host profiles: who holds each, at what role, and whether their code is still unused |
| Permissions | Which roles may do what at this event |
| Settings | Name, address, dates, day bounds, passwords, audit retention, archive |
| Trash | Deleted sessions and contributions, with restore |
| Backup | The event as JSON — also how an event is run again — and the encrypted whole-instance download |
| Audit | Who created, edited, deleted or restored what, by name and UID |

Browser backups and the host-side ones: [deploy.md](deploy.md#backups).

## Audit log

The audit log records every write, plus failed password and device-phrase
attempts, and nobody can edit it — organisers included. It keeps the newest
1000 entries per event by default; past that the oldest are dropped as new
ones arrive. Settings changes the number, and 0 keeps everything. That is a
real trade rather than a detail: a low cap means someone making a great
many edits can push an earlier action off the end.

## When passwords are being guessed

Above the audit log you will sometimes find a line saying how many password
attempts failed in the last hour. It appears only when there have been more
than a handful, so a quiet event shows nothing.

Two things happen on their own. Anyone can get the password wrong five times
at no cost, which covers mistyping a four-word phrase; the sixth attempt waits
two minutes, the next five are free again, and the eleventh waits a quarter of
an hour. Entering it correctly clears the count, so somebody who mistypes and
then corrects it is never delayed. Attempts are counted per person, not per
network address, so people sharing one address do not share one allowance. If
a hundred people are typing the password at the same time from the same
network, one of them getting it wrong delays nobody but themselves.

If the event as a whole sees sixty failed attempts in an hour, coming from at
least ten different network addresses, it stops accepting new sign-ins for
fifteen minutes. Several addresses are required on purpose: one address
repeatedly failing is already waiting under the rule above, and should not be
able to block sign-ins for everyone else. Anyone who already has access is
unaffected: the schedule stays up and contributions still post. Only new
sign-ins are refused, and the audit log records it.

Both limits can be cleared, because they are blunt and you know things the
server does not. Changing any password in Settings clears them by itself,
which matters because that is the moment everyone holding the old password
has just failed. If the password was right all along and the failures were
your own attendees, the notice above the audit log has a button that forgets
the attempts and starts accepting sign-ins again. Either way nobody is signed
out: roles already granted are kept deliberately, so changing a password does
not remove anyone's access mid-event.

## Choosing passwords

Leave a password blank and one is generated: four random words, which is
stronger than anything worth typing and is the recommended answer. If you type
your own, the form says what that password is worth. The viewer password is
usually read aloud or shown on screen, so a short one is a fair trade. The
admin password changes the event and deserves more length. If you pick one of
the handful anybody would guess first, or the event's own name, the form says
so, and still lets you save it. The length is your decision, because only you
know how the password will be shared.

## Renaming an event

An event's address is its slug — `/e/valley-2026` — and Settings can
change it after the fact, for the typo, the rebrand, or the slug picked
before the event had a name. **The old address goes on working.** Every
slug an event has ever had keeps resolving to it, so the invite link on a
badge, a QR code taped to a door, a subscribed calendar feed and any
script written against the old name all still answer; the app moves the
address bar to the current slug when it notices.

Nobody is signed out and nothing is re-entered either — a role is held
against the event, not against its name, so organisers stay organisers and
starred agendas stay starred. Open browsers follow the rename without a
reload.

A slug that still redirects cannot be claimed by a new event or a JSON
import, so an old link can never be quietly re-pointed at
somebody else's event. Renames appear in the audit log under their own
word, *renamed*.

## Telegram

**Manage Event → Publish → Telegram.** The event announces itself into a
Telegram group: what is starting next, the day's programme each morning, and
sessions as they are added and moved.

Nothing runs on Telegram's side. A bot is not a program — it is an account with
a token, and the code that uses it runs inside LibreSesh. So there is nothing
to install and nothing to schedule.

**Make the bot.** In Telegram, message `@BotFather` and send `/newbot`. Pick a
name and a username; it hands you a token. Paste that into the **Bot** field.
It stays on the server and is never shown back to you — only its last four
characters, so you can tell which one is saved. Anyone holding the token can
post as that bot, so treat it like a password; `/revoke` in BotFather kills a
leaked one.

If whoever runs this instance has provided a bot, you can skip that and leave
the field empty. Your own bot is worth it for one reason: the group sees your
conference's name on the messages rather than the host's.

**Connect the group.** Add the bot to your Telegram group. Press **Generate a
code**: LibreSesh gives you a line like `/bind 4f2a9c1e07`. Send that line as
an ordinary message in the group, the way you would send anything else. The bot
recognises which group the message arrived from and connects it — which is why
you never have to look up a group id. The code works once and expires in
fifteen minutes.

**Send a test message** then proves the whole path. If the bot was never added,
or was removed, Telegram's own words come back verbatim.

To stop it: **Disconnect** here, or send `/unbind` in the group.

**Choose how loud it is.** A group is a conversation, and every announcement
pushes it up the screen.

| | Posts |
| --- | --- |
| Off | Nothing. The group stays connected |
| Light | One message before each start time |
| Medium | That, plus the whole day each morning |
| Heavy | That, plus a session as it is added, and when one moves |

Everything starting at the same time goes out in **one** message, however many
rooms that is: a busy slot is one notification, not five. **How early it says
it** sets how long before the start time that message goes out.

**The morning message** goes out at the time you set, on the venue's clock. It
is one line a session for the whole day — no speakers, no links to streams,
because it is read over breakfast to decide where to be. A day with nothing on
it says nothing. If the server is restarted more than an hour after that time,
that day's is skipped rather than arriving at lunchtime.

**Added and moved** are the Heavy-only pair. A session added inside the *how
early* window is announced as that slot rather than twice over, so a pitch
placed five minutes before it runs produces one message and not two. Moves are
held for up to a minute and go out together, so dragging a morning about is one
message rather than a dozen — and only sessions the group has already been told
about are mentioned, since announcing the move of a session nobody knew existed
would disclose it. Repeating a session across days announces nothing: one click
should not produce a fortnight of messages.

**Livestreams.** Off unless you turn it on. With it on, a session that carries
a stream gets that link in the announcement, under the speakers. Worth knowing
before you do: the session link in a message still asks for the event password,
and a stream address does not — anyone who can see the group, or anyone they
forward the message to, can watch.

**Example** shows exactly what these settings would post, drawn from your own
schedule. Use it — this is the one screen in LibreSesh whose effect you cannot
see from the screen, because it lands in somebody else's Telegram tomorrow.

**What never leaves.** Drafts, under any setting. Deleted sessions. Anything
from an archived event. Notes, questions and stars. The links in the messages
still ask for the event password — the messages themselves do not, so treat
connecting a group as publishing the programme to everyone in it.

## Nostr

**Manage Event → Publish → Nostr.** The event publishes its programme to
Nostr under a key of its own, so anyone with a Nostr client can follow it:
each session is a calendar entry that stays current as the schedule changes,
and short notes go out when a pitch is placed, a slot is about to start, or a
day begins.

**Read the list, then switch it on.** The switch sits behind a list of what
leaves this instance — titles, descriptions, times, rooms, speaker names,
livestream links, and for pitches the pitcher's name — and a tick. Everything
already written goes out too. Relays keep copies, and asking them to delete
something is a request they may ignore, which is why the list comes first.

**The identity.** Switching on makes the event a keypair. The public half is
the `npub` people follow; **Copy** it, or **Open on njump** to see it in a
browser. It belongs to the event, not to anyone in it, and it survives
switching publishing off and on. The private half stays on the server,
encrypted. **Export key** shows it once so you can keep a copy — if the
instance's secret ever changes, the key is gone with it, and nothing already
published can be updated or retracted. **Import key** replaces it with one you
made elsewhere; that makes the event a different identity, and followers of
the old one stop seeing it.

**Relays.** One address per line, `wss://…`, up to ten. A new event starts
with whatever list the instance provides. A relay added later receives the
whole programme. The **Delivery** table shows, per relay, what it has not
accepted yet and its latest refusal in its own words; **Send a test** asks
each relay now and shows what it said, without posting anything followers
would see.

**What it posts.** Six short notes, each a checkbox: a pitch placed on the
grid, a slot about to start, the day's programme each morning, a session
added, a session moved, a pitch made on the board. **Example** beside each
shows the note as it would read today, from your own schedule. The calendar
entries are kept current whatever is ticked.

**Opting a session out.** While publishing is on, the session and pitch forms
say so and carry a **Publish to Nostr** box, ticked by default. Its author or
an organiser can untick it; a published session then gets a deletion request
on the next pass, and no note names it or the pitch from then on.

**Switching off** stops updates and notes and removes nothing. **Retract
everything** asks every relay to delete every entry and the profile, then
switches off; switching on again publishes the programme afresh under the
same identity.

## Importing a schedule from JSON

`POST /api/events/import` builds a whole event — rooms, tracks, tags and a
full grid of sessions — from one JSON document. It is guarded by the
instance password, like creating an event by hand, because it makes an
event rather than editing one.

**[`/import`](/import)** is that route with a screen in front of it: paste
the document, check it, import. From a terminal:

```bash
# Rehearse first: this validates everything and writes nothing.
curl -X POST 'https://your-host/api/events/import?dryRun=1' \
  -H "X-Instance-Key: $INSTANCE_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' --data @schedule.json

# Then drop the ?dryRun=1 to keep it.
```

The document is written the way a schedule is printed — room names and
wall-clock times, no ids — so it can be typed by hand or transcribed from a
photo of a programme:

```json
{
  "event": {
    "name": "Photo Conf",
    "slug": "photoconf",
    "timezone": "Europe/Berlin",
    "startDate": "2026-06-01",
    "endDate": "2026-06-02"
  },
  "rooms": [{ "name": "Main hall", "capacity": 200 }, { "name": "Side room" }],
  "tracks": [{ "name": "Design" }],
  "sessions": [
    {
      "room": "Main hall",
      "track": "Design",
      "title": "Opening keynote",
      "speaker": "Ada Lovelace",
      "date": "2026-06-01",
      "start": "09:00",
      "end": "10:00"
    }
  ]
}
```

Rooms, tracks and tags are declared once and referred to by name — a
session naming one that was not declared is refused rather than invented —
and room order is column order. Everything lands in one transaction, so a
document that fails on its last row leaves nothing behind. Contradictions
are refused naming the row that caused them; a session outside the visible
hours or double-booked against another is imported and named in `warnings`
instead.

**[schedule-import.md](schedule-import.md)** is the full field reference,
the error and warning catalogue, and the photo-to-document workflow.
[`examples/schedule-import.example.json`](examples/schedule-import.example.json)
is a template to copy; the test suite dry-runs it, so it cannot go stale.

An event's own `export.json` is not written in this form — it is a record of
ids — but the importer reads one anyway: it is translated at the door and
imported as the programme it describes. Give it a new address — the **Address**
field on `/import` — since its own is taken; profiles,
pitches, contributions and star counts stay behind, and the first warning says
so. See [schedule-import.md §Importing an export](schedule-import.md#importing-an-export).

**To run an event again** — next year's edition, next month's meetup — there
is no copy button: on Backup, untick all four parts and download the frame
alone (settings, permissions, rooms, tracks with their hours, tags, formats and
breaks), then on `/import` give it a new **Address**, **Name** and dates.
Anything pinned to a date of the old edition — a one-day break, a track's
hours for one day — is left out and named by the check; a break that runs
every day comes along.
