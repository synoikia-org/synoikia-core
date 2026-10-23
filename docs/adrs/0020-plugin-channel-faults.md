---
status: accepted
date: 2026-10-23
---

# Core survives a plugin that breaks its message channel

## Context and Problem Statement

Core and each plugin child talk over the IPC channel of `child_process.fork` (ADR-0011, ADR-0014). Core checks each message that reaches the `message` event. Node reads the channel before that event, and two faults there throw out of Node's own code:

- A line that is not JSON on the channel. The child can write it to the channel's file descriptor. Node throws a `SyntaxError` in `parseChannelMessages`.
- An internal message `{ cmd: 'NODE_HANDLE_ACK' }` or `NODE_HANDLE_NACK`. The child can send it with `process.send`. Node throws `ERR_INTERNAL_ASSERTION`.

Each error is uncaught, so core stops. Neither error names the child. How does core stay up?

## Decision Drivers

- One plugin must not stop core or the other instances (ADR-0014).
- A fault in core itself must still stop core, so that the restart policy starts it clean.
- The handler must not change processes that embed core, such as the plugin harness of `@synoikia/core/testing`.

## Considered Options

- A narrow `uncaughtException` handler in the server entry.
- Core's own framing on a separate pipe, parsed for each child.
- No guard. A plugin can already stop core with a signal (ADR-0002, remaining risk 13).

## Decision Outcome

Chosen option: "A narrow `uncaughtException` handler in the server entry". It needs no SDK change, so every plugin keeps working.

- Only `main.ts` installs the handler. The plugin harness and tests do not.
- The pure function `isPluginChannelFault` matches only the two faults above. It checks the error and the `node:internal/child_process` frames of its stack.
- On a match, core logs a warning that a plugin broke its message channel. It logs at most one line a minute, with the count of the repeats. The line names no instance, because Node does not say which child wrote it.
- Any other error prints its stack, and core exits with code 1, as before.

### Consequences

- Good, because a plugin that breaks its channel no longer stops core.
- Good, because a fault in core still stops core.
- Bad, because core cannot say which plugin broke its channel, and it does not stop that plugin.
- Bad, because the match depends on Node's internal stack frames. A Node update can change them, and the unit test of `isPluginChannelFault` then fails.

Core's own framing on a pipe would name the plugin and stop it. It changes the SDK side of the channel, so it belongs with a separate user for each plugin (issues #108 and #111). The feature file `@id:plugin-isolation` specifies the behavior.
