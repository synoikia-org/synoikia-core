---
title: Access
audience: everyone
related: rules, roles
---

Each group of operations has a level. The level decides what a client can do with the operations of that group.

## Levels

- **None**: nothing in the group can be called.
- **Read**: reads run. Writes are off.
- **Ask**: reads run. Each write asks for approval. Pre-approval rules can cover some writes.
- **Write**: reads run. Writes run without asking. Locked operations still ask.

## Groups and operations

An operation follows the level of its group, unless it has its own level. Setting the level of a group puts each operation in it back to follow the group. ↺ puts back an operation that has its own level.

A locked operation never takes **Write**. Each call of it asks, with a typed confirmation where the plugin wants one.

New groups start at **Ask**.

## Roles {admin}

A role never goes above the level of the endpoint. Groups that a role has no level for, and new groups, are **None** for that role. Set the most that a role can do on its tab of this page.
