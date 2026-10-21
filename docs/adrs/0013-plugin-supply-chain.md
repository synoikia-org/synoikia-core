---
status: accepted
date: 2026-10-17
---

# Plugins come from pinned repositories or an admin upload

## Context and Problem Statement

A plugin is code that runs next to core and gets the secrets of its instances. Plugins come from many authors. How does a plugin reach a server, and who checks what it is before it runs?

## Decision Drivers

- No plugin code may run without an admin action on one pinned version.
- A signed repository must prove that the publisher made the package, with a key that the admin pins.
- An archive must not write outside its directory, or exhaust the disk.
- A change to what a plugin can reach must need a new review.
- A developer must be able to try an unreleased build on a live server.

## Considered Options

- Plugin repositories with an index, a pinned minisign key or an unsigned warning, prebuilt packages only, and a review when the permissions change. An admin can also upload a file.
- Installs from npm, with `npm install` on the server.
- Automatic updates from a repository.

## Decision Outcome

Chosen option: "Plugin repositories with a pinned key, prebuilt packages and a review when the permissions change". Each install is one admin action on one version, and the server never builds code.

**Installation.** Core installs each plugin from a plugin repository, or from a file that an admin uploads, into `DATA_DIR/plugins/<id>/`. Only one version of a plugin is installed at a time. Core replaces it atomically.

