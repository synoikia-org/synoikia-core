---
status: accepted
date: 2026-09-29
---

# One gate for every call

## Context and Problem Statement

The model writes code that calls upstreams through bindings in the sandbox. Core makes every security decision (ADR-0001). In which order does core decide a call, and what does it check again before the upstream gets it?

## Decision Drivers

- A call can wait minutes for a human. The catalog, the access level, the targets or the plugin bundle can change in that time.
- The model must get a clear refusal that its code can catch, and the host must never stop.
- A denied or refused call must cost the principal nothing and must reach the audit log.

## Considered Options

- One pipeline in core for each binding call, with the checks done again after an approval.
- Checks at the MCP request only, with each call of the code then trusted.
- Checks in each plugin.

## Decision Outcome

Chosen option: "One pipeline in core for each binding call". Only a check at each call sees the operation, the parameters and the targets that reach the upstream.

```
binding(args)
  │
  ├─ 0. resolveOperation (plugin)       → key, params              | UNKNOWN_OPERATION
  ├─ 1. access level (ADR-0004) under the principal's ceiling       | OPERATION_DISABLED {reason}
  │      mode: run (read) · approve (ask) · auto (write at level write)
  ├─ 2. attestation (if required)                                   | ATTESTATION_REQUIRED
  ├─ 3. resolveTargets (plugin, if targets)                         | TARGET_RESOLUTION_FAILED
  ├─ 4. prepareWrite (plugin, configTransform and kind config)      | CONFIG_CONFLICT
  ├─ 5. mode run (read) → invoke
  │     writes: write rate limit checked                            | RATE_LIMITED
  ├─ 6. mode auto → invoke (auto-approved:level)
  │     mode approve: session grant (ADR-0006) → invoke (auto-approved:grant:<id>)
  │     mode approve: pre-approval rule (never locked) → invoke (auto-approved:rule:<id>)
  ├─ 7. human approval (ADR-0006), then access checked again        | PERMISSION_DENIED / OPERATION_DISABLED
  │      operation checked again                                    | OPERATION_CHANGED
  ├─ 8. targets resolved again                                      | TARGETS_CHANGED
  ├─ 9. catalog version checked again, write counted                | PLUGIN_UNAVAILABLE / RATE_LIMITED
  ├─ 10. invoke (plugin)                                            | UPSTREAM_* / PLUGIN_* / INVALID_PARAMS / TIMEOUT
  ├─ 11. redaction of the result (ADR-0007)
  └─ 12. audit (each branch, refusals included)
```

`docs/reference.md` lists the binding error codes and the run result codes.

These rules apply to the pipeline:

- **Refusals are errors in the sandbox.** Core throws each refusal into the sandbox as an `Error` with a `code` property. The code can catch it. A refusal never stops the host.
- **One call at a time.** The calls of one `execute` run in sequence. While a call waits for approval, the full `execute` waits.
- **An `execute` ends with its sandbox.** The run ends when the script returns, throws or times out, the MCP request is cancelled, or the session closes. Core then refuses the remaining calls (`EXECUTION_ENDED`) and cancels an open approval. A parked execution (ADR-0006) is the one exception.
- **Catalog version.** Core reads the catalog version when it gates a call, and again just before `invoke`. If it is not set or it changed, core refuses the call with `PLUGIN_UNAVAILABLE`. A call then never runs under the rules of another bundle.
- **Checks after an approval.** After a human approves, core checks the access level, the operation, the targets and the catalog version again. The approval applies only to what the approver saw.
- **Timeouts.** The deadline of an `invoke` is 500 ms before the end of the sandbox time limit. With less than 600 ms left, core sends nothing upstream and refuses the call with `TIMEOUT`.
- **Unknown results.** Core cannot cancel an `invoke` that timed out, and the upstream can still complete the write. Core audits the call as `error:UPSTREAM_TIMEOUT`, which means "result unknown". Each `invoke` has a unique `context.callId` that a plugin can send as an idempotency key.
- **`prepareWrite`** runs for write operations of kind `config` on plugins with `configTransform`.

**Rate limits.** These limits apply for each principal and instance. They are separate from the limits of pre-approval rules.

| Limit                    | Default                                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execute` and `search`   | 30 each minute                                | Core refuses a run with `RATE_LIMITED` before it creates an isolate.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Upstream writes          | 10 each minute                                | Checked before an approval, counted only when the write runs. A denied call costs nothing.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Sandbox at the same time | 4 for each instance, 16 for each CPU in total | Over the limit, a run waits up to 2 s for a place, first come first served, then gets `BUSY`. The wait does not count against the sandbox time limit. The admin sets the total, from 2 to 256, and the limit for each instance. The total also bounds the memory of the isolates, so lower it on a host with many CPUs and little memory. An instance limit is at most one less than the total, so another instance can always run. A cancelled run leaves the queue. A parked execution gives back its place. |

**Attestation.** Some operations need the model to read a best-practice guide first (`attestationRequired`).

- `guides.get` in `search` returns the guide with its key.
- The key is `HMAC(attestation key, instance ‖ operation key ‖ guide version ‖ MCP session id)`.
- The key works only in the MCP session that read the guide. A new guide version makes all old keys invalid.
- Core audits each guide read as a `search` event with `decision: guide_read`, the guide version and the MCP session.

**Pre-approval rules.** A rule approves matching calls without a human. Its `match` is a list of conditions, and all of them must be true.

- `{ field: "/json/pointer", op: "eq" | "in" | "prefix" | "range" | "bool", value }` applies to the normalized parameters. A missing field gives no match. `prefix` matches at a path segment boundary. A value with a dot part never matches a `prefix`, so the call goes to a human. A dot part has only dots and spaces. It ends at `/`, `\`, a Unicode slash, a Windows best-fit backslash or a control character. Core checks it also after it decodes `%`-escapes and NFKC forms, and it ignores invisible format characters. A value that stays encoded fails closed. A rule cannot hold a `prefix` with a dot part, and catalog sync turns off a stored one.
- `{ field: "$targets", ids?, scopes? }` is true only if each resolved target meets all given selectors. Zero targets gives no match. A rule uses only the scope keys that the operation's `$targets` field offers.
- **Strict matching.** A condition must cover each parameter of the call, and a condition on a path covers everything below it. A `$targets` condition also covers the subtrees in its field's `covers`.
- A parameter that the rule does not mention must be absent. An empty object or list is a parameter too. `{ field, op: "any" }` accepts it. If the conditions were true but the call had extra parameters, core records `strict_miss_at` on the rule.
- Over its `rate_limit` in `window_seconds`, a rule sends the call to a human. Core does not refuse it.
- A rule applies only at level `ask`. It never applies to a locked operation.
- An admin rule applies to the calls of all users. An own rule applies only to the calls of its owner, while the owner's role allows own rules.

### Consequences

- Good, because a change during an approval can never run a call that the approver did not see.
- Good, because each branch of the pipeline writes one audit event, refusals included.
- Bad, because the calls of one `execute` run in sequence, so a script that waits on an approval waits in full.
- Bad, because a write that timed out has an unknown result. The plugin and the upstream must handle a repeat.

The model views `execute` and `approval` show the pipeline. The feature files `@id:call-pipeline`, `@id:rate-limits`, `@id:call-targets`, `@id:config-write`, `@id:attestation`, `@id:catalog-search` and `@id:pre-approval-rules` specify its behavior.
