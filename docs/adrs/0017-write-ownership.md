---
status: accepted
date: 2026-10-07
---

# One writer for each part of the data

## Context and Problem Statement

The Admin API, the catalog sync, the gate and the OAuth server all write to one SQLite file. A sync writes data that comes from a plugin. Which writer may change what, so that plugin output never opens access and the audit log stays true?

## Decision Drivers

- A sync must never unlock an operation or open access.
- Only a signed-in user may change levels, and core must audit each change.
- The audit log must be append-only.
- Sandbox code and plugin children must not reach the database.

## Considered Options

- A fixed writer for each table and column, with the rules in the service layer.
- Any module writes what it needs, and a review checks it.

## Decision Outcome

Chosen option: "A fixed writer for each table and column". A review can check each write against one table, and plugin output reaches only the columns of the sync.

| Writer                       | Tables                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin API (signed-in user)   | `users`, `settings`, `oidc_config`, `plugin_repos`, `plugins`, `plugin_instances`, `operation_groups.{level, label}`, `operation_group_aliases`, `operations.{level_override, write_acknowledged, attestation_required}`, `pre_approval_rules`, `mcp_tokens`, `oauth_clients` (admin), `notifier_channels` |
| Catalog sync (plugin output) | `operations` (inserts, inferred fields, `stale`, `last_seen_at`, locked seeds, `sensitive_*`, acknowledgement resets), `pre_approval_rules.enabled` (off only), `operation_groups` (inserts at `ask`, `stale`), `registry_entries`, the sync columns of `plugin_instances`                                 |
| `guides.get` in `search`     | `guides` (ADR-0003)                                                                                                                                                                                                                                                                                        |
| Gate and approval service    | `pending_approvals`, `approval_links`, `pre_approval_hits`, `audit_log`                                                                                                                                                                                                                                    |
| OAuth server                 | `oauth_*`, `sessions` (kind `oauth_ui`)                                                                                                                                                                                                                                                                    |
| Nobody                       | `audit_log` rows are never changed or deleted through an API                                                                                                                                                                                                                                               |

**Rules that the service layer enforces.**

- Only a sync can set `locked`, from a plugin seed. The API cannot clear it. The API cannot change a classification at all.
- `PATCH` with level `write` on a locked operation returns 409.
- A pre-approval rule can never refer to a locked operation. `POST` and `PATCH` return 409. A sync that locks an operation disables its rules and audits this.
- An operation without a group row is not reachable (`group_missing`).
- A group can go to `write` only with the exact list of writes that it acknowledges. A list that is not current returns 409.
- Only the Admin API changes levels, and core audits each change. Only the approval page and allowed in-session approvals make approval decisions (ADR-0006).
- A user delete clears the user from `level_changed_by`, `acknowledged_by`, `pre_approval_rules.created_by`, `mcp_tokens.created_by` and decided `pending_approvals.owner_user_id`.
- A user delete refuses while a `pending` row of the user remains. It deletes the rules that the user owns, because an empty `owner_user_id` makes an admin rule.
- Each route that changes state writes a `config` audit event with the values before and after, with secrets redacted.
- Sandbox code and plugin children have no access to any of these tables.

### Consequences

- Good, because a plugin can only close access through a sync, never open it.
- Good, because the audit log is append-only, and housekeeping alone removes old rows.
- Bad, because each new column needs a writer in this table, and a review must check it.

The feature files `@id:catalog-access-on-sync`, `@id:pre-approval-rules`, `@id:user-deletion`, `@id:audit-log` and `@id:admin-api-basics` specify its behavior.
