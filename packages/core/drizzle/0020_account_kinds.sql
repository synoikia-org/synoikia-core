ALTER TABLE `users` ADD `kind` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `oidc_email` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_email_idx` ON `users` (lower("oidc_email"));--> statement-breakpoint
-- ADR-0025: an account with an OIDC identity is an SSO account. One that also had a password loses it, with its
-- authenticator app and recovery codes, so that a session alone can never add a way in. Audit first, then change.
INSERT INTO `audit_log` (`at`, `kind`, `decision`, `actor_kind`, `actor_id`, `detail`)
  SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER), 'auth', 'password_removed_sso_account', 'system', `id`,
    json_object('username', `username`, 'totpRemoved', json(CASE WHEN `totp_enabled` = 1 THEN 'true' ELSE 'false' END),
      'migration', '0020_account_kinds')
  FROM `users` WHERE `oidc_subject` IS NOT NULL AND `password_hash` IS NOT NULL;
--> statement-breakpoint
UPDATE `users` SET `kind` = 'sso', `password_hash` = NULL, `totp_secret_enc` = NULL, `totp_enabled` = 0,
    `totp_last_step` = NULL, `recovery_codes_hash` = NULL
  WHERE `oidc_subject` IS NOT NULL;
