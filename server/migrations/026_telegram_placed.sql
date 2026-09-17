-- Announcing a pitch as it lands on the grid.
--
-- `placed` is its own trigger and not a synonym for `added`, because the two
-- answer different questions. An organiser building a programme enters twenty
-- sessions in an afternoon and wants none of them announced; the same organiser
-- during the conference wants every pitch that reaches the grid to reach the
-- group, because a session placed at short notice is the one thing no printed
-- programme can carry. `_planning/specs/announcements.md` separates them for
-- exactly that reason.
--
-- Nothing is stored here: the trigger lives in the existing
-- `events.telegram_triggers` JSON set, and Medium gains it. This file exists to
-- move events already on Medium onto the new set, so a preset an organiser
-- chose keeps meaning what its label says.
UPDATE events
   SET telegram_triggers = '["digest","up_next","placed"]'
 WHERE telegram_triggers IN ('["digest","up_next"]', '["up_next","digest"]');

UPDATE events
   SET telegram_triggers = '["digest","up_next","placed","added","changed"]'
 WHERE telegram_triggers IN (
   '["digest","up_next","added","changed"]',
   '["up_next","digest","added","changed"]'
 );
