# AI Agent Skills Distribution: The 2025 Landscape

> **Research Date:** December 28, 2025
> **Status:** Current as of publication date

---

## Executive Summary

The AI agent skills ecosystem has undergone a fundamental transformation in 2025, shifting from fragmented vendor-specific approaches toward **open, interoperable standards**. The formation of the **Agentic AI Foundation (AAIF)** under the Linux Foundation on December 9, 2025, marks the inflection point—with OpenAI, Anthropic, Google, Microsoft, and AWS all committing to shared protocols.

**Key insight:** We're witnessing the emergence of a "package manager for AI agents" model, where skills are distributed like npm packages or Docker containers, but with semantic discovery and automatic loading based on task context.

---

## The Standards Convergence

### The Agentic AI Foundation (AAIF)

On **December 9, 2025**, the Linux Foundation announced AAIF with three founding projects:

| Project | Origin | Purpose |
|---------|--------|---------|
| **Model Context Protocol (MCP)** | Anthropic | Universal standard for connecting AI to tools/data |
| **goose** | Block | Open-source AI agent framework |
| **AGENTS.md** | OpenAI | Repository-level agent guidance standard |

**Platinum Members:** AWS, Anthropic, Block, Bloomberg, Cloudflare, Google, Microsoft, OpenAI

**Why this matters:** Jim Zemlin (Linux Foundation Executive Director) stated the goal is avoiding "closed wall proprietary stacks where tool connections, agent behavior, and orchestration are locked behind a handful of platforms."

