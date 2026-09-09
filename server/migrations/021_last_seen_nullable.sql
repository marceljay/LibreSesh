-- "Last seen" must mean a visit, and an identity minted for a speaker code has
-- not made one.
--
-- `identities.last_seen_at` was NOT NULL, so every insert stamped it with the
-- current time — the gate's insert rightly, because a gate visit is a visit,
-- and `mintSpeakerCode`'s wrongly, because that row is created by the
-- organiser's request for a person who has never opened the app. The People
-- tab then showed "seen just now" beside a profile whose code was still in
-- the organiser's clipboard.
--
-- Nullable now. The identity middleware stamps the column on the first real
-- request that carries the cookie, as it always has, and a null renders as
-- the dash the list already had for a profile nobody holds. SQLite cannot drop
-- a NOT NULL constraint in place, so the column is rebuilt beside itself, the
-- way 004 and 009 moved columns.
ALTER TABLE identities ADD COLUMN last_seen_at_new TEXT;
UPDATE identities SET last_seen_at_new = last_seen_at;
ALTER TABLE identities DROP COLUMN last_seen_at;
ALTER TABLE identities RENAME COLUMN last_seen_at_new TO last_seen_at;

-- Repair what the old insert wrote: an identity that holds an unredeemed
-- speaker code and was never seen after the minute it was created has not
-- been here. One whose code was redeemed keeps its stamp — that was a visit.
UPDATE identities
   SET last_seen_at = NULL
 WHERE id IN (SELECT identity_id FROM link_codes WHERE person_id IS NOT NULL AND used_at IS NULL)
   AND substr(last_seen_at, 1, 16) = substr(created_at, 1, 16);
