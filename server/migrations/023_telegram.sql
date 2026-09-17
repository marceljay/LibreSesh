-- Announcing an event's schedule into a Telegram group.
--
-- What lives on the event is the organiser's own choice — which bot, which
-- group, how loud, how early — because an organiser must be able to set this
-- up without asking whoever deployed the instance. `TELEGRAM_BOT_TOKEN` is a
-- fallback for a single-tenant instance and nothing more.
--
-- `telegram_bot_token` IS A CREDENTIAL AT REST, IN PLAINTEXT, AND THE ONLY ONE
-- IN THIS DATABASE. Every other secret here is either hashed (event passwords,
-- link codes) or minted by us (identity tokens). A bot token has to be
-- replayed to Telegram on every call, so it cannot be hashed. The consequences
-- are enumerated in SECURITY.md: it is in every backup, it is readable by
-- anyone who can read the file, and it grants posting to every group its bot
-- is in. It is never returned to a client and never written to an export.
-- Encrypting it at rest is LIB-213.
--
-- `telegram_chat_id` is TEXT: a supergroup id is a large negative number that
-- has no business being coerced through a JS number.
--
-- `telegram_bind_code` is how the group is discovered rather than typed. A
-- private group has no @name and its numeric id is not something an organiser
-- can look up, so they mint a code here and send `/bind <code>` as a message
-- in the group. Single-use, short-lived, the same shape as `link_codes`.
ALTER TABLE events ADD COLUMN telegram_bot_token TEXT;
ALTER TABLE events ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE events ADD COLUMN telegram_topic_id INTEGER;
ALTER TABLE events ADD COLUMN telegram_triggers TEXT NOT NULL DEFAULT '["up_next"]';
ALTER TABLE events ADD COLUMN telegram_lead_min INTEGER NOT NULL DEFAULT 15;
ALTER TABLE events ADD COLUMN telegram_bind_code TEXT;
ALTER TABLE events ADD COLUMN telegram_bind_expires TEXT;

CREATE UNIQUE INDEX idx_events_telegram_bind_code
  ON events (telegram_bind_code)
  WHERE telegram_bind_code IS NOT NULL;
