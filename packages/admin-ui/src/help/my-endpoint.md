---
title: Endpoint
audience: everyone
related: my-endpoints, access, rules
---

This page shows what your clients can do on one endpoint. Use it to check why a call runs, asks or is refused, and to make your own clients more careful.

Operations sit in groups. Each operation shows what a call of it does now.

## What a call does now

- **Runs**: the call runs at once.
- **Asks**: each call waits for your approval.
- **Asks until acknowledged**: a new or changed write asks, until an administrator reviews it.
- **Runs without asking**: a write runs at once. Locked operations still ask.
- **Off**: your clients cannot call the operation.
- **Off: your own level**: you closed it yourself. You can open it again.

## Your own levels

Your role sets the most that each operation can do here. Where your role allows it, you can lower a level for your own clients. Your own level applies to every client that signs in as you.

A level above the most of your role is greyed out. An operation that your role keeps at **Off** shows its level only, with nothing to pick.

If you cannot pick any level, your role does not let you set your own levels on this endpoint.

## Lower a level for your own clients

1. Find the group, and pick a lower level on it. **Read** stops every write of the group.
2. To change one operation, open its group and pick a level on the operation.

A **Read only** token or connection also cannot run writes, whatever the level. Use **Ask** on a write to approve each call yourself. Use **Ask** on a read to see each read before it runs. Use **None** to close the whole group.

A new level on a group puts each operation of the group back on the group level.

## Go back to the level of your role

Choose ↺ on a group to go back to the level of your role. Choose ↺ on an operation to put it back on the level of its group.

A group or operation that you closed stays on the page, so you can open it again. The ↺ of a group also puts its operations back on the group level.

## Your own pre-approval rules

Where your role allows it, the tab **My pre-approval rules** shows. A rule approves matching calls of your clients without a question. You can write rules only for operations that you can call.

## When the endpoint shows an error

Your role can let you see the status of the endpoint. An error then shows at the top of the page. The endpoint cannot take calls until it runs again. Tell an administrator if the error stays.

## How an admin sets the levels of an endpoint {admin}

Open the **Access** tab of the endpoint, and pick the role in **Levels for**. The levels of a role are the most that its users can do. They never go above the levels of the endpoint itself.

Under **Roles** in the settings, each endpoint of a role has three switches: **Set personal levels**, **Own pre-approval rules** and **See endpoint status**.

When you turn off **Set personal levels**, the own levels of users stop counting. The server keeps them, and they count again when you turn the switch back on.
