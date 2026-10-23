---
status: accepted
date: 2026-10-23
---

# Core reads plugin messages from its own framing

## Context and Problem Statement

Core and each plugin child talked over the IPC channel of `child_process.fork` (ADR-0011, ADR-0014). Node reads that channel in core before core sees a message, and a child can make Node fail there:

- A line that is not JSON throws a `SyntaxError` in Node's parser.
- A handle sent with `process.send(message, handle)` is converted in core. A forged one throws, and a converted server or socket can emit an `error` later.
- A handle that Node never delivers keeps a file descriptor in core. A child can repeat this until core runs out of descriptors, and core then stops serving without exiting.
- A regular file sent as a handle fails a check in Node's native code, and core aborts. No JavaScript can catch this.
- A Node internal message, such as `{ cmd: 'NODE_HANDLE_ACK' }`, fails an assertion.

How do core and a plugin talk so that nothing a plugin sends can stop core?

## Decision Drivers

- One plugin must not stop core or the other instances (ADR-0014).
- A fault in core itself must still stop core, so that the restart policy starts it clean.
- Core must not depend on Node internals to stay up.

## Considered Options

- Core's own framing on a plain pipe.
- The Node IPC channel, with the handle listener removed and the parser faults caught.
- No change. A plugin can already stop core with a signal (ADR-0002, remaining risk 13).

## Decision Outcome

Chosen option: "Core's own framing on a plain pipe". A plain pipe carries bytes only. The kernel drops any file descriptor that a child sends on it, so core never receives a handle.

- Core starts the child with `child_process.spawn` and a plain pipe on file descriptor 3. It has no `ipc` channel.
- Each message is one JSON value on one line, in UTF-8. JSON escapes line breaks inside strings, so a line break always ends a message.
- The SDK writes and reads the same framing. A pure frame reader in the SDK splits the stream for both sides.
- Core accepts a line of 64 MiB at most. A line that is not JSON is a message that is not valid (`@id:plugin-isolation`). A longer line ends the stream, so core stops the child, and supervision starts it again (ADR-0014).
- Core skips empty lines. Each instance may send 100 messages that are not valid in a second. Above that, core stops the child, as for a long line.
- When the child closes its end of the pipe and does not exit within a second, core stops it.
- This changes the contract, so the contract version becomes `0.3.0` (ADR-0011). A plugin built for `0.2` is incompatible and does not load.

### Consequences

- Good, because no byte, handle or file descriptor from a plugin reaches Node's IPC code in core.
- Bad, because the cap limits bytes, not the memory that parsing them takes. One line under the cap can take more than 1 GiB of heap in core. Core also keeps every request for a child that does not read. Plugin resource limits (step 9 of the security plan) set these bounds.
- Good, because core needs no process-wide error handler and no Node internals for this.
- Bad, because every plugin must be built again with the new SDK before it runs on this core.
- Bad, because a plugin can no longer send a handle to core. No plugin uses this.

The model view `coreComponents` shows the channel between the instance and the plugin host.
