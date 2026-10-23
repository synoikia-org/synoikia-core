# Writing a Synoikia plugin

A plugin connects one kind of self-hosted service (the _upstream_) to Synoikia. It describes the upstream's API: which operations exist, which read and which write, which are destructive, and which fields hold secrets. **It never decides what is allowed.** Core's sandbox, permission gate, approvals, redaction and audit apply to every call. Design: ADR-0003 to ADR-0007 and ADR-0011 to ADR-0014 in [`adrs/`](adrs/).

## Start

```sh
pnpm create @synoikia/plugin my-plugins        # a plugin repository, then its first plugin
cd my-plugins
pnpm new                                        # more plugins later (or: pnpm new --id x --archetype … --auth … --yes)
pnpm test                                       # check, build, unit tests and compliance suite of every plugin
```

`pnpm new` asks for an id, a name, an **archetype** and an **auth kind**:

| Archetype       | For                                                      | The catalog comes from                      |
| --------------- | -------------------------------------------------------- | ------------------------------------------- |
| `openapi-rest`  | REST APIs that serve an OpenAPI 3 spec                   | the spec (`buildOpenApiCatalog`)            |
| `static-rest`   | REST APIs without a spec                                 | `operations:` in `plugin.yaml`              |
| `websocket-rpc` | JSON-RPC 2.0 over WebSocket                              | `operations:` in `plugin.yaml`              |
| `blank`         | anything else: introspection endpoints, custom protocols | your code, decorated by `plugin.yaml` rules |

Auth kinds are `bearer`, `api-key` (with a header name), `basic` and `none`. The generated plugin builds and passes its tests straight away: unit tests for every archetype, plus end-to-end tests against a fake upstream in `test/` for all but `blank`.

## Files

| File              | What                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `manifest.json`   | Sandbox binding, connection form, `sensitiveKeys`, `network.hosts`, match profiles (SDK `ManifestSchema`) |
| `instructions.md` | Optional: how the upstream API works, for the agent (below)                                               |
| `plugin.yaml`     | What the plugin tells core about its operations, as data (below)                                          |
| `src/plugin.ts`   | `definePlugin(…)`: the client, the version, discovery, and decisions that need logic                      |
| `src/auth.ts`     | How each request authenticates                                                                            |
| `test/`           | `compliance.yaml`, a fake upstream, and unit tests in `test/unit/` (below)                                |

`synoikia-plugin build` bundles everything into one self-contained `dist/index.js`. It validates `plugin.yaml` and inlines it at build time. At runtime the plugin runs as a permission-confined child. It can read nothing outside its package directory, and it can't write files or spawn processes. **Network access is not restricted.** `network.hosts` is a declaration that the admin reviews before enabling the plugin. An update that changes it arrives disabled again. Core does not enforce it. A container egress policy is the mitigation (ADR-0014, issues #108 and #111). List exactly the hosts the plugin connects to.

### Agent instructions

`"instructions": "instructions.md"` in the manifest names a Markdown file in the package (letters, digits, `_ . -` and `/`, ending in `.md`, never `..` or absolute, not a symbolic link). Core adds its text to the MCP server `instructions` and to the `search` tool description in a `<plugin-notes plugin="<id>">` block between core's own text and core's approval rule. The agent reads it once per session, so it spends fewer `search` calls on conventions.

- Write what the agent can't guess: the base path and versioning, how keys and IDs are built, pagination and filter parameters, async patterns (start a job, then poll it), and the three to five most common workflows as key sequences. Say in one line what is locked or excluded.
- Never describe auth, secrets or approvals: core handles them.
- At most 4 KiB of UTF-8 text, without control characters other than tab and newline, invisible format characters (bidi, zero-width), U+2028/U+2029 or a `plugin-notes` tag. A change to the text is audited by its SHA-256. A larger or binary file, or a missing one, fails `synoikia-plugin check`, and core marks the plugin `invalid`; core never truncates it. Core sends it as plain text, with no templating.
- `synoikia-plugin repo pack` ships it in the tarball next to `manifest.json`. The harness stages it. Review a change to it like a `plugin.yaml` diff. It is text the model reads.

An `optionsSource` of a match field fills a rule picker, which core also serves to users who may write their own rules (ADR-0010). `optionsFor` can't tell who asks, so the manifest is refused if a match field and a connection-form field share a source: give each its own.

## `plugin.yaml`

Discovery lists operations; `plugin.yaml` decorates them by operation key. Editors validate it with the schema the SDK ships (`# yaml-language-server: $schema=./node_modules/@synoikia/plugin-sdk/plugin-settings.schema.json`).

