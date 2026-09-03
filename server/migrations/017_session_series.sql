-- Linked sessions: a soft grouping that lets an edit offer to apply to the
-- rest, without ever forcing it.
--
-- Until now a repeat "expanded, it did not persist" (ARCHITECTURE §Sessions):
-- morning yoga placed five mornings was five rows that knew nothing about each
-- other, and keeping them in step meant editing each by hand. That default is
-- right for sessions that drift, so it stays the default — a linked session is
-- still an independent, draggable, last-write-wins row. `series_id` only powers
-- an opt-in "apply to the linked ones too" affordance and an "unlink this one"
-- escape. It is an opaque id, not a foreign key: there is no series table,
-- nothing to answer "does moving Tuesday move all of them?" — that question is
-- answered per edit, and its default answer is no.
--
-- NULL is every session that exists today: unlinked, untouched.
ALTER TABLE sessions ADD COLUMN series_id TEXT;
CREATE INDEX idx_sessions_series ON sessions(series_id);
