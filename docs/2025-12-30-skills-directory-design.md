# Skills Directory & Distribution System Design

> **Date:** 2025-12-30
> **Status:** Draft

---

## Overview

Build a skills directory that:
1. Discovers public GitHub repos containing skills
2. Indexes them as installable packages
3. Powers our website for discovery
4. Enables guerrilla marketing (README PRs promoting `sk`)

---

## System Architecture

All code lives in `packages/discovery/`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 1: BUILD DIRECTORY                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐              │
│  │  1. DISCOVER │ ──▶  │  2. DETECT   │ ──▶  │  3. STORE    │              │
│  │              │      │              │      │              │              │
│  │ SkillsMP API │      │ Scan repo    │      │ PostgreSQL   │              │
│  │ (for now)    │      │ Find skill   │      │ (packages/   │              │
│  │              │      │ paths        │      │  database/)  │              │
│  └──────────────┘      └──────────────┘      └──────────────┘              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                           PHASE 2: GUERRILLA MARKETING                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐      ┌──────────────┐                                    │
│  │  4. DRAFT    │ ──▶  │  (manual)    │                                    │
│  │              │      │              │                                    │
│  │ Generate     │      │ You submit   │                                    │
│  │ README text  │      │ PR yourself  │                                    │
│  │ for `sk`     │      │              │                                    │
│  └──────────────┘      └──────────────┘                                    │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                           PHASE 3: NATIVE PACKAGES (FUTURE)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐      ┌──────────────┐                                    │
│  │  5. GENERATE │ ──▶  │  6. PUBLISH  │                                    │
│  │              │      │              │                                    │
│  │ agents.toml │      │ sk registry  │                                    │
│  │ PRs          │      │              │                                    │
│  └──────────────┘      └──────────────┘                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Dependency Types (how to install)

In order of preference:

1. `registry` → `sk pkg add registry name` (no version stored)
2. `claude-plugin` → `/plugin install plugin@marketplace`
3. `github` → `sk pkg add github owner/repo [--path ...]`
4. `git` → `sk pkg add git https://...`
5. `path` → local only, not for discovery

### Package Types (what it is)

In order of preference:

1. `agents.toml` → native sk package (registry-ready)
2. `skill-subdir` → directory with skills (e.g., `.claude/skills/*`)
3. `skill-single` → single `SKILL.md` at root

**Note:** Package type is auto-detected by `sk`, not stored in our index.

### Database Schema (Kysely)

Add to `packages/database/models/public/PublicSchema.ts`:

```typescript
export interface IndexedPackagesTable {
  id: Generated<number>              // auto-incrementing integer
  github_repo: string                // "pytorch/pytorch" - key for upsert
  declaration: string                // JSON string of DependencyDeclaration

  // Metadata (fetched from GitHub)
  name: string
  description: Nullable<string>
  author: string
  stars: number
  github_updated_at: Date

  // Discovery tracking
  discovered_at: Generated<Date>
  updated_at: Generated<Date>
}
```

Add to `PublicSchema` interface:
```typescript
export default interface PublicSchema {
  // ... existing tables ...
  indexed_packages: IndexedPackagesTable
}
```

### Declaration Types

```typescript
import type {
  GithubPackageDeclaration,
  GitPackageDeclaration,
  ClaudePluginDeclaration
} from "@skills-supply/sksup/core/manifest/types"

// Registry declaration (version-less)
type RegistryPackageDeclaration = { registry: string }

type IndexedDeclaration =
  | RegistryPackageDeclaration
  | GithubPackageDeclaration
  | GitPackageDeclaration
  | ClaudePluginDeclaration
```

### Upsert Logic

When we scan a GitHub repo, we find ALL installable packages and replace the existing ones in one transaction:

```typescript
async function upsertRepoPackages(
  db: Kysely<Database>,
  githubRepo: string,
  packages: Omit<IndexedPackagesTable, 'id' | 'discovered_at' | 'updated_at'>[]
) {
  await db.transaction().execute(async (trx) => {
    // Delete all existing packages for this repo
    await trx
      .deleteFrom('indexed_packages')
      .where('github_repo', '=', githubRepo)
      .execute()

    // Insert new packages
    if (packages.length > 0) {
      await trx
        .insertInto('indexed_packages')
        .values(packages.map(pkg => ({
          ...pkg,
          github_repo: githubRepo,
        })))
        .execute()
    }
  })
}
```

### Examples

```typescript
// GitHub with path (skill-subdir)
{
  id: 1,
  github_repo: "pytorch/pytorch",
  declaration: JSON.stringify({ gh: "pytorch/pytorch", path: ".claude/skills" }),
  name: "PyTorch Skills",
  description: "Skills for PyTorch development",
  author: "pytorch",
  stars: 95362,
  github_updated_at: new Date("2025-12-01"),
  discovered_at: new Date("2025-12-30"),
  updated_at: new Date("2025-12-30")
}

// Claude plugin
{
  id: 2,
  github_repo: "superpowers-marketplace/superpowers",
  declaration: JSON.stringify({
    type: "claude-plugin",
    plugin: "superpowers",
    marketplace: "superpowers-marketplace"
  }),
  name: "Superpowers",
  description: "Meta-skills for Claude Code",
  author: "superpowers-marketplace",
  stars: 1200,
  github_updated_at: new Date("2025-12-15"),
  discovered_at: new Date("2025-12-30"),
  updated_at: new Date("2025-12-30")
}
```

---

## Discovery Sources

### Primary: SkillsMP API

**Endpoint:** `https://skillsmp.com/api/v1/skills/search`

