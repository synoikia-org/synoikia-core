ALTER TABLE `users` ADD `owner` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_owner_idx` ON `users` (`owner`) WHERE "users"."owner" = 1;--> statement-breakpoint
-- ADR-0025: the oldest local admin with a password becomes the primary owner; without one, the start-up admin makes it.
UPDATE `users` SET `owner` = 1 WHERE `id` = (SELECT `id` FROM `users` WHERE `kind` = 'local' AND `role_id` = 'admin'
  AND `password_hash` IS NOT NULL AND `disabled` = 0 ORDER BY `created_at`, `id` LIMIT 1);
--> statement-breakpoint
INSERT INTO `audit_log` (`at`, `kind`, `decision`, `actor_kind`, `actor_id`, `detail`)
  SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER), 'auth', 'owner_set', 'system', `id`,
    json_object('username', `username`, 'migration', '0021_primary_owner')
  FROM `users` WHERE `owner` = 1;