```yaml
defaults:
  confirm: instance # typed-confirmation literal for locked operations without their own
  timeouts: { request: 15000, lookup: 10000 }
instanceName: { op: 'GET /status', field: name, fallback: Acme } # what `confirm: instance` types
exclude: ['POST /auth/*'] # left out of the catalog
include: [] # re-allows keys inside an excluded glob
operations: [] # declared operations (static-rest, websocket-rpc, blank), below
rules:
  - match: 'DELETE /items/{itemId}' # a key, a list of keys, or globs: 'api_key.*', '*#garage'
    locked: true
    confirm: { lookup: { op: 'GET /items/{itemId}', args: [{ itemId: { $param: /path/itemId } }], field: name } }
  - match: 'POST /request/{id}/{status}'
    split: on-behalf # adds a locked twin 'POST /request/{id}/{status}#on-behalf'
  - match: '*#on-behalf'
    description: Approving a request filed by another user: locked.
    summaryNote: "(another user's request)"
  - match: pool.dataset.create
    matchProfile: dataset-name-prefix
    sensitiveParams: [/0/encryption_options/key]
    guidance: Name is "<pool>/<path>".
  - match: auth.generate_token
    sensitiveResult: whole # or { keys: [key], deep: true }
  - match: 'GET /sync/status'
    classification: read # a reviewed override of the heuristic
    reason: reviewed:read
    needsReview: false
plugin: {} # anything specific to this upstream, validated by the plugin's own schema
```

### Declared operations

`operations:` declares a catalog for upstreams with nothing to discover. With `http`, `staticHttpBinding` makes the request:

```yaml
operations:
  - key: torrents.add
    group: torrents
    classification: write
    summary: Add torrents by URL
    http: { method: POST, path: /torrents/add, body: multipart } # body: json (default), form or multipart
```

`http.body` sets how `params.body` is sent:

| `body`      | Content type                        | Encoding                                                                                                                                                      |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `json`      | `application/json`                  | `JSON.stringify(body)`                                                                                                                                        |
| `form`      | `application/x-www-form-urlencoded` | The body must be an object. As `query`: an array repeats the key, an object is sent as JSON, booleans and numbers as text, `null` and `undefined` are dropped |
| `multipart` | `multipart/form-data`               | Text fields only, encoded as `form`, under a random boundary. No file uploads                                                                                 |

`HttpJsonClient.request(method, path, { body, bodyEncoding })` takes the same `json`, `form` or `multipart`; `encodeBody` and `formFields` are exported. A body that is not an object for `form` or `multipart` is refused with `INVALID_PARAMS` before the call is gated. `restBinding` sends a form when the OpenAPI operation offers only `application/x-www-form-urlencoded` or `multipart/form-data` and no JSON type, and uses that schema as the body schema. A sign-in that sets a cookie reads `Set-Cookie` from `client.raw(…).headers` in `before` or `onAuthFailure`.

### Rule fields

| Field             | Effect                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `locked`          | Always write, always a human who types the confirmation literal. Any matching rule locks.                                                                                          |
| `classification`  | Overrides the plugin's heuristic (`read` or `write`), with `reason` and `needsReview`. Never unlocks.                                                                              |
| `split`           | Adds a locked twin `<key>#<suffix>`; the plugin decides per call when the twin applies (`splitWhen`).                                                                              |
| `confirm`         | Literal source(s), first that yields wins: `instance`, `targets`, `{ param: /pointer }`, `{ lookup: … }`, `{ custom: name }`. A lookup falls back to the `$param` it looked up by. |
| `sensitiveParams` | JSON pointers core redacts from params wherever they are shown or stored (all matching rules add up).                                                                              |
| `sensitiveResult` | Secrets in the result that core can't recognize by key name: `whole`, or `{ keys, deep }`. Core masks them (below). Needs `sdk` `^0.2.2` or later in the manifest.                 |
| `matchProfile`    | The manifest match profile pre-approval rules use for this operation.                                                                                                              |
| `summaryNote`     | Appended to the approval summary.                                                                                                                                                  |
| `description`     | `docs.description` (`{base}` and `{key}` are replaced).                                                                                                                            |
| `guidance`        | `docs.guidance` shown to the model.                                                                                                                                                |
| `attestation`     | Requires the model to read a guide first (`getGuide`).                                                                                                                             |

A field set by several matching rules takes the **first** rule's value, except `locked` and `attestation` (any rule) and `sensitiveParams` and `summaryNote` (all rules). `sensitiveParams`, `sensitiveResult`, `matchProfile` and `guidance` also apply to a split twin through its base key.

### Precedence, which fails closed

1. `exclude` (unless `include`d): the operation doesn't exist.
2. `locked`, or being a split twin: write, typed confirmation.
3. A rule's `classification`.
4. The plugin's own heuristic (an OpenAPI GET reads, other verbs write, and a GET whose description or path names an action, such as `/cache/flush`, is a write flagged for review).
5. Nothing settled it: write.

