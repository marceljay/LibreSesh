-- Every slug an event has ever answered to, so renaming one does not break
-- the links already handed out.
--
-- The slug is an event's address: it is in the invite link taped to the door,
-- the QR code on the badge, the calendar feed somebody subscribed to, and the
-- bookmark in an attendee's phone. Until now it was also unchangeable, because
-- changing it would have broken all of them at once — so a typo, a rebrand or
-- a slug picked before the event had a name was permanent.
--
-- Nothing else in the database references an event by slug: every other table
-- joins on `event_id`, and a role is stored against `event_id` too. So a
-- rename moves one string, and this table is what keeps the old string
-- resolving to the same event afterwards. `getEventBySlug` falls back to it,
-- which means an old link does not merely redirect in the browser — the API,
-- the gate and the calendar feed all still answer to it.
--
-- PRIMARY KEY on `slug` because the whole point is that a slug names exactly
-- one event; that also makes the uniqueness check for a new event a lookup
-- across both tables, so nobody can claim a name that is still pointing
-- somewhere.
CREATE TABLE event_slugs (
  slug TEXT PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_event_slugs_event ON event_slugs(event_id);
