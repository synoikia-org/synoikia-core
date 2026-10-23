# Open-source, self-hostable MCP gateways, aggregators and proxies (competitors to Synoikia), as of October 2026

Research method note: GitHub (web and API) was blocked from this research session (HTTP 403 via the proxy), and WebFetch failed with DNS errors for several third-party comparison sites. As a result, **GitHub star counts, exact last-commit dates and release cadences could not be verified for any project**. Findings below come from search-engine extracts of primary pages (official docs, release pages, PyPI, vendor sites) and secondary comparison blogs. Many comparison blogs are vendor-written (Maxim/Bifrost, Lunar, Pomerium, Composio, Requesty, Zuplo, TrueFoundry, ToolMesh), so treat their claims as directional. Items marked "(prior knowledge, unverified in this session)" come from the researcher's training data (cutoff mid-2026) and should be confirmed before publication.

## Per-tool profiles (what it is, license, backing, maturity, deployment, features, strengths/weaknesses vs Synoikia)

### Takeaway
The field splits into (a) enterprise/Kubernetes infrastructure gateways (agentgateway, Envoy AI Gateway, Microsoft MCP Gateway, Kong, Traefik Hub, Pomerium, ContextForge, Obot, Archestra) that proxy arbitrary existing MCP servers and focus on authn/authz, routing and observability; (b) LLM gateways that added MCP (LiteLLM, Bifrost, Portkey); and (c) lightweight aggregators for developers and homelabs (MetaMCP, MCPJungle, 1MCP, mcpo, mcp-proxy, Magg, mcp-hub, Unla). Only Bifrost (Code Mode, Starlark sandbox) and Docker MCP Gateway (experimental `code-mode` tool) overlap with Synoikia's code-mode-plus-sandbox design. No project found combines code mode with an out-of-band approval page that the client cannot self-approve.

### Cited Findings

