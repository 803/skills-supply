# sksup CLI Design

> Design for the Skills Supply CLI that resolves, fetches, and installs skill packages for AI coding agents.

---

## Overview

sksup is a package manager for AI agent skills. It reads `skills.toml` manifests, resolves package dependencies from GitHub/Git/local paths, and installs skills to enabled agents (Claude Code, Codex, OpenCode).

---

## CLI Command Structure

```
sksup
├── sync                    # Reconcile installed state with manifests
├── pkg                     # Interactive package manager (ink)
│   ├── add <type> <spec>   # Add package to ./skills.toml
│   │   ├── gh <owner/repo> [--tag|--branch|--rev] [--path] [--as]
│   │   ├── git <url>       [--tag|--branch|--rev] [--path] [--as]
│   │   └── path <path>     [--as]
│   └── remove <alias>      # Remove package from ./skills.toml
├── agent                   # Interactive agent manager (ink)
│   ├── add <name>          # Enable agent (claude-code|codex|opencode)
│   └── remove <name>       # Disable agent
├── auth                    # Authenticate with Skills Supply
├── logout                  # Remove credentials
├── status                  # Show auth status
└── whoami                  # Show current user
```

---

## Agent Install Paths

| Agent | Install Path |
|-------|--------------|
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| OpenCode | `~/.config/opencode/skill/` |

---

## Core Data Flow (sksup sync)

```
1. DISCOVER manifests
   └── Walk up from cwd to home, collect all skills.toml paths
   └── Always include ~/.sksup/skills.toml as base

2. PARSE & MERGE manifests
   └── Parse each TOML file
   └── Merge packages: higher priority wins (by dedupe keys)
   └── Merge agents: higher priority wins (per agent key)
   └── Error on alias conflicts (same alias, different dedupe keys)

3. RESOLVE packages
   └── For each package declaration → canonical form
   └── Compute dedupe keys, detect duplicates

4. FETCH packages
   └── gh: git clone (sparse if --path)
   └── git: git clone
   └── path: resolve to absolute, validate exists

5. DETECT package type (for each fetched package)
   └── skills.toml? → read manifest, get skill dirs
   └── Subdirs with SKILL.md? → each subdir is a skill
   └── SKILL.md at root? → single skill
   └── else → error

6. INSTALL to each enabled agent
   └── For each agent: compute target path
   └── Remove skills not in manifest (full reconciliation)
   └── Copy/symlink skills with prefixed names
   └── e.g., ~/.claude/skills/superpowers-brainstorming/
```

---

## Core Types

```typescript
// Parsed from skills.toml
interface Manifest {
  agents: Record<string, boolean>
  packages: Record<string, PackageDeclaration>
  sourcePath: string  // Which file this came from (for path resolution)
}

// Package declaration (what's in skills.toml)
type PackageDeclaration =
  | string                           // registry: "^4.0"
  | { gh: string; tag?: string; branch?: string; rev?: string; path?: string }
  | { git: string; tag?: string; branch?: string; rev?: string; path?: string }
  | { path: string }

// Normalized canonical form (after resolution)
type CanonicalPackage =
  | { type: 'registry'; name: string; org?: string; version: string; alias?: string }
  | { type: 'github'; gh: string; ref?: GitRef; path?: string; alias: string }
  | { type: 'git'; url: string; ref?: GitRef; path?: string; alias: string }
  | { type: 'local'; absolutePath: string; alias: string }

type GitRef =
  | { tag: string }
  | { branch: string }
  | { rev: string }

// Detected skill within a package
interface Skill {
  name: string           // From SKILL.md frontmatter
  sourcePath: string     // Absolute path to skill directory
}

// Resolved package with its skills
interface ResolvedPackage {
  canonical: CanonicalPackage
  skills: Skill[]
  prefix: string         // Alias or derived name for prefixing
}

// Agent definition
interface Agent {
  id: string             // 'claude-code' | 'codex' | 'opencode'
  displayName: string
  skillsPath: string     // e.g., '~/.claude/skills/'
  detect: () => boolean  // Is this agent installed?
}
```

---

## Project Structure

```
packages/sksup/
├── src/
│   ├── cli.ts                    # Entry point, cac setup
│   ├── commands/
│   │   ├── sync.tsx              # sksup sync
│   │   ├── pkg/
│   │   │   ├── index.tsx         # sksup pkg (interactive)
│   │   │   ├── add.tsx           # sksup pkg add
│   │   │   └── remove.tsx        # sksup pkg remove
│   │   ├── agent/
│   │   │   ├── index.tsx         # sksup agent (interactive)
│   │   │   ├── add.tsx           # sksup agent add
│   │   │   └── remove.tsx        # sksup agent remove
│   │   ├── auth.tsx              # existing, migrate to ink
│   │   ├── logout.tsx            # existing, migrate to ink
│   │   ├── status.tsx            # existing, migrate to ink
│   │   └── whoami.tsx            # existing, migrate to ink
│   ├── core/
│   │   ├── manifest/
│   │   │   ├── parse.ts          # TOML parsing
│   │   │   ├── discover.ts       # Walk up tree, find all skills.toml
│   │   │   ├── merge.ts          # Merge with priority rules
│   │   │   └── write.ts          # Write to skills.toml
│   │   ├── packages/
│   │   │   ├── resolve.ts        # Resolve deps to canonical form
│   │   │   ├── fetch.ts          # Clone/download packages
│   │   │   ├── detect.ts         # Detect package type
│   │   │   └── extract.ts        # Find SKILL.md files
│   │   ├── agents/
│   │   │   ├── registry.ts       # Agent definitions (paths, detection)
│   │   │   └── install.ts        # Install skills to agent paths
│   │   └── sync.ts               # Orchestrates full sync
│   ├── ui/
│   │   ├── components/           # Reusable ink components
│   │   └── theme.ts              # Colors, styling
│   ├── utils/                    # existing utils
│   └── env.ts                    # existing
├── package.json
├── tsconfig.json
└── build.ts                      # Bun build script
```

---

## Dependencies

```json
{
  "dependencies": {
    "cac": "^6.7.14",
    "ink": "^5.1.0",
    "react": "^18.3.1",
    "smol-toml": "^1.3.0",
    "open": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^18"
  }
}
```

---

## Build Pipeline

```json
{
  "scripts": {
    "build": "tsc --build",
    "bundle": "bun build ./dist/cli.js --compile --outfile ./bin/sksup",
    "clean": "rm -rf dist bin"
  }
}
```

1. `npm run build` — tsc type-checks and emits to `dist/`
2. `npm run bundle` — bun compiles to standalone binary in `bin/sksup`

---

## Key Behaviors

### Manifest Write Target
- Always modify `./skills.toml` in cwd
- If doesn't exist, prompt user to confirm creation

### Sync Reconciliation
- Full reconciliation: installed state matches manifest exactly
- Skills not in manifest are removed

### Package Alias Derivation
- Derive from repo name by default (e.g., `alice/tools` → `tools`)
- Override with `--as` flag

---

## Scope

### v1 (Core)
- TOML parsing & manifest discovery/merging
- GitHub packages (`gh`)
- Git URL packages (`git`)
- Local path packages (`path`)
- Claude Code installation
- Codex installation
- OpenCode installation

### Deferred
- Registry packages (no registry yet)
- Lockfile
- Cursor/Windsurf agents
