-- What a session's line in an announcement says, chosen by the organiser.
--
-- The message used to be whatever we decided it was — room, title, speakers,
-- a line per stream — and an organiser who wanted the session format in it, or
-- the room out of it, had no way to say so. This is the set of fields each line
-- carries. We keep the order and the punctuation, because those are a rendering
-- problem and not a choice anybody wants to make; the organiser keeps what
-- appears.
--
-- Default `["speakers"]`: the title and who is giving it, which is the line the
-- message was cut down to. Room is one tick away for anyone who wants it back.
--
-- `livestreams` becomes one of these rather than a column of its own
-- (migration 024), because it is the same kind of choice and two mechanisms for
-- one kind of choice is one too many. Its disclosure warning does not move —
-- it sits on that checkbox, where the person ticking it reads it. The backfill
-- below is what keeps an event that had already switched streams on from
-- silently losing them.
ALTER TABLE events ADD COLUMN telegram_fields TEXT NOT NULL DEFAULT '["speakers"]';

UPDATE events SET telegram_fields = '["speakers","livestreams"]' WHERE telegram_livestreams = 1;

ALTER TABLE events DROP COLUMN telegram_livestreams;
