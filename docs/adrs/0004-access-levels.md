---
status: accepted
date: 2026-10-10
---

# Access levels

## Context and Problem Statement

A catalog can have hundreds of operations. An admin must decide which of them an agent can call, and which need a human first. Users with other roles must get less, never more. How does core decide if an operation runs, asks or is off?

## Decision Drivers

- An admin must set access for a group of operations at once, and for one operation when necessary.
- A catalog sync must never open an operation by itself.
- A dangerous operation must never run without a human.
- The gate, `search` and the portal must give the same answer.

## Considered Options

- Four levels on groups and operations, narrowed by the role maximum and the personal level, decided by one function.
- An allow list of operations for each principal.
- The access that the plugin declares.

## Decision Outcome

Chosen option: "Four levels on groups and operations, narrowed by the role maximum and the personal level, decided by one function". The admin keeps control with few settings, and the layers can only take access away.

The plugin gives the groups. When the admin sets the level of a group, all operations in the group follow it. The admin can give one operation its own level, which applies until the admin sets the group level again.

Read or write comes from the upstream API, through the plugin. For example, a REST plugin uses the HTTP method. The admin cannot change a classification. Only a `plugin.yaml` rule can.

**Group levels.**

| Group level | Read operations | Write operations                                          | Locked operations                                       |
| ----------- | --------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `none`      | off             | off                                                       | off                                                     |
| `read`      | run             | off                                                       | off                                                     |
| `ask`       | run             | each call asks for approval, pre-approval rules can apply | only with their own `ask`                               |
| `write`     | run             | run without a question after acknowledgement              | only with their own `ask`, never run without a question |

**Own levels.** An operation can have only the levels that its kind allows.

| Kind   | Own levels             | Meaning                                                              |
| ------ | ---------------------- | -------------------------------------------------------------------- |
| read   | `none`, `read`, `ask`  | off · runs · each call asks                                          |
| write  | `none`, `ask`, `write` | off · each call asks · runs without a question after acknowledgement |
| locked | `none`, `ask`          | off · each call asks, with typed confirmation                        |

**Roles.** The levels above are the levels of the endpoint, and they apply to the Admin role. Two more layers limit them for a user with another role:

- **Role maximum.** The admin sets it for each group of an endpoint, and for an operation when necessary. It follows the group as the endpoint level does. A group or operation without a role maximum is `none`.
- **Personal level.** A user sets it if the role allows personal levels. If it is not set, the role maximum applies.

The level in force is the most restrictive of the three. From restrictive to open, the order is `none`, `ask`, `read`, `write`. A role maximum and a personal level never open more than the endpoint level.

**One function.** `effectiveAccess` in `packages/core/src/gate/access.ts` makes this decision. The gate, `search` and the portal all use it.

```
effectiveAccess(op, group, principal):
  group missing or level not known  → hidden (group_missing)
  level = level in force            -- own level (narrowed to its kind), else the group table
  principal is not admin:
    endpoint not in the role        → hidden (not_in_role)
    level = most restrictive of level, role maximum, personal level
  level == none                     → hidden (locked_not_opted_in for a locked op, else level_none)
  op is read and not locked         → run, or approve at its own ask
  principal ceiling == read         → hidden (token_read_only)
  level == ask, or op is locked     → approve
  write not acknowledged            → approve (pendingReview)
  otherwise                         → auto
```

**Locked operations.** They never follow their group into `ask` or `write`. A locked operation is callable only when the admin sets its own level to `ask`. Core refuses `write` for it. Each call needs a human and a typed confirmation, and a pre-approval rule never applies to it.

**Acknowledgement.** At level `write`, calls run without a question. When the admin selects `write` for a group or an operation, core acknowledges each write in it that is not locked. A write that is not acknowledged asks, also at level `write`.

**Catalog sync.** A sync never opens an operation by itself.

- A new operation in an existing group gets its own level: `read` for a read, `none` for a write. A new operation in a new group follows the group. Core sends `sync.pending_review` for new writes.
- A change from read to write resets the acknowledgement. So does a change to the parameter schema, kind, match profile, lock or stale state of an acknowledged write.
- If the own level of an operation does not fit its new kind, core narrows it.
- If a sync locks an operation, core clears its own level. The operation is then off until the admin sets `ask`.
- If the plugin moves an operation to another group, the operation keeps its access.
- Each sync checks the enabled pre-approval rules against the new catalog and match profiles. Core disables and audits each rule that does not fit.

**Defaults.** A new group starts at `ask`: reads run and each write asks. Locked operations stay off until the admin sets each one to `ask`. The access ceiling of a credential is `read` by default.

**Regroup.** The groups of the plugin are the default. The admin can merge groups and change labels. Core stores a merge as an alias (`plugin_group → group_key`) and applies it at each sync. A merge of groups with different levels takes the lower level.

**Search.** `catalog.find` returns only callable operations by default. For a user who is not an admin, it never returns an operation that the user cannot call.

### Consequences

- Good, because one function gives the gate, `search` and the portal the same answer.
- Good, because a sync, a role or a personal level can only close access, never open it.
- Bad, because a new write in an existing group is off until the admin opens it.

The model view `execute` shows the access step. The feature files `@id:access-levels`, `@id:catalog-access-on-sync`, `@id:role-access` and `@id:portal-instances` specify its behavior.
