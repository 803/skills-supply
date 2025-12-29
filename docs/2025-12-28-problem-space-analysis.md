# Skills Distribution Problem Space Analysis

> Analysis conducted December 2024. Validated against Claude Code, OpenCode, and OpenAI Codex documentation.

---

## Executive Summary

The AI agent skills ecosystem is at an inflection point. Skills (markdown-based instruction files that teach agents specialized behaviors) are becoming a core primitive across Claude Code, OpenCode, and OpenAI Codex. However, the infrastructure around skills—distribution, updates, discovery, monetization—remains fragmented and immature.

This document validates the core problems in the skills space and identifies gaps that represent opportunities for Skills Supply.

---

## Platform Comparison

### File Format Convergence

All three platforms have converged on nearly identical formats:

| Aspect | Claude Code | OpenCode | Codex |
|--------|-------------|----------|-------|
| File | `SKILL.md` | `SKILL.md` | `SKILL.md` |
| Format | YAML frontmatter + markdown | YAML frontmatter + markdown | YAML frontmatter + markdown |
| Required fields | `name`, `description` | `name`, `description` | `name`, `description` |
| Optional fields | `allowed-tools`, `model` | `license`, `compatibility`, `metadata` | N/A (uses directories) |

### Installation Locations

| Platform | Project | Personal | System |
|----------|---------|----------|--------|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` | Enterprise managed settings |
| OpenCode | `.opencode/skill/` or `.claude/skills/` | `~/.config/opencode/skill/` | N/A |
| Codex | `.codex/skills/` | `~/.codex/skills/` | `/etc/codex/skills/` |

### Distribution Mechanisms

| Platform | Primary Distribution | Update Mechanism |
|----------|---------------------|------------------|
| Claude Code | Plugins (git-based), manual copy | Plugin: git pull. Manual: overwrite + restart |
| OpenCode | Manual copy | Manual overwrite + restart |
| Codex | `$skill-installer` from GitHub | Manual re-run installer |

---

## Validated Problems

### 1. Distribution of Skills

**Status: Validated**

**Current State:**
- Claude Code plugins provide a git-based distribution mechanism that works reasonably well
- OpenCode and Codex require users to manually copy SKILL.md files to the correct directory
- There is no universal `npm install skill-name` equivalent

**Evidence:**
- Claude Code docs show plugin installation: `/plugin install skill-name@marketplace`
- OpenCode docs state: "OpenCode walks up from your current working directory to the git worktree root, loading matching SKILL.md files"
- Codex docs describe `$skill-installer` that downloads from a "curated set of skills on GitHub"

**The Gap:**
- No cross-platform installer
- No registry/index of available skills
- No dependency resolution
- No version pinning (except via git tags in Claude Code plugins)

**Severity: High** — This is table-stakes infrastructure that doesn't exist.

---

### 2. Updating Skills

**Status: Validated**

**Current State:**
- Claude Code plugins can be updated via git pull
- All other skills require manual overwrite
- No notification when updates are available
- No semantic versioning
- No changelogs

**Evidence:**
- Claude Code docs: "Update: Edit SKILL.md directly and restart Claude Code"
- No update mechanism documented for OpenCode or Codex

**The Gap:**
- No `skill update` command
- No way to see "3 skills have updates available"
- No way to diff what changed between versions
- No rollback mechanism

**Severity: High** — Skills rot without updates. No update mechanism means skills become stale.

---

### 3. Keeping Track of Skills

**Status: Validated (with nuance)**

**Current State:**
- Project skills (`.claude/skills/`) are version controlled and visible in PRs
- Personal skills (`~/.claude/skills/`) are NOT version controlled
- Plugin skills are tracked by plugin manifest but not visible in project

**The Gap:**
- Personal skills can override project skills silently
- A developer's local skill can change Claude's behavior in ways not reproducible by teammates
- No audit trail for "which skills were active when this code was written"

**Assessment:** This is "pretty good" for project skills but has hidden failure modes for personal/plugin skills.

**Severity: Medium** — Works for the common case but has edge cases that cause confusion.

---

### 4. Expanding Users

**Status: Validated**

**Current State:**
The current skill model assumes users who:
- Know what a git repo is
- Can edit markdown files
- Understand YAML frontmatter
- Can navigate file systems
- Are comfortable with CLI tools

**The Gap:**
For non-technical users (marketers, PMs, writers, ops), skills are inaccessible:
- No GUI for skill creation
- No one-click install
- No categories/ratings/reviews for discovery
- No sandboxing/permissions (non-tech users won't audit `allowed-tools`)

**Projection:**
Over the next year, AI coding assistants will expand beyond developers. Claude for Enterprise already targets non-engineering teams. Skills will need to be accessible to users who think in terms of "teach Claude my preferences" not "write a markdown file with YAML frontmatter."

**Severity: Medium-term High** — Not urgent today, but critical for the market expansion happening in 2025.

---

### 5. Buying Skills

**Status: Validated — Entirely Untapped**

**Current State:**
- OpenAI announced GPT Store revenue sharing in January 2024; never delivered
- No existing skill marketplace with payments
- Skill creators have no way to monetize their work
- Good skills take significant effort to build (prompt engineering, testing, iteration)

**The Gap:**
- No pricing mechanism
- No payment processing
- No access gating for paid skills
- No payout system for creators
- No business model for the ecosystem

**Evidence:**
- OpenAI GPT Store: "Revenue sharing coming Q1 2024" — still not implemented as of December 2024
- MCP marketplaces (Smithery, Glama, PulseMCP) focus on discovery, not monetization
- Claude Code plugin marketplace: free plugins only

**Severity: High** — This is greenfield. First mover advantage available.

---

## Additional Problems Identified

Beyond the five problems in the initial breakdown, analysis revealed 11 additional gaps:

### 6. Skill Discovery & Search

**Problem:** No way to find skills you don't know exist.

**Current State:**
- Skills are loaded at startup based on what's in local directories
- No cross-platform skill directory
- No search by category, capability, or use case
- Codex has "curated GitHub set" but no browsing UI

**The Gap:**
- No `skill search "code review"`
- No browsable catalog
- No trending/popular/new sections
- No way to see "skills that work well together"

**Severity: High** — Discovery is prerequisite to distribution.

---

### 7. Skill Compatibility & Dependencies

**Problem:** Skills are standalone; no dependency management.

**Current State:**
- Skills cannot depend on other skills
- Skills may require external tools (Python packages, npm packages) with no automated install
- No compatibility matrix for skill versions vs platform versions

**Evidence:**
- Claude Code docs: "Packages must be installed in your environment: `pip install pypdf pdfplumber`"
- No `dependencies` field in any skill format

**The Gap:**
- Skill A cannot require Skill B
- External dependencies are manual installation
- No way to express "requires Claude Code 2.x"

**Severity: Medium** — Works for simple skills, breaks for complex workflows.

---

### 8. Skill Conflicts & Namespacing

**Problem:** Multiple skills with same name have undefined behavior.

**Current State:**
- Priority order (Enterprise > Personal > Project > Plugin) resolves conflicts silently
- No namespacing (`@creator/skill-name`)
- No warning when skills override each other

**The Gap:**
- Two plugins provide same skill name: undefined behavior
- No way to install "only the git-helper skill from this plugin, not the others"
- No pinning to specific source

**Severity: Low-Medium** — Edge case today, will grow as ecosystem expands.

---

### 9. Skill Testing & Validation

**Problem:** No way to test skills before deployment.

**Current State:**
- "Run it and see if it works"
- No test framework for skills
- No CI/CD for skill repositories
- No syntax validation before deployment

**The Gap:**
- No `skill test my-skill`
- No preview mode
- No "this skill has syntax errors" before publish
- No automated testing for regressions

**Severity: Medium** — Important for paid skills where quality matters.

---

### 10. Skill Analytics & Feedback Loop

**Problem:** Creators have zero insight into usage.

**Current State:**
- No telemetry on skill invocations
- No success/failure tracking
- No user feedback mechanism
- No popularity metrics

**The Gap:**
- Creators can't answer "is anyone using my skill?"
- No data to prioritize improvements
- No ratings or reviews

**Severity: Medium** — Important for marketplace dynamics but not blocking.

---

### 11. Skill Permissions & Trust

**Problem:** No verification or security model for third-party skills.

**Current State:**
- `allowed-tools` restricts what a skill can do
- No audit process for third-party skills
- No sandbox for untrusted skills
- No signature/verification

**The Gap:**
- Who audits third-party skills?
- How do I know this skill is really from the claimed author?
- Enterprise can't blocklist specific skills
- No CVE-like system for vulnerable skills

**Severity: Medium-High** — Critical for enterprise adoption.

---

### 12. Skill Composition & Chaining

**Problem:** Skills are independent units; no composition model.

**Current State:**
- Each skill operates in isolation
- No way to chain skills (`skill-a | skill-b`)
- No meta-skills that orchestrate other skills
- Subagents can specify skills but no dynamic selection

**The Gap:**
- Can't build "review PR, then format commit message, then push"
- No workflow builder
- No conditional skill activation

**Severity: Low** — Power-user feature, not MVP.

---

### 13. Cross-Platform Portability

**Problem:** Similar but not identical formats across platforms.

**Current State:**
| Field | Claude Code | OpenCode | Codex |
|-------|-------------|----------|-------|
| Directory | `.claude/skills/` | `.opencode/skill/` | `.codex/skills/` |
| Unique fields | `allowed-tools`, `model` | `license`, `compatibility` | `references/`, `assets/` |

**The Gap:**
- No universal installer
- No import/export between platforms
- agentskills.io specification exists but incomplete adoption

**Severity: Medium** — Important for skill authors who want cross-platform reach.

---

### 14. Offline Support

**Problem:** How do cloud-distributed skills work offline?

**Current State:**
- Local skills work offline (they're just files)
- Plugin-based skills require initial network fetch
- No explicit offline mode

**Considerations for Marketplace:**
- Should purchased skills be cached locally?
- License enforcement when offline?
- Grace period for network failures?

**Severity: Low** — Edge case but important for reliability.

---

### 15. Organizational Governance

**Problem:** Enterprises need control over skills.

**Current State:**
- Claude Code has Enterprise managed settings
- No approval workflows
- No audit logs
- No compliance reporting

**The Gap:**
- No "skill must be reviewed before org-wide deployment"
- No "who installed what skill when"
- No "what skills have access to what tools"
- No role-based skill access

**Severity: Medium-High** — Blocking for enterprise sales.

---

### 16. External Service Authentication

**Problem:** Skills that need external services have no standard way to authenticate.

**Current State:**
Skills that connect to external services (Notion, Linear, Jira, Slack, GitHub, databases, internal APIs) have no standard auth mechanism. There is no `credentials`, `secrets`, or `auth` field in the SKILL.md spec.

Skills that need external access do one of:
- Hardcode credentials in SKILL.md (security disaster, can't share skill)
- Assume env vars exist (skill README says "set NOTION_API_KEY before using")
- Ask mid-conversation for API key (insecure, annoying, breaks flow)
- Just break silently or with cryptic errors

**The Gap:**
- No credential storage mechanism
- No OAuth flow support for "connect your Notion"
- No credential scoping (all skills see all env vars)
- No credential UI (users must edit shell config files)
- No per-skill secrets (can't give one skill Notion access without giving all skills access)

**Why This Matters:**
This blocks entire categories of useful skills. Any skill that does something *real* — posts to Slack, syncs to Notion, files an issue, queries a database — hits this wall.

The most valuable skills are integrations. Integrations need auth. Auth is unsolved.

**Severity: High** — Blocking for high-value skill categories.

---

## Problem Prioritization Matrix

| Problem | User Pain | Market Gap | sksup Fit | Priority |
|---------|-----------|------------|-----------|----------|
| Buying skills | High | Complete gap | Core value prop | **P0** |
| Distribution | High | Partial (Claude plugins exist) | Universal installer | **P0** |
| Discovery | High | Complete gap | Marketplace UI | **P0** |
| Updating | Medium | Complete gap | Built into installer | **P1** |
| Non-technical users | Medium (growing) | Complete gap | Future expansion | **P1** |
| Permissions/Trust | Medium | Complete gap | Verified publishers | **P2** |
| Governance | Medium | Complete gap | Enterprise tier | **P2** |
| Analytics | Low | Complete gap | Post-launch | **P3** |
| Dependencies | Low | Complete gap | Future version | **P3** |
| Composition | Low | Complete gap | Power-user feature | **P4** |
| External Service Auth | High | Complete gap | Credential management | **P1** |

---

## Conclusion

The initial problem breakdown is validated:

1. **Distribution** — Validated. Only Claude Code plugins have a decent story.
2. **Updating** — Validated. Entirely manual except for plugins.
3. **Keeping track** — Validated with nuance. Good for project skills, hidden issues for personal/plugin.
4. **Expanding users** — Validated. Current model assumes technical users.
5. **Buying skills** — Validated. Completely untapped market.

Additional problems identified (16 total) reveal a larger opportunity. The skills ecosystem is nascent infrastructure waiting to be built. First-mover advantage is available for whoever builds the foundational layers: distribution, discovery, and monetization.

---

## Appendix: Source Documentation

### Claude Code Skills
- URL: https://code.claude.com/docs/en/skills
- Key features: SKILL.md format, allowed-tools, model override, plugin distribution

### OpenCode Skills
- URL: https://opencode.ai/docs/skills/
- Key features: Discovery from cwd to git root, permission configuration, Claude-compatible paths

### OpenAI Codex Skills
- URL: https://developers.openai.com/codex/skills/
- Key features: Progressive disclosure, $skill-installer, agentskills.io compliance
