# MVP 2: Skill Discovery Catalog

> Product Hunt meets npm registry for AI agent skills

---

## Problem Statement

Users can't find skills they don't know exist. There's no:
- Browsable catalog of available skills
- Search by capability ("I need a skill for code review")
- Way to see what's popular or trending
- Try-before-install experience

Discovery is prerequisite to adoption. If users don't know a skill exists, they won't install it.

---

## Scope

**In Scope:**
- Browsable web catalog of skills
- Search by name, description, capability
- Category/tag filtering
- Popularity ranking
- Skill detail pages with examples
- Live "try it now" sandboxes
- Skill submission flow

**Out of Scope:**
- Installation (assume sksup CLI exists)
- Payments (separate MVP)
- User accounts for browsing (anonymous access)
- Reviews/comments (usage is the signal)
- Multiple versions (latest only)

---

## Core User Flows

### Flow 1: Browsing

```
1. Land on skills.supply
2. See featured/trending skills immediately
3. Browse by category (Writing, Development, Data, Marketing, etc.)
4. Click skill → see detail page
5. Try in sandbox → "this is useful"
6. Copy install command
```

### Flow 2: Searching

```
1. Land on skills.supply
2. Search: "write better commit messages"
3. See ranked results by relevance
4. Click top result → see detail page
5. Try in sandbox
6. Copy install command
```

### Flow 3: Submitting

```
1. Push skill to GitHub repo with SKILL.md
2. Add GitHub Action that submits to catalog
3. Skill appears in catalog within minutes
4. (Optional) Verify publisher identity for badge
```

---

## Homepage Design

```
┌─────────────────────────────────────────────────────────────────┐
│  SKILLS SUPPLY                                    [Search...]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  🔥 Trending This Week                                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ code-review │ │ commit-msg  │ │ api-design  │               │
│  │ ⭐ 2.4k/wk  │ │ ⭐ 1.8k/wk  │ │ ⭐ 1.2k/wk  │               │
│  │ [Try Now]   │ │ [Try Now]   │ │ [Try Now]   │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│                                                                 │
│  📁 Categories                                                  │
│  [Development] [Writing] [Marketing] [Data] [Productivity]     │
│                                                                 │
│  ⚡ New This Week                                               │
│  • sql-optimizer by @datawhiz — Optimize SQL queries            │
│  • brand-voice by @copyai — Maintain consistent brand tone      │
│  • test-writer by @devtools — Generate unit tests               │
│                                                                 │
│  📈 Most Used (All Time)                                        │
│  1. code-review (45k installs)                                  │
│  2. commit-helper (38k installs)                                │
│  3. doc-writer (29k installs)                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Skill Detail Page

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back                                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  code-review                                    ✓ Verified      │
│  by @devtools                                                   │
│                                                                 │
│  Reviews pull requests using best practices. Catches bugs,      │
│  security issues, and style problems. Suggests improvements.    │
│                                                                 │
│  ⭐ 2,412 uses this week   |   📦 45,231 total installs         │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  📋 Install                                                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ sksup install gh:devtools/code-review                     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                            [Copy]               │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  🎮 Try It Now                                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ Enter a code snippet or PR diff to review:                │ │
│  │                                                           │ │
│  │ function add(a, b) {                                      │ │
│  │   return a + b                                            │ │
│  │ }                                                         │ │
│  │                                                           │ │
│  │                                        [Run Review →]     │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  📄 SKILL.md Preview                                            │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ ---                                                       │ │
│  │ name: code-review                                         │ │
│  │ description: Reviews code for bugs, security, style...    │ │
│  │ ---                                                       │ │
│  │                                                           │ │
│  │ # Code Review                                             │ │
│  │                                                           │ │
│  │ When reviewing code, analyze for:                         │ │
│  │ 1. Logic errors and bugs                                  │ │
│  │ ...                                                       │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Tags: #development #code-quality #review                       │
│  License: MIT                                                   │
│  Source: github.com/devtools/code-review                        │
│  Last updated: 3 days ago                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Skill Metadata

```typescript
interface CatalogSkill {
  // Identity
  id: string;                    // "devtools/code-review"
  name: string;                  // "code-review"

  // Discovery
  description: string;           // From SKILL.md (max 1024 chars)
  capabilities: string[];        // ["review code", "find bugs", "suggest improvements"]
  categories: Category[];        // ["Development", "Code Quality"]
  tags: string[];               // ["code-review", "pr", "quality"]

  // Source
  source_url: string;           // "https://github.com/devtools/code-review"
  source_type: "github" | "gitlab" | "custom";

  // Author
  author: {
    username: string;           // "devtools"
    verified: boolean;          // Has verified identity
    avatar_url?: string;
  };

  // Content
  skill_md_preview: string;     // First 500 chars of SKILL.md
  skill_md_full: string;        // Complete SKILL.md
  example_input?: string;       // Pre-filled sandbox input
  example_output?: string;      // Expected output for display

  // Stats
  stats: {
    installs_total: number;
    installs_7d: number;
    installs_30d: number;
    trending_score: number;     // Calculated from velocity
  };

  // Meta
  license: string;              // "MIT", "Apache-2.0", etc.
  platforms: Platform[];        // ["claude", "opencode", "codex"]
  created_at: Date;
  updated_at: Date;
}

type Category =
  | "Development"
  | "Writing"
  | "Marketing"
  | "Data"
  | "Productivity"
  | "Design"
  | "DevOps"
  | "Security";

