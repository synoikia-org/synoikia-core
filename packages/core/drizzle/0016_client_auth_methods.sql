ALTER TABLE `plugin_instances` ADD `auth_methods` text;--> statement-breakpoint
-- The old auth modes become method lists, and nothing gains a method. External mode without Cloudflare Access
-- relied on the removed trusted header: it gets no method, so it refuses calls until an admin sets one.
CREATE TEMP TABLE `__client_auth_0016` AS
WITH `old` AS (
  SELECT (SELECT CASE WHEN json_valid(`value`) THEN `value` END FROM `settings` WHERE `key` = 'mcp') AS `v`
), `base` AS (
  SELECT
    coalesce(json_extract(`v`, '$.cfAccess.teamDomain'), '') != ''
      AND coalesce(json_extract(`v`, '$.cfAccess.aud'), '') != '' AS `cf`,
    CASE WHEN json_extract(`v`, '$.defaultAuthMode') IN ('external', 'bearer', 'oauth', 'bearer+oauth')
      THEN json_extract(`v`, '$.defaultAuthMode') ELSE 'bearer+oauth' END AS `d`
  FROM `old`
)
SELECT `cf`, `d`,
  `d` IN ('bearer', 'bearer+oauth') AS `d_bearer`,
  `d` IN ('oauth', 'bearer+oauth') AS `d_oauth`,
  `d` = 'external' AND `cf` AS `d_external`,
  `d` IN ('bearer', 'bearer+oauth')
    OR EXISTS (SELECT 1 FROM `plugin_instances` WHERE `auth_mode` IN ('bearer', 'bearer+oauth')) AS `g_bearer`,
  `d` IN ('oauth', 'bearer+oauth')
    OR EXISTS (SELECT 1 FROM `plugin_instances` WHERE `auth_mode` IN ('oauth', 'bearer+oauth')) AS `g_oauth`,
  `cf` AND (`d` = 'external' OR EXISTS (SELECT 1 FROM `plugin_instances` WHERE `auth_mode` = 'external')) AS `g_external`
FROM `base`;--> statement-breakpoint
UPDATE `plugin_instances` SET `auth_methods` = CASE `auth_mode`
  WHEN 'bearer' THEN '["bearer"]'
  WHEN 'oauth' THEN '["oauth"]'
  WHEN 'bearer+oauth' THEN '["bearer","oauth"]'
  WHEN 'external' THEN CASE WHEN (SELECT `cf` FROM `__client_auth_0016`) THEN '["external"]' ELSE '[]' END
  ELSE '[]' END
WHERE `auth_mode` IS NOT NULL;--> statement-breakpoint
-- An endpoint that inherited the old default keeps exactly its methods when the new global set is wider,
-- or when the old default gave it none.
UPDATE `plugin_instances` SET `auth_methods` = (
  SELECT CASE `d`
    WHEN 'bearer' THEN '["bearer"]'
    WHEN 'oauth' THEN '["oauth"]'
    WHEN 'bearer+oauth' THEN '["bearer","oauth"]'
    ELSE CASE WHEN `cf` THEN '["external"]' ELSE '[]' END END
  FROM `__client_auth_0016`)
WHERE `auth_mode` IS NULL AND (SELECT
    (`g_bearer` AND NOT `d_bearer`) OR (`g_oauth` AND NOT `d_oauth`) OR (`g_external` AND NOT `d_external`)
    OR NOT (`d_bearer` OR `d_oauth` OR `d_external`)
  FROM `__client_auth_0016`);--> statement-breakpoint
-- The global methods are the old default and every endpoint's own mode, together.
UPDATE `settings` SET `value` = json_set(
  json_remove(`value`, '$.defaultAuthMode', '$.trustedIdentityHeader'),
  '$.clientAuth', (SELECT json_object(
    'bearer', json(CASE WHEN `g_bearer` THEN 'true' ELSE 'false' END),
    'oauth', json(CASE WHEN `g_oauth` THEN 'true' ELSE 'false' END),
    'external', json(CASE WHEN `g_external` THEN 'true' ELSE 'false' END)) FROM `__client_auth_0016`),
  '$.external', json_object('provider', 'cloudflare'))
WHERE `key` = 'mcp' AND json_valid(`value`);--> statement-breakpoint
DROP TABLE `__client_auth_0016`;--> statement-breakpoint
ALTER TABLE `plugin_instances` DROP COLUMN `auth_mode`;
