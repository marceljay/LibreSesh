-- The line an organiser actually writes, rather than a set of parts we join.
--
-- Migration 027 made the parts of a session's line tickable and arrangeable,
-- which covers "show the format" and "drop the room" and does not cover
-- "Annnoooounciiiiiing: <title>". A fixed set of parts in a chosen order is
-- still our sentence with their words in it. This is their sentence.
--
-- `telegram_fields` goes, rather than sitting beside this: the template says
-- everything the field set said, and two ways to describe one line is one too
-- many. 027 reached a review branch and no release, so nothing in the wild is
-- losing a setting — the default below is exactly what its default rendered.
--
-- The language is deliberately two things. `{name}` is a value. `[...]` is a
-- part that disappears when everything inside it is empty, which is what stops
-- "Title, by " on a session with no speakers — the one failure a plain
-- placeholder string cannot avoid. Everything else is literal text, escaped, so
-- a stray `<` is a `<` and never markup.
ALTER TABLE events ADD COLUMN telegram_template TEXT NOT NULL
  DEFAULT '{title}[, by {speakers}]';

UPDATE events
   SET telegram_template = '{room} · {title}[, by {speakers}]'
 WHERE telegram_fields LIKE '%"room"%';

ALTER TABLE events DROP COLUMN telegram_fields;
