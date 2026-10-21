---
status: accepted
date: 2026-10-07
---

# Notifications inform only

## Context and Problem Statement

Admins want to know when an instance fails, a sync needs review, or a user name is locked. Notifications go to services outside core, such as ntfy or a webhook. What may a notification carry?

## Decision Drivers

- A notification must not be a way to approve a call. Only the owner of the credential approves, on the approval page (ADR-0006).
- A notification must not carry parameters or secrets.
- A receiver must be able to tell a real webhook from a forged or replayed one.

## Considered Options

- Notifications give information only, from redacted data, on ntfy or a signed webhook.
- Notifications with approve and deny links.

## Decision Outcome

Chosen option: "Notifications give information only". They never carry links to approve or deny a call. Approvals happen in the MCP client, which opens the approval page.

| Kind      | Configuration                                                                    | Delivery                                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ntfy`    | Server URL (default `https://ntfy.sh`), topic, optional access token (encrypted) | JSON publish to `POST {server}` with `topic`, `title`, `message`, `priority`, `tags`. JSON keeps titles safe for UTF-8.                                                                                                     |
| `webhook` | URL, optional HMAC secret (encrypted), optional extra headers (encrypted)        | `POST` JSON `{event, at, instance, title, message, data}` with `X-Synoikia-Event`, `X-Synoikia-Timestamp` and `X-Synoikia-Signature: sha256=<HMAC-SHA256(secret, timestamp + "." + body)>`. A receiver can refuse a replay. |

Each channel subscribes to a set of events, and can have a filter for instances.

| Event                 | When                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| `instance.error`      | An instance goes to `error`.                                                           |
| `instance.recovered`  | An instance is `ready` after `error`, also after a crash restart through `starting`.   |
| `plugin.crashed`      | A plugin child crashes.                                                                |
| `sync.failed`         | A catalog sync fails.                                                                  |
| `sync.pending_review` | A sync adds or changes writes, or disables rules (ADR-0004).                           |
| `auth.lockout`        | A user name reaches the failure limit (ADR-0008). Core sends it once for each lockout. |

- Core sends a message up to 3 times with backoff. It does not send again after a 4xx answer, except 429.
- A failure sets `last_error`, which Settings → Notifications shows. Each channel has a Test button.
- Messages use the redacted summary. They never hold raw parameters.
- Core removes event names that are no longer valid when it reads or saves a channel.
- Core encrypts the secrets of a channel with the master key (ADR-0016).

### Consequences

- Good, because a leaked notification gives no way to approve a call and no secret.
- Good, because a webhook receiver can check the signature and the timestamp.
- Bad, because an admin must open the portal or the MCP client to act on a notification.

The feature file `@id:notifications` specifies its behavior.
