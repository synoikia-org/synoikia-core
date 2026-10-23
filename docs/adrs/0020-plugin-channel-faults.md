---
status: accepted
date: 2026-10-23
---

# Core survives a plugin that breaks its message channel

## Context and Problem Statement

Core and each plugin child talk over the IPC channel of `child_process.fork` (ADR-0011, ADR-0014). Core checks each message that reaches the `message` event. Node reads the channel before that event, and a child can make Node's own code throw there:

- A line that is not JSON on the channel. The child can write it to the channel's file descriptor. Node throws a `SyntaxError` in `parseChannelMessages`.
- A handle that the child sends with `process.send(message, handle)`. Node converts it in the parent, and a forged handle throws, for example `ERR_SOCKET_BAD_TYPE`. A converted server or socket can also emit an `error` later, and each handle keeps a file descriptor in core.
- A Node internal message, such as `{ cmd: 'NODE_HANDLE_ACK' }`. Node throws `ERR_INTERNAL_ASSERTION`.

Each error is uncaught, so core stops. How does core stay up?

## Decision Drivers

- One plugin must not stop core or the other instances (ADR-0014).
- A fault in core itself must still stop core, so that the restart policy starts it clean.
- A guard must not depend on a list of error shapes that a Node update or a new handle type can extend.

## Considered Options

- Refuse handles and internal messages for each child, and handle the one parse fault in the server entry.
- An `uncaughtException` handler that matches every fault by its error shape.
- Core's own framing on a separate pipe, parsed for each child.
- No guard. A plugin can already stop core with a signal (ADR-0002, remaining risk 13).

## Decision Outcome

Chosen option: "Refuse handles and internal messages for each child". Core never converts or keeps a plugin's handle, and it needs no SDK change.

- **For each child.** After the fork, the plugin host removes Node's `internalMessage` listener from the child. Its own listener closes any handle that arrives and counts the message as a message that is not valid, with the slug (`@id:plugin-isolation`). A child that sends a handle blocks its own channel, so only its own calls time out.
- **In the server entry.** Only `main.ts` installs an `uncaughtException` handler, so the plugin harness and tests do not have one. The pure function `isPluginChannelFault` matches only the `SyntaxError` from `parseChannelMessages`, by the frames of its stack and not by its message. Core then logs a warning that a plugin broke its message channel, at most once a minute. The line has no slug, because Node does not say which child wrote it.
- Any other error prints its stack, and core exits with code 1, as before.

### Consequences

- Good, because no handle, internal message or line that is not JSON from a plugin stops core.
- Good, because a fault in core still stops core.
- Bad, because both parts depend on Node internals: the name of the `internalMessage` event and the `parseChannelMessages` frame. Unit tests with real Node processes pin both, so a Node update that changes them fails the tests.
- Bad, because core cannot say which plugin wrote a line that is not JSON, and it does not stop that plugin.

Core's own framing on a pipe would name the plugin and stop it. It changes the SDK side of the channel, so it belongs with a separate user for each plugin (issues #108 and #111). The feature file `@id:plugin-isolation` specifies the behavior.
