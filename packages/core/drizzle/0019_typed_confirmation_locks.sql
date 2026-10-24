-- ADR-0004: a typed confirmation makes an operation locked. Lock the rows that a sync stored before this
-- rule, as a sync now would: its rules turn off first, then its own level clears, so it starts closed.
UPDATE `pre_approval_rules` SET `enabled` = 0, `updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE `enabled` = 1 AND `operation_id` IN (SELECT `id` FROM `operations` WHERE `typed_confirmation` = 1 AND `locked` = 0);
--> statement-breakpoint
UPDATE `operations` SET `locked` = 1, `classification` = 'write', `classification_source` = 'locked', `level_override` = NULL
  WHERE `typed_confirmation` = 1 AND `locked` = 0;