type Platform = "claude" | "opencode" | "codex";
```

### Capabilities Index

For semantic search, we extract "capabilities" from skill descriptions:

```typescript
// From description: "Reviews pull requests using best practices.
// Catches bugs, security issues, and style problems."

capabilities: [
  "review pull requests",
  "catch bugs",
  "find security issues",
  "check code style"
]
```

Search query "find bugs in my code" matches skills with capability "catch bugs".

---

## Submission Flow

### Option A: GitHub Action (Recommended)

Skill authors add a GitHub Action to their repo:

```yaml
# .github/workflows/publish-skill.yml
name: Publish to Skills Supply

on:
  push:
    branches: [main]
    paths:
      - 'skills/**'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: skills-supply/publish-action@v1
        with:
          api_key: ${{ secrets.SKILLS_SUPPLY_API_KEY }}
```

**On push:**
1. Action reads all `skills/*/SKILL.md` files
2. Extracts metadata
3. Posts to Skills Supply API
4. Catalog updates within minutes

### Option B: Manual Submission

```
1. Go to skills.supply/submit
2. Paste GitHub repo URL
3. We fetch and validate SKILL.md
4. Preview how it will appear
5. Submit for catalog inclusion
```

### Validation Rules

Before a skill appears in catalog:
- [ ] `SKILL.md` exists and is valid YAML frontmatter + markdown
- [ ] `name` field matches directory name
- [ ] `description` is 10-1024 characters
- [ ] No malicious content (basic keyword scan)
- [ ] Source repo is public (or author authenticated for private)

---

## Ranking Algorithm

### Default Sort: Trending

```typescript
function trendingScore(skill: CatalogSkill): number {
  const recencyBonus = daysSinceUpdate(skill) < 7 ? 1.2 : 1.0;
  const velocityScore = skill.stats.installs_7d / Math.max(skill.stats.installs_30d / 4, 1);
  const verifiedBonus = skill.author.verified ? 1.1 : 1.0;

  return velocityScore * recencyBonus * verifiedBonus;
}
```

**Trending = growth rate, not absolute numbers.**

A skill with 100 installs this week that had 20 last week (5x growth) ranks higher than a skill with 1000 installs this week that had 900 last week (1.1x growth).

### Other Sorts

- **New**: `created_at DESC`
- **Most Used**: `installs_total DESC`
- **Recently Updated**: `updated_at DESC`

### Category Filters

```
skills.supply/?category=Development
skills.supply/?category=Writing&sort=trending
```

---

## Live Sandbox

**The differentiator: Try before install.**

Every skill detail page has a sandbox where users can test the skill without installing.

### Implementation

```typescript
// Sandbox API endpoint
POST /api/sandbox/run
{
  skill_id: "devtools/code-review",
  input: "function add(a, b) { return a + b }",
  max_tokens: 1000
}

// Response
{
  output: "## Code Review\n\n### Issues Found\n1. Missing semicolon...",
  tokens_used: 342,
  model: "claude-sonnet-4"
}
```

### Constraints

- Rate limited: 5 sandbox runs per hour per IP
- Max input: 2000 characters
- Max output: 1000 tokens
- No tool use in sandbox (skills only, no file access)
- Runs against Anthropic API with skill instructions prepended

### Why This Matters

The core discovery problem is: **you can't know if a skill is useful until you try it**.

But trying requires:
1. Finding install command
2. Running install
3. Restarting agent
4. Testing with real input
5. Deciding it's not quite right
6. Repeating for next skill

Sandbox breaks this catch-22. 30 seconds to evaluate vs 5 minutes.

---

## Telemetry

### What We Track

```typescript
// From sksup CLI (opt-in)
interface InstallEvent {
  skill_id: string;
  source: string;
  platform: "claude" | "opencode" | "codex";
  action: "install" | "update" | "remove";
  timestamp: Date;
  // NO user identity, NO IP, NO machine info
}
```

### Privacy Model

- Anonymous by default
- No account required to browse
- Install telemetry is opt-in via `sksup config set telemetry on`
- Only aggregate stats shown publicly

---

## What We Skip (For MVP)

1. **Reviews/Ratings** — Usage is the signal. Reviews add noise and moderation burden.
2. **Comments** — Link to GitHub issues instead.
3. **Multiple versions** — Show latest only. Version pinning handled by sksup CLI.
4. **Collections/Lists** — Future feature. Just categories for now.
5. **User profiles** — Authors link to GitHub. No custom profiles.
6. **Social features** — No following, no feeds. Pure discovery.

---

## Technical Stack

### Frontend
- Next.js for SSG/SSR
- Tailwind for styling
- Edge-cached pages (Cloudflare/Vercel)
- Client-side search with Algolia or Meilisearch

### Backend
- PostgreSQL for catalog data
- Redis for rate limiting
- Anthropic API for sandbox execution
- GitHub API for repo validation

### Infrastructure
- Catalog rebuild: Hourly cron job fetches updates from registered repos
- Search index: Rebuilt on catalog changes
- CDN: All static pages cached

---

## Success Metrics

1. **Time to find relevant skill**: < 60 seconds from landing to finding useful skill
2. **Sandbox usage**: % of detail page views that try sandbox
3. **Sandbox → Install conversion**: % of sandbox users who copy install command
4. **Return visitors**: Weekly active users
5. **Catalog growth**: Skills submitted per week

---

## The 10x Insight

**Discovery isn't search, it's demonstration.**

A list of skill names and descriptions is not discovery. Users don't know what they're looking for until they see it work.

The sandbox makes discovery tangible. Instead of "this skill reviews code" you see "here's how this skill would review YOUR code."

Show, don't tell.