### What the SDK refuses

- An OpenAPI spec with two templates a concrete path can't tell apart (`/user/{id}` and `/user/{userId}/`): rules match keys by text, so a lookalike key could route around a lock.
- Path parameters that are `.`, `..` or not a plain string or number, and request paths with dot segments: the endpoint core gated is the one called.
- More than 32 `sensitiveParams` on one operation (core's limit), rather than silently redacting fewer.
- A spec whose `$ref`s expand past a fixed budget, and YAML aliases past 100.

`sensitiveResult` masks any non-empty value under a listed key (strings, numbers, objects), and anything nested deeper than it looks. Like `sensitiveParams`, it travels on the operation descriptor and **core** applies it, to the plugin's raw result right after `invoke` and before its own redaction by key name and secret value: an `invoke` returns the upstream's result as is. Core does this from plugin contract `0.2.2`, so a plugin with a `sensitiveResult` rule must declare `"sdk": "^0.2.2"` (or later) in its manifest, or an older core would drop the field; `synoikia-plugin check`, `checkConformance` and `repo pack` refuse it otherwise, and on an older core the SDK itself refuses to sync and to run any operation that declares one. The one thing core can't attribute is another operation's result handed back inside this one's (a job queue's records): mask those with `rules.maskEmbeddedResult(key, value)`, which applies `key`'s rule.

## The SDK

| Need                                   | Use                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Lifecycle (init, close, version, test) | `definePlugin({ connect, close, version, probe, handlers(kit) })`, `kit.lazy()` caches                                |
| HTTP upstream                          | `HttpJsonClient` (TLS verify toggle, no redirects, size cap, re-auth retry, JSON/form/multipart bodies), `restLookup` |
| Socket protocol                        | `PendingRequests`, `singleFlight`, `joinApiPath(…, { websocket: true })`                                              |
| OpenAPI catalog and binding            | `buildOpenApiCatalog`, `restBinding`, `fetchSpec`                                                                     |
| Declared catalog                       | `staticCatalog`, `staticHttpBinding`                                                                                  |
| Rules                                  | `parsePluginSettings`, `compileRules` (`describe`, `confirmLiteral`, `maskEmbeddedResult`, …)                         |
| Errors                                 | `PluginError`, `upstreamError`, `statusKind`                                                                          |
| Tests                                  | `complianceConfig` (`@synoikia/core/testing/compliance`), `startFakeHttp`, `checkManifest`, `checkConformance`        |

## Rules every plugin keeps

- Every credential connection field is `writeOnly`, uses the `secret` widget and is in `sensitiveKeys`. `synoikia-plugin check` enforces it.
- Every secret field that the upstream returns is in `sensitiveKeys` or has a `sensitiveResult` rule. The compliance suite checks it.
- Model-supplied arguments never change the host, scheme or port, never set auth headers, and path parameters are encoded. The operation core gated is the one invoked.
- Approval summaries and confirmation literals show exactly what is affected, and never secrets.
- No plugin-side allow/deny lists, approval prompts or secret handling: that is core's job. If a plugin needs something core doesn't offer, change core first.

## The compliance suite

Core's compliance suite certifies a plugin for production. The plugin's `vitest.config.ts` runs it:

```ts
export default mergeConfig(shared, complianceConfig({ pluginDir: import.meta.dirname }));
```

`test/compliance.yaml` tells the suite how to drive the plugin against its fake upstream:

```yaml
fake: test/fake.ts # exports start(): { url, close(), reset?() } and any value that ${fake.<name>} names
connection: { baseUrl: '${fake.url}', token: '${fake.token}' }
reads: [{ fn: request, args: [{ path: /items }], key: GET /items }]
writes: [{ fn: request, args: [{ method: POST, path: /items, body: { name: x } }], key: POST /items }]
rejects: [{ fn: request, args: [{ path: /nope }] }]
locks:
  'DELETE /items/{itemId}':
    { fn: request, args: [{ method: DELETE, path: /items/1 }], confirm: First item, target: /items/1 }
secrets: [{ fn: request, args: [{ path: /settings }], key: GET /settings, values: ['${fake.secret}'] }]
connectionTest: { wrong: { token: wrong-token } }
calls:
  list the items: { fn: request, args: [{ path: /items }], key: GET /items }
```

- Give a case in `locks` for each locked operation and each split twin. A lock with no case fails the suite.
- List in `secrets` each upstream value that must never reach the agent.
- Name in `calls` the calls that the plugin's own feature files use.

Plugin-specific behavior goes in `features/*.feature`, with the steps of the suite:

```gherkin
Scenario: The approval names the item
  Given the operation of "delete the first item" is at level ask
  When the agent runs "delete the first item", and the human types "First item"
  Then the approval shows "/items/1"
```

