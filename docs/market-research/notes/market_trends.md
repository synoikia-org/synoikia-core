# MCP gateway / agent-tool-infrastructure market trends (as of 2026-10-23)

Method note: 15 web searches/fetches on 2026-10-23. Many findings come from vendor blogs or search-engine summaries, not primary pages. blog.cloudflare.com could not be fetched (DNS failure). Items marked **[prior knowledge, not re-verified]** come from the researcher's training data (cutoff mid-2026), with the canonical URL. Verify them before publication.

## 1. Market structure and segments

### Takeaway

The market has split into five segments: API-gateway incumbents that bolt MCP onto existing gateways, security vendors (much of it now acquired by large security platforms), integration/tool platforms (Composio, Arcade, Zapier, Pipedream), registries, and open-source gateways. Gartner says MCP support is now a mandatory gateway feature, not a differentiator. Almost every vendor targets the enterprise. The self-hosted homelab segment has open-source tools but no funded player.

### Cited Findings

- Gartner (2025 Innovation Insight on MCP gateways) defines MCP gateways as the enterprise layer for registration, discovery, authentication and observability across MCP servers. It names three deployment patterns: aggregator, proxy and composite. Reported second-hand by a vendor — [Operant AI](https://www.operant.ai/art-kubed/operant-ai-featured-in-gartners-2025-market-guide-for-api-protection-and-innovation-report-mcp-gateways)
- Gartner projects that 75% of API gateway vendors will have MCP features by end of 2026, up from near zero in 2024. Reported by a vendor, Zuplo — [Zuplo](https://zuplo.com/blog/gartner-75-percent-api-gateways-mcp)
- Kong cites Gartner listing MCP gateway support as mandatory, not a differentiator. Kong also cites Gartner's "context mesh" framing — [Kong Gartner report page](https://konghq.com/resources/reports/gartner-complimentary-report); [Kong context mesh blog](https://konghq.com/blog/enterprise/gartners-context-mesh)
- Many 2026 "best MCP gateway" roundups are vendor content: Zuplo, Speakeasy, MintMCP, Maxim/Bifrost, Lunar, Composio. This is evidence that the category is crowded and SEO-contested — [Zuplo](https://zuplo.com/blog/what-the-best-mcp-gateways-do-in-2026); [Speakeasy](https://www.speakeasy.com/blog/best-mcp-gateways-for-enterprise-2026); [Lunar open source list](https://www.lunar.dev/post/the-best-open-source-mcp-gateways-in-2026); [Maxim](https://www.getmaxim.ai/articles/best-mcp-gateways-in-2026-what-they-do-and-how-to-pick-one/); [MintMCP](https://www.mintmcp.com/blog/gateways-investment-banks-with-mcp)
- Cloudflare: MCP server portals (part of Cloudflare One / Zero Trust Access) put many MCP servers behind one endpoint, with audit controls and progressive tool disclosure. Code Mode is on by default on all portals. Portals need a Cloudflare zone and an IdP in Zero Trust — [Cloudflare docs: MCP portals](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/mcp-portals); [Cloudflare community changelog](https://community.cloudflare.com/t/access-code-mode-for-mcp-server-portals/918887); [Cloudflare enterprise MCP reference architecture](https://blog.cloudflare.com/enterprise-mcp/); [zenn.dev write-up](https://zenn.dev/oymk/articles/45e38ede000716?locale=en)
- Docker MCP Gateway / MCP Toolkit: Docker Desktop 4.50 added `mcp-find`, `mcp-add` and `code-mode` dynamic tools. Code mode runs agent-written JavaScript in an isolated sandbox that can only reach MCP tools. Docker Sandboxes have static and dynamic modes — [Docker blog: Dynamic MCPs](https://www.docker.com/blog/dynamic-mcps-stop-hardcoding-your-agents-world/); [Docker docs: Dynamic MCP](https://docs.docker.com/ai/mcp-catalog-and-toolkit/dynamic-mcp/); [Docker Sandboxes MCP gateway](https://docs.docker.com/ai/sandboxes/mcp-gateway/)
- Docker labels code mode as experimental and "not yet reliable for general use". It can be turned off with `docker mcp feature disable dynamic-tools`. From a third-party listing — [mcp.so Docker MCP gateway](https://mcp.so/servers/docker-mcp-gateway)
- Open-source gateways listed in 2026 roundups: Docker MCP Gateway, IBM ContextForge, MetaMCP, Lunar MCPX, Bifrost, MCPProxy, utcp-mcp-gateway, and others — [Lunar](https://www.lunar.dev/post/the-best-open-source-mcp-gateways-in-2026); [Maxim open source list](https://www.getmaxim.ai/articles/open-source-mcp-gateways-for-developers-in-2026/); [DEV: MCPProxy landscape](https://dev.to/algis/the-mcp-gateway-landscape-in-2026-where-mcpproxy-fits-mjk)
- Integration platforms: Composio (managed toolkits and auth), Arcade (tool-calling runtime with auth, now also owns the Smithery registry), Klavis AI (YC X25, Apache 2.0, open source) — [rywalker.com MCP integration platforms compared](https://rywalker.com/research/mcp-integration-platforms)
- MCP security vendor roundup (2026) lists pure-play MCP security companies. It says disclosed funding across pure-play MCP security startups is about $40M across four companies. This figure was published before Runlayer's reported $30M Series A, so it is probably stale — [AppSentinels](https://appsentinels.ai/blog/top-10-mcp-security-companies-in-2026/)

### Inferences

- The incumbents (Kong, Cloudflare, Azure APIM, AWS, Apigee, F5) sell MCP as a feature of an existing gateway or SASE contract. Their buyer is the platform or security team in an enterprise, not a homelab owner.
- Docker is the closest local-first competitor. It has a catalog, a gateway, dynamic tools and a code mode sandbox, and it runs on the developer's machine. It does not yet offer human approvals or a per-service security model.

### Gaps

- No primary-source detail for Kong, Apigee, Azure APIM, AWS (Bedrock AgentCore Gateway), Traefik Hub, Solo agentgateway or F5/NGINX MCP features in this pass. The search budget did not allow it.
- IBM ContextForge and MetaMCP status in Oct 2026 (activity, licence changes) not verified.

## 2. Funding, acquisitions and analyst views

### Takeaway

2025 was the year that large security platforms bought AI and agent security startups: Snyk–Invariant, Cato–Aim, SentinelOne–Prompt, CrowdStrike–Pangea and Palo Alto–Protect AI. In 2026 the MCP-specific layer consolidated: Boomi–Lunar.dev, Arcade–Smithery and, per one source, Palo Alto–Portkey. Arcade ($60M Series A) and Runlayer ($30M Series A) raised large rounds. Analysts call the AI gateway market small but fast-growing. Gartner sizes it at about $1B by 2028 and warns about MCP security incidents.

### Cited Findings

- Snyk acquired Invariant Labs (Zurich, founded 2024; Guardrails and an MCP server scanner) in June 2025. Terms were not disclosed. The work moved into Snyk Labs and the AI Trust Platform — [Startupticker](https://www.startupticker.ch/en/news/snyk-acquires-invariant-labs-to-accelerate-agentic-ai-security-innovation); [Techzine](https://www.techzine.eu/news/security/132501/snyk-acquires-invariant-labs-for-ai-security/); [BankInfoSecurity](https://www.bankinfosecurity.com/embargo-0624-9am-et-agentic-ai-security-gets-fuel-snyks-invariant-labs-buy-a-28789)
- CrowdStrike announced the Pangea acquisition at Fal.Con 2025, to build AI Detection and Response (AIDR) into Falcon. The value is reported as about $260M, or $222.7M per an SEC-based tracker (conflict) — [CrowdStrike IR](https://ir.crowdstrike.com/news-releases/news-release-details/crowdstrike-acquire-pangea-secure-every-layer-enterprise-ai); [SDxCentral](https://www.sdxcentral.com/news/crowdstrike-acquires-pangea-for-shadow-ai-panacea/); [guptadeepak.com M&A tracker](https://guptadeepak.com/agent-security/deals/)
- SentinelOne acquired Prompt Security. The tracker says it closed on 2025-09-05 for $160.2M (SEC). Other outlets report about $250M (conflict) — [guptadeepak.com M&A tracker](https://guptadeepak.com/agent-security/deals/); [Infosecurity Magazine](https://www.infosecurity-magazine.com/news-features/cybersecurity-ma-crowdstrike/)
- Cato Networks acquired Aim Security (Cato's first acquisition, terms not disclosed). Aim is now part of the Cato SASE platform — [guptadeepak.com M&A tracker](https://guptadeepak.com/agent-security/deals/); [cyberdb](https://www.cyberdb.co/cybersecurity-ma-in-2025/)
- Palo Alto Networks bought Protect AI (closed July 22, 2025), which became Prisma AIRS. A Zuplo post says Palo Alto acquired Portkey on April 30, 2026 ("Prisma AIRS AI Gateway"). Single source, and from a competitor, so unverified — [guptadeepak.com runtime guardrails](https://guptadeepak.com/agent-security/runtime-guardrails/); [Zuplo](https://zuplo.com/blog/what-the-best-mcp-gateways-do-in-2026)
- Boomi completed its acquisition of Lunar.dev (MCPX gateway). Date not captured. The source is Lunar's own blog — [Lunar.dev](https://www.lunar.dev/post/mcp-gateway-build-vs-buy)
- Arcade raised a $60M Series A in June 2026, led by SYN Ventures with Morgan Stanley and Wipro. Total $72M including a $12M 2025 seed. CB Insights lists a different earlier round (conflict) — [FinSMEs](https://www.finsmes.com/2026/06/arcade-raises-60m-in-series-a-funding.html); [CB Insights](https://www.cbinsights.com/company/arcade-5/financials)
- Arcade.dev acquired Smithery (public MCP registry and hosting platform), announced 5 August (2026 by context). Terms not disclosed — [Dealroom](https://app.dealroom.co/news/feed/arcade-acquires-smithery-to-control-mcp-registry-and-runtime-layer)
- Composio raised a $25M Series A led by Lightspeed (July 2025), $29M in total. Composio's positioning moved toward "skills that evolve with your agents" — [Composio blog](https://composio.dev/blog/series-a); [Yahoo Finance](https://finance.yahoo.com/news/composio-raises-29m-solve-ais-130000885.html)
- Runlayer (MCP security): an $11M seed, then a $30M Series A in June 2026, about seven months later — [AppSentinels](https://appsentinels.ai/blog/top-10-mcp-security-companies-in-2026/)
- Gartner, per Kong: the AI gateway market grows from under $250M annual revenue to $1B by 2028 — [Kong](https://konghq.com/resources/reports/gartner-complimentary-report)
- Gartner, "Manage the Cybersecurity Risks of the Model Context Protocol" (Nov 2025), per Tray.ai: by 2027, incidents from prompt injection, data access or agent misconfiguration will affect over 40% of enterprise MCP deployments — [Tray.ai](https://tray.ai/blog/mcp-enterprise-security-risks/)
- CrowdStrike also acquired SGNL (identity) in January 2026 for $637.1M. This is adjacent: agent identity — [guptadeepak.com M&A tracker](https://guptadeepak.com/agent-security/deals/)

### Inferences

- The exit path in this space is acquisition by a security, iPaaS or API platform. The buyers want enterprise distribution. An MIT, free, homelab project is not on that path, and it does not compete for the same budget.
- The registry layer is consolidating into runtime vendors (Smithery into Arcade). Independent public registries are becoming fewer.

### Gaps

- Natoma funding status not found in this pass.
- Klavis AI: only "YC X25 seed" found, no amount.
- No Forrester MCP-specific report found in this pass.
- No verified total "MCP market size" number. Only the Gartner AI-gateway figure, quoted second-hand.

## 3. MCP adoption, spec versions and governance

### Takeaway

MCP is the de facto standard for agent tools. Anthropic gave it to the Linux Foundation's Agentic AI Foundation (AAIF) on 9 December 2025. The 2026-07-28 spec is the biggest revision so far: a stateless core, header-based routing for gateways, cacheable lists, an extensions framework (Tasks, MCP Apps, Enterprise Managed Authorization), and auth hardening. The two Tier 1 SDKs each have over 1 billion downloads.

### Cited Findings

- 2026-07-28 spec: the `initialize` handshake and `Mcp-Session-Id` are retired. Each request carries its protocol version, client identity and capabilities. There is an optional `server/discover` call — [MCP blog 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- Multi Round-Trip Requests (MRTR) replace server-initiated sampling and elicitation over held-open streams. The server returns `input_required` and the client retries with `inputResponses` — [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- Streamable HTTP requests must carry `Mcp-Method` and `Mcp-Name` headers, so that gateways can route and meter without parsing JSON. `tools/list` and similar responses carry `ttlMs` and `cacheScope` — [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- Roots, Sampling and Logging are deprecated. Legacy HTTP+SSE is deprecated. There is a formal 12-month minimum deprecation window — [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/); [VentureBeat](https://venturebeat.com/infrastructure/mcp-just-got-its-biggest-update-ever-heres-what-changes-for-ai-agents)
- Extensions: Tasks moved to `io.modelcontextprotocol/tasks` (`tasks/get`, `tasks/update`, `subscriptions/listen`). MCP Apps and Enterprise Managed Authorization are extensions — [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- Auth: authorization servers should return RFC 9207 `iss`, and clients must validate it (OAuth mix-up defence). Credentials are bound to their issuer. Dynamic Client Registration is deprecated in favour of Client ID Metadata Documents (CIMD) — [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- Adoption: Tier 1 SDKs see close to 500M downloads per month. The TypeScript and Python SDKs each passed 1B total downloads. Lead maintainers are David Soria Parra and Den Delimarsky. MCP is "a Series of LF Projects, LLC" — [MCP blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- AAIF: a directed fund under the Linux Foundation, co-founded by Anthropic, Block and OpenAI. MCP was donated on 9 Dec 2025 — [Wikipedia: MCP](https://en.wikipedia.org/wiki/Model_Context_Protocol); [AAIF: MCP is growing up](https://aaif.io/blog/mcp-is-growing-up); [AAIF migration guide](https://aaif.io/blog/mcp-2026-07-28-whats-changing-and-how-to-migrate)
- Earlier spec versions: 2025-06-18 (structured tool output, elicitation, OAuth resource-server classification) and 2025-11-25 (anniversary release: experimental Tasks, CIMD, URL-mode elicitation) **[prior knowledge, not re-verified]** — [spec 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18); [spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- ChatGPT: developer mode with full MCP (read and write) and "MCP apps" is in beta. OpenAI's help centre names Business, Enterprise and Edu. Third-party guides also claim Plus and Pro (conflict). Free plans do not support custom connectors — [OpenAI Help Center](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt-beta); [coworker.ai](https://coworker.ai/blog/chatgpt-mcp); [OpenAI community](https://community.openai.com/t/mcp-server-tools-now-in-chatgpt-developer-mode/1357233)
- Claude, Cursor, VS Code / GitHub Copilot, Gemini CLI and others list MCP registration. This comes from a third-party registration guide that covers ChatGPT, Claude, Cursor, Copilot and Gemini — [vastlint](https://vastlint.org/docs/mcp/register/)
- Home Assistant ships an official `mcp_server` integration (merged into Core on 2 Jan 2025) that exposes the Assist API, limited to exposed entities — [Home Assistant docs](https://home-assistant.io/integrations/mcp_server/); [HA PR #134122](https://github.com/home-assistant/core/pull/134122)

### Inferences

- The 2026-07-28 changes (header routing, cacheable lists, stateless requests, MRTR replacing held-open streams, CIMD) make gateways cheaper to build. They also mean every gateway, Synoikia included, must migrate. Synoikia's `resume(executionId)` approval pattern fits the MRTR and Tasks model.
- Approval flows can use MRTR `input_required` or URL-mode elicitation. Clients may surface these natively, which can reduce the need for out-of-band approval links. Check how clients implement this.

### Gaps

- Official MCP Registry (registry.modelcontextprotocol.io) GA status and size, and GitHub MCP Registry details: no results this pass.
- Native Gemini app (consumer) MCP support: no official Google source found.
- No total public MCP server count from a reliable source.

## 4. Code Mode / context-efficiency trend

### Takeaway

"Search plus execute code in a sandbox" went from a Cloudflare experiment (Sep 2025) to a mainstream pattern. Anthropic published it (Nov 2025), Docker shipped it (experimental), Cloudflare made it the default on its portals, and several gateways (Bifrost, utcp-mcp-gateway) adopted it. Reported token savings are large at scale (58–99.9%) and smaller at small scale (an independent test: 78.5% fewer input tokens, but 7% more latency). Synoikia's 3-tool design is on trend but no longer unique.

### Cited Findings

- Cloudflare's Cloudflare-API MCP server exposes only `search()` and `execute()`. The model writes JavaScript. The whole Cloudflare API costs about 1,000 tokens, a reported 99.9% cut in input tokens — [Cloudflare blog: Code Mode MCP](https://blog.cloudflare.com/code-mode-mcp/); [cloudflare/mcp GitHub](https://github.com/cloudflare/mcp)
- The original Cloudflare "Code Mode" post (Sep 2025) proposed converting MCP tools into a TypeScript API that the LLM codes against, run in V8 isolates **[prior knowledge, not re-verified]** — [Cloudflare blog: Code Mode](https://blog.cloudflare.com/code-mode/)
- Anthropic, "Code execution with MCP" (Nov 2025): present tools as code files, load them on demand. Example: 150,000 tokens down to 2,000 (98.7%) **[prior knowledge, not re-verified]** — [Anthropic engineering](https://www.anthropic.com/engineering/code-execution-with-mcp)
- Anthropic Tool Search Tool (Nov 2025, "advanced tool use"): about 85% less token use while the full tool library stays available. It is search-then-load, not code execution — [Maxim summary](https://www.getmaxim.ai/articles/code-execution-with-mcp-how-code-mode-cuts-agent-token-costs-by-90/); [mcp.directory](https://mcp.directory/blog/mcp-context-bloat-fix-2026-tool-search-code-mode-progressive-disclosure)
- Cloudflare extended Code Mode to MCP server portals ("front all of your MCP servers with a centralized portal that performs audit controls and progressive tool disclosure"). It is on by default — [Cloudflare enterprise MCP](https://blog.cloudflare.com/enterprise-mcp/); [Cloudflare community](https://community.cloudflare.com/t/access-code-mode-for-mcp-server-portals/918887)
- Docker MCP Gateway has `code-mode` (Desktop 4.50+), a JS sandbox limited to MCP tools. It is experimental — [Docker blog](https://www.docker.com/blog/dynamic-mcps-stop-hardcoding-your-agents-world/); [Docker docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/dynamic-mcp/)
- Bifrost (Maxim) vendor benchmark: Code Mode cut input tokens by 58.2% at 96 tools, 84.5% at 251 and 92.8% at 508, with a 100% pass rate — [Maxim/Bifrost](https://www.getmaxim.ai/articles/best-mcp-gateway-in-2026-how-bifrost-cuts-token-usage-by-50/)
- Independent AIMultiple test, one MCP server: 78.5% fewer input tokens, 7% higher latency — [AIMultiple](https://aimultiple.com/code-execution-with-mcp)
- StackOne compares four token-optimisation approaches: static, tool search, code mode and progressive disclosure — [StackOne](https://www.stackone.com/blog/mcp-token-optimization/)
- utcp-mcp-gateway (open source) combines progressive discovery, code mode and LLM response filtering. It claims 90%+ savings (self-reported) — [GitHub](https://github.com/Xuleileon/utcp-mcp-gateway)
- One author says MCP adopted progressive discovery in January 2026, which removed Skills' context advantage. Others say the gap narrowed but did not close — [Milvus blog](https://milvus.io/blog/is-mcp-dead-cli-and-skills-for-ai-agents.md); [Maxim Skills vs MCP](https://www.getmaxim.ai/blog/the-skills-vs-mcp-debate-understanding-two-layers-of-the-same-stack/)

### Inferences

- Code Mode is becoming table stakes for gateways. Synoikia's differentiation must come from what wraps the sandbox (per-operation access levels, approvals that pause and resume, redaction, audit, signed plugins), not from the 3-tool shape.
- The savings data favours large catalogs. A homelab with 5–15 services gets smaller absolute gains. Synoikia's pitch should stress safety and one endpoint per service as much as tokens.

### Gaps

- An OpenAI equivalent of Code Mode or tool search (for example in the Responses API or Agents SDK) was not verified this pass.
- No independent accuracy or quality benchmark comparing Code Mode with direct tool calls across models.

## 5. Competing protocols and approaches

### Takeaway

MCP is the dominant tool protocol, but in 2026 it faced a "CLI + Skills instead of MCP" backlash (HN "MCP is dead", Feb 2026; Perplexity's CTO, Mar 2026). The consensus that is emerging is a layered one: Skills for procedural knowledge, CLIs for local developer tools, MCP for authenticated remote services with permissions. A2A covers agent-to-agent traffic. MCP Apps / the OpenAI Apps SDK cover UI.

### Cited Findings

- The debate started around Feb 2026 with a "MCP is dead" HN post. Perplexity's CTO said in March 2026 that Perplexity was moving off MCP toward APIs and CLIs. Garry Tan criticised MCP context cost and auth. All from secondary blogs — [Milvus](https://milvus.io/blog/is-mcp-dead-cli-and-skills-for-ai-agents.md); [heyuan110](https://www.heyuan110.com/posts/ai/2026-07-04-cli-skills-vs-mcp/); [manveerc substack](https://manveerc.substack.com/p/mcp-vs-cli-ai-agents)
- Claim: a standard GitHub MCP server takes about 55,000 tokens before the agent does any work (unverified blog figure) — [Medium](https://medium.com/@krishnan.srm/mcp-vs-cli-vs-skills-lets-get-a-better-understanding-87a2d52ff42b)
- Arize ran an eval comparing MCP and CLI+Skills for agents — [Arize](https://arize.com/blog/mcp-vs-cli-skills-for-agents-what-our-eval-found-and-which-you-should-use/)
- Middle view: choose the transport per integration. OAuth discovery, structured schemas and granular permissions keep MCP necessary for enterprise SaaS — [DEV](https://dev.to/trashwbin/cli-vs-mcp-vs-skills-the-whole-debate-is-asking-the-wrong-question-nc1); [DEV: different, not competing](https://dev.to/phil-whittaker/mcp-vs-agent-skills-why-theyre-different-not-competing-2bc1); [Maxim](https://www.getmaxim.ai/blog/the-skills-vs-mcp-debate-understanding-two-layers-of-the-same-stack/)
- MCP Apps is now an official MCP extension. It is the convergence of the OpenAI Apps SDK and the MCP-UI line of work into server-rendered UIs — [MCP blog 2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/); [OpenAI Help Center](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt-beta)
- A2A (Google-originated, agent-to-agent) is a Linux Foundation project — [Wikipedia: Agent2Agent](https://en.wikipedia.org/wiki/Agent2Agent)
- Agent Skills: Anthropic published it as an open standard (Dec 2025). AAIF founding projects also include Block's goose and OpenAI's AGENTS.md **[prior knowledge, not re-verified]** — [agentskills.io](https://agentskills.io); [Linux Foundation AAIF announcement](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- UTCP (Universal Tool Calling Protocol) is used as a direct-call alternative or complement. utcp-mcp-gateway bridges it to MCP — [GitHub utcp-mcp-gateway](https://github.com/Xuleileon/utcp-mcp-gateway)

### Inferences

- The CLI argument is weakest where Synoikia lives: remote, credentialed services that must not let an agent run arbitrary shell commands. It is a good opening for "the safe alternative to giving an agent `curl` and your API keys".
- Synoikia's `plugin-notes` (per-plugin usage guidance in server instructions) are close to a Skill. Bundling or exporting Skills per plugin is a possible hedge.

### Gaps

- UTCP adoption level not measured.
- No primary OpenAI statement on Apps SDK and MCP Apps unification was fetched.

## 6. Market gaps for a self-hosted, security-first homelab gateway, and threats

### Takeaway

Funded vendors target enterprises (SSO, SASE, compliance). The homelab and small-team segment has many single-service community MCP servers and generic open-source aggregators, but no product combines per-service plugins, per-operation access levels, human approvals that pause and resume, redaction, audit and signed plugins in one free self-hosted box. The main threats are Docker (local gateway, catalog, code mode already shipped), Home Assistant extending its native MCP server, and Cloudflare portals if they become free for small Zero Trust tiers.

### Cited Findings

- Home Assistant's native MCP server exposes only entities the user has exposed. It relies on the client for remote transport, or on a local gateway if the client lacks remote support. It is limited to the Assist API — [Home Assistant docs](https://home-assistant.io/integrations/mcp_server/)
- One news article says Home Assistant 2026.10 (7 Oct 2026) "integrates MCP directly" and exposes 2,000+ integrations to AI agents. Single secondary source, unverified, and needs a check against HA release notes — [forkast.news](https://forkast.news/?p=131390)
- Many community Home Assistant MCP servers exist (allenporter, oleander, AHA, tevonsb), with automation management and several transports — [allenporter](https://glama.ai/mcp/servers/@allenporter/mcp-server-home-assistant/blob/0a82f5d157d77a73cfbef0f7d3b8c8dd46d31fbd/README.md); [oleander](https://cdn.jsdelivr.net/gh/oleander/home-assistant-mcp-server@main/README.md); [AHA](https://glama.ai/mcp/servers/@slhad/aha-mcp/blob/a212cbac289d1e7c54311a6486ef04c13f52f127/README.md)
- Docker's gateway already offers a catalog, dynamic discovery and sandboxed code mode on the desktop — [Docker docs](https://docs.docker.com/ai/mcp-catalog-and-toolkit/dynamic-mcp/)
- Cloudflare portals need a Cloudflare zone and a Zero Trust IdP. Pricing is not stated in the sources found. The hosted Cloudflare API MCP server has no separate price — [zenn.dev](https://zenn.dev/oymk/articles/45e38ede000716?locale=en); [mcp.so Cloudflare](https://mcp.so/servers/cloudflare)
- Gartner predicts that by 2027 over 40% of enterprise MCP deployments will have security incidents. This supports a security-first positioning — [Tray.ai](https://tray.ai/blog/mcp-enterprise-security-risks/)
- Security posture is the main buying criterion in vendor roundups (auth, audit, guardrails) — [Speakeasy](https://www.speakeasy.com/blog/best-mcp-gateways-for-enterprise-2026); [AppSentinels](https://appsentinels.ai/blog/top-10-mcp-security-companies-in-2026/)

### Inferences

- Gaps that Synoikia could own:
  - Self-hosted with no cloud dependency, unlike Cloudflare, Composio or Arcade, which are SaaS-first. This suits homelabs on private networks.
  - Out-of-band human approval for dangerous operations (unlock, garage, delete), with `resume`. Most gateways do authn/authz and guardrails but not per-call human approval.
  - Per-service semantic plugins (locks, sensitive fields) instead of generic proxying of community MCP servers of unknown quality.
  - Signed plugins as supply-chain defence against the "malicious MCP server" risk that Invariant and Snyk publicised.
  - Free and MIT-licensed, while the enterprise vendors are being acquired, which can change their licences or roadmaps.
- Threats:
  - Docker adds approvals and policies to its MCP Gateway. It has distribution to every developer desktop.
  - Home Assistant widens its native MCP server, which takes Synoikia's most obvious homelab plugin.
  - Cloudflare makes portals with Code Mode free on small Zero Trust plans. Many homelabbers already use Cloudflare Tunnel.
  - Spec churn (2026-07-28 statelessness, DCR to CIMD) consumes a small team's capacity.
  - Client-native features (Anthropic tool search, native elicitation and approval UIs in clients) shrink the gateway's value-add on context efficiency.

### Gaps

- No data on homelab or small-team MCP adoption size (for example self-hosted community surveys).
- No information on whether Unraid, TrueNAS, Proxmox or the \*arr projects ship native MCP servers. Not searched.
- Cloudflare portal pricing for free Zero Trust accounts not confirmed.
