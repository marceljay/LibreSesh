-- What the thing was called when the row was written.
--
-- The name beside each line was looked up when the page was read, so renaming
-- an event rewrote its whole history: every earlier line, the creation
-- included, said the new name, as though it had always been called that. The
-- rows said what happened; they no longer said to what.
--
-- The writer now stores the name at the time, and the reader shows it. The
-- rename line itself carries the new name, with the old one in `changes`
-- (migration 029), so the sequence reads: created "Old", edited "Old",
-- renamed to "New", edited "New". Links and the live/trashed state are still
-- looked up at read time — those are about where the thing is now.
--
-- Backfilled with the current names, which is all that is known about rows
-- written before this: the best guess, and from here on a frozen one, so the
-- next rename leaves these lines as they are.
ALTER TABLE audit ADD COLUMN label TEXT;

UPDATE audit SET label = (SELECT substr(name, 1, 80) FROM events WHERE id = audit.entity_id)
  WHERE entity = 'event' AND label IS NULL;
UPDATE audit SET label = (SELECT substr(title, 1, 80) FROM sessions WHERE id = audit.entity_id)
  WHERE entity = 'session' AND label IS NULL;
UPDATE audit SET label = (SELECT substr(name, 1, 80) FROM rooms WHERE id = audit.entity_id)
  WHERE entity = 'room' AND label IS NULL;
UPDATE audit SET label = (SELECT substr(name, 1, 80) FROM tags WHERE id = audit.entity_id)
  WHERE entity = 'tag' AND label IS NULL;
UPDATE audit SET label = (SELECT substr(name, 1, 80) FROM tracks WHERE id = audit.entity_id)
  WHERE entity = 'track' AND label IS NULL;
UPDATE audit SET label = (SELECT substr(name, 1, 80) FROM session_formats WHERE id = audit.entity_id)
  WHERE entity = 'format' AND label IS NULL;
UPDATE audit SET label = (SELECT substr(name, 1, 80) FROM people WHERE id = audit.entity_id)
  WHERE entity = 'person' AND label IS NULL;
UPDATE audit SET label = (SELECT substr(title, 1, 80) FROM proposals WHERE id = audit.entity_id)
  WHERE entity = 'proposal' AND label IS NULL;
UPDATE audit SET label = (SELECT substr(body, 1, 80) FROM contributions WHERE id = audit.entity_id)
  WHERE entity = 'contribution' AND label IS NULL;
