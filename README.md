# sk

Manage AI agent skills across Claude Code, Codex, and OpenCode.

```bash
# Install
brew install 803/sk/sk

# Add skills to your project
sk init
sk pkg add gh superpowers-marketplace/superpowers
sk sync
```

## What is sk?

`sk` is a CLI for installing and synchronizing skills across multiple AI coding agents. Skills are instructions that extend what your agent can do—coding patterns, workflows, domain knowledge.

**One manifest. Multiple agents.** Define your skills in an `agents.toml` file once, and `sk sync` installs them to all your enabled agents.

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

This creates an `agents.toml` file with your enabled agents:

```toml
[agents]
claude-code = true
codex = true
opencode = false

[dependencies]
```

### 2. Add packages

```bash
# Add a skill package from GitHub
sk pkg add gh superpowers-marketplace/superpowers

# Add with a specific version
sk pkg add gh superpowers-marketplace/superpowers --tag v4.0.0

# Add from a subdirectory in a monorepo
sk pkg add gh myorg/skills-monorepo --path packages/core

# Add a local package (for development)
sk pkg add path ../my-local-skills
```

### 3. Sync to your agents

```bash
sk sync
```

This fetches all packages and installs their skills to each enabled agent's skill directory.

## Project vs Global Skills

`sk` supports two scopes:

| Scope | Manifest Location | Use Case |
|-------|-------------------|----------|
| **Project** | `./agents.toml` | Skills for a specific repo |
| **Global** | `~/.sk/agents.toml` | Skills available everywhere |

```bash
# Project scope (default)
sk init
sk pkg add gh owner/repo
sk sync

# Global scope
sk init --global
sk pkg add gh owner/repo --global
sk sync --global
```

Project manifests are discovered by walking up from your current directory—run `sk sync` from anywhere in your repo.

## The Manifest: agents.toml

```toml
[agents]
claude-code = true    # Anthropic's Claude Code
codex = true          # OpenAI Codex CLI
opencode = false      # OpenCode

[dependencies]
# GitHub packages
superpowers = { gh = "superpowers-marketplace/superpowers", tag = "v4.0.0" }
feature-dev = { gh = "claude-plugins-official/feature-dev", branch = "main" }

# Subdirectory in a repo
elements = { gh = "org/monorepo", path = "packages/elements" }

# Git URL (any git remote)
internal = { git = "https://gitlab.com/myorg/skills.git", rev = "abc123" }

# Local path (for development)
local-dev = { path = "../my-skills" }
```

## Commands

| Command | Description |
|---------|-------------|
| `sk init` | Create an `agents.toml` manifest |
| `sk pkg add <type> <spec>` | Add a package |
| `sk pkg remove <alias>` | Remove a package |
| `sk pkg` | Interactive package management |
| `sk agent add <name>` | Enable an agent |
| `sk agent remove <name>` | Disable an agent |
| `sk agent` | Interactive agent management |
| `sk sync` | Sync skills to all enabled agents |
| `sk sync --dry-run` | Preview changes without writing |

### Common Options

- `--global` - Use the global manifest (`~/.sk/agents.toml`)
- `--non-interactive` - Run without prompts (for scripts/CI)
- `--init` - Create manifest if it doesn't exist (with `pkg add`)

## Supported Agents

| Agent | ID | Skills Directory |
|-------|-----|------------------|
| Claude Code | `claude-code` | `~/.claude/skills/` |
| Codex | `codex` | `~/.codex/skills/` |
| OpenCode | `opencode` | `~/.config/opencode/skill/` |

`sk` auto-detects which agents are installed on your system.

## Package Types

### GitHub (`gh`)

```bash
sk pkg add gh owner/repo
sk pkg add gh owner/repo --tag v1.0.0
sk pkg add gh owner/repo --branch develop
sk pkg add gh owner/repo --rev abc123
sk pkg add gh owner/repo --path subdirectory
```

### Git (`git`)

```bash
sk pkg add git https://gitlab.com/org/repo.git
sk pkg add git git@github.com:org/private-repo.git --tag v1.0.0
```

### Local Path (`path`)

```bash
sk pkg add path ../relative/path
sk pkg add path /absolute/path/to/skills
```

## Workflows

### Team Setup

Share skills across your team by committing `agents.toml`:

```bash
# Set up
sk init
sk pkg add gh your-org/team-skills
git add agents.toml
git commit -m "Add team skills"

# Teammates run
sk sync
```

### Development

Work on skills locally before publishing:

```bash
sk pkg add path ../my-skills-in-development
sk sync
# Make changes to your skills
sk sync  # Re-sync to test
```

### CI/Automation

```bash
sk init --agents claude-code --non-interactive
sk pkg add gh org/skills --non-interactive --init
sk sync --non-interactive
```

## How It Works

1. **Manifest discovery**: `sk` walks up from your current directory to find `agents.toml`
2. **Package resolution**: Each dependency is resolved to a fetchable source
3. **Skill detection**: Packages are scanned for skill files
4. **Synchronization**: Skills are installed to each enabled agent's directory

Skills are tracked in a state file, so `sk sync` only updates what's changed.

## License

MIT
