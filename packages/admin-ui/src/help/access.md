---
title: Access
audience: everyone
related: rules, roles
---

This page decides what clients can do on this endpoint. You give each group of operations a level. You can also give one operation its own level.

A change applies to the next call, also in sessions that are open.

## Levels

- **None**: nothing in the group can be called.
- **Read**: reads run. Writes are off.
- **Ask**: reads run. Each write asks for approval. Pre-approval rules can cover some writes.
- **Write**: reads run. Writes run without asking. Locked operations still ask.

A new endpoint starts each group at **Ask**.

## Set the level of a group

Pick the level on the row of the group. It applies at once, without a question. The operations of the group then follow the new level, also the ones that had their own level.

**Set all groups…** sets every group to one level. It asks first, because operations with their own level go back to their group.

The search box finds groups and operations by name.

## Give one operation its own level

1. Open the group with the arrow on its left.
2. Pick a level on the row of the operation.

Each operation offers only the levels that its kind allows. A read takes **None**, **Read** or **Ask**. A write takes **None**, **Ask** or **Write**. A read at its own **Ask** asks for each call, also after an approval.

↺ puts the operation back on the level of its group. Picking the level that the group gives does the same. The status on each row says what a call does now, such as **Runs** or **Asks**.

## Locked operations

The plugin locks operations that are destructive or irreversible. A locked operation is off until you give it its own **Ask**. The portal asks you to confirm first.

Each call then needs a person on the approval page. The page can ask you to type a value, such as a name, to confirm. Rules, session approvals and approvals in the agent session never cover a locked operation. It never takes **Write**.

## Acknowledge new writes

A write at **Write** runs without asking only after you acknowledge it. Until then its status says **Asks until acknowledged**. Choose **Acknowledge** on its row.

Setting a group to **Write** acknowledges its writes. So does an own level **Write**. **Needs attention only** shows the operations to acknowledge, and the ones that the plugin marks for a review.

## After a sync

A sync never gives a client more access.

- A new write in a group that is not at **None** arrives off, at its own **None**.
- A new read in such a group arrives at its own **Read**.
- A write whose parameters changed, or that came back, waits for a new acknowledgement.
- An operation that becomes locked loses its own level, and its rules stop.
- An operation that the plugin no longer lists shows as stale. Clients cannot call it.

## Merge or rename groups

**Rename** changes only the label that you see. The key stays.

**Regroup…** merges groups into one, to set them with one control. The merged group takes the lowest of their levels. Later syncs keep the merge.

## When a client cannot call an operation

- The status says **Off**. Its level is **None**, or it is a write in a group at **Read**.
- The status says that it is locked and not enabled. Give it its own **Ask**.
- The client signed in read-only. It cannot write at any level. Give it a credential with write access.
- The operation is stale. Sync the endpoint on its Connection page.
- The client belongs to a user with a role. The role level applies too.
- **Guide** is ticked. The client must read the guide of the operation in the same session first.

## Roles {admin}

**Levels for** picks a role, when there are roles other than Admin. You then set the most that the role can do on this endpoint. A role never goes above the level of the endpoint.

- Groups that a role has no level for, and new groups, are **None** for that role.
- ↺ on a group clears the level of the role, which is then **None**.
- If the endpoint is not one of the role's endpoints, choose **Add it to** the role first.

A client of a user gets the lowest of the endpoint level, the role level and the user's own level. A role at **Write** does not open a write that the endpoint keeps at **Ask**. A call that asks goes to the user who owns the client, not to you.
