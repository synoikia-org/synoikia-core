# Synoikia reference

Facts about Synoikia core that are not a decision or a behavior. The decisions are ADRs in [`adrs/`](adrs/). The behavior is the feature files in [`features/`](../features/). The structure is the LikeC4 model in [`architecture/`](architecture/README.md).

## Glossary

Each term has one meaning. Documents, ADRs, feature files and the model use these words.

| Term                | Meaning                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Core                | The Synoikia server process. It owns all security decisions.                                                      |
| Upstream            | A self-hosted service that a plugin connects to.                                                                  |
| Plugin              | A package that describes one kind of upstream API to core. It makes no security decisions.                        |
| Instance            | One configured connection of a plugin to one upstream. It runs as one child process.                              |
| Endpoint            | The MCP endpoint of one instance, at `/{slug}`.                                                                   |
| Operation           | One upstream call that the catalog lists, with a stable key.                                                      |
| Catalog             | The list of operations of one instance, synced from the plugin.                                                   |
| Group               | A set of operations that share an access level, for example one API tag.                                          |
| Access level        | `none`, `read`, `ask` or `write`. It controls if an operation runs, asks, or is off.                              |
| Locked operation    | An operation that always needs a human approval with a typed confirmation.                                        |
| Split twin          | A second, locked key for an operation, used when its risk depends on its parameters.                              |
| Principal           | The authenticated identity that calls an endpoint. Each principal belongs to one user.                            |
| Role                | What a user can reach: the built-in Admin role, or a role that an admin makes.                                    |
| Role maximum        | The highest access level that a role allows for a group or an operation.                                          |
| Personal level      | An access level that a user sets for their own calls, at most the role maximum.                                   |
| Self-registration   | The creation of a user without an admin, with the default role.                                                   |
| Access ceiling      | The most that a principal can do: `read` or `write`.                                                              |
| Client auth method  | How an MCP client proves who it is: `bearer`, `oauth` or `external`.                                              |
| Client name         | The `clientInfo.name` that an MCP client declares in `initialize`. It is not authentication.                      |
| External provider   | A service in front of the MCP listener that identifies the user of a request.                                     |
| Approval            | A human decision on one call, made on the approval page or in the agent session.                                  |
| In-session approval | An approval in the agent session: a form prompt or the approval card. Set with `formElicitationApprovals: 'ask'`. |
| Parked execution    | An `execute` that waits on the server for an approval after its tool call answered.                               |
| Approval card       | The MCP Apps view that shows a parked approval in the chat. It approves only in session.                          |
| Session grant       | A time-limited permission, given on the approval page, that auto-approves `ask` for a client.                     |
| Pre-approval rule   | A stored rule that approves matching calls without a human.                                                       |
| Target              | A concrete upstream object that a call acts on, for example one device.                                           |
| Registry            | The local copy of the upstream objects that a plugin lists, for pickers and target selection.                     |
| Binding             | The function in the sandbox that sends a call to the gate, for example `acme.call(...)`.                          |
| Gate                | The permission pipeline between the binding and the plugin.                                                       |
| Sandbox             | The `isolated-vm` isolate that runs model code.                                                                   |
| Attestation key     | A key that shows that the model read a best-practice guide in the same MCP session.                               |
| Redaction           | The replacement of secret values with `[REDACTED]`.                                                               |
| Audit log           | The append-only log of calls, searches, configuration changes, sign-ins and plugin events.                        |
| Bundle              | The built plugin code (`dist/index.js`) with its `manifest.json`.                                                 |

## Limits

- Each user has one role. Only the Admin role administers the server. The other roles are made by an admin and only limit access.
- There is one core process. It owns the SQLite file. The design does not scale across hosts.
- Core does not terminate TLS. A reverse proxy does this.
- There is no endpoint that combines the tools of many instances. Each instance is its own MCP server.

## Search APIs

In `search(code)`, the sandbox (ADR-0005) has these read-only APIs:

- `catalog.find({ text?, group?, tag?, kind?, classification?, includeDisabled? })` returns descriptors. By default it returns only callable operations (ADR-0004).
- Each descriptor has `approval: 'none' | 'required' | 'auto'`: it runs, it asks a human, or it runs without a question. With `includeDisabled`, the other operations come back marked `disabled` with a `reason`.
- `catalog.groups()` returns the groups with their levels and counts. The model can then tell the user why an operation is not callable.
- `catalog.get(key)` returns the full descriptor with `paramsSchema` and docs.
- `registry.find({ kind?, text?, parent?, scopes? })` returns matching registry entries only, never the full registry. It exists only if the plugin has `registry`.
- `guides.get(key)` returns the guide of an operation with its `best_practice_key` (ADR-0003). It exists only if the plugin has `attestation`.

