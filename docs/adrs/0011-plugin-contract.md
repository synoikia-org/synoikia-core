---
status: accepted
date: 2026-10-15
---

# Plugins describe, core decides

## Context and Problem Statement

Core makes every security decision (ADR-0001), but only a plugin knows its upstream API. What does a plugin give core, what does core keep to itself, and how do the two talk?

## Decision Drivers

- A plugin with errors, or a malicious plugin, must not be able to skip the gate.
- A plugin must get only the secrets of its own instance.
- Text from a plugin that reaches the model must not carry hidden instructions.
- A plugin built for another contract must not load.

## Considered Options

- The plugin gives data (catalog, classifications, locks, summaries, sensitive fields) and makes the upstream call. Core enforces everything, over a versioned JSON-RPC contract.
- The plugin enforces its own access rules, and core only routes calls.

## Decision Outcome

Chosen option: "The plugin gives data and core enforces everything". A plugin can give core wrong data, but it cannot skip the gate.

| Concern                                     | Core                               | Plugin                                                   |
| ------------------------------------------- | ---------------------------------- | -------------------------------------------------------- |
| MCP protocol, sessions, tool schemas        | Does it                            | Nothing                                                  |
| Endpoint and admin authentication           | Does it                            | Nothing                                                  |
| Sandbox and binding                         | Does it                            | Gives the binding names                                  |
| Access levels and locked operations         | Enforces them                      | Gives the group, the classification and the locked seeds |
| Pre-approval rules                          | Stores and evaluates them          | Gives the fields that rules can match                    |
| Approvals and typed confirmation            | Does them                          | Gives the summary text and the confirmation literal      |
| Audit log and redaction                     | Does them                          | Gives the sensitive keys, parameters and result fields   |
| Database, encryption, master key            | Owns them                          | Has no access                                            |
| Upstream connection and credentials         | Stores them encrypted              | Gets only its own decrypted secrets, and uses them       |
| Catalog discovery                           | Stores the catalog                 | Discovers it (introspection, OpenAPI, a declared list)   |
| Registry                                    | Stores it                          | Produces it                                              |
| Target resolution                           | Calls it                           | Does it                                                  |
| Configuration edits with optimistic locking | Shows the diff, keeps the hash     | Calculates the diff and the hash                         |
| Best-practice guides                        | Issues and checks attestation keys | Gives the guide text and version                         |
| Options for admin pickers                   | Shows them                         | Gives them (`optionsFor`)                                |

Core calls `invoke` only after the gate lets the call through. The admin accepts the risk of wrong plugin data when they install the plugin (ADR-0013).

**Manifest.** Each plugin has a `manifest.json`, which the SDK validates with a zod schema. `docs/reference.md` has an example.

- **Secrets.** A connection field with `writeOnly: true` is a secret. Core encrypts it and the API never returns it. All other connection fields are plain configuration.
- **Network hosts.** `network.hosts` is a declaration that the admin reviews before the plugin is enabled. Core does not enforce it (ADR-0014).
- **Targets.** A plugin with `capabilities.targets` declares `targets`: a `label`, an optional `registryKind`, and the `scopes` that a rule can select targets by. Core has no other knowledge of upstream objects.
- Each target that `resolveTargets` returns gives its value for each scope. A `$targets` match field offers scopes (`options.scopes`) and can narrow suggestions (`options.filter`). Naming an undeclared scope makes the manifest not valid.
- **Match profiles.** A match profile is a reusable set of fields that pre-approval rules can match (ADR-0003). An operation refers to one by name.

**Agent instructions.** `instructions` (optional) names a Markdown file that tells the agent how the upstream API works. Core adds its text to the MCP instructions of each endpoint of the plugin. The text reaches the model, so the SDK checks it strictly:

- The path is relative, contains only letters, digits, `_`, `.`, `-` and `/`, and ends in `.md`. A `..` segment or an absolute path is not valid.
- The file is UTF-8 text of 4096 bytes (`INSTRUCTIONS_MAX_BYTES`) or less. Core never truncates it.
- The text has no control characters other than tab, line feed and carriage return. It has no invisible format characters (Unicode `Cf`), no U+2028 or U+2029, and no `plugin-notes` tag.
- The file is not a symbolic link, and its real path is in the package directory.
- `readInstructionsFile` in the SDK does these checks. `synoikia-plugin check` and discovery use it. A file that fails makes the plugin `invalid`.
- When the text of an existing plugin changes, core audits `plugin_instructions_changed` with the SHA-256 of the text before and after, not the text. The plugin stays enabled.

**RPC contract.** Core starts each instance as a child process (ADR-0014). Core and the child send JSON-RPC 2.0 messages on a plain pipe, one JSON value on each line (ADR-0020).

