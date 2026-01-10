# What is sk?

sk is a cross-agent skill installer for AI coding assistants. It works like npm or pip, but for AI agent skills and plugins.

## The Problem

AI agents like Claude Code, Codex, and OpenCode can be extended with skills (custom commands, workflows, and capabilities). But there's no standard way to discover, install, or manage these skills across different agents.

## How sk Solves It

sk provides a universal package manager for AI skills:

1. **Add packages**: `sk pkg add github:owner/repo` adds a skill package to your manifest
2. **Sync**: `sk sync` installs/updates all packages, removing any that were removed from the manifest
3. **Works everywhere**: Same commands work with Claude Code, Codex, OpenCode, Factory, and other compatible agents

## Key Features

- **Declarative manifest**: Your `.sk/manifest.json` tracks what's installed. Share it with your team.
- **Cross-agent**: Skills installed via sk work across supported AI agents
- **Git-based**: Packages come from GitHub repos. No central registry needed.
- **Atomic sync**: `sk sync` reconciles your installed skills with your manifest in one operation

# Repository

{{REPO}}

# IndexedPackages

The data below is an array of **IndexedPackages**. Each IndexedPackage represents a skill package we've discovered in this repository.

**Data model:**
```
IndexedPackage {
  name: string | null        // Package name (may be null)
  description: string | null // Package description
  installCommand: string     // The EXACT sk command to install this package - use verbatim
  path: string | null        // Path within repo (for monorepos)
  skills: Skill[]            // Array of skills contained in this package
}

Skill {
  name: string               // Skill name
  description: string | null // What this skill does
}
```

**IndexedPackages in this repository:**

{{PACKAGES_JSON}}

---

## Your Task

### Phase 1: Understand the IndexedPackages

Use subagents to analyze each IndexedPackage in parallel. For each IndexedPackage:
- Read its skills (the `skills` array - names and descriptions)
- Understand what the package does and who the target audience is
- Find where documentation lives for that audience:
  - README.md (package-level or root)
  - docs/ folder in the repo
  - External site or separate repo
  - No clear docs location

### Phase 2: Synthesize and report

Once subagents complete, present your findings:
- For each IndexedPackage: what it is, who it's for, where docs live
- Which IndexedPackages have in-repo docs (can add instructions)
- Which IndexedPackages have external docs (flag for manual review)
- Any observations about shared audiences or consolidation

**Then stop and wait for further instruction.**

Do not edit any files until instructed.

---

## When Adding Documentation

When instructed to add sk installation instructions, follow this format:

### Example

```markdown
### Install with `sk`

Install <name> via [sk](https://github.com/803/skills-supply), the universal skills package manager for coding agents (supports Claude, Codex, OpenCode, etc...).

```bash
<installCommand>
sk sync
```
```

Where `<installCommand>` is the exact value from the IndexedPackage data (e.g., `sk pkg add github:owner/repo --path skills`).

### Include

- The one-liner: `Install via [sk](https://github.com/803/skills-supply), the universal package manager for AI agent skills (supports Claude, Codex, OpenCode, etc...).`
- The `installCommand` from the IndexedPackage data **verbatim** - do not invent or modify it
- `sk sync` on the next line
- Match the existing documentation style of the repo

### Exclude

- Don't explain what the skills do - the package's existing docs already cover that
- Don't be promotional - no "awesome", "powerful", "amazing" language
- Don't duplicate or replace existing installation methods - sk is an alternative option
