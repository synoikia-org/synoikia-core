---
status: accepted
date: 2026-10-07
---

# Secrets at rest under one master key

## Context and Problem Statement

Core stores upstream credentials, TOTP secrets, the OIDC client secret and notification secrets. A database file can leave the server in a backup. How does core keep these secrets, and what can the Admin API return?

## Decision Drivers

- A copy of the database alone must not give a secret.
- A secret copied to another row must not decrypt there.
- The API must never return a secret, and a changed upstream address must not get the stored credentials.

## Considered Options

- AES-256-GCM for each value with a master key outside the database, and an API that only writes secrets.
- The database file encrypted as a whole.
- Secrets in plain text, with file permissions.

## Decision Outcome

Chosen option: "AES-256-GCM for each value with a master key outside the database". Each value is bound to its row, and the API writes secrets but never reads them back.

**Master key.**

- `MASTER_KEY` (32 bytes, base64) comes from the environment.
- If it is not set, core reads or creates `DATA_DIR/master.key` (mode 0600) at the first start. Core logs a warning: move the key out of the data volume.

**Encryption.**

- AES-256-GCM with a random 96-bit nonce for each value. The stored value is `v1 ‖ nonce ‖ ciphertext ‖ tag`.
- The associated data is `table:column:row-id`, so a value copied to another row does not decrypt.
- **Encrypted columns:** `plugin_instances.secrets_enc` (all `writeOnly` connection fields), `users.totp_secret_enc`, `oidc_config.client_secret_enc` and `notifier_channels.secrets_enc`.

**Derived keys.** HKDF makes these keys from the master key: the attestation HMAC key, the signed-state key (MFA and consent forms), and the session-id pepper. Approval-link tokens are random and stored as SHA-256 hashes. They need no key.

**Secrets in the Admin API.**

- The API never returns a decrypted secret. `GET` returns `{ set: true, hint: "…ab12" }` for each secret field.
- `PUT` with a secret field replaces it. If the field is not in the request, core keeps the old value.
- **Exception:** the request changes where the upstream is. This is a non-secret field with a `uri`, `hostname` or IP format, or with a name like `url`, `host`, `server`, `endpoint` or `address`.
- Core then does not use the stored secrets, for a save and for "Test connection". The request must give them again (`400 secrets_required`). A changed URL thus never gets the stored key.
- Stored secrets that the current master key cannot decrypt give `409 secrets_unreadable` for `GET`, `PUT` and "Test connection". A request that gives each secret field, with a value or `null`, replaces them.
- A notification channel works the same way: its test and a save without each secret field give `409 secrets_unreadable`.
- The channel list marks the channel with `secretsUnreadable`, and a notification to it fails with that reason as its last error.

**Key rotation.** `node dist/cli.js rotate-master-key` changes the master key.

- The server must be stopped, because it keeps the old key in memory. A running server holds `DATA_DIR/server.lock` with its pid and host.
- The command first decrypts all encrypted columns, then encrypts them again in one transaction. A wrong current key changes nothing.
- The command deletes all sessions, because their pepper comes from the master key.

### Consequences

- Good, because a database copy without the master key gives no secret, and a secret is bound to its row.
- Good, because the API cannot leak a secret, and a new upstream address must bring its own credentials.
- Bad, because a master key in the data volume protects nothing against a copy of that volume. Core warns about it.
- Bad, because a lost master key loses every secret. The admin must enter them again.

The feature files `@id:secrets` and `@id:master-key-rotation` specify its behavior.
