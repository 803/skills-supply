# sk

Manage AI agent skills across Claude Code, Codex, OpenCode, and others.

```bash
# Install
brew install 803/sk/sk

# Add skills to your project
sk init
sk pkg add gh superpowers-marketplace/superpowers
sk sync
```

## Highlights

- **One manifest, multiple agents** — Define skills once in `agents.toml`, sync to all your AI coding tools
- **Cross-agent compatibility** — Use Claude Code plugins with Codex and OpenCode; sk extracts skills from `.claude-plugin` packages and syncs them everywhere
- **Team-shareable** — Commit `agents.toml` to version control; teammates run `sk sync`
- **Live development** — Local packages use symlinks; edit skills and changes appear instantly
- **Smart reconciliation** — Only updates what changed; safely removes stale skills without touching manually-added ones
- **Flexible sourcing** — Pull from GitHub, any git remote, local paths, or existing Claude Code plugins

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [The Manifest](#the-manifest)
- [Package Types](#package-types)
- [Commands](#commands)
- [Creating Skill Packages](#creating-skill-packages)
- [How It Works](#how-it-works)
- [Workflows](#workflows)
- [Troubleshooting](#troubleshooting)

## Installation

```bash
# Homebrew (macOS/Linux)
brew install 803/sk/sk

# npm (requires Node.js 18+)
npm install -g @skills-supply/sk

# Scoop (Windows)
scoop bucket add 803 https://github.com/803/scoop-sk
scoop install sk
```

## Quick Start

### 1. Initialize a manifest

```bash
sk init
```

Creates `agents.toml` with detected agents:

```toml
[agents]
claude-code = true
codex = true
opencode = false

[dependencies]
```

### 2. Add packages

```bash
sk pkg add https://github.com/obra/superpowers
```

### 3. Sync to your agents

```bash
sk sync
```

Skills are now installed in each enabled agent's directory.

## Core Concepts

### Skills

A **skill** is a markdown file (`SKILL.md`) that extends what an AI agent can do. Skills contain instructions, patterns, workflows, or domain knowledge that agents follow during conversations.

### Packages

A **package** is a collection of one or more skills. Packages can be:
- A GitHub repository
- Any git remote (GitLab, Bitbucket, self-hosted)
- A local directory (for development)
- A Claude Code plugin (`.claude-plugin` directory)

### Manifest

The **manifest** (`agents.toml`) declares which packages you want and which agents should receive them. It's the single source of truth for your skill configuration.

### Agents

**Agents** are the AI coding tools that consume skills. Each agent has its own skills directory:

| Agent | Skills Directory |
|-------|------------------|
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| OpenCode | `~/.config/opencode/skill/` |

### Project vs Global Scope

| Scope | Manifest Location | Use Case |
|-------|-------------------|----------|
| **Project** | `./agents.toml` | Skills for a specific repo |
| **Global** | `~/.sk/agents.toml` | Skills available everywhere |

```bash
# Project scope (default)
sk init && sk pkg add gh owner/repo && sk sync

# Global scope
sk init --global && sk pkg add gh owner/repo --global && sk sync --global
```

Project manifests are discovered by walking up from your current directory.

## The Manifest

```toml
[agents]
claude-code = true    # Anthropic's Claude Code
codex = true          # OpenAI Codex CLI
opencode = false      # OpenCode (disabled)

[dependencies]
# GitHub packages
superpowers = { gh = "superpowers-marketplace/superpowers", tag = "v4.0.0" }
feature-dev = { gh = "claude-plugins-official/feature-dev", branch = "main" }

# Subdirectory in a monorepo
elements = { gh = "org/monorepo", path = "packages/elements" }

# Any git remote
internal = { git = "git@gitlab.com:myorg/skills.git", rev = "abc123" }

# Local path (development)
my-skills = { path = "../my-skills" }
```

## Package Types

### GitHub (`gh`)

For repositories hosted on GitHub.

```bash
# Basic
sk pkg add gh owner/repo

# Pinned to a tag (recommended for stability)
sk pkg add gh owner/repo --tag v1.0.0

# Track a branch (updates on each sync)
sk pkg add gh owner/repo --branch main

# Pinned to exact commit
sk pkg add gh owner/repo --rev abc123def

# Subdirectory in a monorepo
sk pkg add gh owner/repo --path packages/skills
```

**Version behavior:**
- `--tag` — Pinned. Always uses that exact tag.
- `--branch` — Floating. Each `sk sync` fetches the latest commit.
- `--rev` — Pinned. Always uses that exact commit.
- No ref specified — Uses the repository's default branch (floating).

**Authentication:** Uses your existing git SSH keys. For private repos, ensure your SSH key has access.

### Git (`git`)

For any git remote—GitLab, Bitbucket, self-hosted, or SSH URLs.

```bash
# HTTPS
sk pkg add git https://gitlab.com/org/repo.git

# SSH
sk pkg add git git@github.com:org/private-repo.git --tag v1.0.0
```

Same version options as GitHub packages (`--tag`, `--branch`, `--rev`).

**When to use `git` vs `gh`:**
- Use `gh` for GitHub repos (shorter syntax, GitHub-specific optimizations)
- Use `git` for everything else

### Local Path (`path`)

For skills you're developing or testing locally.

```bash
sk pkg add path ../my-skills
sk pkg add path /absolute/path/to/skills
```

**Key behavior:** Local packages are **symlinked**, not copied. When you edit files in the source directory, changes appear immediately in the agent's skills directory. No need to re-run `sk sync`.

This makes local packages ideal for:
- Developing new skills
- Testing changes before publishing
- Team members working on shared skill repos

## Commands

| Command | Description |
|---------|-------------|
| `sk init` | Create an `agents.toml` manifest |
| `sk pkg add <type> <spec>` | Add a package to the manifest |
| `sk pkg remove <alias>` | Remove a package from the manifest |
| `sk pkg` | Interactive package management |
| `sk agent add <name>` | Enable an agent |
| `sk agent remove <name>` | Disable an agent |
| `sk agent` | Interactive agent management |
| `sk sync` | Sync skills to all enabled agents |
| `sk sync --dry-run` | Preview changes without writing |

### Global Options

- `--global` — Use the global manifest (`~/.sk/agents.toml`)
- `--non-interactive` — Run without prompts (for scripts/CI)
- `--init` — Create manifest if it doesn't exist (with `pkg add`)

## Creating Skill Packages

### Package Structure

sk detects packages in several ways (checked in order):

1. **Manifest package** — Has `agents.toml` with `[exports.auto_discover]`
2. **Plugin package** — Has `.claude-plugin/plugin.json`
3. **Subdirectory package** — Contains subdirectories with `SKILL.md` files
4. **Single-skill package** — Has `SKILL.md` in the root

For most cases, use the **subdirectory** structure:

```
my-skills/
├── debugging/
│   └── SKILL.md
├── code-review/
│   └── SKILL.md
└── testing/
    └── SKILL.md
```

### The SKILL.md File

Every skill needs a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: debugging
---

# Debugging Skill

Instructions for systematic debugging...
```

**Requirements:**
- File must be named exactly `SKILL.md`
- Must start with YAML frontmatter (`---`)
- Must include a `name` field
- Name must be unique within the package

### Manifest-Based Packages

For more control, add an `agents.toml` to your package:

```toml
[package]
name = "my-skills"
version = "1.0.0"

[exports.auto_discover]
skills = "./skills"  # Directory to scan for SKILL.md files
```

This is useful when you want to:
- Specify a custom skills directory
- Add package metadata
- Combine skills with other exports

### Claude Code Plugins

sk automatically detects Claude Code plugins (packages with `.claude-plugin/plugin.json`). Skills from these plugins can be synced to all agents, not just Claude Code.

This means you can:
- Use existing Claude Code plugins with Codex or OpenCode
- Publish one plugin that works across all AI coding tools
- Share plugin skills with teammates who use different agents

## How It Works

### Manifest Discovery

When you run `sk sync`, sk walks up from your current directory looking for `agents.toml`. The first manifest found is used. This means you can run `sk sync` from anywhere in your project.

For global scope (`--global`), sk uses `~/.sk/agents.toml` directly.

### Package Resolution

Each dependency in your manifest is resolved to a fetchable source:

1. **GitHub packages** — Cloned via git using `gh` shorthand
2. **Git packages** — Cloned via the provided URL
3. **Local packages** — Used directly (no clone)

Version refs (`tag`, `branch`, `rev`) determine what gets checked out.

### Skill Detection

After fetching, sk scans each package for skills:

1. Check for `agents.toml` with auto-discover config
2. Check for `.claude-plugin/` directory
3. Scan subdirectories for `SKILL.md` files
4. Check root for `SKILL.md`

Each discovered skill is validated (frontmatter, unique name).

### Installation

Skills are installed to each enabled agent's directory:

- **Remote packages** — Files are copied
- **Local packages** — Symlinks are created

Skill names are prefixed with the package alias to avoid conflicts: `superpowers-debugging`, `feature-dev-code-review`, etc.

### State Tracking

sk maintains a state file (`.sk-state.json`) in each agent's directory. This tracks which skills sk installed, enabling:

- **Safe removal** — When you remove a package from your manifest, its skills are cleaned up
- **Protection** — sk won't overwrite manually-added skills (errors instead)
- **Incremental sync** — Only changed skills are updated

### Reconciliation

On each sync, sk compares the desired state (manifest) to the installed state:

- Skills in manifest but not installed → **Install**
- Skills installed but not in manifest → **Remove**
- Skills that changed → **Update**

This "npm prune" pattern ensures your installed skills always match your manifest.

## Workflows

### Team Setup

Share skills across your team:

```bash
# One person sets up
sk init
sk pkg add gh your-org/team-skills
git add agents.toml
git commit -m "Add team skills"
git push

# Teammates run
git pull
sk sync
```

### Local Development

Develop skills with instant feedback:

```bash
# Add your local skills directory
sk pkg add path ../my-skills-dev
sk sync

# Edit SKILL.md files in ../my-skills-dev
# Changes appear immediately (symlinked)

# When ready, publish to git and switch to remote
sk pkg remove my-skills-dev
sk pkg add gh your-org/my-skills --tag v1.0.0
sk sync
```

### CI/Automation

Install skills in CI pipelines:

```bash
sk init --agents claude-code --non-interactive
sk pkg add gh org/skills --non-interactive --init
sk sync --non-interactive
```

### Multiple Projects

Use global skills for tools you want everywhere, project skills for repo-specific needs:

```bash
# Global: your personal productivity skills
sk pkg add gh my-username/my-skills --global
sk sync --global

# Project: team-specific skills (committed to repo)
sk pkg add gh team/project-skills
sk sync
```

## Troubleshooting

### "Skill target already exists and is not managed by sk"

sk found an existing skill with the same name that it didn't install. This protects manually-added skills from being overwritten.

**Solutions:**
- Rename your manual skill to avoid the conflict
- Remove the manual skill if you want sk to manage it
- Use a different package alias in your manifest

### "No dependencies to sync"

Your manifest has no packages in `[dependencies]`.

**Solutions:**
- Add packages: `sk pkg add gh owner/repo`
- Check you're in the right directory (sk walks up to find `agents.toml`)

### Private repository access denied

sk uses your existing git SSH keys. For private repos:

**Solutions:**
- Ensure your SSH key is added: `ssh-add -l`
- Test access directly: `git ls-remote git@github.com:owner/private-repo.git`
- For HTTPS, configure git credentials

### Skills not appearing after sync

**Check:**
- Is the agent enabled? (`sk agent` to view)
- Did sync complete without errors?
- Is the skill file named exactly `SKILL.md`?
- Does the skill have valid YAML frontmatter with `name:`?

### Changes to local skills not appearing

Local packages use symlinks, so changes should appear immediately. If not:

**Check:**
- Is the symlink intact? Check the agent's skills directory
- Re-run `sk sync` to recreate symlinks if needed

### Resetting sk state

If you need to start fresh:

```bash
# Remove sk's state file (per agent)
rm ~/.claude/.sk-state.json
rm ~/.codex/.sk-state.json

# Re-sync
sk sync
```

This makes sk treat all existing skills as unmanaged.

## License

MIT
