# Managed (SaaS) and commercial MCP gateways, integration platforms and enterprise control planes vs Synoikia

Research date: 2026-10-23. Method note: direct page fetches were blocked by the session egress proxy (WebFetch/curl got DNS/403 for obot.ai, developers.cloudflare.com, truefoundry.com). All findings below come from web search result summaries. Many cited pages are vendor or competitor marketing ("best MCP gateways" listicles written by MintMCP, Obot, TrueFoundry, Composio, Lunar, Unified, Scalekit, Maxim). Treat pricing as indicative and confirm on vendor pages. Items with no source are in Gaps.

## Q1. Vendor profiles (what, pricing, self-host, backing, features, strengths/weaknesses vs Synoikia)

### Takeaway
The market splits into (a) enterprise MCP control planes sold to security/IT (Runlayer, Natoma/Snowflake, MintMCP/Mintive, Barndoor, Obot Enterprise, TrueFoundry, Lunar MCPX, Peta), (b) SaaS integration platforms that host managed-OAuth tools for SaaS apps (Composio, Arcade, Klavis, Pipedream, Zapier, Merge, Nango, Paragon, Unified, Smithery), (c) hyperscaler/API-gateway add-ons (Cloudflare, AWS AgentCore, Azure APIM, Apigee, Kong, Portkey), and (d) MCP auth vendors (Descope, WorkOS, Auth0). Almost all target SaaS apps and enterprise identity, price per user/call/credit or by quote, and none is aimed at self-hosted homelab services. Cloudflare is the closest technical analogue (Code Mode portals that can reach private networks).

### Cited Findings

