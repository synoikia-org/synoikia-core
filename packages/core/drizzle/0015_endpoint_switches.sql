ALTER TABLE `role_instances` ADD `can_set_own_levels` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `role_instances` ADD `can_manage_own_rules` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `role_instances` ADD `can_see_status` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `roles` ADD `can_see_other_endpoints` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Each endpoint of a role keeps the switches the role had before they moved to the endpoint.
UPDATE `role_instances` SET
  `can_set_own_levels` = (SELECT `can_set_own_levels` FROM `roles` WHERE `roles`.`id` = `role_instances`.`role_id`),
  `can_manage_own_rules` = (SELECT `can_manage_own_rules` FROM `roles` WHERE `roles`.`id` = `role_instances`.`role_id`),
  `can_see_status` = (SELECT `can_see_status` FROM `roles` WHERE `roles`.`id` = `role_instances`.`role_id`);--> statement-breakpoint
ALTER TABLE `roles` DROP COLUMN `can_set_own_levels`;--> statement-breakpoint
ALTER TABLE `roles` DROP COLUMN `can_manage_own_rules`;--> statement-breakpoint
ALTER TABLE `roles` DROP COLUMN `can_see_status`;