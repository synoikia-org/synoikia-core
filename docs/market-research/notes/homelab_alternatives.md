# Homelab / self-hosted alternatives to Synoikia

Research date: 2026-10-23. Method: web search plus a direct fetch of the ha-mcp GitHub README. Several primary sites (home-assistant.io, docs.n8n.io, virtualizationhowto.com) could not be fetched because of DNS errors in the research sandbox. Claims about those sites come from search-result snippets, so check them before relying on them. Most per-service facts come from directory listings (glama.ai, lobehub, mcpservers.org), which are aggregators and can be stale. Star counts were gathered only where stated.

## 1. Per-service MCP servers that Synoikia would replace

### Takeaway
Every service Synoikia targets already has at least one community MCP server, and Home Assistant has both an official one and a very popular community one (ha-mcp, about 5.2k stars). The strongest per-service rival, ha-mcp, has copied much of Synoikia's playbook: read-only mode, per-tool approval policies, separate read, write and delete proxies, and an opt-in tool-search mode that cuts the tool list down to 4 entry points. Most other servers (TrueNAS, Proxmox, Unraid, *arr, Paperless) are single-author Python or Node projects. They authenticate with a static API token and load the full tool list, and they have little or no write gating.

### Cited Findings

**Home Assistant: official "Model Context Protocol Server" integration**
- It exposes the home to MCP clients through the Assist API. Clients can only see and control entities exposed to Assist, which you set on the exposed-entities page. There is a "Control Home Assistant" option at setup. — [HA docs: MCP Server](https://home-assistant.io/integrations/mcp_server/)
- Third-party summaries say the Assist-based approach exposes only the intent layer over voice-exposed entities. It has no raw states, no arbitrary service calls, no history, no templates, no registries, no add-ons and no automation configs. — [glama: mcp-ha listing](https://glama.ai/mcp/servers/Devitek/mcp-ha); [glama listing](https://glama.ai/mcp/servers/qubit999/ha-mcp)
- Transport and auth: the ganhammar/hass-mcp-server README says the official integration uses SSE. That author built an HTTP-transport server with OAuth 2.0 and Dynamic Client Registration to cover web clients such as claude.ai. I could not confirm whether the official server now supports OAuth. — [ganhammar/hass-mcp-server](https://github.com/ganhammar/hass-mcp-server); [HA MCP Server docs](https://home-assistant.io/integrations/mcp_server/)
- A separate official "Model Context Protocol" client integration lets HA's conversation agent use external MCP servers, with OAuth Client ID and Secret through Application Credentials. This means HA itself can act as an MCP consumer, not only a server. — [HA docs: MCP client](https://www.home-assistant.io/integrations/mcp)
- The original integration PR is home-assistant/core #134122 (the PR number suggests late 2024 / early 2025; the date is my inference). — [GitHub PR](https://github.com/home-assistant/core/pull/134122)

**Home Assistant: ha-mcp (homeassistant-ai/ha-mcp), "The Unofficial and Awesome Home Assistant MCP Server"**
- 5.2k stars, 243 forks, MIT license, 87 tools. — [GitHub](https://github.com/homeassistant-ai/ha-mcp)
- Install: HACS custom component (recommended, runs in-process on all HA install types), HA add-on, Docker `ghcr.io/homeassistant-ai/ha-mcp`, uvx/PyPI. Local stdio is "not recommended". It has a setup wizard for 15+ clients. — [GitHub](https://github.com/homeassistant-ai/ha-mcp)
- Safety features: a Read Only Mode toggle, per-tool enable and disable, and "tool security policies" that can require user approval. It takes automatic backups before edits. YAML edits get backup, validation and a config check. Destructive tools sit behind a separate `ha_call_delete_tool` proxy, so clients can apply a different permission policy to them. Appending `/readonly` to the endpoint gives a read-only connection. — [GitHub](https://github.com/homeassistant-ai/ha-mcp)
- Auth: a secret URL (the simplest option), HA sign-in (`ha_auth`), or OIDC through an external IdP. In OIDC mode all users share the server's HA credentials. The README recommends a dedicated admin account with local-only login. — [GitHub](https://github.com/homeassistant-ai/ha-mcp)
- Context cost: by default all ~87 tools are listed. The README says this has "near-zero idle cost" in clients with deferred tool loading (claude.ai, Claude Desktop, Claude Code). It warns that clients without deferred loading, or with a 100-tool cap, can be overwhelmed, and that small local models need a bigger `num_ctx`. `ENABLE_TOOL_SEARCH=true` (default false) replaces the list with 4 entry points: `ha_search_tools` (BM25), `ha_call_read_tool`, `ha_call_write_tool` and `ha_call_delete_tool`, plus pinned tools. — [GitHub](https://github.com/homeassistant-ai/ha-mcp)
- Version conflict: PyPI showed 6.5.0, and a directory listed v7.10.0 (2026-07-06). The README fetch referenced "version 9.0.0 (October 28, 2026)", a date after today's research date. This may be a pre-announced release or an extraction error, so treat it with caution. — [PyPI](https://pypi.org/project/ha-mcp/); [GitHub](https://github.com/homeassistant-ai/ha-mcp)
- Directories cite tool counts of 70+, 82, 85+ and 95+ at different times. This shows fast growth and churn. — [dev.co](https://dev.co/ai/mcp/ha-mcp); [sourcepulse](https://www.sourcepulse.org/projects/22903699)

**Other Home Assistant community servers**
- voska/hass-mcp: stdio, with entity queries, service calls, automation listing, restart, history and error log. It authenticates with a long-lived token. — [Stacklok registry](https://stacklok.com/registry/hass-mcp/); [glama README](https://glama.ai/mcp/servers/@voska/hass-mcp/blob/716366b31eb1160f9b18321d840ea9ca8a26d8f9/README.md)
- mcp-ha (Devitek): an HA add-on with entities, areas, devices, services, automations, scripts, history, add-ons and system. Listings disagree: one says 45 tools (27 read, 18 "guarded write"), another says 16. — [glama](https://glama.ai/mcp/servers/Devitek/mcp-ha)
- Many more exist (allenporter/mcp-server-home-assistant, tevonsb/homeassistant-mcp, jango-blockchained/advanced-homeassistant-mcp, hass-mcp-plus, oleander). Most use long-lived tokens. — [glama hass-mcp-plus](https://glama.ai/mcp/servers/rmaher001/hass-mcp-plus); [Enterprise DNA](https://enterprisedna.co/directories/mcp/allenporter-mcp-server-home-assistant); [glama advanced-homeassistant-mcp](https://glama.ai/mcp/servers/@jango-blockchained/advanced-homeassistant-mcp/blob/38968a933faed63bd6c87cc5173f88bf340cb327/README.md)

**TrueNAS**
- No official iXsystems control MCP server found. sonicaj/tn_mcp ("TrueNAS Middleware MCP Server") only serves middleware docs to Claude Code for TrueNAS developers. It does not control a NAS. — [mcpservers.org](https://mcpservers.org/tr/servers/sonicaj/tn_mcp); [lobehub](https://lobehub.com/mcp/sonicaj-tn_mcp)
- vespo92/TrueNasCoreMCP (PyPI `truenas-mcp-server`, MIT): Core and SCALE with auto-detect, covering users, storage, shares, snapshots and monitoring. It is configured with `TRUENAS_URL` + `TRUENAS_API_KEY`. It is self-described as "production-ready". — [glama README](https://glama.ai/mcp/servers/@vespo92/TrueNasCoreMCP/blob/d12400e9adcb794cff74a0839c99f12b90cb7add/README.md)
- svnstfns TrueNAS Scale MCP: 11 tools focused on Docker Compose apps, with a mock mode. — [glama](https://glama.ai/mcp/servers/i7346o6ca5)
- None of these appear to expose the full ~650–700-method middleware API that Synoikia's TrueNAS plugin covers. They expose curated subsets. (Inference from the listed scopes.)

**Unraid**
- jmagar/unraid-mcp (Python, GraphQL-backed): it uses one `unraid` tool routed by action + subaction, which is itself a consolidation pattern. Counts conflict: 26 tools, or 10 tools with 76 actions. — [glama](https://glama.ai/mcp/servers/@jmagar/unraid-mcp); [plugin README](https://glama.ai/mcp/servers/@jmagar/unraid-mcp/blob/5b6a728f453d62b0d43a3af34457be613a8a0d0b/.claude-plugin/README.md)
- The Unraid API has been native since Unraid 7.2 (GraphQL at `/graphql`, API key, session cookie or SSO/OIDC), according to research notes in the jmagar repo. — [jmagar research doc](https://glama.ai/mcp/servers/@jmagar/unraid-mcp/blob/5b6a728f453d62b0d43a3af34457be613a8a0d0b/docs/research/unraid-api-research.md)
- unraid-rmcp (Rust, dinglebear-ai) is read-only with no mutations. — [socket.dev](https://socket.dev/npm/package/unraid-rmcp)

**Proxmox VE**
- Many forks: bsahane/mcp-proxmox (Python: lifecycle, networking, snapshots and backups, metrics, pools and permissions; API token; stdio), RekklesNA/ProxmoxMCP-Plus (MCP + OpenAPI, Docker image, built on canvrno/ProxmoxMCP), mjrestivo16/mcp-proxmox (35 tools), netixc/proxmoxmcp (MIT) and Cronus87/ProxmoxMCP-Production. — [bsahane README](https://cdn.jsdelivr.net/gh/bsahane/mcp-proxmox@main/README.md); [ProxmoxMCP-Plus](https://glama.ai/mcp/servers/@RekklesNA/ProxmoxMCP-Plus/blob/fbc2b07cf3e62b319015acad20f3078e460d8c63/README.md); [mjrestivo16](https://glama.ai/mcp/servers/@mjrestivo16/mcp-proxmox/blob/cc9b790858a1c2aeef8bafc6edbfabd7f8963f1d/README.md); [netixc](https://lobehub.com/mcp/netixc-proxmoxmcp); [Cronus87](https://glama.ai/mcp/servers/Cronus87/ProxmoxMCP-Production)
- A homelab article (Aug 2026) recommends auditing each Proxmox token for list, start, stop and delete VM or user rights, and keeping a token "kill switch". This means safety is left to how the user scopes the token. — [Virtualization Howto, Aug 2026](https://www.virtualizationhowto.com/2026/08/i-connected-ai-to-my-home-lab-then-i-realized-what-it-could-access/)

**Media stack (*arr, Jellyfin/Plex, Seerr)**
- Consolidated "arr-mcp" servers dominate, with many forks: bardesss/arr-mcp (Radarr, Sonarr, Prowlarr, Bazarr, Jellyfin, Plex, Seerr, SABnzbd, Transmission, qBittorrent, plus an Unraid CA template not yet in Community Applications), tomasmorello/arr-mcp (adds Whisparr and Profilarr), zakaria1193/arr-mcp (FastMCP 3.3, 25 tools, cross-arr orchestration, Jellyfin bridge, Overseerr), drmogie/arr-mcp, and CT4nk3r/arrstack-mcp (Sonarr, Radarr, qBittorrent, Jellyfin, with Jellyfin limited to read-ish tools). — [bardesss](https://github.com/bardesss/arr-mcp); [tomasmorello](https://github.com/tomasmorello/arr-mcp); [zakaria1193](https://github.com/zakaria1193/arr-mcp); [drmogie](https://github.com/drmogie/arr-mcp); [CT4nk3r](https://github.com/CT4nk3r/arrstack-mcp)
- This "one server for the whole media stack" pattern competes directly with Synoikia's multi-plugin pitch for media, but without a permission gate or approvals (no such features found in the listings).

**Paperless-ngx**
- No official server. OrellBuehler/paperless-mcp has 115+ tools over the REST API plus optional local semantic search. nloui/paperless-mcp covers documents, tags, correspondents and types. One listing has 50 tools, MIT, stdio + HTTP/OAuth. There is also teran (Go, hardened container) and paulmeier (Docker). — [OrellBuehler](https://github.com/OrellBuehler/paperless-mcp); [nloui](https://github.com/nloui/paperless-mcp); [mcp.pub](https://mcp.pub/servers/paperless-ngx-mcp-server/); [teran](https://github.com/teran/mcp-paperless-ngx); [paulmeier](https://github.com/paulmeier/paperless-ngx-mcp-container)
- 115+ tools is a clear example of the classic-server context cost that Synoikia's Code Mode avoids.

**Grafana (vendor-official)**
- grafana/mcp-grafana is official. `--disable-write` gives read-only mode (no dashboard, folder, incident or alerting writes). Query execution is a separate gate (`--enable-query`). There is also a hosted Grafana Cloud MCP endpoint in public preview, with access by Grafana role. — [GitHub](https://github.com/grafana/mcp-grafana); [Grafana docs: flags](https://grafana.com/docs/grafana/latest/developer-resources/mcp/configure/command-line-flags/); [Walma guide](https://walma.ai/en/guides/mcp/grafana-mcp)

**Kubernetes**
- containers/kubernetes-mcp-server (Red Hat-backed org): `--read-only` blocks create, update and delete. `--disable-destructive` disables destructive ops (sources conflict on whether that covers update or only delete). There is a TOML config. flux159/mcp-server-kubernetes is a second popular option. — [glama](https://glama.ai/mcp/servers/@containers/kubernetes-mcp-server); [archestra catalog](https://archestra.ai/mcp-catalog/manusa__kubernetes-mcp-server); [flux159](https://archestra.ai/mcp-catalog/flux159__mcp-server-kubernetes)

### Inferences
- Coarse write control (a read-only flag, or read-only plus no-destructive) is now common in vendor-grade servers (Grafana, Kubernetes, ha-mcp). Per-operation None/Read/Ask/Write, out-of-band approval, redaction and audit are not common. Only ha-mcp comes close, and its "approval" relies on the MCP client's own confirmation prompt, not an out-of-band channel.
- ha-mcp's tool-search mode (search + read, write and delete call proxies) is structurally close to Synoikia's search/execute. Synoikia's context-cost advantage over ha-mcp is therefore small for Claude clients with deferred tool loading, and for ha-mcp users who turn on tool search. The advantage stays large against the long tail (Paperless 115 tools, Proxmox 35, and so on) and for non-Claude or local-model clients.
- Synoikia's HA plugin locks unlock, disarm, garage open and similar operations by default. ha-mcp has no equivalent semantic lock list that I could find, only a read, write and delete categorisation.

### Gaps
- No usable sources found for: Synology MCP, Emby/Plex-only servers, Overseerr/Jellyseerr standalone servers, Portainer MCP (official status unknown), Docker MCP Gateway (dynamic `mcp-find` mode not verified), pfSense/OPNsense, UniFi, Immich, Nextcloud, Gitea/Forgejo MCP. Searches returned nothing for these. Gitea has an official `gitea-mcp` from memory, and Docker ships an MCP Toolkit/Gateway, but I could not verify either here, so do not cite them without checking.
- Stars and late-2026 activity are verified only for ha-mcp (5.2k stars). All other maturity data is missing.
- Could not fetch the official HA MCP Server docs page to confirm the current transport (SSE vs streamable HTTP) and OAuth support.

## 2. Self-hosted automation / agent platforms as the hub

### Takeaway
n8n is the most credible "hub" substitute. It can expose workflows as an MCP server (MCP Server Trigger), consume MCP servers, and, since n8n 2.6 (Jan 2026), gate individual AI-agent tool calls behind human approval through Slack, Telegram, chat and similar channels. This is the closest match to Synoikia's out-of-band approval. Chat front ends (Open WebUI, LibreChat, AnythingLLM) and agents (Goose) consume MCP but have weak or global-only approval controls, and they add no per-service safety model.

### Cited Findings
- n8n tool-level human-in-the-loop: you can require approval before an AI Agent runs a specific tool. The workflow pauses until a reviewer approves or denies, and a denial tells the agent the call was rejected. It is configured in the AI Agent node's Tools Panel under "Human review". Approval channels include n8n Chat, Slack, Discord, Telegram, Teams, Gmail, WhatsApp, Google Chat and Outlook, and the channel can differ from the chat channel. Reviewers see the tool name and parameters (`$tool`). — [n8n docs: HITL for tools](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools); [n8n docs alt path](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools)
- It was released in n8n 2.6 (beta, community release dated Jan 30, 2026, per a blog). — [growwstacks roadmap](https://growwstacks.com/blog/n8n-2026-roadmap/); [gopenai blog](https://blog.gopenai.com/tool-level-hitl-in-n8n-build-a-gated-crm-agent-with-audit-trail-33eb39c923e6)
- Caveat (inferred from the docs wording "AI Agent node"): n8n's HITL applies to tool calls made by n8n's own AI Agent node. Whether it also gates calls arriving from an external client through the MCP Server Trigger was not confirmed (the trigger docs page could not be fetched).
- Open WebUI: native MCP since v0.6.31, Streamable HTTP only. stdio and SSE servers need the mcpo proxy (MCP to OpenAPI). The docs still call OpenAPI "the preferred integration path". Only admins can add MCP servers, with per-user or per-group access control. OAuth 2.1 is supported for MCP servers. `WEBUI_SECRET_KEY` must be set, or OAuth tokens break on container recreation. — [Open WebUI MCP docs](https://docs.openwebui.com/features/mcp); [mcp.md](https://docs.openwebui.com/features/extensibility/mcp.md); [mcpo docs](https://docs.openwebui.com/features/extensibility/plugin/tools/openapi-servers/mcp)
- LibreChat: MCP is supported. Tool approval is configured globally in `librechat.yaml` (`endpoints.agents.toolApproval`), with no per-server UI. By default it runs tools without asking. Feature requests for per-tool approval are open or were closed as duplicates. A fork (anno-systems) adds per-tool off, allow or confirm. — [LibreChat MCP docs](https://www.librechat.ai/docs/features/mcp); [Issue #14193](https://github.com/LibreChat-AI/LibreChat/issues/14193); [Issue #7564](https://github.com/LibreChat-AI/LibreChat/issues/7564); [anno-systems PR #24](https://github.com/anno-systems/LibreChat/pull/24)
- Goose (Block): four modes: auto (Completely Autonomous), approve (Manual), smart_approve and chat. Per-tool always allow, ask or never allow in the Manual and Smart modes. It defaults to autonomous when `GOOSE_MODE` is unset. — [Goose docs: permissions](https://goose-docs.ai/docs/guides/managing-tools/goose-permissions/); [Konveyor issue](https://github.com/konveyor/editor-extensions/issues/1510)
- AnythingLLM: MCP since Desktop v1.8.0, configured through `anythingllm_mcp_servers.json`. No per-tool approval setting found. — [AnythingLLM docs](https://docs.anythingllm.com/mcp-compatibility/overview)
- Home Assistant + local LLM: HA's MCP client integration lets HA's own conversation agent (which can be a local LLM) call external MCP servers. HA becomes a hub that can consume, for example, a TrueNAS or *arr MCP server. — [HA docs: MCP client](https://www.home-assistant.io/integrations/mcp)

### Inferences
- n8n can reproduce Synoikia's approval flow for a curated set of hand-built tools. But each tool must be wired by hand, and n8n has no catalog of hundreds of upstream methods, no Code Mode and no redaction layer. It is a substitute for power users who already run n8n, not a drop-in substitute.
- Open WebUI and LibreChat are complements to Synoikia (MCP clients that could point at Synoikia endpoints), not substitutes. Their weak approval controls strengthen the case for server-side gating like Synoikia's, because the client often cannot be trusted to ask.
- Goose's and other agents' client-side approval modes mean safety depends on the client config, and Goose defaults to autonomous. Synoikia's server-side gate works whatever the client does.

### Gaps
- Not researched (call budget): Node-RED MCP nodes, Activepieces MCP, Windmill, Huginn, Dify, Flowise, Langflow, LobeChat, OpenHands. No sourced facts for them in these notes.
- n8n license (Sustainable Use License, fair-code) is from memory and not verified here.

## 3. Homelab "AI ops" products

### Takeaway
I found no mature, productised "AI ops for homelab" platform with a gateway and safety model comparable to Synoikia. What exists are starter kits and blog-post architectures. Some of them use the same read, write and destructive classification with approval gates.

### Cited Findings
- "Agentic Homelab" starter kit: classifies actions as read, write or destructive, stops risky or destructive ops for mandatory human verification and backups, and has explicit approval gates for Proxmox, Docker, NAS and monitoring. — [mcpmarket: agentic-homelab](https://mcpmarket.com/zh/server/agentic-homelab)
- A "homelab-change-control" skill (AgenticSelfHostSkills) exists in a skills registry, which points to a similar change-control idea. — [tessl registry](https://tessl.io/registry/skills/github/pvnkmnk/AgenticSelfHostSkills/homelab-change-control/review)
- A read-only homelab MCP server "rides along" with a monitor. The author deliberately made the MCP surface read-only. — [DEV: read-only homelab MCP](https://dev.to/sikamikanikobg/your-homelab-legible-to-ai-agents-a-read-only-mcp-server-that-rides-along-with-your-monitor-40io)
- Airlock: each approval is an Ed25519 signature over the exact action, single-use and time-limited. It is early-stage and targets Alibaba Cloud only. — [GitHub: sneg55/airlock](https://github.com/sneg55/airlock)

### Inferences
- The fact that hobbyist kits arrive at the same read, write and destructive plus approval design supports Synoikia's model. These kits do not yet compete as products.

### Gaps
- Not verified: Komodo MCP or AI features, TrueNAS built-in AI features, Unraid AI features, homelab dashboards (Homarr, Homepage, Glance) with agents. No sources found within budget. Do not claim these exist or do not exist.

## 4. Community sentiment on letting LLMs control home infrastructure

### Takeaway
Searches did not surface Reddit threads directly (the search tool returned none). Homelab blogs from Aug–Oct 2026 consistently warn about over-broad agent access and recommend scoped tokens, read-only first, approval for writes, backups and isolation. This supports Synoikia's positioning. Token bloat is a recognised concern in MCP writing, but the spread of deferred tool loading in Claude clients weakens it.

### Cited Findings
- Virtualization Howto (Oct 2026), "Don't Give Your AI Agents Direct Access to Your Home Lab. Do This Instead." The title signals mainstream homelab media pushing an intermediary or gateway approach. The body could not be fetched, so its recommendations are unverified. — [Virtualization Howto, Oct 2026](https://www.virtualizationhowto.com/2026/10/dont-give-your-ai-agents-direct-access-to-your-home-lab-do-this-instead/)
- Virtualization Howto (Aug 2026), "I Connected AI to My Home Lab. Then I Realized What It Could Access". It recommends auditing token rights (list, start, stop, delete VMs and users) and a kill switch. — [Virtualization Howto, Aug 2026](https://www.virtualizationhowto.com/2026/08/i-connected-ai-to-my-home-lab-then-i-realized-what-it-could-access/)
- A zero-trust homelab post isolates MCP servers on a separate Docker network and relies on nightly backups in case "a confused agent deletes the wrong directory" through the Filesystem MCP. — [Medium: Zero-Trust Homelab](https://medium.com/@imalocalhost/the-zero-trust-homelab-building-a-secure-foundation-for-ai-agents-afbdae85f075)
- A DEV guide: keep client confirmation on for anything that deletes or changes config, and make deploys reversible. — [DEV: agents deploy without root](https://dev.to/offpage_prince/letting-ai-agents-deploy-to-your-own-servers-with-mcp-without-handing-them-root-12na)
- Token bloat: one author estimates the GitHub MCP server at ~55k tokens across 93 tools and ~75k tokens for 10 servers × 15 tools. These are estimates, not benchmarks. — [DEV: MCP token limits](https://dev.to/piotr_hajdas/mcp-token-limits-the-hidden-cost-of-tool-overload-2d5)
- Counterpoint: ha-mcp states its 87-tool listing has "near-zero idle cost" in clients with deferred tool loading, and is a problem only for clients without it or with tool caps or small local models. — [ha-mcp GitHub](https://github.com/homeassistant-ai/ha-mcp)
- MCP's `destructiveHint` tool annotation lets hosts decide which calls need confirmation. This is advisory and enforced by the client. — [stanza.dev MCP course](https://www.stanza.dev/courses/mcp-production/advanced-patterns/mcp-production-sampling)

### Inferences
- The safety story (server-enforced approvals, locked destructive ops, audit) is better supported by the evidence than the context-cost story. For Claude-client users context cost matters less in late 2026. For local-LLM users (Ollama and similar, common in r/selfhosted) it still matters a lot.

### Gaps
- No direct r/selfhosted, r/homelab or r/homeassistant threads or quotes were retrieved. The search tool did not return Reddit results for 3 query variants. A writer should not attribute specific sentiment to Reddit from these notes.

## 5. Synthesis: write safety, context cost, auth, and most likely substitutes

### Takeaway
For a homelab user, the most likely substitutes are: (1) ha-mcp for Home Assistant (popular, MIT, has read-only, a delete split, tool search and backups), (2) an all-in-one "arr-mcp" for the media stack, (3) a per-service community server for each of TrueNAS, Proxmox and Unraid, wired straight into Claude Desktop or Code, and (4) n8n for users who want approvals and are willing to hand-build tools. None of them combine Synoikia's per-operation policy, out-of-band approval, redaction, audit, OAuth, signed plugins and one admin portal across services.

### Cited Findings
- Write safety, by product:
  - ha-mcp: read-only mode, `/readonly` endpoint, per-tool policies requiring approval (client-side), delete proxy, auto backups. — [ha-mcp](https://github.com/homeassistant-ai/ha-mcp)
  - Official HA MCP: limited by Assist entity exposure. No per-op approval found. — [HA docs](https://home-assistant.io/integrations/mcp_server/)
  - Grafana: `--disable-write`. Kubernetes: `--read-only`, `--disable-destructive`. — [mcp-grafana](https://github.com/grafana/mcp-grafana); [k8s MCP](https://glama.ai/mcp/servers/@containers/kubernetes-mcp-server)
  - n8n: per-tool human review through chat apps. — [n8n docs](https://docs.n8n.io/advanced-ai/human-in-the-loop-tools)
  - LibreChat: global approval only. Goose: client modes, autonomous by default. — [LibreChat #14193](https://github.com/LibreChat-AI/LibreChat/issues/14193); [Goose](https://goose-docs.ai/docs/guides/managing-tools/goose-permissions/)
- Auth: most community servers use a static long-lived token or API key (HA long-lived token, `TRUENAS_API_KEY`, Proxmox API token). ha-mcp adds a secret URL, HA login or OIDC (with shared backend credentials). Open WebUI supports OAuth 2.1 to MCP servers. — [ha-mcp](https://github.com/homeassistant-ai/ha-mcp); [TrueNasCoreMCP](https://glama.ai/mcp/servers/@vespo92/TrueNasCoreMCP/blob/d12400e9adcb794cff74a0839c99f12b90cb7add/README.md); [bsahane Proxmox](https://cdn.jsdelivr.net/gh/bsahane/mcp-proxmox@main/README.md); [Open WebUI](https://docs.openwebui.com/features/mcp)
- Context cost examples: ha-mcp 87 tools (or 4 entry points with tool search), Paperless 115+ tools, Proxmox 35, arr-mcp 25, jmagar Unraid 1 routed tool. — sources as cited in section 1.

### Inferences
- Synoikia's differentiators that hold up: server-enforced per-operation policy with semantic locks (unlock, disarm, garage), out-of-band approval that does not depend on client UI, secret redaction, a unified audit log, and one admin plane across services. Differentiators that are eroding: tool-count and context savings (deferred loading in clients, ha-mcp tool search, consolidated routed tools in Unraid and arr servers).
- Synoikia's main weakness against these alternatives is coverage and network effects. ha-mcp alone has about 5.2k stars and support for 15+ clients, and the long tail covers services Synoikia has no plugin for. A "compatibility bridge" that wraps existing MCP servers behind the Synoikia gate would address this, though that is a product suggestion, not a finding.
- The biggest single threat is ha-mcp, because Home Assistant is the most common homelab AI use case and ha-mcp already offers read-only, approval hooks and a tool-search mode.

### Gaps
- No measured token-cost benchmarks for any competitor. All figures are tool counts or author estimates.
- Activity and maturity (commits, releases in late 2026) are unverified for all projects except ha-mcp.
