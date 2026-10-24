# Security model

Synoikia core decides what an agent can do. A plugin only describes its upstream API. This page explains the controls that every call goes through. The ADRs in [`docs/adrs/`](adrs/) give the reasons for each control.

## Access levels

Each group of operations has a level. The admin can also give one operation its own level, which wins over the level of its group. Read or write comes from the upstream API, through the plugin. The admin cannot change it ([ADR-0004](adrs/0004-access-levels.md), [ADR-0012](adrs/0012-classification-fails-closed.md)).

| Level     | Reads | Writes                                                          |
| --------- | ----- | --------------------------------------------------------------- |
| **None**  | Off   | Off                                                             |
| **Read**  | Run   | Off                                                             |
| **Ask**   | Run   | Each call waits for a human, unless a pre-approval rule applies |
| **Write** | Run   | Run without a question, after the admin acknowledges them       |

A new group starts at Ask. An operation that nobody can classify is a write.

An operation can have only the levels that its kind allows:

| Kind   | Own levels       |
| ------ | ---------------- |
| Read   | None, Read, Ask  |
| Write  | None, Ask, Write |
| Locked | None, Ask        |

A role sets a maximum level for its users, and a user can set a lower personal level. The level in force is the most restrictive of the three.

## Locked operations

A plugin locks destructive operations, such as a delete or a reboot. A locked operation is off until the admin gives it its own level Ask. Then each call needs a human and a typed confirmation. A pre-approval rule or a session grant never covers it.

## Human approval

A call that asks waits for a human decision ([ADR-0006](adrs/0006-human-approval.md)). The owner of the agent's credential decides on the approval page of core. The page has its own sign-in, or the access gateway identifies the owner. The page shows the targets of the call, and a config change shows each setting before and after.

How the call reaches the human depends on the client:

| Client                                    | What happens                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Supports URL-mode elicitation             | The client opens the approval page.                                                 |
| Shows MCP apps, such as Claude or ChatGPT | An approval card shows in the chat. The chat continues after the decision.          |
| Any other client                          | The call parks. The agent gets the approval link and follows the run with `resume`. |

The client that made the call cannot approve it. The admin can allow approval in the agent session for one endpoint. Then a form in the client, or the approval card, can approve a call at Ask. This never applies to a locked operation or to a call that needs a typed confirmation.

**Approve for this session** gives a session grant. For a few hours, the calls at Ask of that credential on that endpoint run without a question.

## Credentials and their ceilings

An agent signs in with OAuth 2.1, a bearer token or the access gateway ([ADR-0009](adrs/0009-mcp-client-authentication.md)). The admin turns each method on for the server, and an endpoint can only narrow that choice.

Each credential has an access ceiling: read or write. On the OAuth consent page the default is read only, and a new bearer token is read only by default. A credential with a read ceiling never reaches a write, whatever the access levels are.

The admin can allow or refuse clients by the name that each client gives for itself. A client can give any name, so this policy is not a security boundary.

## Isolation

- **Sandbox.** The code of an agent runs in a new [`isolated-vm`](https://github.com/laverdet/isolated-vm) isolate for each run. It has no Node APIs, no network, no file system and no timers. It runs within a time limit and a memory limit ([ADR-0005](adrs/0005-sandbox.md)).
- **Plugin processes.** Each instance runs its plugin in its own child process under the [Node permission model](https://nodejs.org/api/permissions.html). The process can read only its own folder. It gets a scrubbed environment, a memory cap and only the secrets of its instance ([ADR-0014](adrs/0014-plugin-process-isolation.md)).
- **Two listeners.** Agents use one port and the admin portal uses another. Each port lets in only known host names ([ADR-0015](adrs/0015-two-listeners.md)).
- **Plugin supply chain.** Core installs plugins only from repositories that the admin added. A signed repository proves each build with the key that the admin confirmed ([ADR-0013](adrs/0013-plugin-supply-chain.md)).

## Secrets and redaction

Core encrypts the secrets of instances and notification channels with its master key ([ADR-0016](adrs/0016-secrets-at-rest.md)). Administration shows only whether a secret is set.

Core hides secrets before a value reaches the agent, an approver, a log or the audit log ([ADR-0007](adrs/0007-redaction.md)). It hides values under sensitive key names, the parameters and results that a plugin declares secret, and the secret values of the instance.

## Audit

Core records each call, search, decision, sign-in and change of configuration in the audit log, with its actor. A change of configuration shows its values before and after, without secrets. The admin exports the log as a spreadsheet file. Core keeps the rows for 90 days by default ([`docs/reference.md`](reference.md#maintenance) › Housekeeping).