**IBM ContextForge (IBM/mcp-context-forge)**
- AI gateway, registry and proxy in front of MCP, A2A and REST/gRPC APIs, exposing a unified endpoint with centralized discovery, guardrails and management, with plugin support — [GitHub repo](https://github.com/IBM/mcp-context-forge)
- v1.0.0 "General Availability" released 2026-04-30, consolidating 93 PRs; includes end-user identity propagation, OAuth token validation with JWKS, audience enforcement, Microsoft Entra ID support, account lockout protection, SSRF protection and plugin framework enhancements — [Release v1.0.0](https://github.com/IBM/mcp-context-forge/releases/tag/v1.0.0)
- Latest PyPI package 1.0.10, uploaded 2026-09-07 (active maintenance in the 1.0.x line) — [PyPI](https://pypi.org/project/mcp-contextforge-gateway/)
- 1.0.0 Beta announcement: "more than 30 built-in safety guardrails" run on every request — [IBM Developer blog](https://developer.ibm.com/blogs/context-forge-mcp-gateway-now-available/)
- Installs via PyPI, Docker or Helm; license reported inconsistently across comparison blogs (MIT vs Apache 2.0) — [Maxim comparison](https://www.getmaxim.ai/articles/open-source-mcp-gateways-for-developers-in-2026/), [Requesty comparison](https://www.requesty.ai/blog/mcp-gateway-comparison-2026-enterprise-scalability-security)
- Project roadmap page is stale (lists GA at 0% although GA shipped) — [Roadmap](https://ibm.github.io/mcp-context-forge/architecture/roadmap/)
- Strengths vs Synoikia: IBM backing, federation of REST/gRPC into MCP (closest to Synoikia's "wrap an API" model), broad guardrail plugin set, Helm/HA deployment. Weaknesses vs Synoikia: no code mode or sandboxed execution found; no human-approval page found; heavier (Python, enterprise oriented).

**MetaMCP (metatool-ai/metamcp)**
- "MCP Aggregator, Orchestrator, Middleware, Gateway in one docker"; aggregates upstream MCP servers into namespaces, each served as one authenticated endpoint; MIT; Docker Compose with admin UI on port 12008 backed by Postgres; SSE/Streamable HTTP, stdio clients need a local bridge — [GitHub](https://github.com/metatool-ai/metamcp), [mcp.directory guide](https://mcp.directory/blog/metamcp-complete-guide-2026), [Coolify one-click](https://coolify.io/docs/services/metamcp)
- Middleware to filter or transform requests; described as the "tinkerer's pick"; one source says it hides large catalogs behind a small set of meta-tools — [Maxim comparison](https://www.getmaxim.ai/articles/open-source-mcp-gateways-for-developers-in-2026/)
- The hosted cloud version is marked outdated; the self-hosted repo is the supported path; several community forks exist — [metamcp.com](https://metamcp.com/), [fork example](https://github.com/TanNhatCMS/metamcp)
- Strengths vs Synoikia: proxies any existing MCP server, Coolify one-click, homelab-friendly. Weaknesses: no per-operation read/write classification, approvals, redaction or sandbox found.

**Docker MCP Gateway / MCP Toolkit (docker/mcp-gateway)**
- Ships as `docker mcp` CLI plugin and inside Docker Desktop MCP Toolkit; runs MCP servers from the Docker MCP Catalog in containers — [Docker docs, Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit.md), [developersdigest listing](https://www.developersdigest.tech/mcp-servers/docker-mcp-gateway)
- "Dynamic MCP" (experimental, early development): management tools `mcp-find`, `mcp-add`, `mcp-config-set`, `mcp-remove`, `mcp-exec` and `code-mode` ("creates a JavaScript-enabled tool that combines multiple MCP server tools"); dynamically added servers are per session and not persisted; requires Docker Desktop 4.50+ — [Docker docs, Dynamic MCP](https://docs.docker.com/ai/mcp-catalog-and-toolkit/dynamic-mcp/), [Docker blog](https://www.docker.com/blog/dynamic-mcps-stop-hardcoding-your-agents-world/)
- Strengths vs Synoikia: largest curated catalog of containerized servers, container isolation, a code-mode feature, Docker brand. Weaknesses: code mode experimental; desktop/developer oriented rather than an always-on multi-client server; no approval page, per-op access levels or redaction found.

**Microsoft MCP Gateway (microsoft/mcp-gateway)**
- Kubernetes reverse proxy for session-aware routing and MCP server lifecycle management; Entra ID integration — [Maxim comparison](https://www.getmaxim.ai/articles/best-mcp-gateways-to-connect-tools-and-mcp-servers-to-your-ai-agent/), [Maxim open-source list](https://www.getmaxim.ai/articles/open-source-mcp-gateways-for-developers-in-2026/)
- No authorization model detail found in this session.
- Strengths: Azure/AKS fit. Weaknesses vs Synoikia: k8s-only, no HITL, no context reduction found.

**agentgateway (Linux Foundation, originally Solo.io)**
- Rust proxy for MCP, A2A and LLM traffic; Apache 2.0; hosted by Linux Foundation after Solo.io donation; auth via JWT, API keys, OAuth; CEL-based RBAC — [agentgateway.dev](https://agentgateway.dev/), [Maxim agent gateways](https://www.getmaxim.ai/articles/best-open-source-agent-gateways-for-mcp-and-a2a-in-2026/)
- CEL rules can gate individual tools on a role (per-tool pattern) — [mehdihadeli tutorial](https://mehdihadeli.com/blog/agentgateway-ai-gateway)
- No evidence of approval workflows — [search summary of agentgateway site](https://agentgateway.dev/)
- Strengths vs Synoikia: high performance, neutral foundation governance, per-tool CEL policy, multiplexing of existing servers. Weaknesses: infrastructure component, no HITL, no code mode, no API-native read/write classification.

**Envoy AI Gateway**
- Added MCP support; claims fine-grained authorization on tool invocations — [Envoy AI Gateway blog](https://aigateway.envoyproxy.io/blog/mcp-implementation/)
- Strengths/weaknesses: Envoy/Kubernetes Gateway API ecosystem; enterprise k8s audience; no HITL or code mode found.

**Unla (AmoyLab/Unla, formerly mcp-ecosystem/mcp-gateway)**
- Go gateway converting REST APIs (via Go text/template config) and existing MCP servers (stdio, SSE, streamable HTTP) into MCP endpoints with zero code changes; management UI; Docker/Kubernetes; multi-tenancy, persistent sessions, OAuth pre-authentication; gRPC/WebSocket conversion "in development"; warns backward compatibility not guaranteed (rapid development); v0.10.0 release mirrored on SourceForge — [GitHub](https://github.com/AmoyLab/Unla), [docs](https://docs.unla.amoylab.com/en), [deepwiki](https://deepwiki.com/mcp-ecosystem/mcp-gateway), [SourceForge mirror](https://sourceforge.net/projects/unla.mirror/)
- Strengths vs Synoikia: config-only REST-to-MCP (competes with Synoikia's OpenAPI catalog plugins). Weaknesses: every endpoint becomes a tool (no code mode); no permission gate/HITL found.

**MCPJungle (mcpjungle/MCPJungle)**
- Self-hosted MCP registry and gateway; single binary or Docker Compose; dev mode and enterprise mode; single `/mcp` endpoint aggregating all registered servers — [Maxim top 5](https://www.getmaxim.ai/articles/top-5-open-source-mcp-gateways-for-self-hosted-ai-infrastructure/), [Lunar comparison](https://www.lunar.dev/post/the-best-open-source-mcp-gateways-in-2026)
- RBAC and audit described as "basic" (Lunar comparison; Lunar is a competitor) — [Lunar](https://www.lunar.dev/post/the-best-open-source-mcp-gateways-in-2026)
- Strengths: simplicity, homelab fit. Weaknesses: thin governance.

**1MCP (1mcp-app/agent)**
- Unified MCP server aggregating multiple MCP servers into one — [awesome-mcp.tools aggregators](https://awesome-mcp.tools/category/aggregators), [awesomeclaude aggregators](https://awesomeclaude.ai/mcp/aggregators)
- No feature detail obtained in this session.

**Obot (obot-platform/obot)**
- MIT core, open-core; self-hosted on Kubernetes or Docker — [GitHub](https://github.com/obot-platform/obot), [Obot site](https://obot.ai/mcp-gateway-platform/)
- Architecture: gateway is a reverse proxy for authentication, server deployment and forwarding; a shim beside each MCP server does authorization, audit logging, webhook filters and token exchange; filters (MCP filter servers, HTTP webhooks, built-in credential filters) can inspect, reject or modify requests and responses; server/tool access by user or IdP group through vMCP profiles; tool search for large virtual servers; full logs of tool calls and LLM requests exportable — [Obot docs](https://docs.obot.ai/concepts/mcp-gateway/)
- Enterprise SSO (Okta/Entra/Auth0/JumpCloud) gated to the paid tier, per a third-party comparison — [ToolMesh comparison](https://www.toolmesh.io/en/mcp-gateway-comparison/)
- Strengths vs Synoikia: catalog, per-group tool access, audit export, webhook filters that could implement approvals, tool search. Weaknesses: SSO paywalled; heavier enterprise platform; no native approval page found.

**Lasso Security MCP Gateway (lasso-security/mcp-gateway)**
- Plugin-based gateway orchestrating other MCPs; plugins include PII masking, secret masking, custom policy, prompt-injection and harmful-content checks (some via Lasso's API); MCP server reputation scanning — [GitHub](https://github.com/lasso-security/mcp-gateway)
- No tool-approval workflow found — [Composio comparison](https://composio.dev/content/best-mcp-gateway-for-developers)
- Strengths vs Synoikia: secret/PII masking (overlaps Synoikia redaction). Weaknesses: advanced guardrails depend on Lasso's commercial API; no permission levels/HITL.

**Stacklok ToolHive (stacklok/toolhive)**
- Runs every MCP server in its own container with minimal permissions and no local credentials; "optimizer" filters the tool list before it reaches the LLM; Cedar-based policy — [Maxim top 5](https://www.getmaxim.ai/articles/top-5-open-source-mcp-gateways-for-self-hosted-ai-infrastructure/), [Requesty](https://www.requesty.ai/blog/mcp-gateway-comparison-2026-enterprise-scalability-security)
- Strengths vs Synoikia: container isolation including network (addresses Synoikia's missing egress restriction), Cedar policy, tool-list optimizer. Weaknesses: no HITL approval page found.

**Pomerium MCP**
- Identity-aware proxy; policies can separate tools inside one server (allow a read call, deny a delete call) — [Pomerium blog (vendor)](https://www.pomerium.com/blog/top-5-agentic-gateways-for-securing-mcp-tool-calls-in-2026)
- Strengths: mature zero-trust identity, per-tool policy. Weaknesses: no code mode, no HITL found.

**Lunar.dev MCPX**
- Governance gateway: token auth, role-based access, agent-specific tool restrictions; admin approval process for adding MCP servers (not per tool call); guardrails on full requests incl. tool arguments — [Composio](https://composio.dev/content/best-mcp-gateway-for-developers), [Lunar security](https://www.lunar.dev/security)

**Archestra**
- Kubernetes-native MCP platform with registry, gateway and orchestrator; deterministic guardrails for tool calls, "Dual-LLM" verification and "Lethal Trifecta" protections; per-environment egress and cost limits; guardrail policies layer on top of permissions — [GitHub (mirror)](https://github.com/azaj01/archestra), [Archestra docs](https://archestra.ai/docs/reference/archestra-mcp-server), [awesome-ai-gateway](https://github.com/cuihuan/awesome-ai-gateway)
- Strengths vs Synoikia: prompt-injection-aware design, egress limits. Weaknesses: k8s-native, enterprise.

**Bifrost (Maxim AI, maximhq/bifrost)**
- LLM gateway with MCP gateway; tool calls treated as suggestions, execution requires explicit API calls by default; opt-in Agent Mode with per-tool auto-execute (`tools_to_auto_execute`) — [Bifrost docs](https://docs.getbifrost.ai/mcp/gateway-url), [Maxim architecture guide](https://www.getmaxim.ai/articles/mcp-gateway-architecture/)
- Code Mode: model discovers/reads only needed tools, writes a script, executed in a sandboxed Starlark interpreter; vendor claims up to 92.8% input-token reduction across 500+ tools; per-client setting — [Maxim, What is Code Mode](https://www.getmaxim.ai/articles/what-is-code-mode-in-bifrost-mcp-gateway/), [Bifrost blog](https://www.getmaxim.ai/bifrost/blog/bifrost-mcp-gateway-access-control-cost-governance-and-92-lower-token-costs-at-scale)
- Virtual keys set a tool ceiling; headers can only narrow; deny-by-default allow-list re-checked at execution — [Bifrost blog](https://www.getmaxim.ai/bifrost/blog/bifrost-mcp-gateway-access-control-cost-governance-and-92-lower-token-costs-at-scale)
- Strengths vs Synoikia: the closest architectural rival (code mode + sandbox + per-key ceilings), also an LLM router. Weaknesses: "approval" means the calling application must make the execute call, not an out-of-band human page; aimed at app developers, not homelab services.

**LiteLLM MCP gateway (BerriAI/litellm)**
- MCP permissions by key and team; execution-control model not published — [Maxim LLM gateways comparison (competitor)](https://www.getmaxim.ai/articles/5-best-llm-gateways-for-ai-agents-in-2026-mcp-support-tool-governance-and-cost-tracking/)

**Traefik Hub MCP Gateway** (commercial, not OSS)
- Task-based access control across tasks, tools and transactions — [Traefik](https://traefik.io/solutions/mcp-gateway)

**Kong AI Gateway**
- Plugins proxy, secure and observe MCP traffic beside regular APIs — [Maxim list](https://www.getmaxim.ai/articles/best-mcp-gateways-to-connect-tools-and-mcp-servers-to-your-ai-agent/)

**Magg (sitbon/magg)**
- Meta-MCP server letting LLMs discover, install and orchestrate MCP servers autonomously — [awesome-mcp.tools](https://awesome-mcp.tools/category/aggregators)

**Additional notable tools found**
- **hoop.dev**: open-source L7 gateway where policy can require a human to approve an operation; request is paused, reviewer notified (email, Slack, ticketing), proceeds only on explicit allow — [hoop.dev guide](https://hoop.dev/blog/a-guide-to-human-in-the-loop-approval-in-mcp)
- **Octelium**: self-hosted zero-trust platform with tool-level authorization (allow/deny MCP methods and tools) — [Octelium](https://octelium.com/solutions/open-source-mcp-gateway)
- **Peta**: zero-trust MCP gateway with HITL approvals for high-risk operations (open-source status unverified) — [bytebridge analysis](https://bytebridge.medium.com/analyzing-top-mcp-gateways-contextforge-zapier-mcp-klavis-gate22-unla-and-peta-a7dd9a069928)
- **TrueFoundry MCP Gateway**: HITL tool approvals, runs in own cloud, open-core unclear (commercial) — [TrueFoundry](https://www.truefoundry.com/blog/best-mcp-security-tools)
- **mcp-gw**: small Docker aggregator for homelab, combining several backends including a Home Assistant MCP server for Claude Code — [Glama](https://glama.ai/mcp/servers/gpimthong/mcp-gw)
- Curated lists for further candidates — [ianwieds/awesome-mcp-gateways](https://github.com/ianwieds/awesome-mcp-gateways), [e2b-dev/awesome-mcp-gateways](https://github.com/e2b-dev/awesome-mcp-gateways), [bh-rat/awesome-mcp-enterprise](https://github.com/bh-rat/awesome-mcp-enterprise)

### Inferences
- Bifrost is the most direct conceptual competitor on context reduction (code mode + sandbox). Docker is second (experimental `code-mode`). Both target developers, not self-hosted services.
- ContextForge and Unla compete with Synoikia's "wrap a REST API" plugin model through configuration rather than code-written plugins, which lowers their ecosystem barrier compared with Synoikia.
- ToolHive's per-server containers are the clearest answer to Synoikia's known gap (no plugin egress restriction).
- Profiles from prior knowledge (unverified in this session, confirm before use): mcpo (open-webui/mcpo) exposes MCP servers as OpenAPI REST endpoints for Open WebUI, MIT; sparfenyuk/mcp-proxy bridges stdio and SSE/streamable HTTP transports, MIT; ravitemer/mcp-hub is a Node hub mainly used with the Neovim mcphub.nvim plugin; Director.run and Pluggedin (VeriTeknik/pluggedin-app) are aggregator/workspace tools with hosted options; Higress (Alibaba, Apache 2.0) and Apache APISIX added MCP and REST-to-MCP plugins; Portkey's OSS gateway is LLM-focused with MCP features mainly in its hosted product; Hypr MCP gateway (hyprmcp) adds OAuth and analytics in front of MCP servers.

### Gaps
- GitHub stars, last-commit dates and release cadence for all projects: GitHub was blocked (HTTP 403) in this session.
- No primary-source data obtained for 1MCP features, mcpo, mcp-proxy, mcp-hub, Director.run, Pluggedin, Hypr, Higress, APISIX, Portkey MCP, Kong OSS MCP plugin scope, Microsoft MCP Gateway authz.
- Whether any project has been archived or abandoned as of October 2026 could not be checked.
- ContextForge license (MIT vs Apache 2.0) conflicts across sources.

## Which support human-in-the-loop approval the client cannot fake? Which have per-tool RBAC, audit, secret redaction?

### Takeaway
Out-of-band human approval is rare. Only hoop.dev (generic L7 gateway), Peta and TrueFoundry (commercial or unclear OSS status) were found with request-pausing approval routed to a human reviewer. Bifrost's "approval" is application-side (the caller decides to execute), so a compromised client could approve itself. Per-tool RBAC is common in enterprise gateways (agentgateway CEL, Pomerium, Obot, Bifrost virtual keys, Traefik Hub, Lunar MCPX, ToolHive Cedar). Secret/PII masking appears in Lasso and ContextForge guardrail plugins.

### Cited Findings
- hoop.dev pauses requests until a reviewer explicitly allows them (email/Slack/ticketing) — [hoop.dev](https://hoop.dev/blog/a-guide-to-human-in-the-loop-approval-in-mcp)
- Peta: HITL approvals for high-risk operations — [bytebridge](https://bytebridge.medium.com/analyzing-top-mcp-gateways-contextforge-zapier-mcp-klavis-gate22-unla-and-peta-a7dd9a069928)
- TrueFoundry: HITL tool approvals, can run in own cloud — [TrueFoundry](https://www.truefoundry.com/blog/best-mcp-security-tools)
- Bifrost: execution requires explicit API calls unless Agent Mode auto-executes listed tools — [Bifrost docs](https://docs.getbifrost.ai/mcp/gateway-url)
- Lunar MCPX approval is for adding servers, not per call — [Composio](https://composio.dev/content/best-mcp-gateway-for-developers)
- No approval workflows found for agentgateway, Docker MCP Gateway, Microsoft MCP Gateway; Obot approval support unconfirmed — [search synthesis incl. Octelium and agentgateway pages](https://octelium.com/solutions/open-source-mcp-gateway)
- Per-tool control: Pomerium (read vs delete in one server) — [Pomerium](https://www.pomerium.com/blog/top-5-agentic-gateways-for-securing-mcp-tool-calls-in-2026); agentgateway CEL — [tutorial](https://mehdihadeli.com/blog/agentgateway-ai-gateway); Obot by user/IdP group — [Obot docs](https://docs.obot.ai/concepts/mcp-gateway/); Octelium per-tool allow/deny — [Octelium](https://octelium.com/solutions/open-source-mcp-gateway)
- Audit: Obot full tool-call logs exportable — [Obot docs](https://docs.obot.ai/concepts/mcp-gateway/); MCPJungle "basic" — [Lunar](https://www.lunar.dev/post/the-best-open-source-mcp-gateways-in-2026)
- Redaction: Lasso PII and secret masking plugins — [Lasso GitHub](https://github.com/lasso-security/mcp-gateway); ContextForge 30+ guardrails, PII specifics unconfirmed — [IBM blog](https://developer.ibm.com/blogs/context-forge-mcp-gateway-now-available/)

### Inferences
- Synoikia's combination (API-derived read/write classification, locked destructive ops with typed confirmation, approval page the client cannot self-approve, MCP URL-mode elicitation) appears to be a real differentiator among OSS gateways. Competitors classify by tool name/policy written by an admin, not by upstream read/write semantics.
- Obot's webhook filters could be used to build approvals, but that is custom work.

### Gaps
- Whether ContextForge or ToolHive added approval features in 2026 releases: not found.
- Whether any gateway uses MCP URL-mode elicitation for approvals: not found.

## Which reduce context cost (tool filtering, search/lazy loading, code mode)?

### Takeaway
Code mode: Bifrost (Starlark sandbox, production) and Docker (experimental JS `code-mode`). Search/lazy loading: Docker `mcp-find`/`mcp-add`, Obot tool search, MetaMCP meta-tools (per one source), Magg. Static filtering: ToolHive optimizer, MetaMCP middleware, Bifrost virtual keys, agentgateway/Pomerium policies. Most infra gateways (Envoy, Microsoft, Kong, Unla, MCPJungle) pass full tool lists through.

### Cited Findings
- Bifrost Code Mode, Starlark sandbox, up to 92.8% input-token reduction (vendor benchmark) — [Maxim](https://www.getmaxim.ai/articles/what-is-code-mode-in-bifrost-mcp-gateway/)
- Docker `code-mode` and `mcp-find` (experimental) — [Docker docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/dynamic-mcp/)
- Obot tool search for large virtual servers — [Obot docs](https://docs.obot.ai/concepts/mcp-gateway/)
- ToolHive optimizer filters tool list before LLM — [Maxim top 5](https://www.getmaxim.ai/articles/top-5-open-source-mcp-gateways-for-self-hosted-ai-infrastructure/)
- MetaMCP meta-tools hide large catalogs — [Maxim](https://www.getmaxim.ai/articles/open-source-mcp-gateways-for-developers-in-2026/)
- A "mcp-gateway" single-port gateway replaces per-tool registrations with a few meta-tools — [Pomerium list](https://www.pomerium.com/blog/top-5-agentic-gateways-for-securing-mcp-tool-calls-in-2026)

### Inferences
- Code mode is becoming table stakes for gateways that target large catalogs. Synoikia's advantage is pairing code mode with a permission gate that runs inside each call made by the sandboxed code.

### Gaps
- Independent token benchmarks across gateways: none found.

## Which proxy existing MCP servers vs require custom adapters?

### Takeaway
Almost all competitors proxy existing MCP servers (ContextForge, MetaMCP, Docker, Microsoft, agentgateway, Envoy, Unla, MCPJungle, 1MCP, Obot, Lasso, ToolHive, Pomerium, MCPX, Bifrost, LiteLLM). ContextForge and Unla also convert REST (and gRPC, ContextForge) APIs to MCP through configuration. Synoikia is unusual in requiring purpose-built plugins, which is both its weakness (ecosystem size) and the reason it can classify read/write per operation.

### Cited Findings
- ContextForge fronts MCP, A2A and REST/gRPC — [GitHub](https://github.com/IBM/mcp-context-forge)
- Unla: REST via config templates plus proxy of stdio/SSE/HTTP MCP servers — [Unla docs](https://docs.unla.amoylab.com/en)
- MetaMCP aggregates upstream MCP servers — [mcp.directory](https://mcp.directory/blog/metamcp-complete-guide-2026)
- Docker runs catalog MCP servers in containers — [Docker docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit.md)
- MCPJungle single `/mcp` endpoint over registered servers — [Maxim top 5](https://www.getmaxim.ai/articles/top-5-open-source-mcp-gateways-for-self-hosted-ai-infrastructure/)

### Inferences
- A "proxy existing MCP server" plugin type in Synoikia would neutralize the most common competitive objection, at the cost of losing API-derived read/write classification for proxied tools.

### Gaps
- None beyond the per-tool data gaps above.

## Target audience (enterprise k8s vs homelab)?

### Takeaway
Enterprise/k8s: agentgateway, Envoy AI Gateway, Microsoft MCP Gateway, Archestra, ContextForge (Helm), Obot, Kong, Traefik Hub, Pomerium, Lunar MCPX, TrueFoundry, Bifrost, LiteLLM. Developer desktop: Docker MCP Toolkit, ToolHive (also k8s operator per prior knowledge, unverified), Magg, mcp-hub. Homelab-friendly self-hosted: MetaMCP (Coolify one-click), MCPJungle, 1MCP, mcpo, mcp-proxy, Unla, mcp-gw. None of the homelab tools found offers approvals, redaction or per-operation access levels, so Synoikia's segment (security-heavy, homelab services) appears underserved.

### Cited Findings
- Microsoft MCP Gateway is Kubernetes-only — [Maxim](https://www.getmaxim.ai/articles/best-mcp-gateways-to-connect-tools-and-mcp-servers-to-your-ai-agent/)
- Archestra is Kubernetes-native — [awesome-ai-gateway](https://github.com/cuihuan/awesome-ai-gateway)
- MetaMCP has a Coolify one-click template — [Coolify](https://coolify.io/docs/services/metamcp)
- MCPJungle has a dev mode for local use and enterprise mode for teams — [Maxim top 5](https://www.getmaxim.ai/articles/top-5-open-source-mcp-gateways-for-self-hosted-ai-infrastructure/)
- Homelab Home Assistant users mostly run single-service MCP servers (ha-mcp, built-in HA MCP) and small aggregators (mcp-gw) — [raspberry.tips](https://raspberry.tips/en/smart-home/home-assistant-mcp-server-ai-setup), [Glama mcp-gw](https://glama.ai/mcp/servers/gpimthong/mcp-gw)

### Inferences
- Synoikia's realistic homelab competitors are MetaMCP and MCPJungle plus native per-service MCP servers (for example Home Assistant's built-in MCP). Its enterprise-grade features (OIDC, TOTP, audit, signed repos) outclass these, while enterprise gateways outclass Synoikia on scale (multi-node, Postgres, k8s).

### Gaps
- No r/selfhosted, r/homelab or Hacker News discussion threads were retrieved, so community sentiment is not covered.