**Default repository.** At the first start, core adds the Synoikia plugins repository ([synoikia-core-plugins](https://github.com/synoikia-org/synoikia-core-plugins)) as a signed repository.

- Its public key is pinned in core (`plugins/default-repo.ts`), so the admin does not confirm it. Core adds it once and records a `system` audit event.
- If an admin removes it, it stays removed. If its index cannot be fetched, core records the error on the repository. This is not fatal.

**Discovery.** At start, the plugin host scans `DATA_DIR/plugins`. For each directory it:

- validates `manifest.json` against the SDK schema and the `sdk` range (ADR-0011), and writes or updates a `plugins` row
- marks a plugin with a manifest or instructions file that is not valid as `invalid`, with an error message, and does not load it
- marks a plugin whose directory is missing as `invalid`, and keeps its instances and history

**Enabled flag.** A new plugin starts disabled, and the admin creates instances one by one. If the admin disables a plugin, core stops all its instances, and their endpoints return 503. Core keeps their configuration and history.

**Repositories.** The admin adds a repository by URL on the Plugins page. The URL points to an `index.json` with the plugins, their versions, and for each version its `url`, `sha256` and `signature`. `docs/reference.md` has an example.

- **Index refresh.** Core fetches the index when the admin adds the repository, on "Refresh", and each day. After a failed fetch, core tries again each hour. Core keeps the index in `plugin_repos.index_cache`.
- **No automatic updates.** The Plugins page shows the installed version and the available updates. Each install or update is an admin action on one pinned version.
- **Review on enable.** When the admin enables a plugin, they accept its binding, capabilities, sensitive keys and network hosts. If an update changes one of these, core disables the plugin again.
- Its endpoints then stop, and the audit event lists the changes. Other updates keep the enabled state.
- **Plugin id conflicts.** The `plugins` row records its `repo_id`, and only that repository can update the plugin. Another repository with the same id refuses to install it (`installed_from_elsewhere`) until the admin uninstalls it.
- **Adoption.** The first repository install of an id adopts a plugin that no repository manages. Core replaces the files, keeps the row and its endpoints, and keeps the plugin disabled. The audit event is `plugin_adopted`.

**Package contents.** A tarball holds a prebuilt, self-contained package: `manifest.json`, the entry, all that the entry imports, and the instructions file. Usually this is one bundle made with esbuild. Core never runs `npm install` or build scripts.

- Under the permission model (ADR-0014), the child can read only its own directory. An entry that imports from a shared `node_modules` does not load.
- Discovery refuses an entry whose real path (after symlinks) is outside the directory. An archive can be flat or have one top-level `package/` directory.

**Extraction limits.** Core accepts only regular files and directories. These make the install fail:

- links, devices, and paths outside the target
- more than 50 MB compressed, 200 MB extracted, or 5,000 entries
- a manifest whose id or version is not the one that the admin selected

**Signing modes.** When the admin adds a repository, they select a signing mode.

- **Signed.** Core shows the `publicKey` of the index with its key id. The admin pastes the full public key (`RW…`, or the `.pub` file) as the publisher gives it on a separate channel.
- A key id alone is not sufficient, because its owner selects it. Core pins the full key on the `plugin_repos` row.
- Each install must match `sha256` and have a valid minisign signature over the tarball, made with the pinned key. Core accepts the `ED` (prehashed, BLAKE2b-512) and `Ed` algorithms. It always checks the global signature over the trusted comment.
- If a later index has a different `publicKey` (compared byte for byte), core sets the repository to `key_changed`. Installs and updates stop until the admin confirms the new full key.
- **Unsigned.** Core checks only `sha256`. The portal shows a warning before each install and shows the plugin as "unsigned" everywhere.
- **Manual.** An uploaded file has no index and no signature. Core records its sha256 and sets `signature_verified` to false. The portal shows a warning before the install.

Core audits these actions as `config` events: install, update, removal, repository add and remove, key change, manual install and revert.

**Manual plugins.** An admin can install a plugin from a tarball, for example an unreleased build that `synoikia-plugin repo pack` makes. The build then runs on the live endpoints. Only the Admin role uses these routes.

- **Upload.** `POST /api/plugins/uploads` takes the raw tarball as the body and the file name in `x-file-name` or `?fileName=`. The body limit is 50 MB, and the extraction limits apply.
- Core computes the sha256 and extracts the file into `DATA_DIR/plugins-staging/upload-<id>`. Then it inspects the directory as discovery does.
- Core refuses a file name with control characters or bidi overrides (`invalid_file_name`).
- The answer gives the upload id, the plugin id and version, the sha256 and the SDK compatibility. It also names the plugin that it replaces, its enabled state and the permission changes.
- Core keeps one staged upload at a time, and a new upload removes the previous one. While core extracts an upload, it refuses another (`upload_in_progress`).
- A staged upload expires after 15 minutes (`upload_expired`). Core removes all staged uploads at start.

**Manual install.** `POST /api/plugins/uploads/:uploadId/install`.

1. The SDK range of the plugin must include the SDK of core (`incompatible`). A file has no `minCoreVersion`, so core does not check it.
2. Core stops the instances of the plugin, replaces its directory, runs discovery, writes the row and the audit event, and starts the instances again. A repository install uses the same step.
3. The row keeps its id, `repo_id`, instances, connections and access levels. `sha256` is the sha256 of the file, and `signature_verified` is false.
4. Core sets `plugins.manual` to `{ fileName, uploadedAt, releasedVersion }`. `releasedVersion` is the repository version that the file replaces, and a second manual install keeps the first one.

| Plugin before the install        | Enabled after the install |
| -------------------------------- | ------------------------- |
| None (a new plugin id)           | No                        |
| Exists, no permission change     | Same as before            |
| Exists, with a permission change | No                        |

An upload without a permission change keeps the plugin enabled, also over a plugin from a signed repository. The click of the admin on Install, after the unsigned warning, is the review of the code.

The audit event is `plugin_manual_installed`. It records the plugin id, the version, the previous version, the sha256, the file name, `releasedVersion`, the enabled state and the permission changes (`needsReview`).

**Revert.** `POST /api/plugins/:id/revert` installs `releasedVersion` from the repository of the row, with the checks of a repository install.

- Without `releasedVersion`, core refuses the revert (`not_manual`). If the index no longer has it, core refuses with `released_version_gone`.
- The audit event is `plugin_manual_reverted`, with the file name and the sha256 of the manual build.
- A repository install of the same plugin is also allowed, and it clears `plugins.manual`.

### Consequences

- Good, because no plugin code runs without an admin action on one version.
- Good, because a signed repository proves its publisher with a key that the admin pinned.
- Good, because a new binding, capability, sensitive key or network host always needs the admin to enable the plugin again.
- Bad, because an unsigned repository or a manual upload runs code that nobody signed. ADR-0002 lists this risk.

The feature files `@id:plugin-repositories`, `@id:plugin-install-and-update`, `@id:plugin-discovery`, `@id:manual-plugins`, `@id:repository-release` and `@id:portal-plugins` specify its behavior.
