---
status: accepted
date: 2026-10-24
---

# A metrics listener for Prometheus

## Context and Problem Statement

An operator wants to monitor how core is used, with the Prometheus server they already run. Metrics show usage across all instances and users. Where does core serve them, who can read them, and what can they contain?

## Decision Drivers

- The deployment decides what core opens. The portal must not open a port.
- A metrics reader must not reach the Admin API or an MCP endpoint.
- Metrics must not show what an agent sent or got.

## Considered Options

- A third Hono app on its own port, off by default, with an optional bearer token.
- A `/metrics` route on the admin listener, behind an admin session.
- A `/metrics` route on the MCP listener.

## Decision Outcome

Chosen option: "A third Hono app on its own port". Prometheus can reach it without a portal session, and the internet does not reach it through the MCP proxy.

| Listener | Default | Variables                                       | Serves                 |
| -------- | ------- | ----------------------------------------------- | ---------------------- |
| Metrics  | off     | `METRICS_HOST`, `METRICS_PORT`, `METRICS_TOKEN` | `/metrics`, `/healthz` |

- **Off by default.** Core opens the metrics listener only when `METRICS_PORT` is set. `METRICS_HOST` is `0.0.0.0` by default, as for the other listeners (ADR-0015).
- **Ports.** The metrics port must differ from the MCP port and the admin port. Otherwise core does not start.
- **Token.** When `METRICS_TOKEN` is set, `/metrics` needs `Authorization: Bearer <token>`. Core compares the SHA-256 digests in constant time. A missing or wrong token gets 401 and no metric. When `METRICS_TOKEN` is not set, `/metrics` is open, and core logs a warning at start. `/healthz` needs no token.
- **Format.** `@prometheus-io/client` writes the Prometheus text format. Every metric name starts with `synoikia_`.
- **Content.** Metrics count and measure. A label holds a value of core, such as an instance slug, a plugin id, an outcome or a state. A label never holds a parameter, a result, a secret, a token or a user name.
- **Counters.** The gate, the approvals and the MCP endpoints emit events on the event bus of ADR-0019. The metrics listener counts them in memory. The counters start at zero when core starts. These events go to no notification channel and to no portal stream.
- **Gauges.** At each scrape, the metrics listener reads the current numbers from the caches of the modules that own them.
- **App names.** The app name comes from the client, so core bounds it before it becomes a label. Core makes it lower case, keeps only `a-z`, `0-9`, `.`, `_` and `-`, and cuts it at 64 characters. The first 32 names keep their own label until core stops. Other names count as `other`, and an empty name counts as `unknown`.

### Consequences

- Good, because a metrics reader cannot reach a route of the other listeners.
- Good, because an install that does not set `METRICS_PORT` opens no new port.
- Bad, because metrics without a token are open to anyone who reaches the port.
- Bad, because the listener has no Host check. Without a token, a web page can make a browser on the LAN read the metrics through DNS rebinding. Set `METRICS_TOKEN` where browsers share the network.
- Bad, because the token is one shared secret in the environment, with no rotation in the portal.
- Bad, because a restart sets the counters and the active users back to zero.
- Bad, because a client can claim the name of another app. One client can also take all 32 names until core stops, so later apps count as `other`.

The model views `index` and `coreComponents` show the metrics listener. The feature file `@id:134` specifies its behavior.
