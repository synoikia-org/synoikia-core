-- ADR-0004: a typed confirmation makes an operation locked. Lock the rows that a sync stored before this
-- rule, as a sync now would. First the audit row that tells the admin, then its rules turn off, then its own
-- level clears, so it starts closed.
INSERT INTO `audit_log` (`at`, `kind`, `instance_id`, `decision`, `actor_kind`, `detail`)
  SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER), 'config', o.`instance_id`, 'rules_disabled_operation_locked', 'system',
    json_object(
      'operations', json_group_array(o.`key`),
      'rulesDisabled', (SELECT count(*) FROM `pre_approval_rules` r JOIN `operations` x ON x.`id` = r.`operation_id`
        WHERE r.`enabled` = 1 AND x.`instance_id` = o.`instance_id` AND x.`typed_confirmation` = 1 AND x.`locked` = 0),
      'migration', '0019_typed_confirmation_locks')
  FROM `operations` o WHERE o.`typed_confirmation` = 1 AND o.`locked` = 0 GROUP BY o.`instance_id`;
--> statement-breakpoint
UPDATE `pre_approval_rules` SET `enabled` = 0, `updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE `enabled` = 1 AND `operation_id` IN (SELECT `id` FROM `operations` WHERE `typed_confirmation` = 1 AND `locked` = 0);
--> statement-breakpoint
UPDATE `operations` SET `locked` = 1, `classification` = 'write', `classification_source` = 'locked', `level_override` = NULL
  WHERE `typed_confirmation` = 1 AND `locked` = 0;
