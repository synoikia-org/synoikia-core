# §4 Plugin lifecycle

## 4.1 Installation and discovery

Core installs each plugin from a plugin repository (§4.2), or from a file that an admin uploads (§4.6), into `DATA_DIR/plugins/<id>/`. Only one version of a plugin is installed at a time. Core replaces it atomically.

**Default repository.** At the first start, core adds the Synoikia plugins repository ([synoikia-core-plugins](https://github.com/via-justa/synoikia-core-plugins)) as a signed repository. Its public key is pinned in core (`plugins/default-repo.ts`), so the admin does not confirm it. Core adds it once and records a `system` audit event. If an admin removes it, it stays removed. If its index cannot be fetched, core records the error on the repository. This is not fatal.

**Discovery.** At start, the plugin host scans `DATA_DIR/plugins`. For each directory it:

- validates `manifest.json` against the SDK schema and the `sdk` range;
- writes or updates a `plugins` row;
- marks a plugin with a manifest that is not valid as `invalid`, with an error message, and does not load it;
- reads the instructions file (§3.2) into the `plugins` row. A file that does not pass the checks of §3.2 makes the plugin `invalid`. When the text of an existing plugin changes, core records a `plugin_instructions_changed` audit event with the SHA-256 of the text before and after, not the text. The plugin stays enabled;
- marks a plugin whose directory is missing as `invalid`, and keeps its instances and history.

**Enabled flag.** Each plugin has an `enabled` flag on the Plugins page. A new plugin starts disabled. The admin creates instances one by one. If the admin disables a plugin, core stops all its instances, and their endpoints return 503. Core keeps their configuration and history.

## 4.2 Plugin repositories

The admin adds a repository by URL on the Plugins page. The URL points to an `index.json`:

```jsonc
{
  "schema": 1,
  "name": "Example community plugins",
  "homepage": "https://github.com/example/mcp-plugins",
  "publicKey": "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3", // optional, minisign
  "plugins": [
    {
      "id": "unifi",
      "name": "UniFi Network",
      "description": "Search/execute over the UniFi controller API",
      "versions": [
        {
          "version": "0.3.1",
          "sdk": "^0.2.0",
          "minCoreVersion": "1.0.0",
          "url": "https://github.com/example/mcp-plugins/releases/download/unifi-0.3.1/unifi-0.3.1.tgz",
          "sha256": "9f2c…",
          "signature": "untrusted comment: …\nRWQ…", // required in a signed repository
        },
      ],
    },
  ],
}
```

- **Index refresh.** Core fetches the index when the admin adds the repository, when the admin clicks "Refresh", and each day. After a failed fetch, core tries again each hour. Core keeps the index in `plugin_repos.index_cache`.
- **No automatic updates.** The Plugins page shows the plugins of all repositories, the installed version, and available updates. Each install or update is an admin action on one pinned version.
- **Review on enable.** A new install starts disabled. When the admin enables it, they accept its binding, capabilities, sensitive keys and network hosts. If an update changes one of these, core disables the plugin again. Its endpoints stop, and the audit event lists the changes. Other updates keep the enabled state.
- **Package contents.** A tarball holds a prebuilt, self-contained package: `manifest.json`, the entry, all that the entry imports, and the instructions file (§3.2) if the manifest names one, in the package directory. Usually this is one bundle made with esbuild. Core never runs `npm install` or build scripts.
  - Under the permission model (§4.4), the child can read only its own directory. An entry that imports from a shared `node_modules` does not load.
  - Discovery refuses an entry whose real path (after symlinks) is outside the directory.
  - An archive can be flat or have one top-level `package/` directory.
- **Extraction limits.** Core accepts only regular files and directories. These make the install fail:
  - links, devices, and paths outside the target;
  - more than 50 MB compressed, 200 MB extracted, or 5,000 entries;
  - a manifest whose id or version is not the one that the admin selected.
- **Plugin id conflicts.** The `plugins` row records its `repo_id`. Only that repository can update the plugin. Another repository with the same id shows it as installed from elsewhere and refuses to install it (`installed_from_elsewhere`). The admin must uninstall it first.
- **Adoption.** A plugin that no repository manages (for example, copied by hand into `DATA_DIR/plugins`) is adopted by the first repository install of its id. Core replaces the files, keeps the row and its endpoints, and keeps the plugin disabled until the admin enables it. The audit event is `plugin_adopted`.

## 4.3 Trust and signatures

When the admin adds a repository, they select a signing mode.

**Signed.**

1. Core reads `publicKey` from the index and shows it with its key id.
2. The admin pastes the full public key (`RW…`, or the full `.pub` file) as the publisher gives it on a separate channel. A key id alone is not sufficient, because its owner selects it.
3. Core pins the key on the `plugin_repos` row.
4. Each install must match `sha256`. It must also have a valid minisign signature over the tarball, made with the pinned key.
5. Core accepts the `ED` (prehashed, BLAKE2b-512) and `Ed` algorithms. It always checks the global signature over the trusted comment.
6. If a later index has a different `publicKey` (compared byte for byte), core sets the repository to `key_changed`. Installs and updates stop until the admin confirms the new full key.

**Unsigned.** Core checks only `sha256`. Each install shows a warning, and the admin must type the plugin id. The portal shows the plugin as "unsigned" everywhere.

**Manual.** An uploaded file (§4.6) has no index and no signature. Core records its sha256 and sets `signature_verified` to false. The admin must type the plugin id. The admin who uploads the file is responsible for its code.

Core writes these actions to the audit log as `config` events: install, update, removal, repository add and remove, key change, manual install and revert.

## 4.4 Process isolation

Each enabled instance runs in its own child process. Core starts it with `child_process.fork(entry)` and these limits:

- **Node permission model.** The flags are `--permission` and `--allow-fs-read=<plugin directory>`. There is no write, child-process, worker or add-on permission. The child cannot read outside its directory, cannot write files, and cannot start processes. A plugin cannot change these flags.
- **Clean environment.** The child gets only `NODE_ENV` and `PLUGIN_INSTANCE_ID`. It never sees `MASTER_KEY`, database paths, or admin configuration.
- **Memory limit.** `--max-old-space-size`, 256 MB by default, set for each instance.
- **Secrets only through `init`.** Core decrypts the secrets of that instance only and sends them in `init`.
- **Supervision.**
  - If the child crashes, the instance status becomes `error`. Core starts it again with exponential backoff, from 1 s to 60 s. Core audits the crash and sends a notification (§9).
  - Start, stop and restart of an instance run one at a time. A stop or restart kills a child that is still in `init`. At most one child of an instance is alive.
  - While the child is down, `execute` calls fail with `PLUGIN_UNAVAILABLE`. The gate does not need the plugin to refuse a call, so it never fails open.
- **Bundle version.** Just before each fork, core reads the version in the `manifest.json` of the bundle. The catalog must come from this version. If it does not, core syncs before the endpoint serves again (§10). The gate also refuses a call if the bundle changed while the call waited (§5.2).
- **Known limit: network access is not restricted.** The Node permission model does not control network access. A plugin can connect to any host that the container can reach. `network.hosts` is a declaration that the admin reviews. Use a container egress policy to restrict network access (§11, §14).

## 4.5 Plugin tests

A plugin tests itself against the real core, in its own repository. Core tests never name a plugin. The package `@synoikia/core/testing` has the harness. A plugin adds `@synoikia/core` as a development dependency.

```ts
const h = await startPluginHarness({ pluginDir, connection: { baseUrl: fake.url, apiKey } });
h.setGroupLevel('scene', 'ask');
await h.execute(`return await acme.call('scene.delete', { id: 'evening' })`, {
  onApproval: (a) => a.approve(),
});
```

`startPluginHarness`:

- copies the release files of the plugin (`manifest.json`, `package.json`, the top-level path of the entry, and the instructions file) to `plugins/<id>` in a temporary data directory;
- starts core on that directory with an in-memory database, enables the plugin, creates an instance and syncs it;
- runs the bundle as a child under the permission model, as in production;
- fails with an error if the entry is not built. Plugin `test` scripts build first.

| Area       | Harness functions                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calls      | `execute(code, { onApproval })` and `search(code)`, on the same path as an MCP client. `onApproval` decides each approval, with typed confirmation. With `{ park: true }`, the call parks as for a client without prompts (§5.6): `parkedApproval(result)` decides it and `resume(executionId)` collects it. |
| Access     | `setGroupLevel`, `setOperationLevel`, `addRule`                                                                                                                                                                                                                                                              |
| Inspection | `operation(key)`, `operations()`, `registry()`, `audit({ operationKey })`, `instance()`, `approvalErrors`                                                                                                                                                                                                    |
| Upstream   | `testConnection(connection)`, `syncNow()`                                                                                                                                                                                                                                                                    |
| Lifecycle  | `stop()` stops core and removes the temporary directory                                                                                                                                                                                                                                                      |

The same package has `startFakeHttp` (a fake HTTP upstream) and `checkPluginContract` (the end-to-end checks that each plugin repeats).

**Repository release check.** `verifyPluginRepository({ index, assets, publicKey })` checks a built repository before it is published:

1. It adds the repository as signed, with `publicKey` pinned.
2. It installs the newest version of each plugin, with the sha256, signature and archive checks.
3. It starts each bundle as a child under the permission model and requires an answer over IPC.

The release workflow runs it after signing and before upload.

## 4.6 Manual plugins

An admin can install a plugin from a tarball file, for example an unreleased build that `synoikia-plugin repo pack` makes. The build then runs on the live endpoints, with the same connections and access levels. Only the Admin role uses these routes (§8.4).

**Upload.** `POST /api/plugins/uploads` takes the raw tarball as the body and the file name in `x-file-name` or `?fileName=`.

- The body limit is 50 MB. The extraction limits of §4.2 apply.
- Core computes the sha256 and extracts the file into `DATA_DIR/plugins-staging/upload-<id>`. Then core inspects the directory as discovery does (§4.1).
- The answer gives the upload id, the plugin id and version, the sha256, the SDK compatibility, the plugin that it replaces, and the permission changes (§4.2).
- Core keeps one staged upload at a time. A new upload removes the previous one.
- A staged upload expires after 15 minutes (`upload_expired`). Core removes all staged uploads at start.

**Install.** `POST /api/plugins/uploads/:uploadId/install {confirm}`.

1. `confirm` must be the plugin id (`confirm_required`).
2. The plugin SDK range must include the SDK of core (`incompatible`). A file has no `minCoreVersion`, so core does not check it.
3. Core stops the instances of the plugin, replaces its directory, runs discovery, writes the row and the audit event, and starts the instances again. A repository install uses the same step.
4. The row keeps its id, `repo_id`, instances, connections and access levels. `sha256` is the sha256 of the file, and `signature_verified` is false.
5. Core sets `plugins.manual` to `{ fileName, uploadedAt, releasedVersion }`. `releasedVersion` is the repository version that the file replaces. A second manual install keeps the first `releasedVersion`. A plugin that no repository manages has no `releasedVersion`.

| Plugin before the install           | Enabled after the install |
| ----------------------------------- | ------------------------- |
| None (a new plugin id)              | No                        |
| Exists, no permission change (§4.2) | Same as before            |
| Exists, with a permission change    | No                        |

The audit event is `plugin_manual_installed`. It records the plugin id, the version, the previous version, the sha256, the file name, `releasedVersion`, the enabled state and the permission changes (`needsReview`).

**Revert.** `POST /api/plugins/:id/revert {confirm}` installs `releasedVersion` from the repository of the row, with the install of §4.2 and §4.3. An unsigned repository needs `confirm` as for each install.

- Without `releasedVersion`, core refuses the revert (`not_manual`). The admin can uninstall the plugin.
- If the index no longer has `releasedVersion`, core refuses the revert (`released_version_gone`).
- The audit event is `plugin_manual_reverted`. It records the file name and the sha256 of the manual build.

A repository install of the same plugin from its repository is also allowed, and it clears `plugins.manual`.
