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

## Environment

`.env.example` lists every variable: `DATA_DIR`, `MASTER_KEY`, `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, `PUBLIC_MCP_URL`, `PUBLIC_ADMIN_URL`, `MCP_ALLOWED_HOSTS`, `TRUST_PROXY`, `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_FORCE_LOCAL_LOGIN` and `LOG_LEVEL`.

## Server log

Core writes one `LEVEL message key=value` line for each event to stdout or stderr, filtered by `LOG_LEVEL`. A refused MCP request logs its reason, but never a credential value. Request lines hold the path only, because query strings hold OAuth state. The feature files `@id:server-log` and `@id:listeners` specify the log and the health checks.
