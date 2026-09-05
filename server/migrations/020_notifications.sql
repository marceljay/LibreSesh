-- Somewhere for a mention to land.
--
-- `sse.ts` already carries schedule changes to open tabs, and it is the right
-- transport and the wrong storage: a notification has to survive a closed tab,
-- which an in-process broker cannot promise. So the table is the truth and the
-- broker is only the nudge.
--
-- The recipient is an **identity**, not a name. Names are per event and change
-- (`event_identities.display_name`), and an identity merge rewrites authorship
-- (`mergePeople.ts`) — pointing at the identity is what lets a notification
-- follow a person through both instead of being orphaned by a rename.
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  identity_id INTEGER NOT NULL REFERENCES identities(id),
  -- What happened, from the recipient's side: 'mention', 'session_moved',
  -- 'session_cancelled', 'starred_moved', 'starred_cancelled',
  -- 'pitch_scheduled', 'pitch_posted'. Kept as text rather than a lookup
  -- table: the set is small, named in code, and a row is read far more often
  -- than the set changes.
  kind TEXT NOT NULL,
  -- What it is about, so the panel can link to it and a dangling one can be
  -- swept. Not a foreign key: the target table depends on the kind, and a
  -- notification must outlive a soft-deleted row long enough to be pruned.
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  -- Frozen at write time. A mention's line must still read correctly after the
  -- comment is edited or the session renamed, and re-deriving it on read would
  -- mean joining four tables per row for text that never changes.
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- Who caused it, for "Ada mentioned you". NULL when nobody did — a prune, or
  -- an automated move.
  actor_id INTEGER REFERENCES identities(id),
  created_at TEXT NOT NULL,
  read_at TEXT
);

-- The panel's only query: this person's, in this event, newest first. Unread
-- counting rides the same index.
CREATE INDEX idx_notifications_inbox
  ON notifications (identity_id, event_id, created_at DESC);

-- Pruning sweeps by age across every event at once, so it wants its own.
CREATE INDEX idx_notifications_created ON notifications (created_at);

-- A merge rewrites identity_id in bulk; this keeps that from scanning.
CREATE INDEX idx_notifications_actor ON notifications (actor_id);

-- Which kinds a person wants, per event, one row per kind they have turned
-- **off**. Absence means on, so the table stays empty for everyone who never
-- opens Settings, and a kind added later is on by default without a backfill.
CREATE TABLE notification_mutes (
  event_id INTEGER NOT NULL REFERENCES events(id),
  identity_id INTEGER NOT NULL REFERENCES identities(id),
  kind TEXT NOT NULL,
  muted_at TEXT NOT NULL,
  PRIMARY KEY (event_id, identity_id, kind)
);
