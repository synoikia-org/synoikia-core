---
status: accepted
date: 2026-10-24
---

# A plugin that stops sending heartbeats is started again

## Context and Problem Statement

Core restarts a child that exits (ADR-0014). A child whose event loop blocks does not exit. Each call to it then waits for its timeout and fails, without end. Core cannot tell such a child from one that waits for a slow upstream, because both leave the call open. How does core find a child that stopped running, and keep the guarantees of ADR-0014?

## Decision Drivers

- A child that waits for a slow upstream must not restart.
- A plugin built on an older SDK, and an older core, must keep working.
- The check must not depend on a call that already failed.

## Considered Options

- The child sends a heartbeat, and core restarts a child that stops.
- Core pings the child after a call times out.
- Core restarts the child after a number of timeouts in a row.

## Decision Outcome

Chosen option: "The child sends a heartbeat, and core restarts a child that stops". Only a running event loop sends it, so it tells a blocked child from a waiting one. It also finds a blocked child when no call runs.

- **Contract.** Core passes `heartbeatMs` in `init`, 5 s by default. The child then sends the notification `heartbeat` at that interval. Plugin contract `0.3.1` adds both. A child that gets no `heartbeatMs`, from an older core, sends none.
- **Watch.** Core watches a child from its first heartbeat. A child that never sends one, from an older SDK, is never watched, and works as before.
- **Restart.** When three intervals pass with no heartbeat, core kills the child. Supervision counts it as a crash, with the reason `stopped_answering`, and follows the back-off of ADR-0014. Core audits it and sends the crash notification. The calls that wait on the child fail as `PLUGIN_UNAVAILABLE`.

### Consequences

- Good, because a blocked child no longer holds its instance until an admin acts.
- Good, because a slow upstream never restarts a child.
- Bad, because only plugins built on SDK 0.9.0 or later get the check. A plugin repository must rebuild.
- Bad, because a child that blocks its event loop on purpose for longer than three intervals restarts. The interval sets how long a plugin may block.

The model view `coreComponents` shows the plugin host.