**Authentication:** Bearer token

**Response includes:**
- `githubUrl` - full URL to skill (e.g., `https://github.com/pytorch/pytorch/tree/main/.claude/skills/at-dispatch-v2`)
- `author` - GitHub username/org
- `name` - skill name
- `description` - skill description
- `stars` - repo stars
- `updatedAt` - timestamp

**Stats:** 38,216+ skills indexed, sortable by stars

**Usage:**
```bash
curl -H "Authorization: Bearer $SKILLSMP_API_KEY" \
  "https://skillsmp.com/api/v1/skills/search?q=*&limit=100&sortBy=stars"
```

**Extracting repo from URL:**
```typescript
// "https://github.com/pytorch/pytorch/tree/main/.claude/skills/at-dispatch-v2"
// → "pytorch/pytorch"

function extractRepoFromGithubUrl(url: string): string | null {
  const match = url.match(/github\.com\/([^\/]+\/[^\/]+)/)
  return match ? match[1] : null
}
```

### Future: In-house GitHub Search

Direct GitHub API queries for:
- Repos with `SKILL.md` files
- Repos with `.claude/skills/` directories
- Repos with `agents.toml` (sk-native)
- Repos tagged with `claude-skills`, `claude-code-plugins`

---

## Package Structure

Lives in `packages/discovery/`.

```
packages/discovery/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli.ts                    # CLI entry point
│   ├── commands/
│   │   ├── discover.ts           # Phase 1: find & index packages
│   │   ├── draft.ts              # Phase 2: generate README text
│   │   └── pr.ts                 # Phase 3: auto-create PRs (future)
│   ├── sources/
│   │   ├── skillsmp.ts           # SkillsMP API client
│   │   └── github.ts             # GitHub search (future)
│   ├── detection/
│   │   └── scan.ts               # Scan repo for installable packages
│   └── db/
│       └── indexed-packages.ts   # Database operations
```

### CLI Commands

```bash
# Phase 1: Discovery
sk-discovery discover                    # Fetch repos, scan, store packages
sk-discovery discover --limit 100        # Limit to first N repos
sk-discovery discover --repo owner/repo  # Scan a specific repo

# Database queries
sk-discovery list                        # Show all indexed packages
sk-discovery list --stars 1000           # Filter by min stars
sk-discovery show <id>                   # Show package details
sk-discovery stats                       # Count by type, source, etc.

# Phase 2: Marketing
sk-discovery draft <id>                  # Generate README install section
sk-discovery draft <id> --format md      # Output as markdown

# Phase 3: Native packages (future)
sk-discovery pr <id>                     # Create PR to add agents.toml
```

---

## README Installation Template

Generated for guerrilla marketing PRs:

```markdown
## Installation

### Claude Code (CLI)

```bash
claude plugin marketplace add owner/repo-name
claude plugin install plugin-name@repo-name
```

### Claude Code (Slash Commands)

```
/plugin marketplace add owner/repo-name
/plugin install plugin-name@repo-name
```

### Cross-Agent Install (sk)

Works with Claude, Codex, Copilot, and other compatible agents:

```bash
sk pkg add github owner/repo-name --path .claude/skills
sk sync
```

> **Why sk?** One manifest, all agents. [Learn more](https://skills.supply)
```

---

## PR Targeting Strategy

### Tier 1: Low-friction (start here)
- `athola/claude-night-market`
- `jeremylongshore/claude-code-plugins-plus-skills`
- `zai-org/zai-coding-plugins`

### Tier 2: Mid-size community
- `ccplugins/awesome-claude-code-plugins`
- `travisvn/awesome-claude-skills` (3.3k stars)

### Tier 3: High-profile (use Tier 1-2 as proof)
- `ComposioHQ/awesome-claude-skills` (12.3k stars)
- `skillmatic-ai/awesome-agent-skills`
- `anthropics/claude-plugins-official`

---

## Repo Scanning Strategy

**Approach:** Ephemeral shallow clones

```bash
# Clone shallow, scan, delete
git clone --depth 1 https://github.com/owner/repo.git /tmp/sk-scan-XXXXX
# ... run detection ...
rm -rf /tmp/sk-scan-XXXXX
```

**Why this approach:**
- No cache management complexity
- Minimal disk usage
- Each scan is independent and reproducible
- `--depth 1` is fast (no history)

**Detection logic:** Reuse/share with sksup's package detection code. Scan for:
1. `agents.toml` at root → registry-ready
2. `.claude/skills/` or similar subdirs → skill-subdir
3. `SKILL.md` at root → skill-single
4. `.claude-plugin/` directory → claude-plugin

---

## Refresh & Processing Strategy

**Freshness:** On-demand only. No automatic refresh - manual trigger when needed.

**Processing:** Batched + parallel

```bash
# Process 100 repos at a time, 10 concurrent clones
sk-discovery discover --limit 100 --concurrency 10

# Resume from where we left off (track progress in DB)
sk-discovery discover --limit 100 --concurrency 10 --resume
```

**Implementation:**
- Track last-processed repo in DB (or offset)
- `--limit N` controls batch size per run
- `--concurrency N` controls parallel clones (default: 10)
- `--resume` continues from last position

---

## Next Steps

1. [ ] Add `IndexedPackagesTable` to `packages/database/`
2. [ ] Create migration for `indexed_packages` table
3. [ ] Create `packages/discovery/` package structure
4. [ ] Implement SkillsMP API client
5. [ ] Implement repo scanning (detect installable packages)
6. [ ] Build `discover` command
7. [ ] Build `draft` command for README generation

