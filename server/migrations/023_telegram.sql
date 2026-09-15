-- Announcing an event's schedule into a Telegram group.
--
-- The bot token is NOT here: it is an instance-level secret (TELEGRAM_BOT_TOKEN),
-- and a column is data that gets exported, cloned and backed up. What lives on
-- the event is the organiser's own choice — which group, how loud, how early —
-- because an organiser must be able to configure their own event without
-- touching the deployment.
--
-- `telegram_chat_id` is TEXT: a supergroup id is a large negative number
-- (-100…) that has no business being coerced through a JS number.
--
-- `telegram_bind_code` is how the group is discovered rather than typed. A
-- private group has no @name and its numeric id is not something an organiser
-- can look up, so they mint a code here and say `/bind <code>` in the group.
-- Single-use, short-lived, same shape as `link_codes`.
ALTER TABLE events ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE events ADD COLUMN telegram_topic_id INTEGER;
ALTER TABLE events ADD COLUMN telegram_triggers TEXT NOT NULL DEFAULT '["up_next"]';
ALTER TABLE events ADD COLUMN telegram_lead_min INTEGER NOT NULL DEFAULT 15;
ALTER TABLE events ADD COLUMN telegram_bind_code TEXT;
ALTER TABLE events ADD COLUMN telegram_bind_expires TEXT;

CREATE UNIQUE INDEX idx_events_telegram_bind_code
  ON events (telegram_bind_code)
  WHERE telegram_bind_code IS NOT NULL;