- Each request has a timeout of 30 s. `invoke` gets the time that remains in the sandbox budget.
- The SDK function `runPlugin(handlers)` is the child side. The core class `PluginProcess` is the parent side.
- Core validates each plugin message: the envelope against its own schemas, each result against the SDK schemas.

| Method                                                          | Required               | Purpose                                                                                              |
| --------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `init({ instanceId, config, secrets, sdkVersion })`             | Yes                    | First call after start. This is the only time that secrets go to the child.                          |
| `testConnection()` → `{ ok, message?, upstreamVersion? }`       | Yes                    | "Test connection" on the Connection page. Core limits its rate.                                      |
| `getUpstreamVersion()` → `string`                               | Yes                    | A fast version check for version-triggered sync.                                                     |
| `syncCatalog()` → `{ upstreamVersion, sourceRef?, operations }` | Yes                    | The full catalog (`OperationDescriptor[]`).                                                          |
| `syncRegistry()` → `RegistryEntry[]`                            | With `registry`        | Upstream objects for pickers: `{ kind, id, name, parentId?, scopes?, attrs? }`.                      |
| `resolveOperation(fn, args)` → `{ key, params }`                | Yes                    | Maps a binding call to a catalog key. An unknown operation must throw.                               |
| `resolveTargets(key, params)` → `ResolvedTarget[]`              | With `targets`         | Expands the call to concrete targets. It must throw on an unknown target or scope value.             |
| `summarize(key, params, targets)` → `{ text, confirmLiteral? }` | Yes                    | The text for the approval. `confirmLiteral` is the text the approver types for a locked operation.   |
| `prepareWrite(key, params)` → `{ params, diff, expectedHash }`  | With `configTransform` | Applies a configuration change to the current object. Throws `ConfigConflict` if the object changed. |
| `invoke(key, params, context)` → `unknown`                      | Yes                    | The upstream call. Core calls it only after the gate.                                                |
| `optionsFor(source, query?)` → `{ value, label, meta? }[]`      | No                     | Options for admin pickers.                                                                           |
| `getGuide(key)` → `{ version, content }`                        | With `attestation`     | The best-practice guide of an operation.                                                             |
| `shutdown()`                                                    | Yes                    | Stops the child.                                                                                     |

The child can also send the notifications `log`, `catalogChanged` and `heartbeat` (ADR-0023). After a `catalogChanged`, core syncs the catalog within seconds, and at most once a minute for each instance.

`InvokeContext` holds `callId` (unique for each call), `expectedHash` (from `prepareWrite`), `deadlineMs` and `targets`. `targets` are the targets that the approver saw. The plugin acts on these targets and does not resolve them again.

```ts
// OperationDescriptor
{
  key: string;                    // stable catalog key, unique for each instance
  displayName?: string;
  kind: string;                   // plugin-defined; `config` writes go through prepareWrite
  group: string;                  // access group (ADR-0004)
  groupLabel?: string;
  tag?: string;                   // for filters only
  classification: 'read' | 'write';
  classificationReason: string;   // for example 'verb:GET'
  locked?: boolean;
  typedConfirmation?: boolean;    // makes the operation locked; always true for a locked one
  attestationRequired?: boolean;
  needsReview?: boolean;
  matchProfile?: string;
  paramsSchema?: JSONSchema;
  sensitiveParams?: string[];     // JSON pointers that core redacts (ADR-0007); 32 at most
  sensitiveResult?: 'whole' | { keys: string[]; deep?: boolean }; // result secrets that core masks (ADR-0007)
  docs?: { summary?: string; description?: string; guidance?: string };
}
```

**Contract version.** `SDK_VERSION` in the SDK is the version of this contract. The current version is `0.3.0`. Version `0.3.0` moved the messages from the Node IPC channel to the pipe. A manifest gives the range it accepts in `sdk`. Core does not load a plugin if its own contract version is outside that range.

- Core masks `sensitiveResult` from contract `0.2.2`. A plugin that declares `sensitiveResult` must require `^0.2.2` or later.
- `checkManifest`, `checkConformance`, `synoikia-plugin check` and `synoikia-plugin repo pack` refuse a plugin that does not.
- `init` gives the plugin the contract version of core. Below `0.2.2`, the SDK refuses `syncCatalog` and `invoke` for an operation that declares `sensitiveResult`.

### Consequences

- Good, because a plugin needs no security code, and the gate covers every plugin the same way.
- Good, because a plugin cannot read the secrets of another instance, or change what the agent reads with hidden characters.
- Bad, because a plugin that gives wrong classifications, locks or summaries can expose its own upstream. ADR-0002 lists this risk, and the compliance suite checks for it.

The model views `containers` and `coreComponents` show the plugin host and the children. The feature files `@id:plugin-manifest`, `@id:manifest-checks`, `@id:plugin-runtime` and `@id:plugin-conformance` specify its behavior.
