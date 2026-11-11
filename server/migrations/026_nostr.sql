-- Publishing to Nostr (_planning/specs/nostr-publishing.md).
--
-- An event that turns this on gets its own signing key: the public half is
-- its identity on Nostr, the one followers add; the private half signs every
-- calendar event and note. Lose the private key and nothing already published
-- can be updated or retracted, leak it and someone else is the event for
-- good, so it is stored encrypted at rest (server/src/secretsAtRest.ts), never
-- exported or returned to a client, and the Publish tab offers an export the
-- organiser is told to keep.
--
-- nostr_published is the publish queue. A write that changes what a calendar
-- event would contain marks the row (touched_at every time, dirty_since only
-- the first time, so a burst of drag edits is published once and a burst
-- that never pauses still goes out within a minute); a loop builds the
-- current version, signs it and publishes it. Acceptance is tracked per
-- relay in `pending`, so a relay that refuses keeps its rows pending without
-- blocking the others. `deleted` rows are what a kind-5 deletion was sent
-- for; they stay so a restore can re-enter and a retract can be resent.
--
-- The opt-out columns are the author's choice about one item and travel with
-- an export; the key and settings columns do not.
ALTER TABLE events ADD COLUMN nostr_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN nostr_pubkey TEXT;
ALTER TABLE events ADD COLUMN nostr_seckey TEXT;
ALTER TABLE events ADD COLUMN nostr_relays TEXT;
ALTER TABLE events ADD COLUMN nostr_triggers TEXT NOT NULL
  DEFAULT '["placed","up_next","digest"]';
ALTER TABLE sessions ADD COLUMN nostr_optout INTEGER NOT NULL DEFAULT 0;
ALTER TABLE proposals ADD COLUMN nostr_optout INTEGER NOT NULL DEFAULT 0;

CREATE TABLE nostr_published (
  event_id      INTEGER NOT NULL REFERENCES events(id),
  entity        TEXT NOT NULL CHECK (entity IN ('session', 'calendar', 'profile')),
  entity_id     INTEGER NOT NULL,
  d_tag         TEXT NOT NULL,
  last_event_id TEXT,
  published_at  TEXT,
  dirty_since   TEXT,
  touched_at    TEXT,
  pending       TEXT NOT NULL DEFAULT '[]',
  deleted       INTEGER NOT NULL DEFAULT 0,
  tries         INTEGER NOT NULL DEFAULT 0,
  next_try      TEXT,
  last_error    TEXT,
  PRIMARY KEY (event_id, entity, entity_id)
);
CREATE INDEX nostr_published_due ON nostr_published (event_id, dirty_since, next_try);
