# §10 Maintenance

The core scheduler keeps the catalog of each instance current. An in-process lock for each instance makes calls that start at the same time share one sync.

**When a sync runs.**

| Trigger                     | Rule                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each `search` and `execute` | If the catalog was never synced, or it came from another bundle version, the sync runs first and must succeed (see below).                                                  |
| Session start               | If `last_synced_at` is older than `syncMaxAge` (default 1 hour), or `getUpstreamVersion()` is not `upstream_version`, the sync runs before the first `search` or `execute`. |
| Open sessions               | Each 30 minutes, a fast version check. If the version changed, the sync runs before the next call.                                                                          |
| Each day                    | A sync for each instance, at a different time for each.                                                                                                                     |
| Admin                       | "Sync now", or `POST /api/instances/:id/sync`.                                                                                                                              |
| Plugin                      | The `catalogChanged` notification starts a sync after a short delay.                                                                                                        |

**Bundle version.** Core records on the instance the bundle version that the catalog came from (`catalog_plugin_version`). Core reads this version from the `manifest.json` of the bundle just before each fork (ADR-0014).

- If the version of the running child is not the recorded one, the sync must succeed first. This happens after an install, an update, or files copied by hand and a restart.
- Until the sync succeeds, the endpoint answers `PLUGIN_UNAVAILABLE`. It never serves a catalog of another bundle, with its locks and its `sensitiveResult`.
- The gate also checks this version for each call (ADR-0003).

**What a sync does.**

- Core maps the `plugin_group` of each operation through `operation_group_aliases`.
- Core creates missing groups at `ask`.
- Core marks groups without operations as `stale` and keeps their level, in case they come back.
- Core marks operations that are missing as `stale`. It never deletes them.
- New writes start without acknowledgement. At level `write` they ask until the admin acknowledges them (ADR-0004).
- `syncRegistry` runs with each sync and after `catalogChanged`. `resolveTargets` uses the live view of the plugin, so scope membership is as it is at the time of the call.

**Sync failure.**

- Core continues to serve the last catalog. It sets `last_sync_status = error` and sends `sync.failed`.
- "Sync now" answers `502 sync_failed` with the redacted reason that `last_sync_status` shows. A plugin that is not running or does not answer in time gives `503 plugin_unavailable`.
- An exception: a bundle version that is not the recorded one (see above).
- An instance without any synced catalog stays in `error`, and its endpoint returns 503.

Scenarios: [`@id:catalog-sync-schedule`](../../packages/core/features/maintenance/catalog-sync-schedule.feature), [`@id:catalog-sync`](../../packages/core/features/instances/catalog-sync.feature), [`@id:catalog-access-on-sync`](../../packages/core/features/access/catalog-access-on-sync.feature).

**Repository index refresh.** Each day (ADR-0013). It shows available updates and key changes. It never installs anything. Scenarios: [`@id:plugin-repositories`](../../packages/core/features/plugins/plugin-repositories.feature).

**Housekeeping** (each hour, idempotent):

- Delete `pre_approval_hits` older than the largest rule window.
- Delete expired sessions, OAuth codes, OAuth tokens and approval-page tokens.
- Delete decided approvals older than 7 days. The audit log keeps their record.
- Delete `audit_log` rows older than `audit.retentionDays`. The default is 90 days, and the minimum is 7. When the admin clears it, core keeps the audit log forever. Core audits a change to this setting and each purge.

Scenarios: [`@id:housekeeping`](../../packages/core/features/maintenance/housekeeping.feature).
