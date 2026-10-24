---
status: accepted
date: 2026-09-29
---

# Classification fails closed

## Context and Problem Statement

Core decides access by classification: read or write, and locked or not (ADR-0004). A plugin builds these from upstream data that can be incomplete, such as an OpenAPI document or an introspection call. Some operations are only dangerous for some parameters or targets. How does a plugin give a classification that never errs toward open?

## Decision Drivers

- An operation with no clear classification must be treated as a write.
- A lock must be a property of one catalog row, so that core can enforce it.
- The rules of a plugin must be data that a review can read, not code.

## Considered Options

- Rules as data in `plugin.yaml`, applied by the SDK in a fixed order that fails closed, and split twins for risks that depend on parameters.
- Classification in plugin code only.
- Core decides the risk from the parameters of each call.

## Decision Outcome

Chosen option: "Rules as data in `plugin.yaml`, in a fixed order that fails closed". The rules are easy to review, and core sees only the resulting descriptors.

A plugin built on the SDK declares its operation rules in `plugin.yaml`. The SDK rules engine (`compileRules`) applies them when the plugin builds its catalog, and the build puts the file into the bundle. The file format is in [`plugin-authoring.md`](../plugin-authoring.md).

`plugin.yaml` declares:

- Locked operations and split twins.
- Classifications that replace the plugin heuristic.
- Match profiles, `sensitiveParams` and `sensitiveResult`.
- Confirmation literals, summary notes, descriptions and guidance.
- Operations to exclude from the catalog.
- Declared operations, for upstreams that core cannot discover.

The classification fails closed, in this order:

1. An excluded operation does not exist. A request to an excluded path is refused, also when a path template has the same form. The SDK also refuses a request in three cases. A literal path matches it only without case, or with a suffix such as `.json`. A template that the catalog leaves out matches it. Or no matching template is the most specific.
2. A locked operation, or a split twin, is a write with typed confirmation. An operation with typed confirmation is locked.
3. A classification from a rule.
4. The plugin heuristic, for example `GET` reads and other HTTP methods write.
5. If nothing gives a classification, the operation is a write.

**Split twins.** The risk of some operations depends on their parameters or targets. The plugin then gives the operation a second catalog key, `<key>#<suffix>`, which is always locked. `resolveOperation` selects the twin for each call.

For example, `cover.open_cover#garage` is the key when a resolved target is a garage door. This keeps `locked` as a property of one catalog row, so core can enforce it.

### Consequences

- Good, because an operation that no rule or heuristic covers is a write, and an access level guards it.
- Good, because a review of `plugin.yaml` shows every lock and every override of a plugin.
- Bad, because a split twin needs `resolveOperation` to select it correctly. A plugin error there gives the open key. The compliance suite checks each lock and twin.

The feature files `@id:operation-rules`, `@id:openapi-catalog`, `@id:static-catalog` and `@id:plugin-compliance` specify its behavior.
