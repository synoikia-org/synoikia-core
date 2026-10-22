---
status: accepted
date: 2026-09-29
---

# A child process for each instance

## Context and Problem Statement

Plugin code comes from many authors and handles upstream credentials (ADR-0013). Core holds the master key, the database and the secrets of every instance. Where does plugin code run, and what can it reach?

## Decision Drivers

- A plugin must never read the master key, the database or the secrets of another instance.
- A plugin crash must not stop core or other instances.
- A call must fail closed while a plugin is down.

## Considered Options

- A child process for each instance, under the Node permission model, with a clean environment and secrets only through `init`.
- Plugins in the core process.
- A container for each instance.

## Decision Outcome

Chosen option: "A child process for each instance, under the Node permission model". It needs no container runtime, and each instance has its own memory, secrets and crash.

Core starts each enabled instance with `child_process.fork(entry)` and these limits:

- **Node permission model.** The flags are `--permission` and `--allow-fs-read=<plugin directory>`. There is no write, child-process, worker or add-on permission.
- The child cannot read outside its directory, cannot write files, and cannot start processes. A plugin cannot change these flags.
- **Clean environment.** The child gets only `NODE_ENV` and `PLUGIN_INSTANCE_ID`. It never sees `MASTER_KEY`, database paths, or admin configuration.
- **Memory limit.** `--max-old-space-size`, 256 MB by default, set for each instance.
- **Secrets only through `init`.** Core decrypts the secrets of that instance only and sends them in `init` (ADR-0011).
- **No debugger.** A child can send signals to the process that started it. Before the first fork, the plugin host listens for `SIGUSR1` for the rest of the process. Node then never opens its debugger on that signal, so a child cannot run code in core. This holds in each process that starts plugins, such as the plugin harness. Core audits a refused signal, at most once a minute with the count.

**Supervision.**

- If the child crashes, the instance status becomes `error`. Core starts it again with exponential backoff, from 1 s to 60 s. Core audits the crash and sends a notification.
- Start, stop and restart of an instance run one at a time. A stop or restart kills a child that is still in `init`. At most one child of an instance is alive.
- While the child is down, `execute` calls fail with `PLUGIN_UNAVAILABLE`. The gate does not need the plugin to refuse a call, so it never fails open.
- **Bundle version.** Just before each fork, core reads the version in the `manifest.json` of the bundle. If the catalog does not come from this version, core syncs before the endpoint serves again.
- The gate also refuses a call if the bundle changed while the call waited (ADR-0003).

**Known limit: network access is not restricted.** The Node permission model does not control network access. A plugin can connect to any host that the container can reach. `network.hosts` is a declaration that the admin reviews.

A container egress policy restricts network access (README › Deployment › Network egress). Issues #108 and #111 track network control in core.

**Known limit: a child can stop core.** The child runs as the same user as core, so it can send `SIGTERM` or `SIGKILL` to core. Core then stops until a restart policy starts it again, as in `docker-compose.example.yml`. A separate user for each child would stop this.

### Consequences

- Good, because a plugin never sees the master key, the database or another instance's secrets.
- Good, because a crash affects one instance, and its calls fail closed until it is back.
- Bad, because a plugin can reach any network host, and it can stop core. ADR-0002 lists these risks.
- Bad, because each instance costs a Node process and its memory.

The model views `containers` and `deployment` show the children. The feature files `@id:plugin-isolation`, `@id:instance-supervision` and `@id:plugin-runtime` specify its behavior.