| Step                                                               | What it does                                |
| ------------------------------------------------------------------ | ------------------------------------------- |
| `Given the group of "<call>" is at level <none\|read\|ask\|write>` | Sets the group of the call's operation      |
| `Given the operation of "<call>" is at level <level>`              | Sets the operation's own level              |
| `When the agent runs "<call>"`                                     | Runs the call with no human                 |
| `When the agent runs "<call>", and the human approves it`          | Approves the call                           |
| `When the agent runs "<call>", and the human types "<literal>"`    | Approves the call with a typed literal      |
| `When the agent runs "<call>", and the human denies it`            | Denies the call                             |
| `Then the agent gets a result that contains "<text>"`              | The call ran, and its result holds the text |
| `Then core refuses the call with the code "<code>"`                | The call failed with that error code        |
| `Then the approval shows "<text>"`                                 | The approval prompt holds the text          |
| `Then the approval asks to type "<literal>"`                       | The approval asks for that literal          |
| `Then the agent gets a result that does not contain "<text>"`      | The call ran, and its result lacks the text |
| `Then no approval was asked`                                       | The call ran or failed with no human        |

Each named call also checks its result against the secret values of the profile.

A step file of the plugin gets the harness, the profile and the fake from `complianceSubject()`. Pure functions get unit tests in `test/unit/`.

### The harness

A plugin tests itself against the real core, in its own repository. Core tests never name a plugin. The package `@synoikia/core/testing` has the harness. A plugin adds `@synoikia/core` as a development dependency.

```ts
const h = await startPluginHarness({ pluginDir, connection: { baseUrl: fake.url, apiKey } });
h.setGroupLevel('scene', 'ask');
await h.execute(`return await acme.call('scene.delete', { id: 'evening' })`, {
  onApproval: (a) => a.approve(),
});
```

`startPluginHarness`:

- copies the release files of the plugin to `plugins/<id>` in a temporary data directory: `manifest.json`, `package.json`, the top-level path of the entry, and the instructions file
- starts core on that directory with an in-memory database, enables the plugin, creates an instance and syncs it
- runs the bundle as a child under the permission model, as in production
- fails with an error if the entry is not built. Plugin `test` scripts build first.

| Area       | Harness functions                                                                                                                                                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calls      | `execute(code, { onApproval })` and `search(code)`, on the same path as an MCP client. `onApproval` decides each approval, with typed confirmation. With `{ park: true }`, the call parks as for a client without prompts (ADR-0006): `parkedApproval(result)` decides it and `resume(executionId)` collects it. |
| Access     | `setGroupLevel`, `setOperationLevel`, `addRule`                                                                                                                                                                                                                                                                  |
| Inspection | `operation(key)`, `operations()`, `registry()`, `audit({ operationKey })`, `instance()`, `approvalErrors`                                                                                                                                                                                                        |
| Upstream   | `testConnection(connection)`, `syncNow()`                                                                                                                                                                                                                                                                        |
| Lifecycle  | `stop()` stops core and removes the temporary directory                                                                                                                                                                                                                                                          |

The same package has `startFakeHttp`, a fake HTTP upstream that answers only the routes a test declares.

**Repository release check.** `verifyPluginRepository({ index, assets, publicKey })` checks a built repository before it is published:

1. It adds the repository as signed, with `publicKey` pinned.
2. It installs the newest version of each plugin, with the sha256, signature and archive checks.
3. It starts each bundle as a child under the permission model and requires an answer on its message pipe.

The release workflow runs it after signing and before upload.

## Testing a build on your instance

To try an unreleased build on a live Synoikia, with its endpoints, connections and access levels (ADR-0013):

1. In the plugin repository, run `pnpm exec synoikia-plugin repo pack --out .repo-test`. It packs each plugin version that `.repo-current/index.json` does not list into `.repo-test/<id>-<version>.tgz`; without that file it packs every plugin. Give the build a new version, such as `1.3.0-dev.1`, so it differs from the released one.
2. On **Plugins**, select **Install from file**, pick the `.tgz` and check the summary: what it replaces and the permission changes.
3. Select **Install**. The build replaces the installed plugin and keeps its endpoints.

If the build changes the binding, capabilities, `sensitiveKeys` or `network.hosts`, the plugin is disabled until you enable it again. Otherwise it stays enabled, and its endpoints serve the build at once. A new plugin id starts disabled.

**Revert to released x.y.z** on the plugin row installs the repository version again. A repository install or update of the plugin also replaces the build.

## Releasing

A repository created with `--release` publishes a signed plugin repository: bump a plugin's version in `manifest.json` and `package.json` and merge. See its `RELEASING.md`; the workflow runs `synoikia-plugin repo pack | index | verify | publish`, signing between `pack` and `index`.