#### Cloudflare (MCP Server Portals, Code Mode, Agents SDK)
- MCP server portals are a Cloudflare One (Zero Trust) feature that aggregates many MCP servers behind one portal URL. Portal hostname must be on a Cloudflare zone and an IdP must be configured in Zero Trust — [Cloudflare docs: MCP server portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals/); [Speakeasy vs Cloudflare portals](https://www.speakeasy.com/blog/speakeasy-vs-cloudflare-mcp-server-portals)
- Pricing: portals are stated in the changelog as available to all Cloudflare customers; no separate portal price is publicly documented — [Cloudflare One changelog](https://developers.cloudflare.com/changelog/product/cloudflare-one/); [blocks.ai comparison](https://blocks.ai/compare/cloudflare-mcp-server-portals-vs-gemini-enterprise-agent-platform)
- Private networks: since 2026-09-22 portals can front MCP servers that exist only on a private network, connected via Cloudflare Tunnel, Mesh or another Cloudflare One connector, routed through Gateway ("Route traffic through Cloudflare Gateway"). OAuth authorize/token endpoints must stay on the public internet — [Cloudflare changelog: Private MCP server support](https://developers.cloudflare.com/changelog/post/2026-09-22-private-mcp-servers/)
- Code Mode on portals: replaces all upstream tools with two tools (search + execute); model-written JS runs in an isolated Dynamic Worker. Per-portal setting: off, opt-in, default on, or enforced. Example: a four-server portal went from ~9,400 to ~600 tokens (third-party write-up of Cloudflare's post) — [zenn.dev write-up](https://zenn.dev/oymk/articles/45e38ede000716?locale=en); [Cloudflare enterprise MCP reference architecture](https://blog.cloudflare.com/enterprise-mcp/); [matthewswong summary](https://www.matthewswong.com/en/blog/cloudflare-enterprise-mcp-reference-architecture-portals/)
- Cloudflare's own API MCP server uses Code Mode so the full API spec stays server-side — [github.com/cloudflare/mcp](https://github.com/cloudflare/mcp)
- HITL in Agents SDK: docs describe three approval layers (MCP elicitation, workflow approval, Code Mode approval); in Code Mode the runtime can pause generated code before an annotated connector method and resume after approval; state persists in a Durable Object — [Cloudflare HITL patterns](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/); [Cloudflare Agents tools](https://developers.cloudflare.com/agents/concepts/tools/)
- An open GitHub issue says approval flows with Code Mode are not yet coherent as a product, noting approving generated code is harder than approving one tool call — [cloudflare/agents issue #1148](https://github.com/cloudflare/agents/issues/1148)
- Strength vs Synoikia: same Code Mode pattern Synoikia copies, global edge, Zero Trust identity, can now reach a homelab via Tunnel. Weakness vs Synoikia: approvals are a developer SDK pattern you build, not a portal feature with a per-operation access classification; traffic and identity transit Cloudflare; requires a Cloudflare zone and Zero Trust setup.

#### Composio (Tool Router, Rube)
- Pricing (Oct 2026): free Hobby plan with 100,000 tool calls/month; Pro $29/month with a $29 non-rollover usage credit and spend controls; Enterprise custom. Older sources list Starter $99/Growth $199 (superseded) — [Swytchcode Composio pricing compared](https://www.swytchcode.com/content/composio-pricing-compared); [Peliqan alternatives](https://peliqan.io/blog/composio-alternatives-competitors/)
- Funding: $29M total incl. a $25M Series A led by Lightspeed (July 2025) — [Latka](https://getlatka.com/companies/composio.dev); [rywalker.com Composio](https://rywalker.com/research/composio)
- Tool Router: `session.tools()` exposes a small set of meta tools to find, connect and run app tools so app schemas load only when needed (tool-search style context reduction) — [Composio docs: Tool Router quickstart](https://docs.composio.dev/tool-router/overview); [Composio review](https://theaiagentindex.com/agents/composio)
- A third-party directory lists Composio human-in-the-loop as "Not required" (unverified) — [theaiagentindex](https://theaiagentindex.com/agents/composio)
- Strength vs Synoikia: hundreds of SaaS toolkits with managed OAuth, generous free tier. Weakness: SaaS-hosted, credentials held by Composio, no homelab/LAN services, no out-of-band approval found.

#### Arcade.dev
- Funding: sources conflict. $12M seed (Mar 2025); a $60M Series A led by SYN Ventures with Morgan Stanley and Wipro, dated June 15, 2026 in one source; one source says $72M total — [startupintros](https://startupintros.com/orgs/arcade-dev); [AlgoTurk](https://algoturk.com/brief/arcade-dev)
- Pricing: Team plan $25/month plus usage (~$0.01/call per one comparison) — [Swytchcode](https://www.swytchcode.com/content/composio-pricing-compared); [AlgoTurk](https://algoturk.com/brief/arcade-dev)
- Features: MCP runtime with agent-optimized tools, per-user OAuth, centralized governance, 100+ integrations, tool-level RBAC and per-gateway scoping — [Speakeasy: choosing an MCP gateway](https://www.speakeasy.com/blog/choosing-an-mcp-gateway); [theneuralbase composio vs arcade](https://theneuralbase.com/composio/learn/advanced/vs-arcade-tools/)
- Strength: per-user delegated auth is its core competence. Weakness vs Synoikia: SaaS app focus; HITL implementation not confirmed.

#### Klavis AI (Strata)
- Open source (Apache 2.0), pricing "Free / enterprise", YC X25 seed — [rywalker.com MCP integration platforms](https://rywalker.com/research/mcp-integration-platforms)
- Strata (progressive tool discovery) details not found in search — see Gaps.

#### Smithery
- Registry/CLI free; hosted servers usage-based. Pricing sources conflict: Hobby $0 (50K RPC/month, 3 namespaces) and Pay-as-you-go $10/month in one; Pay-as-you-go $300/month incl. $300 credit at $0.50 per 1K RPCs in another — [stork.ai Smithery review](https://www.stork.ai/en/smithery); [toolradar](https://toolradar.com/tools/smithery); [mcpize](https://mcpize.com/alternatives/smithery)
- A Sept 2026 opinion piece discusses the economics of Glama/Smithery for open-source server authors — [seosiri](https://www.seosiri.com/2026/09/mcp-monetization-gap-glama-smithery-developer-losses.html)
- Weakness vs Synoikia: a registry/hosting layer, not a permission gate.

#### Zapier MCP
- Billing in Zapier tasks: each successful tool call = 2 tasks; failed calls free. Free plan 100 tasks/month (~50 calls); Professional from $19.99/month billed yearly — [picassoia Zapier MCP pricing](https://blog.picassoia.com/zapier-mcp-pricing-cost-per-call-free-plan-and-alternatives); [Scalekit hosted MCP compared](https://www.scalekit.com/blog/hosted-mcp-servers-compared)
- Strength: 1000s of app actions, non-developer friendly. Weakness: per-call cost, SaaS only, all credentials at Zapier.

#### Pipedream Connect / MCP
- Acquired by Workday (agreement Nov 2025; closing reported Dec 2025 to Feb 2026, sources differ); long-term standalone status unclear — [Scalekit managed MCP platforms](https://www.scalekit.com/blog/best-managed-mcp-server-platforms); [Peliqan](https://peliqan.io/blog/composio-pipedream-peliqan-mcp/); [commandplusk](https://commandplusk.com/vs/pipedream)
- Connect pricing: $99/month annual ($150 monthly) with 100 external users and 10,000 credits; 1 credit per 30 s compute per tool call; possible ~$2/external-user meter (competitor claim) — [usagepricing](https://www.usagepricing.com/blueprint/pipedream); [commandplusk](https://commandplusk.com/vs/pipedream)
- Weakness vs Synoikia: vendor lock-in risk after acquisition; SaaS only.

#### Merge Agent Handler
- Free tier 2,000 credits/month; Pro $1,000/month for 25,000 credits; Enterprise custom; credits consumed per tool call. Billing docs reportedly disagree with the pricing page — [Merge pricing](https://www.merge.dev/pricing/agent-handler); [rywalker Merge Agent Handler](https://rywalker.com/research/merge-agent-handler); [Merge Agent Handler](https://www.merge.dev/merge-agent-handler)

#### Nango, Paragon ActionKit, Unified.to
- Nango: free for 10 connections; PAYG from $50/month at $0.29/connection and $0.72/compute hour; built-in MCP server exposing custom tools and managed APIs. Nango core is open source (self-hostable per vendor) — [Composio: Nango alternatives](https://composio.dev/content/nango-alternatives-ai-agents); [Nango: Paragon vs Nango](https://nango.dev/blog/paragon-vs-nango/)
- Paragon ActionKit: no public price; custom per connected user, often from ~$1,000/month — [Unified vs Paragon](https://unified.to/blog/unified_mcp_vs_paragon_mcp_server_actionkit_a_2026_comparison); [Unified: Paragon alternatives](https://unified.to/blog/top_paragon_alternatives_in_2026_a_buyer_guide_for_saas_teams)
- Unified.to MCP: entry $750/month, unlimited connections, 30-day trial (another source: $750 for 750k API calls) — [Unified: best unified API platforms](https://unified.to/blog/best_unified_api_platforms_of_2026); [Scalekit](https://www.scalekit.com/blog/best-managed-mcp-server-platforms)
- These are embedded-iPaaS products for B2B SaaS builders, not end-user control planes.

#### Speakeasy Gram
- MCP gateway / server builder from OpenAPI. Beta launch post described usage-based pricing with free tier of 1K tool calls; that free tier reportedly no longer appears on Speakeasy pages; current page has "Start for free" — [Speakeasy Gram product](https://www.speakeasy.com/product/gram); [Gram beta launch](https://www.speakeasy.com/blog/release-gram-beta)

#### Stainless
- Only finding: one comparison lists Stainless as closed to new signups — [Scalar: best MCP server generators 2026](https://scalar.com/library/best-mcp-server-generators-2026)

#### Runlayer
- Launched from stealth with $11M seed (Khosla's Keith Rabois, Felicis); later $30M Series A (Felicis, Khosla), $42M total (single aggregator, verify) — [TechCrunch](https://techcrunch.com/?p=3068049); [hyper.ai](https://hyper.ai/en/stories/f85be9018113d7f160be9ad74c228bde); [TAMradar](https://www.tamradar.com/funding-rounds/runlayer-series-a-30m)
- Features: gateway, threat detection, observability, fine-grained permissions in one console; Okta/Entra policies, SSO/SCIM/OAuth; audit logs; cloud and self-hosted; device scanning for unapproved ("shadow") MCP servers. Customers reportedly Gusto, dbt Labs, Instacart, Opendoor; MCP co-creator David Soria Parra is an advisor — [aibase](https://news.aibase.com/news/22923); [IndexBox](https://www.indexbox.io/blog/runlayer-launches-from-stealth-with-11m-seed-to-secure-ai-agent-protocol/); [Maxim: best enterprise MCP gateway](https://www.getmaxim.ai/articles/best-enterprise-mcp-gateway-in-2026/)
- Pricing not public.

#### Natoma (Snowflake)
- Enterprise MCP gateway enforcing identity, policy and audit per tool call; cloud or on-prem/hybrid; SSO, SCIM, SIEM logging; vendor-claimed SOC 2, GDPR, CCPA — [Natoma platform](https://natoma.ai/platform); [cybersectools](https://cybersectools.com/tools/natoma-mcp-gateway)
- Snowflake announced a definitive agreement to acquire Natoma on 27 May 2026; later Snowflake material describes integration into a Cortex AI Gateway — [nhigovernance Natoma](https://nhigovernance.com/companies/natoma.html)
- Pricing: commercial, not published (one directory says $149/month, unverified) — [similarlabs](https://similarlabs.com/p/hosted-mcp-platform)

#### MintMCP (now Mintive)
- Renamed Mintive; also routes LLM calls from Claude Code, Codex, Claude Desktop through its LLM gateway — [mintive.com](https://www.mintive.com/)
- SOC 2 Type II and HIPAA (BAA) self-claimed; pricing custom quote per active user plus platform fee; free trial; managed SaaS with VPC/self-host on request — [nhigovernance MintMCP](https://nhigovernance.com/companies/mintmcp.html)

#### Barndoor AI
- $13.6M seed (May 20, 2025) led by Crosslink Capital (Preface, Precursor, Gaingels, Rob Hayes, others); totals $14–15M elsewhere; no later round found — [PR Newswire](https://www.prnewswire.com/news-releases/barndoor-ai-raises-13-6m-in-series-seed-to-deliver-the-first-control-plane-for-agentic-ai-workforces-302459846.html); [PitchBook](https://pitchbook.com/profiles/company/756262-81)
- Per-call human approval for governed tools, with history and alerts on tool inventory changes; enterprise plan includes air-gapped and on-prem — [Maxim: top 5 MCP gateways](https://www.getmaxim.ai/articles/top-5-mcp-gateways-for-securing-agent-tool-access-in-2026/); April 2026 update added Microsoft 365 MCP security — [chiri.ai](https://chiri.ai/chiri-atlas/barndoor-ai)

#### TrueFoundry MCP Gateway
- Part of a broader AI infra platform (model serving, fine-tuning, LLM gateway). One review lists $499/month (plan unclear) — [TrueFoundry best MCP gateways](https://www.truefoundry.com/blog/best-mcp-gateways); [Speakeasy](https://www.speakeasy.com/blog/choosing-an-mcp-gateway)
- Approval: TrueFoundry describes holding a flagged call at the gateway and notifying an approver ("human gate at the gateway boundary") — [TrueFoundry: The Human Gate](https://www.truefoundry.com/blog/mcp-tool-approval-human-gate-call-path)

#### Lunar.dev MCPX
- MCP gateway for governed tool access; open-source MIT core with Enterprise tier; admin approval workflow for adding MCP servers (server onboarding, not per call) — [Lunar vs TrueFoundry](https://www.lunar.dev/comparison/truefoundry); [Zuplo MCP gateway comparison](https://zuplo.com/blog/mcp-gateway-comparison)

#### Portkey
- LLM gateway extended with an MCP registry/gateway; self-hosting reserved for Enterprise; no public MCP price found — [Lunar comparison](https://www.lunar.dev/comparison/truefoundry); [TrueFoundry best MCP gateways](https://www.truefoundry.com/blog/best-mcp-gateways)

#### Obot (commercial tiers)
- MIT core, free to self-host; Community edition up to 100 users; Obot Cloud with 14-day trial; Enterprise (Okta/Entra, support) priced privately — [Obot MCP Gateway](https://obot.ai/mcp-gateway/); [obot.ai](https://obot.ai/); [TrueFoundry: Obot vs Kong](https://www.truefoundry.com/blog/obot-ai-vs-kong-ai)

#### Peta (Dunia Labs)
- "Control plane for MCP": vault, managed runtime, audit trail, policy-based approvals. Peta Desk pauses flagged tool calls and alerts a human via Slack, Microsoft Teams or the web console; secrets encrypted at rest (PBKDF2 + AES-GCM) and injected server-side; every call logged with identity, decision, outcome — [github.com/dunialabs/peta-core](https://github.com/dunialabs/peta-core); [peta.io architecture](https://peta.io/architecture/); [bytebridge Medium](https://bytebridge.medium.com/model-context-protocol-mcp-evolution-capabilities-and-the-rise-of-peta-ff2967b45d48)
- Closest feature match to Synoikia's vault + out-of-band approval model.

#### Docker MCP Catalog / Gateway
- Curated verified MCP server images on Docker Hub (Beta); browse at hub.docker.com/mcp or Docker Desktop MCP Toolkit; custom/private catalogs supported; MCP Gateway is open source and free on one machine — [Docker MCP Catalog docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/catalog/); [Docker: custom catalog](https://www.docker.com/blog/build-custom-mcp-catalog/); [github.com/docker/mcp-gateway](https://github.com/docker/mcp-gateway)

#### AWS Bedrock AgentCore Gateway
- Consumption pricing, no minimum: $0.005 per 1,000 MCP operations (ListTools, CallTool, Ping); semantic tool Search API $0.025 per 1,000; tool indexing $0.02 per 100 tools/month. Search can dominate cost in some workloads — [AWS AgentCore pricing](https://aws.amazon.com/bedrock/agentcore/pricing/); [betterclaw](https://www.betterclaw.io/blog/aws-bedrock-agentcore-pricing-alternatives); [cloudburn calculator](https://cloudburn.io/tools/amazon-bedrock-agentcore-pricing-calculator)
- Context reduction via semantic tool search (not code mode).

#### Azure API Management (+ API Center / AI Foundry)
- APIM can expose a managed REST API as a remote MCP server or front an existing MCP server with auth, authorization, rate-limit and logging policies; API Center acts as MCP registry — [Microsoft Learn: MCP server overview](https://learn.microsoft.com/en-us/azure/api-management/mcp-server-overview); [Microsoft Learn: export REST as MCP](https://learn.microsoft.com/en-us/azure/api-management/export-rest-mcp-server); [Tech Community](https://techcommunity.microsoft.com/blog/appsonazureblog/mcp-in-azure-using-api-management-for-authentication-access-logging--governance/4532139)
- No MCP-specific pricing found (APIM tier pricing applies).

#### Google Cloud Apigee
- Apigee hybrid 1.17.0 (2026-09-14) adds MCP with the MCP data plane running in your own Kubernetes cluster; OpenAPI operations exposed as MCP tools; entitlements via API products — [Google Developers Blog](https://developers.googleblog.com/announcing-mcp-support-in-apigee-hybrid-agentic-tools-that-run-in-your-own-cluster/); [Hexaware](https://hexaware.com/blogs/mcp-support-in-apigee-bridging-enterprise-apis-with-ai-agent-ecosystems/)
- A 2025 competitor post claimed Apigee did not support MCP (now outdated) — [Solo.io](https://www.solo.io/blog/building-an-mcp-gateway-with-apigee-api-gateway)

#### Kong (AI Gateway / Konnect)
- AI MCP Proxy plugin with default and per-tool ACLs (AI Gateway 3.13; per-tool replaces default; deny wins); AI MCP OAuth2 plugin (RFC 9728 PRM, PKCE, introspection/JWKS) is Enterprise-only; 3.14 maps token claims to Consumers/Groups; `deck file openapi2mcp` converts OpenAPI to MCP — [Kong MCP Tool ACLs blog](https://konghq.com/blog/product-releases/mcp-tool-acls-ai-gateway); [Kong AI MCP OAuth2 plugin](https://developer.konghq.com/plugins/ai-mcp-oauth2/); [Kong AI MCP Proxy](https://developer.konghq.com/plugins/ai-mcp-proxy/); [deck openapi2mcp](https://developer.konghq.com/deck/file/openapi2mcp/)
- Kong Gateway is self-hostable (hybrid data plane), so it can sit on a private network.

#### MCP auth vendors (Descope, WorkOS, Auth0)
- Descope Agentic Identity Hub (2.0 announced Jan 2026): free 7,500 MAU; Pro from $249/month; Growth $799/month (annual); metering includes M2M token exchanges incl. MCP auth — [Scalekit: Descope alternatives](https://www.scalekit.com/blog/descope-alternatives); [tooldirectory Descope](https://tooldirectory.ai/tools/descope)
- WorkOS AuthKit: free to 1M MAU; OAuth 2.1 authorization server for MCP servers; SSO $125/connection/month (down to $80 at volume) — [guptadeepak WorkOS vs Auth0 vs Clerk](https://guptadeepak.com/ciam-compass/guides/workos-vs-auth0-vs-clerk/); [firecrawl](https://www.firecrawl.dev/blog/best-ai-agent-authentication-platforms)
- Auth0 for AI Agents: GA Nov 2025; includes CIBA (asynchronous, out-of-band user authorization); free to 25,000 MAU, Essentials from $35/month, Professional from $240/month; charges for "active agent identities" without a published rate — [agentmail](https://www.agentmail.to/blog/ai-agent-authentication-platforms-compared-2026); [firecrawl](https://www.firecrawl.dev/blog/best-ai-agent-authentication-platforms)
- These are building blocks (auth for an MCP server), not gateways; Synoikia already does OAuth 2.1 itself.

#### Operant AI
- Listed as combining MCP gateway functionality with dedicated security research; no further detail found — [integrate.io](https://www.integrate.io/blog/best-mcp-gateways-and-ai-agent-security-tools/)

### Inferences
- Synoikia's niche (self-hosted services on a LAN, per-operation access classification, locked destructive ops) is not served by any commercial vendor found; they target SaaS apps (Gmail, Slack, Salesforce) and enterprise IdPs.
- Feature-for-feature the nearest analogues are Peta (vault + Slack/Teams/web approvals, self-host) and Cloudflare portals (Code Mode + private-network reach). Neither ships Synoikia's per-operation None/Read/Ask/Write classification derived from the upstream API (based on what was found).
- The paid tiers are priced for companies (Merge $1,000/month, Unified $750/month, Paragon ~$1,000+/month, per-user enterprise quotes). For a homelab user, free tiers of Composio/Zapier/Cloudflare are the only realistic alternatives, and they do not address local services except Cloudflare via Tunnel.
- Consolidation (Workday–Pipedream, Snowflake–Natoma) adds lock-in/roadmap risk to managed options, which favors an MIT self-hosted product's positioning.

### Gaps
- No primary-source detail on Klavis Strata, Composio Rube, Smithery funding, Stainless MCP code mode, Google MCP Toolbox for Databases, Vertex AI Agent Engine MCP, MCP Manager (Usercentrics), Golf.dev, Gentoro, Prefactor. Searches returned nothing on them; existence and current status not verified here.
- Pricing missing for Runlayer, Natoma, Barndoor, Portkey MCP, Kong MCP plugins, Azure APIM MCP, Obot Enterprise, Lunar Enterprise, Speakeasy Gram (current).
- Cloudflare Zero Trust free-plan user limit as applied to MCP portals not verified.

## Q2. Which offer human approval/HITL for tool calls, and is it out-of-band from the calling client?

### Takeaway
Out-of-band per-call approval exists in a minority: Peta (Slack/Teams/web console), TrueFoundry (hold at gateway, notify approver), Barndoor (per-call approval), Auth0 CIBA (out-of-band user consent, as a building block), and Cloudflare Agents SDK (approval pattern you code yourself). Most integration platforms (Composio, Zapier, Arcade, Merge) and API-gateway add-ons (Kong, APIM, Apigee, AgentCore) offer RBAC/ACLs but no confirmed per-call human approval.

### Cited Findings
- MCP recommends human control but defines no universal approval protocol, so each vendor implements its own — [Maxim: best MCP gateway 2026](https://www.getmaxim.ai/articles/best-mcp-gateway-in-2026-for-enterprise-ai-applications/)
- TrueFoundry holds a flagged call at the gateway and notifies an approver — [TrueFoundry Human Gate](https://www.truefoundry.com/blog/mcp-tool-approval-human-gate-call-path)
- Bifrost (Maxim) does not execute tool calls implicitly; per-tool auto-approval is opt-in — [Maxim enterprise MCP gateway](https://www.getmaxim.ai/articles/best-enterprise-mcp-gateway-in-2026/)
- Barndoor: per-call human approval for any governed tool — [Maxim top 5](https://www.getmaxim.ai/articles/top-5-mcp-gateways-for-securing-agent-tool-access-in-2026/)
- Peta Desk: flagged tools pause and alert an operator via Slack, Teams or web console; runs only after approval — [peta-core GitHub](https://github.com/dunialabs/peta-core); [peta.io](https://peta.io/architecture/)
- Cloudflare: elicitation, workflow approval and Code Mode approval patterns in the Agents SDK; Code Mode approval flagged as immature in an open issue — [Cloudflare HITL docs](https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/); [issue #1148](https://github.com/cloudflare/agents/issues/1148)
- Lunar MCPX approval is for adding MCP servers (admin workflow), not per-call — [Zuplo comparison](https://zuplo.com/blog/mcp-gateway-comparison)
- Auth0 for AI Agents includes CIBA (asynchronous authorization) — [agentmail](https://www.agentmail.to/blog/ai-agent-authentication-platforms-compared-2026)

### Inferences
- MCP elicitation (used by Cloudflare and others) shows the prompt inside the calling client. That is in-band and a compromised or auto-approving client could accept it. Synoikia's own approval page that the client cannot self-approve is stronger by design. Peta (Slack/Teams/web) and TrueFoundry (gateway hold) appear out-of-band; Barndoor's channel is not confirmed.
- No vendor found pairs approval with typed confirmation for "locked" destructive operations by default.

### Gaps
- Whether Runlayer, Natoma, MintMCP, Composio, Arcade offer per-call approval was not confirmed.
- Barndoor's and TrueFoundry's approval channel specifics (Slack? UI?) not confirmed from primary pages.

## Q3. Which use code mode / tool search to cut context?

### Takeaway
Only Cloudflare ships true Code Mode (search + execute in a sandbox) for arbitrary MCP servers behind a portal. Others use tool search/meta-tools: AWS AgentCore (semantic search, metered), Composio Tool Router (meta tools), Klavis Strata (progressive discovery, unverified detail). Synoikia's code mode per plugin endpoint is matched only by Cloudflare.

### Cited Findings
- Cloudflare portal Code Mode: two tools, JS in isolated Dynamic Worker, ~9,400 → ~600 tokens example; can be enforced per portal — [zenn.dev](https://zenn.dev/oymk/articles/45e38ede000716?locale=en); [Cloudflare blog](https://blog.cloudflare.com/enterprise-mcp/)
- AWS AgentCore semantic Search API at $0.025/1K calls plus tool indexing $0.02/100 tools/month — [AWS pricing](https://aws.amazon.com/bedrock/agentcore/pricing/); [betterclaw](https://www.betterclaw.io/blog/aws-bedrock-agentcore-pricing-alternatives)
- Composio Tool Router meta tools load app schemas on demand — [Composio docs](https://docs.composio.dev/tool-router/overview)

### Inferences
- Code mode is becoming table stakes in the enterprise segment via Cloudflare; Synoikia's differentiator is gating each operation inside the code run (per-op access levels, approval mid-execution, resume), which Cloudflare's issue tracker shows it has not productized.

### Gaps
- Klavis Strata, Speakeasy Gram, Stainless, Runlayer and others: context-reduction approach not confirmed.

## Q4. Pricing and lock-in; data residency; can they reach services on a private LAN (homelab)?

### Takeaway
Managed integration platforms (Composio, Zapier, Pipedream, Merge, Arcade, Smithery, Unified, Paragon) run in the vendor cloud and hold your OAuth tokens; they target public SaaS APIs and have no documented path to LAN services. Options that can reach a private LAN are: Cloudflare portals via Tunnel (traffic transits Cloudflare), self-hostable gateways (Kong, Apigee hybrid, Obot, Lunar MCPX core, Peta, Docker MCP Gateway, Nango), and enterprise vendors with on-prem/VPC options (Runlayer, Natoma, MintMCP on request, Barndoor air-gapped).

### Cited Findings
- Cloudflare private MCP servers via Tunnel/Mesh; OAuth endpoints must be public — [Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2026-09-22-private-mcp-servers/)
- Apigee hybrid MCP data plane runs in your own cluster — [Google Developers Blog](https://developers.googleblog.com/announcing-mcp-support-in-apigee-hybrid-agentic-tools-that-run-in-your-own-cluster/)
- Runlayer cloud and self-hosted — [aibase](https://news.aibase.com/news/22923); Natoma cloud or on-prem — [cybersectools](https://cybersectools.com/tools/natoma-mcp-gateway); MintMCP VPC/self-host on request — [nhigovernance](https://nhigovernance.com/companies/mintmcp.html); Barndoor air-gapped/on-prem on enterprise plan — [Maxim](https://www.getmaxim.ai/articles/top-5-mcp-gateways-for-securing-agent-tool-access-in-2026/); Portkey self-host Enterprise only — [Lunar](https://www.lunar.dev/comparison/truefoundry)
- Pricing models: per call (Zapier 2 tasks/call; AgentCore $0.005/1K ops; Arcade ~$0.01/call), credits (Merge, Pipedream), per connection (Nango), per user/quote (MintMCP, Paragon, Runlayer, Natoma), MAU (Descope, WorkOS, Auth0) — sources as cited in Q1.
- Acquisitions: Workday–Pipedream, Snowflake–Natoma — [Scalekit](https://www.scalekit.com/blog/best-managed-mcp-server-platforms); [nhigovernance](https://nhigovernance.com/companies/natoma.html)

### Inferences
- For a homelab user, every managed option means credentials or traffic leave the LAN (Cloudflare at minimum terminates TLS and sees traffic). Synoikia keeps secrets and traffic local, which is its strongest differentiator against this segment.
- Synoikia's weaknesses relative to this segment: no managed OAuth to hundreds of SaaS apps, no SSO/SCIM/SIEM enterprise features, no shadow-MCP discovery, no commercial support or compliance attestations (SOC 2/HIPAA), single node.

### Gaps
- Data-residency/region options per vendor not verified (EU hosting etc.).
- Whether Composio/Arcade offer self-hosted or VPC deployment was not confirmed in this pass.
