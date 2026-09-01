-- A session can be given by more than one person.
--
-- `sessions.speaker_id` held exactly one, which is wrong for most of the
-- formats an unconference actually runs: a panel, a pair programming session,
-- a workshop with two facilitators, a talk and its translator. The single
-- column also quietly decided things beyond the label — `speaksFor` grants a
-- speaker the right to edit their own session, and a second name on the poster
-- had none of it.
--
-- The join table is now the source of truth, so the old column goes rather
-- than lingering as a second answer to the same question. `sessions.speaker`,
-- the free-text column from before profiles existed, stays exactly as it was:
-- it is a historical record and nothing reads it for display.
--
-- `sort_order` because the order is the billing: the first name is the one a
-- long list is truncated to, and "Ada and Grace" is not the same poster as
-- "Grace and Ada". The primary key stops the same person being added twice —
-- an ordinary UNIQUE would too, but the pair is the identity of the row.
CREATE TABLE session_speakers (
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, person_id)
);

-- "Which sessions does this person speak at?" is the person page's whole
-- question, and the merge tool's.
CREATE INDEX idx_session_speakers_person ON session_speakers(person_id);

INSERT INTO session_speakers (session_id, person_id, sort_order)
SELECT id, speaker_id, 0 FROM sessions WHERE speaker_id IS NOT NULL;

-- The index has to go first: SQLite refuses to drop a column an index names.
DROP INDEX idx_sessions_speaker;
ALTER TABLE sessions DROP COLUMN speaker_id;
