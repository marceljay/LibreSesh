# Using an event

Role capabilities, the filter bar, breaks, and sessions that hold the
floor. Identity and passwords: [identity.md](identity.md).

## Roles

The password typed at the gate is the role. **Speaker** is a personal
phrase, not a shared password.

**Most of what a role may do is per-event policy**, set from Manage Event →
Permissions. These ticks are the defaults, not the rules — an organiser can
move any of them, except the organiser column, which is locked on so that
an event nobody can moderate cannot be created by accident.

| Capability | viewer | attendee | speaker | organiser |
| --- | :---: | :---: | :---: | :---: |
| Star sessions, build a personal agenda | ✓ | ✓ | ✓ | ✓ |
| Edit your own speaker profile | ✓ | ✓ | ✓ | ✓ |
| Register interest in a pitch | ✓ | ✓ | ✓ | ✓ |
| Add notes, links and questions | | ✓ | ✓ | ✓ |
| Delete your own contributions | | ✓ | ✓ | ✓ |
| Create sessions in rooms that allow booking | | ✓ | ✓ | ✓ |
| Edit and delete your own sessions | | ✓ | ✓ | ✓ |
| Pitch a session to the proposal board | | ✓ | ✓ | ✓ |
| Hide anyone's contribution | | | | ✓ |

The rest is structural and not configurable, because it is how an event is
administered at all:

| Capability | viewer | attendee | speaker | organiser |
| --- | :---: | :---: | :---: | :---: |
| Read the schedule; export or subscribe to it | ✓ | ✓ | ✓ | ✓ |
| Set your display name for this event | ✓ | ✓ | ✓ | ✓ |
| Rewrite the words of a session you speak at | | | ✓ | ✓ |
| Official sessions — create, edit, move anywhere | | | | ✓ |
| Book against a session everyone should be at | | | ✓ | ✓ |
| Rooms, tags, tracks, people, merging duplicates | | | | ✓ |
| Place a pitch on the grid | | | | ✓ |
| Restore deleted items from the trash | | | | ✓ |
| Passwords, settings, permissions, archive | | | | ✓ |

Viewing an event requires the viewer password — schedules are never
public. Display names are unique within an event, so nobody can take an
organiser's.

## Filtering

The **Filter** button beside the search box narrows the grid: free text,
"now / next", your starred agenda, and a chip per room, track and tag.

Tracks include an **Unassigned** chip — the sessions nobody has put on a
strand yet, which is the pile an organiser goes looking for while a
programme is still being built, and which appears only while some session
has no track.

Chips of the same kind are an *or*: two rooms means either room. Every
filter lives in the query string, so a narrowed view is a link that opens
the same way for whoever you send it to.

## Breaks

An official session can be marked a *break* — lunch, dinner, coffee. It
leaves the room columns and is drawn greyed out across the whole schedule,
so nobody puts a session over it by accident. It blocks nothing: running a
session through lunch is allowed, and a break never counts as
double-booking the room it names. The room still records where it is. A
conference dinner can be both a break and something everyone should be at.

## Holding the floor

An organiser can mark an official session *everyone should be at this* — a
keynote, a closing plenary. While it runs, attendees cannot add a session
anywhere in the event, not even in a room that allows booking, and the
schedule shades the hour.

It is per session rather than a switch on the event, because most of what
an official session is at a real unconference is registration, coffee and a
track that runs all afternoon: a rule keyed on "an official session is
happening" would close the grid for the whole event.

Speakers and organisers can still place sessions against it, and the grid
badges those as **competing**. Sessions booked before the mark went on stay
exactly where they are.