*Sources: [Linux Foundation Announcement](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation), [OpenAI Blog](https://openai.com/index/agentic-ai-foundation/), [Block Announcement](https://block.xyz/inside/block-anthropic-and-openai-launch-the-agentic-ai-foundation)*

---

## Distribution Mechanisms

### 1. The SKILL.md Format (Cross-Platform Standard)

The **Agent Skills specification** has emerged as the universal format for defining agent capabilities. Both Anthropic and OpenAI now support identical formats.

**Structure:**
```
skill-name/
├── SKILL.md           # Required: YAML frontmatter + markdown instructions
├── scripts/           # Optional: Executable code (Python, Bash, JS)
├── references/        # Optional: Additional documentation
└── assets/            # Optional: Templates, icons, fonts
```

**SKILL.md Format:**
```yaml
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
---
# My Skill Name

## Instructions
[Instructions the agent follows when this skill is active]

## Examples
[Concrete examples of expected behavior]
```

**Core Design Principle:** Progressive disclosure. Skills load information only as needed, like a manual with a table of contents, chapters, and appendix. This makes the bundled context effectively unbounded.

**Adoption (as of December 2025):**
- Claude (claude.ai, Claude Code, Claude API)
- OpenAI Codex CLI
- ChatGPT (via Apps)
- GitHub Copilot
- VS Code
- Cursor
- OpenCode
- 60,000+ open-source projects (via AGENTS.md)

*Sources: [Claude Code Skills Docs](https://code.claude.com/docs/en/skills), [Anthropic Engineering Blog](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)*

---

### 2. Model Context Protocol (MCP) Distribution

MCP has become the "USB-C for AI" - the universal connector between agents and tools.

**Scale (December 2025):**
- ~2,000 servers in official registry
- 97M+ monthly SDK downloads (Python + TypeScript)
- 407% growth since September 2025 launch

**Distribution Channels:**

| Channel | URL | Model |
|---------|-----|-------|
| **Official Registry** | registry.modelcontextprotocol.io | Federated, vendor-neutral |
| **GitHub Registry** | github.com/modelcontextprotocol/registry | Community-driven |
| **npm packages** | @modelcontextprotocol/* | Package manager |
| **Desktop Extensions** | .mcpb bundles | One-click install |
| **Smithery** | smithery.ai | Hosted marketplace |
| **Glama** | glama.ai/mcp | Discovery + ranking |
| **PulseMCP** | pulsemcp.com | 7,460+ servers indexed |

**Installation Methods:**

```json
// Claude Desktop config
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

```bash
# Smithery CLI
smithery install <server> --client claude

# npm
npm install @modelcontextprotocol/sdk
```

**November 2025 Spec Release Features:**
- Asynchronous operations
- Statelessness support
- Server identity
- Official extensions system

*Sources: [MCP Registry](https://registry.modelcontextprotocol.io/), [Anthropic MCP Donation](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation), [MCP Blog](http://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/)*

---

### 3. OpenAI's App Directory (December 2025)

OpenAI launched its app marketplace on **December 17-18, 2025**, built on MCP.

**Evolution:**
1. **Plugins (Mar 2023 - Apr 2024):** Deprecated due to low adoption and UX friction
2. **Custom GPTs + GPT Store (Jan 2024):** 3M+ created, 159K public
3. **Apps + Apps SDK (Oct-Dec 2025):** Current model

**Key Differences:**

| Aspect | GPTs | Apps |
|--------|------|------|
| Creation | No-code, prompt-based | SDK + backend |
| Capabilities | Instructions + files + actions | Full applications, APIs, widgets |
| Interactivity | Chat-based | In-chat interactive experiences |
| Protocol | Proprietary | Built on MCP |

**Launch Partners:** Adobe (Photoshop, Acrobat, Express), Apple Music, Booking.com, Canva, DoorDash, Dropbox, Expedia, GitHub, Gmail, Google Drive, Mailchimp, Microsoft Teams, Replit, Spotify, Stripe, Zillow

**Submission Process:**
- Developer Platform portal
- MCP connectivity details required
- Testing guidelines + directory metadata
- Country availability settings
- Review process (approved apps rolling out early 2026)

*Sources: [OpenAI Apps Announcement](https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/), [TechCrunch Coverage](https://techcrunch.com/2025/12/18/chatgpt-launches-an-app-store-lets-developers-know-its-open-for-business/)*

---

### 4. Framework-Specific Distribution

| Framework | Distribution | Discovery | MCP Support |
|-----------|-------------|-----------|-------------|
| **LangChain** | PyPI (langchain-community) | Docs + 1000+ integrations | Yes (adapters) |
| **CrewAI** | PyPI (crewai-tools[extras]) | Package extras | Yes (native) |
| **AutoGPT** | Web marketplace (agpt.co) | Curated UI | Planned |
| **AutoGen** | pip/NuGet extensions | GitHub + docs | Yes (MS Agent Framework) |
| **Semantic Kernel** | NuGet/Maven + OpenAPI | Docs + community | Yes (native) |

**LangChain:** Decentralized model with 1000+ integrations distributed via PyPI. Available on AWS Marketplace as of 2025.

**CrewAI:** `pip install crewai-tools[mcp]` enables access to all MCP servers. Enterprise tools via CrewAI AOP.

**AutoGPT:** The only framework with a consumer-facing "app store" at platform.agpt.co/marketplace.

**AutoGen (v0.4, January 2025):** Complete redesign with layered architecture. Microsoft Agent Framework combines AutoGen with Semantic Kernel.

**Semantic Kernel:** Three import methods—native code, OpenAPI specs, or MCP servers. Any can become a plugin.

---

### 5. Git Repository Distribution

The dominant distribution method remains Git repositories with curated "awesome" lists.

**Official Repositories:**
- [anthropics/skills](https://github.com/anthropics/skills) - Anthropic's official skills
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) - Reference MCP implementations

**Community Collections:**

| Repository | Focus | Scale |
|------------|-------|-------|
| travisvn/awesome-claude-skills | Claude skills | 3k+ stars, 450+ workflows |
| wong2/awesome-mcp-servers | MCP servers | Popular community list |
| punkpeye/awesome-mcp-servers | Synced with Glama | Web + GitHub sync |
| TensorBlock/awesome-mcp-servers | Comprehensive index | 7,260+ servers |
| jim-schwoebel/awesome_ai_agents | General AI agents | 1,500+ resources |

---

## Interoperability Protocols

### Agent-to-Tool (MCP)
- JSON-RPC 2.0 over HTTP
- Tool discovery, invocation, response handling
- Now under AAIF governance

### Agent-to-Agent (A2A)
- Launched by Google (April 2025) with 50+ partners
- HTTP, SSE, JSON-RPC
- "Agent Cards" (JSON capability manifests) for discovery
- Now merged with IBM's ACP under Linux Foundation

### Decentralized Discovery (ANP)
- W3C DID (Decentralized Identifiers) based
- JSON-LD and schema.org for agent descriptions
- Being standardized through W3C AI Agent Protocol Community Group

---

## The Current Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    DISCOVERY LAYER                          │
│  MCP Registry │ App Directory │ Awesome Lists │ Smithery    │
├─────────────────────────────────────────────────────────────┤
│                    PROTOCOL LAYER                           │
│         MCP (tools)  │  A2A (agent-to-agent)                │
├─────────────────────────────────────────────────────────────┤
│                    FORMAT LAYER                             │
│    SKILL.md (skills)  │  AGENTS.md (repo guidance)          │
├─────────────────────────────────────────────────────────────┤
│                    DISTRIBUTION LAYER                       │
│   npm │ PyPI │ NuGet │ Git repos │ Desktop Extensions       │
├─────────────────────────────────────────────────────────────┤
│                    GOVERNANCE LAYER                         │
│           Agentic AI Foundation (Linux Foundation)          │
└─────────────────────────────────────────────────────────────┘
```

---

## Market Observations

### What's Working

1. **MCP adoption is explosive** - 97M+ monthly SDK downloads, 2000+ servers
2. **Format convergence** - SKILL.md adopted across OpenAI, Anthropic, Microsoft
3. **Standards governance** - AAIF provides neutral ground for competitors
4. **Progressive disclosure** - Skills load context dynamically, solving token limits

### What's Not (Yet)

1. **Monetization is unsolved** - OpenAI's GPT revenue sharing never launched; creators use external payment systems
2. **Security concerns** - 43% of MCP implementations had command injection vulnerabilities (Equixly research)
3. **Discovery friction** - No dominant "npm for agents" yet; multiple overlapping registries
4. **Enterprise adoption lagging** - Still mostly developer-focused

### Emerging Patterns

1. **Decentralized by default** - Skills as individual Git repos synced to aggregators
2. **No app store dominance** - Unlike mobile, no single marketplace controls distribution
3. **Bring your own tools** - Most frameworks allow importing from OpenAPI, MCP, or custom code
4. **Enterprise vs community split** - Distinct offerings (CrewAI AOP, Microsoft integrations) alongside open tools

---

## Comparison: 2024 vs 2025

| Aspect | 2024 | 2025 |
|--------|------|------|
| **Standards** | Fragmented (each vendor proprietary) | Converging (SKILL.md, MCP, A2A) |
| **Governance** | None | AAIF under Linux Foundation |
| **Distribution** | Vendor-specific marketplaces | Multi-channel (npm, Git, registries) |
| **Interoperability** | None | MCP as universal connector |
| **Major players** | Competing | Collaborating (at protocol level) |

---

## Key Takeaways for Builders

1. **Build on SKILL.md** - It's the cross-platform standard. One skill works on Claude, Codex, Copilot.

2. **Distribute via MCP** - If you're building tools, MCP is the universal connector. Register at registry.modelcontextprotocol.io.

3. **Git + npm is the model** - Skills as repos, MCP servers as packages. No proprietary marketplace lock-in.

4. **Progressive disclosure is key** - Don't dump everything into one file. Let agents load context as needed.

5. **Watch AAIF** - The foundation will shape standards. Get involved early at agentic.ai (expected).

---

## Sources

### Official Announcements
- [Linux Foundation AAIF Announcement](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
- [OpenAI Co-founds AAIF](https://openai.com/index/agentic-ai-foundation/)
- [Block, Anthropic, OpenAI Launch AAIF](https://block.xyz/inside/block-anthropic-and-openai-launch-the-agentic-ai-foundation)
- [Anthropic Donates MCP to AAIF](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation)

### Protocol Documentation
- [MCP Specification (Nov 2025)](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Registry](https://registry.modelcontextprotocol.io/)
- [Claude Code Skills Docs](https://code.claude.com/docs/en/skills)
- [Agent Skills Specification](https://agentskills.io/specification)

### Platform Announcements
- [OpenAI Apps in ChatGPT](https://openai.com/index/introducing-apps-in-chatgpt/)
- [OpenAI App Directory Launch](https://openai.com/index/developers-can-now-submit-apps-to-chatgpt/)
- [Google A2A Protocol](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)

### Analysis & Coverage
- [TechCrunch: OpenAI, Anthropic, Block join AAIF](https://techcrunch.com/2025/12/09/openai-anthropic-and-block-join-new-linux-foundation-effort-to-standardize-the-ai-agent-era/)
- [MCP One Year Anniversary](http://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/)
- [Thoughtworks: MCP Impact on 2025](https://www.thoughtworks.com/en-us/insights/blog/generative-ai/model-context-protocol-mcp-impact-2025)

### GitHub Repositories
- [anthropics/skills](https://github.com/anthropics/skills)
- [modelcontextprotocol/registry](https://github.com/modelcontextprotocol/registry)
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)

---

*Document compiled from research conducted December 28, 2025. Information subject to rapid change in this evolving space.*
