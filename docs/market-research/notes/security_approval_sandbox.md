# MCP/agent security, HITL approval, permission and sandbox tools vs Synoikia (as of 2026-10-23)

Method note: 17 web searches/fetches, mostly search-result summaries (one WebFetch failed: docs.permit.io DNS error). Many sources are vendor listicles; primary sources are marked where available. Items marked "(background, unverified this session)" come from prior knowledge and must be checked before publication.

## Which tools provide out-of-band human approval that a compromised/injected client cannot bypass?

### Takeaway
Out-of-band approval that the calling client cannot self-grant is rare. Most HITL offerings (OpenAI Agents SDK, LangGraph interrupts, Cloudflare Agents HITL, Claude Code permissions) put the approval inside the agent host or client, so a compromised client or host can bypass it. The server-side/gateway exceptions found are Permit MCP Gateway (Enterprise-plan approvals), Permit Access Request MCP (but the agent itself calls the approve tools unless separated), and small open-source gateways (mcpgate, WhereMyMCP, MCP Shield). MCP URL-mode elicitation is now the protocol-level path for this, and it changed in the 2026-07-28 spec.

### Cited Findings
**Category 1: HITL / approval layers**
- HumanLayer: a competitor comparison says HumanLayer is now an AI coding IDE and its classic approvals SDK is deprecated, with the README saying the code is "pretty much all deprecated" (competitor source, verify) — [Pushary vs HumanLayer](https://pushary.com/vs/humanlayer); a May 2026 review says the homepage frames it as an AI IDE / software-factory toolkit — [aicoolies](https://aicoolies.com/reviews/humanlayer-review); the Go package `hld/mcp` still has an `ApprovalDecision` type (published Jun 19, 2026) — [pkg.go.dev](https://pkg.go.dev/github.com/humanlayer/humanlayer/hld/mcp).
- Permit.io Access Request MCP (open source, `permitio/permit-mcp`): MCP server to create/list/approve/deny access requests (standing role on a resource) and operation approvals (one-time action), backed by Permit policies and Permit Elements — [Permit docs](https://docs.permit.io/ai-security/access-request-mcp/overview/), [GitHub](https://github.com/permitio/permit-mcp). The tutorial pairs it with LangGraph `interrupt()` — [Permit blog](https://www.permit.io/blog/delegating-ai-permissions-to-human-users-with-permitios-access-request-mcp).
- Permit MCP Gateway (commercial, separate product): admin dashboard has an Approvals page for pending HITL requests, history, and notifications — [Permit gateway docs](https://docs.permit.io/permit-mcp-gateway/platform/); product page says human approval can be required for high-risk calls on Enterprise plans — [Permit MCP Gateway](https://www.permit.io/mcp-gateway). Also governs cloud/API control planes through MCP — [Permit blog](https://www.permit.io/blog/govern-ai-agents-cloud-api-control-planes-mcp).
- OpenAI Agents SDK (MIT, library): `needsApproval: true` or an async predicate per tool call; the run pauses with a `RunToolApprovalItem` and resumes from the saved `RunState` — [OpenAI Agents JS HITL](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/). Hosted MCP uses `require_approval` ("always"/"never" or per-tool map) plus an `on_approval_request` callback — [OpenAI Agents Python MCP](https://openai.github.io/openai-agents-python/mcp/). A callable policy that receives MCP tool annotations exists but is undocumented — [issue #5350](https://github.com/openai/openai-agents-python/issues/5350). OpenAI-hosted tools (web search, code interpreter, etc.) cannot be gated by per-call hooks, per an unofficial PR — [agentapprovalprotocol PR #61](https://github.com/agentapprovalprotocol/agentapprovalprotocol/pull/61). Also see [OpenAI guardrails & human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals).
- Cloudflare Agents HITL: docs list approval patterns including MCP elicitation, with approval handled by the agent client — [Cloudflare Agents docs](https://developers.cloudflare.com/agents/concepts/human-in-the-loop/).
- A 2026 roadmap piece says HITL hooks are being adopted at the application layer rather than the protocol level — [Knit](https://getknit.dev/blog/the-future-of-mcp-roadmap-enhancements-and-whats-next/).
- AWS Bedrock AgentCore Policy: Cedar policy engine at the AgentCore Gateway; each tool call maps to a Cedar action, JWT supplies the principal; default-deny, forbid-wins; ENFORCE and MONITOR modes; `agentcore add policy` with `--source` or natural-language `--generate` — [AWS docs: core concepts](https://docs.aws.amazon.com/de_de/bedrock-agentcore/latest/devguide/policy-core-concepts.html), [AWS docs: getting started](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-getting-started.html), [AWS blog](https://aws.amazon.com/blogs/machine-learning/govern-ai-agent-tool-access-with-amazon-bedrock-agentcore-gateway/). GA reported as March 3, 2026 in 13 regions (third-party guide, not verified against AWS announcement) — [hidekazu-konishi](https://hidekazu-konishi.com/entry/amazon_bedrock_agentcore_policy_implementation_guide.html). Guardrails integration reportedly July 2026 — [aws-samples](https://github.com/aws-samples/sample-amazon-bedrock-agentcore-onboarding/blob/main/08_policy/README.md). No human-approval primitive was found in AgentCore Policy (allow/deny only).
- Small open-source/self-hosted gateways with approval: mcpgate (source-available) claims "destructive actions gated — admin approval the AI can't self-grant" — [mcpgate](https://mcpgate.de/); WhereMyMCP has one-use approvals bound to one client, one tool and one exact argument object — [GitHub](https://github.com/rizkidarmawan21/wheremymcp); MCP Shield (MIT, alpha) has YAML policy, secret redaction, injection detection, exfiltration-chain blocking, file-based approval queue with webhook, tamper-evident audit — [GitHub](https://github.com/Alex2006boecboec/MCP_Gateway); MSPStack gateway (MIT) gates tools by annotation-derived read/write/destructive tiers, secrets kept server-side in OpenBao/Key Vault, no approval step mentioned — [GitHub](https://github.com/mspstack/mcp-gateway).

**MCP spec: URL-mode elicitation**
- 2025-11-25 spec adds URL-mode elicitation so servers can send users to an external URL for interactions that must not pass through the MCP client (auth, payments); fields `mode: "url"`, `message`, `url`, `elicitationId`; requests without `mode` are form mode — [MCP spec 2025-11-25 elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation), [WorkOS](https://workos.com/blog/mcp-2025-11-25-spec-update).
- "Accept" in URL mode means the user consented to open the link, not that the interaction finished — [Vercel](https://vercel.com/i/mcp-elicitation-form-vs-url-mode).
- 2026-07-28 spec removes `notifications/elicitation/complete` and `elicitationId`; the client learns the outcome by retrying the original request, and servers correlate retries through their own identifier in `requestState` — [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog).
- Client support is uneven: open issue asking Kiro for URL-mode support — [Kiro #4785](https://github.com/kirodotdev/Kiro/issues/4785); a client PR implements it with consent prompts and no auto-open — [ggcode PR #2462](https://github.com/topcheer/ggcode/pull/2462).

### Inferences
- Synoikia's approval page (server-hosted, not answerable by the calling client) is structurally stronger than SDK/host-level approvals (OpenAI SDK, LangGraph, Claude Code, Cloudflare Agents), where the approver code runs in the same process as the possibly-injected agent. Those protect against a model mistake, not a compromised host.
- Permit Access Request MCP exposes approve/deny as MCP tools. If the same agent holds those tools, it could self-approve unless Permit policies restrict who may approve; Synoikia's design (client cannot self-approve) avoids that class.
- The 2026-07-28 change (retry-based completion, `requestState`) maps well onto Synoikia's `resume(executionId)` pattern. Synoikia should confirm it tracks the new spec revision.
- Permit MCP Gateway is the closest commercial match on gateway + approval, but it is SaaS-oriented and approvals are gated to Enterprise plan.

### Gaps
- Not researched this session (no results): gotoHuman, LangGraph interrupts / Agent Inbox (LangChain), Claude Code permission system and hooks, Microsoft Entra Agent ID, Oso, Cerbos, OpenFGA for agents. Background (unverified this session): LangGraph `interrupt()` pauses a graph and Agent Inbox is a UI for reviewing interrupts; Claude Code has allow/ask/deny permission rules and PreToolUse hooks that can block calls; Entra Agent ID gives agents directory identities; Oso/Cerbos/OpenFGA are policy/ReBAC engines usable for agent authz without native HITL. Cite official docs before using.
- Permit gateway pricing and self-host options not confirmed (fetch failed).
- HumanLayer deprecation status only from a competitor and a review site.

## Which tools classify reads vs writes (or destructive ops)?

### Takeaway
Read/write classification is mostly left to MCP tool annotations (`readOnlyHint`, `destructiveHint`), which are server-declared and untrusted. A few gateways (MSPStack, Huf, WhereMyMCP, OpenAI SDK callable policy) derive tiers from annotations. Permit and AgentCore classify via policy authored by admins. No product found derives access levels from the upstream API spec the way Synoikia does.

### Cited Findings
- MSPStack gateway gates tools by annotation-derived read/write/destructive tiers — [GitHub](https://github.com/mspstack/mcp-gateway).
- Huf PR adds `read_only_hint`, `destructive_hint`, `requires_approval` to MCP tool records for an approval gate — [Huf PR #823](https://github.com/tridz-dev/huf/pull/823).
- MikkoParkkola Rust mcp-gateway exposes `destructiveHint` annotations — [GitHub](https://github.com/MikkoParkkola/mcp-gateway).
- WhereMyMCP approvals apply to each write or delete call — [GitHub](https://github.com/rizkidarmawan21/wheremymcp).
- OpenAI Agents SDK callable `require_approval` receives the MCP Tool including annotations — [issue #5350](https://github.com/openai/openai-agents-python/issues/5350).
- AgentCore Policy maps each tool call to a Cedar action; read/write semantics come from admin-written policies — [AWS docs](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-understanding-cedar.html).
- Permit distinguishes standing access requests (e.g., read access) from one-time operation approvals — [Permit docs](https://docs.permit.io/ai-security/access-request-mcp/overview/).

### Inferences
- MCP annotations are hints a malicious server can lie about. Synoikia's derivation from the upstream API (plus locked destructive ops with typed confirmation) is a real differentiator, but only for services it has plugins for.

### Gaps
- MCP spec text on tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, defined since 2025-03-26 spec, and stated as untrusted hints) was not fetched this session (background, unverified).

## MCP security scanners, guardrails and firewalls (category 2)

### Takeaway
The enterprise MCP security market consolidated into large vendors in 2025-2026 (Snyk/Invariant, SentinelOne/Prompt Security, Palo Alto/Portkey into Prisma AIRS). These products focus on detection (scanning tool descriptions, prompt injection, DLP) and runtime inspection, not on per-operation permissioning or human approval. They are complementary to Synoikia more than substitutes.

### Cited Findings
- Snyk acquired Invariant Labs (June 2025); Invariant built Guardrails (agent security layer) and MCP-Scan — [Snyk press release](https://snyk.io/news/snyk-acquires-invariant-labs-to-accelerate-agentic-ai-security-innovation/), [Invariant Labs](https://invariantlabs.ai/), [Guardion](https://guardion.ai/ai-security-index/alternatives/agentic-security).
- mcp-scan rebranded Snyk Agent Scan (Apache 2.0), v0.5.12 June 2026, 15+ risk categories — [Guardion](https://guardion.ai/ai-security-index/alternatives/agentic-security), [ReVerb](https://reverbico.com/blog/top-mcp-security-tools/); one comparison lists them separately (naming conflict) — [Decryption Digest](https://www.decryptiondigest.com/blog/mcp-server-security-scanners-cisco-invariant-akto). Detects tool poisoning, rug pulls via tool hashing, cross-origin escalation, prompt injection — [Practical DevSecOps](https://www.practical-devsecops.com/top-mcp-security-tools/). Tool names/descriptions are shared with invariantlabs.ai for analysis (privacy consideration for self-hosters) — [SourcePulse](https://www.sourcepulse.org/projects/2179133). No Snyk MCP gateway product found.
- SentinelOne announced acquisition of Prompt Security (Aug 2025), now in Singularity Platform — [Software Strategies blog](https://softwarestrategiesblog.com/2026/03/28/agentic-ai-security-startups-funding-mna-rsac-2026/) (secondary).
- Palo Alto Networks: Prisma AIRS MCP Server (open-source sample, June 2025) — [PANW blog](https://www.paloaltonetworks.com/blog/2025/06/securing-ai-agent-innovation-prisma-airs-mcp-server/); Prisma AIRS 3.0 adds Agent Artifact Scanning (agent code and MCP servers for risky permissions) and Agent Identity Security; AI Agent Gateway in limited preview — [PANW Prisma AIRS 3.0](https://www.paloaltonetworks.com/blog/ai-security/prisma-airs-3-0-autonomous-ai/), [Kosmoy](https://www.kosmoy.com/resources/blog/cisco-ai-defense-vs-prisma-airs/). Palo Alto reportedly closed acquisition of Portkey in May 2026 to build Prisma AIRS around its AI gateway (secondary, verify) — [ReVerb](https://reverbico.com/blog/top-mcp-security-tools/).
- Cisco AI Defense MCP Scanner (Apache 2.0): YARA rules + LLM judge + Cisco AI Defense inspection API — [GitHub](https://github.com/cisco-ai-defense/mcp-scanner), [Cisco AI Defense OSS](https://cisco-ai-defense.github.io/); MCP Catalog announced Feb 2026; DefenseClaw sandboxing scoped to the OpenClaw runtime — [Kosmoy](https://www.kosmoy.com/resources/blog/cisco-ai-defense-vs-prisma-airs/).
- Lasso MCP Gateway (open source, April 2025): plugin-based proxy focused on guardrails/filtering — [Lasso launch](https://www.lasso.security/resources/lasso-releases-first-open-source-security-gateway-for-mcp), [Lasso page](https://www.lasso.security/resources/open-source-mcp-gateway-security). Reviewers say it lacks approval workflows and RBAC — [Zuplo](https://zuplo.com/blog/mcp-gateway-comparison); a benchmark found no per-tool authorization step — [AIMultiple](https://aimultiple.com/mcp-gateway).
- Noma Security reportedly raised $100M for AI agent hardening — [Software Strategies blog](https://softwarestrategiesblog.com/2026/03/28/agentic-ai-security-startups-funding-mna-rsac-2026/).
- Golf: listed as a commercial MCP gateway for deploying official MCP servers inside a company — [awesome-mcp-gateways](https://github.com/e2b-dev/awesome-mcp-gateways).
- Radware launched an MCP security product (investor-news source) — [Simply Wall St](https://simplywall.st/stocks/us/software/nasdaq-rdwr/radware/news/mcp-security-launch-might-change-the-case-for-investing-in-r).
- Akto publishes an MCP security tools list (vendor) — [Akto](https://www.akto.io/blog/mcp-security-tools). Microsoft overview of MCP security state in 2026 — [Microsoft Tech Community](https://techcommunity.microsoft.com/blog/microsoft-security-blog/the-state-of-mcp-security-in-2026/4531327).
- Other open-source self-hosted gateways listed by comparisons: Docker MCP Gateway, IBM Context Forge, Microsoft MCP Gateway, Obot, Octelium (identity-aware tool-level authz, OTel audit, no approvals mentioned) — [Composio](https://composio.dev/content/best-mcp-gateway-for-developers), [Octelium](https://octelium.com/solutions/open-source-mcp-gateway).

### Inferences
- Scanners address supply-chain risk (poisoned descriptions, rug pulls) for arbitrary third-party MCP servers. Synoikia's signed plugin repos and own plugin format reduce that surface differently but cannot cover third-party MCP servers, so a scanner is complementary.
- Large-vendor products are enterprise-priced and SaaS-centric; Synoikia's MIT self-hosted positioning targets a different buyer (homelab, SMB, privacy-first).

### Gaps
- No usable results for: Pangea (CrowdStrike acquisition status unverified), Protect AI (background: acquired by Palo Alto Networks in 2025, unverified this session), Zenity, Operant AI, Aim Security (background: acquired by Cato Networks 2025, unverified), Trend Micro, Javelin, Akto product details, Pillar Security, Golf's security features.

## Sandboxed code execution relevant to Code Mode (category 3)

### Takeaway
Code Mode (search/execute over typed APIs in a sandbox) is now a mainstream pattern from Cloudflare and Anthropic. Cloudflare's version is the closest analog to Synoikia's isolated-vm approach (V8 isolates, egress blocked by default, secrets held outside the sandbox) and adds egress control that Synoikia lacks. General sandboxes (E2B, Daytona, Modal, Deno Sandbox) are compute substrates without a permission gate or approval flow.

### Cited Findings
- Cloudflare Code Mode (Sept 2025): agent writes TypeScript against typed APIs instead of sequential tool calls — [Cloudflare blog](https://blog.cloudflare.com/code-mode-mcp/), [WorkOS (81% token cut)](https://workos.com/blog/cloudflare-code-mode-cuts-token-usage-by-81). Cloudflare's own MCP server exposes its API through two tools, search and execute, about 1,000 tokens, code runs in an isolated Dynamic Worker — [Cloudflare servers docs](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/), [Matthew Wong](https://www.matthewswong.com/en/blog/cloudflare-code-mode-mcp-two-tools-1000-tokens/).
- Dynamic Worker Loader: V8 isolate with no filesystem, no env vars, external fetch disabled by default; `globalOutbound: null` blocks fetch/connect, or route through a gateway holding the secret; custom bindings expose specific resources — [Worker Loader docs](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/workers/runtime-apis/bindings/worker-loader.mdx). Open beta, available to paid Workers users (April 2026) — [InfoQ](https://www.infoq.com/news/2026/04/cloudflare-dynamic-workers-beta/). `@cloudflare/codemode` provides `DynamicWorkerExecutor` and can wrap an existing MCP server; v0.2.1 adds custom sandbox modules — [Cloudflare community changelog](https://community.cloudflare.com/t/agents-workers-cloudflare-codemode-v0-2-1-mcp-barrel-export-zero-dependency-main-entry-point-and-custom-sandbox-modules/907761).
- Anthropic "Code execution with MCP" (Nov 2025): present MCP servers as code APIs called from an execution environment; one example cut tokens from ~150,000 to ~2,000 (98.7%) — [Anthropic Engineering](https://www.anthropic.com/engineering/code-execution-with-mcp), [MarkTechPost](https://www.marktechpost.com/2025/11/08/anthropic-turns-mcp-agents-into-code-first-systems-with-code-execution-with-mcp-approach/). Reference implementation mcp-exec reuses Claude Code's sandbox — [GitHub](https://github.com/joeblackwaslike/mcp-exec).
- Sandboxes: E2B uses Firecracker microVMs; Modal uses gVisor; Daytona uses Docker containers by default with Kata/Sysbox opt-in; Modal and Daytona offer GPUs, E2B does not; E2B/Daytona pause/resume and fork — [LogRocket](https://blog.logrocket.com/comparing-ai-agent-sandbox-platforms-e2b-modal-daytona-and-more/), [developersdigest](https://www.developersdigest.tech/blog/ai-agent-code-sandbox-comparison-2026), [rywalker](https://rywalker.com/research/ai-agent-sandboxes). Cold-start figures conflict (E2B 717ms vs ~150ms; Daytona sub-90ms is a vendor claim) — [Superagent benchmark](https://www.superagent.sh/blog/ai-code-sandbox-benchmark-2026), [Morph](https://www.morphllm.com/comparisons/daytona-alternative). E2B/Daytona ~$0.0504/vCPU-hr, E2B Pro $150/month; Deno Sandbox Pro $20/month — [rywalker](https://rywalker.com/research/ai-agent-sandboxes), [Blaxel](https://blaxel.ai/blog/e2b-alternatives-sandbox-environments).

### Inferences
- Cloudflare's stack (Code Mode + Dynamic Workers + Cloudflare Access/MCP auth) is the closest "gateway + sandbox" combination, but it is a hosted, Cloudflare-bound platform and its approvals are client-side (Agents HITL). Synoikia is self-hosted and adds server-side approval.
- Cloudflare's default-deny egress highlights Synoikia's stated gap (no egress control yet).

### Gaps
- Not researched this session: pydantic mcp-run-python status (background: Pyodide in Deno, reportedly archived/deprecated; unverified), Docker MCP Gateway dynamic tools / code mode, Deno Sandbox isolation details.

## Notable MCP security incidents that validate Synoikia's design

### Takeaway
The main incidents (GitHub toxic flow, Supabase, Asana, postmark-mcp) are failures of over-broad credentials, missing write gating, tenant isolation, and supply chain. They map to Synoikia's per-client ceilings, Ask/Write levels with out-of-band approval, secret redaction, and signed plugin repos.

### Cited Findings
- GitHub MCP (May 2025, Invariant Labs): a malicious issue in a public repo made an agent using the official GitHub MCP server leak private repo contents into a public PR; root cause over-broad PAT plus untrusted text in context — [UpGuard](https://www.upguard.com/blog/mcp-security-incidents), [Docker](https://www.docker.com/blog/mcp-horror-stories-github-prompt-injection/), [AuthZed timeline](https://authzed.com/blog/timeline-mcp-breaches), [Vulnerable MCP Project](https://vulnerablemcp.info/).
- Supabase MCP (June 2025): privileged agent processing support tickets was prompt-injected into leaking integration tokens (secondhand) — [TrueFoundry](https://www.truefoundry.com/blog/mcp-security-risks-best-practices).
- Asana MCP (June 2025): tenant isolation flaw exposed project data across organizations, ~1,000 customers reported affected; offline 12 days or ~2 weeks (sources differ) — [DEV Community](https://dev.to/razashariff/9-real-mcp-security-breaches-cves-data-leaks-and-why-the-protocol-needs-a-cryptographic-identity-ff6), [OvalEdge](https://www.ovaledge.com/blog/mcp-server-security).
- postmark-mcp (Sept 2025, Koi Security): first malicious MCP server on npm; versions ≥1.0.16 BCC'd all sent emails to an attacker address; ~1,500-1,643 downloads (figures conflict) — [Snyk](https://snyk.io/blog/malicious-mcp-server-on-npm-postmark-mcp-harvests-emails/), [Qualys](https://threatprotect.qualys.com/2025/09/30/malicious-mcp-server-on-npm-postmark-mcp-exploited-in-attack/), [Semgrep](https://semgrep.dev/blog/2025/so-the-first-malicious-mcp-server-has-been-found-on-npm-what-does-this-mean-for-mcp-security/).
- Tool poisoning (hidden instructions in tool descriptions) and malicious parameter definitions to exfiltrate context — [Checkmarx](https://checkmarx.com/learn/mcp-security-risks-real-world-incidents-and-security-controls/), [Vulnerable MCP Project](https://vulnerablemcp.info/). Path traversal in Git MCP server; CVEs in TypeScript SDK and MCPJam Inspector — [DEV Community](https://dev.to/zeybek/prompt-injection-is-a-data-plane-problem-2f3g), [Vulnerable MCP Project](https://vulnerablemcp.info/).
- CSA published an Agentic MCP Security Best Practices guide — [CSA](https://labs.cloudsecurityalliance.org/agentic/agentic-mcp-security-best-practices-v1/).

### Inferences
- GitHub toxic flow: a read-only default client ceiling plus Ask on "create PR in public repo" would have blocked exfiltration. postmark-mcp: signed plugin repos address this supply-chain class. Asana: a single-tenant self-hosted deployment avoids cross-tenant exposure by construction.

### Gaps
- Confused-deputy issues in MCP OAuth proxies and the MCP authorization spec evolution (OAuth 2.1, Resource Indicators, protected resource metadata, client ID metadata documents) were not searched this session.

## Do any combine gateway + sandbox + approval like Synoikia?

### Takeaway
No product found combines all three in one self-hosted package. Cloudflare has gateway + sandbox (Code Mode) with client-side approval. Permit MCP Gateway has gateway + server-side approval but no sandbox. Small open-source gateways (mcpgate, WhereMyMCP, MCP Shield) have gateway + approval + some redaction, but no code-mode sandbox. AWS AgentCore has gateway + Cedar policy (and a separate code interpreter) without HITL.

### Cited Findings
- See Cloudflare, Permit, mcpgate, WhereMyMCP, MCP Shield, AgentCore findings above. The approval-gateway search returned no result mentioning code mode with out-of-band approval — [mcpgate](https://mcpgate.de/), [WhereMyMCP](https://github.com/rizkidarmawan21/wheremymcp), [MCP Shield](https://github.com/Alex2006boecboec/MCP_Gateway).

### Inferences
- Synoikia's combination is differentiated today, but the pieces are commoditizing: Cloudflare could add server-side approval via URL elicitation, and Permit could add code mode. The moat is the self-hosted, MIT, single-package integration and API-derived access levels.

### Gaps
- Docker MCP Gateway, IBM ContextForge, Obot and Microsoft MCP Gateway were not individually examined for approval features (likely covered by a sibling gateway researcher).