The `catalog` and `registry` APIs read only the database. `guides.get` calls the plugin once for each read (`getGuide`). Core stores a new `guides` row when the guide version or content changed. Core audits each run as a `search` event.

## Binding errors

Core throws these errors into the sandbox as `Error` objects with a `code` property (ADR-0003).

| Code                       | Cause                                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNKNOWN_OPERATION`        | The plugin cannot map the call to a catalog key.                                                                                                                                                |
| `ATTESTATION_REQUIRED`     | The call has no valid attestation key.                                                                                                                                                          |
| `OPERATION_DISABLED`       | Level `none` (also a write in a group at `read`), a read-only principal, a locked operation without its own `ask`, or a level change while the approval was open. The message gives the reason. |
| `TARGET_RESOLUTION_FAILED` | The plugin cannot resolve a target.                                                                                                                                                             |
| `TARGETS_CHANGED`          | The targets are not the targets that the approver saw. The call must be made again.                                                                                                             |
| `OPERATION_CHANGED`        | The operation is not the operation that the approver saw (ADR-0006). The call must be made again.                                                                                               |
| `CONFIG_CONFLICT`          | The object changed after it was read (`prepareWrite`).                                                                                                                                          |
| `INVALID_PARAMS`           | The plugin refused the parameters of the call.                                                                                                                                                  |
| `PERMISSION_DENIED`        | A human denied the call, the client declined, the approval timed out or was cancelled, the client cannot show an approval and cannot park, or the client has too many parked executions.        |
| `RATE_LIMITED`             | The principal used its write budget.                                                                                                                                                            |
| `UPSTREAM_DENIED`          | The upstream refused the call for lack of permission.                                                                                                                                           |
| `UPSTREAM_ERROR`           | The upstream call failed.                                                                                                                                                                       |
| `UPSTREAM_TIMEOUT`         | `invoke` did not answer before its deadline. The result is unknown.                                                                                                                             |
| `PLUGIN_UNAVAILABLE`       | The plugin child is down, or the bundle changed while the call waited.                                                                                                                          |
| `PLUGIN_ERROR`             | The plugin answer is not valid, or the plugin gave an error code that core does not pass on.                                                                                                    |
| `EXECUTION_ENDED`          | The `execute` run ended before the call, or core stopped its parked execution.                                                                                                                  |
| `NOT_A_BINDING`            | The sandbox asked the host for a function that is not a binding.                                                                                                                                |
| `INTERNAL`                 | An unexpected error in core. The message gives no detail.                                                                                                                                       |

## Run results

The tool result of `execute`, `search` or `resume` carries these codes. A binding error that the code does not catch ends the run with its own code.

| Code                  | Cause                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMITED`        | The principal used its run budget. Core makes no isolate.                                                        |
| `BUSY`                | Too many sandboxes run, or another `resume` waits on the same execution.                                         |
| `SYNTAX_ERROR`        | The code does not compile.                                                                                       |
| `CODE_ERROR`          | The code threw an error without a string `code`.                                                                 |
| `TIMEOUT`             | The run passed its time limit (ADR-0005).                                                                        |
| `MEMORY_LIMIT`        | The run passed its memory limit (ADR-0005).                                                                      |
| `INTERNAL`            | An unexpected error in core.                                                                                     |
| `AWAITING_APPROVAL`   | The execution parked on an approval (ADR-0006). The tool result is not an error.                                 |
| `STILL_RUNNING`       | `resume`: the script still runs after the decision.                                                              |
| `EXECUTION_NOT_FOUND` | `resume`: the id is unknown or collected, belongs to another principal or endpoint, or is from before a restart. |

## Environment

`.env.example` lists every variable: `DATA_DIR`, `MASTER_KEY`, `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, `PUBLIC_MCP_URL`, `PUBLIC_ADMIN_URL`, `MCP_ALLOWED_HOSTS`, `TRUST_PROXY`, `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_FORCE_LOCAL_LOGIN` and `LOG_LEVEL`.

## Server log

Core writes one `LEVEL message key=value` line for each event to stdout or stderr, filtered by `LOG_LEVEL`. A refused MCP request logs its reason, but never a credential value. Request lines hold the path only, because query strings hold OAuth state. The feature files `@id:server-log` and `@id:listeners` specify the log and the health checks.
