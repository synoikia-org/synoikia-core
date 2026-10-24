---
title: Endpoint Settings
audience: admin
related: access, client-auth
---

This page holds the path, sign-in methods, approval settings and limits of one endpoint. Choose **Save settings** to apply a change.

## Change the path

The **Path** is where clients reach the endpoint. It takes lowercase letters, digits and dashes.

When you change it, clients that use the old path stop working. Give each client the new endpoint URL. The Connection page shows it.

The **Display name** is only the name that you see in the portal.

## Turn the endpoint off

Clear **Endpoint enabled** to stop the endpoint and keep its setup. Its plugin stops, and clients are told that the endpoint is unavailable.

Approvals that wait end, and session approvals end. When you turn it on again, the levels and rules are as before.

## Choose how clients sign in

**Accepted client auth** limits the sign-in methods of this endpoint. **All enabled methods** accepts each method that is on under Settings, Client auth. **Only these** accepts fewer.

An endpoint without a usable method refuses every call. The page warns you, and the overview flags the endpoint.

## How approvals reach you

A call that asks waits for a person on the approval page. The client opens the page or shows its link. The call of a user's client goes to that user.

**Approval timeout (minutes)**: an approval that nobody decides in this time is denied. The default is 15.

**Approve Ask operations in the agent session (form prompt or chat card)** lets the client show the approval itself. The client could then approve its own calls, with nobody checking. Locked operations and typed confirmations still need the approval page. An unanswered prompt moves to the approval link after 30 seconds.

## Session approvals

On the approval page, an approver can choose **Approve for this session**. The **Ask** calls of that client on this endpoint then run without asking, until the time is up.

- Another client of the same person still asks.
- A new session approval replaces the one before.
- It never covers locked operations or typed confirmations.
- It does not let a read-only client write, or lift **Writes per minute**.

**Longest “Approve for this session” (hours)** caps the length. The default is 8. 0 turns session approvals off. **Active session approvals** lists the current ones. **Revoke** ends one at once.

## Limits for each client

Each client credential has its own budget on this endpoint.

- **Executions per minute** counts the code runs of the client, searches too. A run over the limit is refused, and the client is told to slow down. The default is 30.
- **Writes per minute** counts the writes that run. A write over the limit is refused, even when a rule covers it. The default is 10.

## Sandbox, sync and redaction

- **Script timeout (seconds)**: the longest run of the client's code. Time that waits for an approval does not count. The default is 10.
- **Script memory (MB)**: a run that uses more is stopped. The default is 64.
- **Max result size (KB)**: a larger result reaches the client as a preview with its full size. The default is 64.
- **Re-sync when older than (minutes)**: a new session syncs the catalog first when it is older than this. The default is 60.
- **Plugin process memory (MB)**: the memory limit of the plugin. The default is 256.
- **Stop the plugin when idle**: the plugin stops when nobody calls, and starts at the next call. A waiting approval keeps it running.

**Extra keys to redact** hides more keys in audit logs, approvals and results. Case, `_` and `-` do not matter. A key of 5 or more characters also hides longer keys that contain it. The plugin's sensitive keys and the connection secrets are always hidden.

## Delete the endpoint

**Delete endpoint…** removes the endpoint, its catalog, its access levels and its rules. Type the path to confirm. The audit log is kept. Clients that use this path stop working.

To pause the endpoint instead, clear **Endpoint enabled**.
