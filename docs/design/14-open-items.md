# §14 Open items

1. **Network access control for each plugin** (§4.4). Two options: send plugin traffic through a proxy in core that enforces `network.hosts`, or run plugins in separate network namespaces. Until then, use a container egress policy (§11).
