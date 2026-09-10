- **An instance now explains itself to AI agents.** Four documents, served by
  the running instance rather than kept in the repository, because the programs
  that need them arrive over HTTP with no checkout. They are four because the
  conventions that grew up around agent access answer different questions, and
  an agent tends to arrive knowing only one of the names: `/llms.txt` says what
  this site is, `/agents.md` is the operating manual, `/SKILL.md` is the same
  in the packaged-skill format, and `/api.md` is the full HTTP reference —
  every endpoint, every error code, the limits. Each links to the other three.
  Nothing new is exposed: this is the interface the web app has always used,
  written down.

  They lead with the three things that keep a program out of trouble — fetch a
  schedule in one request rather than crawling it, subscribe to changes rather
  than polling for them, keep your cookie — and they end with what a program
  should not do on a person's behalf. Reading a schedule for someone is what
  this is for; a pitch or a question appears under their name to a room of
  people who will answer it; and stars and interest are private signals the
  event uses to decide what gets a bigger room, so an agent manufacturing them
  corrupts the thing they are for. A test walks the server's routes and fails
  when one is missing from the reference.
