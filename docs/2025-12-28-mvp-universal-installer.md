# MVP 1: Universal Skill Installer

> The npm/homebrew for AI agent skills

---

## Problem Statement

Installing and updating skills is painful. Users must:
1. Find the skill source (GitHub repo, gist, blog post)
2. Copy files manually to the correct directory (`.claude/skills/`, `.opencode/skill/`, `.codex/skills/`)
3. Restart their agent
4. Repeat for updates

There is no universal package manager for skills.

---

## Scope

**In Scope:**
- Installing skills from git repos
- Updating skills to latest version
- Listing installed skills
- Removing skills
- Cross-platform support (Claude Code, OpenCode, Codex)

**Out of Scope:**
- Marketplace/discovery (separate MVP)
- Payments (separate MVP)
- Non-technical user UI (separate MVP)
- Skill creation tools
- Dependency resolution between skills

---

## Core Commands

Three commands only. Simplicity is the feature.

### `sksup install <source>`

Install or update a skill from a git source.

```bash
# Install from GitHub shorthand
sksup install gh:acme/marketing-skills

# Install from full git URL
sksup install https://github.com/acme/marketing-skills.git

# Install specific version via git tag
sksup install gh:acme/marketing-skills@v1.2.0

# Install specific branch
sksup install gh:acme/marketing-skills@experimental
```

**Behavior:**
- Clones/pulls the repo to a cache directory
- Copies all skills from `skills/` directory to user's skill directory
- If skill already exists, overwrites with new version
- Records source + version in local registry

**Multi-skill repos:**
A single repo can contain multiple skills:
```
marketing-skills/
  skills/
    brand-voice/
      SKILL.md
    email-sequences/
      SKILL.md
    seo-content/
      SKILL.md
```

Running `sksup install gh:acme/marketing-skills` installs ALL skills from the repo.

### `sksup list`

Show installed skills with source and version info.

```bash
$ sksup list

Installed skills:

  brand-voice         gh:acme/marketing-skills@v1.2.0    (update available: v1.3.0)
  email-sequences     gh:acme/marketing-skills@v1.2.0    (update available: v1.3.0)
  code-review         gh:personal/dev-skills@main        (up to date)
  commit-helper       gh:popular/git-skills@v2.0.1       (up to date)

4 skills installed from 3 sources
```

**Flags:**
- `--outdated` — show only skills with updates available
- `--json` — output as JSON for scripting

### `sksup remove <name>`

Remove an installed skill.

```bash
$ sksup remove brand-voice
Removed skill: brand-voice

$ sksup remove gh:acme/marketing-skills
Removed 3 skills from gh:acme/marketing-skills:
  - brand-voice
  - email-sequences
  - seo-content
```

---

## Source Format

Skills live in git repos with this structure:

```
my-skills/
  skills/
    skill-name/
      SKILL.md          # Required: The skill definition
      scripts/          # Optional: Executable scripts
      references/       # Optional: Additional docs
      assets/           # Optional: Templates, icons
```

**SKILL.md format** (compatible with Claude Code, OpenCode, Codex):

```yaml
---
name: skill-name
description: What this skill does (max 1024 chars)
version: 1.2.0
license: MIT
---

# Skill Title

Instructions for the agent...
```

The `version` field is optional. If omitted, sksup uses the git tag or commit SHA.

---

## Data Model

Local registry stored at `~/.config/sksup/registry.json`:

```json
{
  "version": 1,
  "skills": {
    "brand-voice": {
      "source": "gh:acme/marketing-skills",
      "ref": "v1.2.0",
      "commit": "abc123def456",
      "installed_at": "2024-12-28T10:30:00Z",
      "skill_path": "skills/brand-voice",
      "target_dir": "claude"
    },
    "code-review": {
      "source": "gh:personal/dev-skills",
      "ref": "main",
      "commit": "789xyz",
      "installed_at": "2024-12-27T14:00:00Z",
      "skill_path": "skills/code-review",
      "target_dir": "claude"
    }
  },
  "sources": {
    "gh:acme/marketing-skills": {
      "url": "https://github.com/acme/marketing-skills.git",
      "last_fetched": "2024-12-28T10:30:00Z",
      "latest_commit": "def789"
    }
  }
}
```

Git repos cached at `~/.cache/sksup/repos/`:

```
~/.cache/sksup/repos/
  github.com/
    acme/
      marketing-skills.git/    # bare git repo
    personal/
      dev-skills.git/
```

---

## Target Directory Detection

sksup auto-detects which agent platforms are installed and installs to all of them:

```bash
# Detection logic (in order)
~/.claude/skills/         # Claude Code personal skills
~/.config/opencode/skill/ # OpenCode personal skills
~/.codex/skills/          # Codex personal skills
```

**Override with flag:**

```bash
sksup install gh:acme/skills --target claude    # Only Claude Code
sksup install gh:acme/skills --target opencode  # Only OpenCode
sksup install gh:acme/skills --target codex     # Only Codex
sksup install gh:acme/skills --target all       # All detected (default)
```

**Project-local installation:**

```bash
sksup install gh:acme/skills --project
# Installs to .claude/skills/ in current directory
```

---

## Update Checking

### On-demand check

```bash
$ sksup list --outdated

Skills with updates available:

  brand-voice         v1.2.0 → v1.3.0    gh:acme/marketing-skills
  email-sequences     v1.2.0 → v1.3.0    gh:acme/marketing-skills

Run 'sksup install <source>' to update
```

### Background check (optional)

sksup can run a weekly background check and notify:

```bash
$ sksup config set update-check weekly

# On next terminal open (if updates available):
[sksup] 2 skills have updates available. Run 'sksup list --outdated' to see.
```

### Update all

```bash
$ sksup install --all
Updating 2 skills...
  brand-voice         v1.2.0 → v1.3.0    ✓
  email-sequences     v1.2.0 → v1.3.0    ✓
```

---

## Version Pinning

```bash
# Pin to specific tag
sksup install gh:acme/skills@v1.2.0

# Pin to specific commit
sksup install gh:acme/skills@abc123def

# Pin to branch (tracks HEAD)
sksup install gh:acme/skills@main
```

**Lockfile** (optional, for project-level reproducibility):

```bash
$ sksup lock
Created sksup.lock with 4 skills pinned to exact commits
```

`sksup.lock`:
```json
{
  "skills": {
    "brand-voice": {
      "source": "gh:acme/marketing-skills",
      "commit": "abc123def456789"
    }
  }
}
```

```bash
$ sksup install --locked
Installing from sksup.lock...
```

---

## Authentication

For private repos:

```bash
# Uses git credential helper (same as git clone)
sksup install gh:private-org/internal-skills

# Or explicit token
sksup install gh:private-org/internal-skills --token ghp_xxx
```

For Skills Supply marketplace (future):

```bash
sksup auth login
# Opens browser for OAuth flow
# Stores token in git credential helper
```

---

## Error Handling

```bash
$ sksup install gh:nonexistent/repo
Error: Repository not found: gh:nonexistent/repo
  - Check the repository exists and you have access
  - For private repos, run 'sksup auth login' first

$ sksup install gh:acme/skills
Error: No skills found in repository
  - Skills should be in skills/<name>/SKILL.md
  - Found 0 SKILL.md files

$ sksup install gh:acme/skills
Warning: Skill 'brand-voice' already installed from gh:other/repo
  - Use --force to overwrite
  - Use --skip-existing to ignore
```

---

## What Makes This 10x Better

### Before sksup
```bash
# Find skill on GitHub
# Click through to raw SKILL.md
# Copy content
# Navigate to ~/.claude/skills/
# Create directory
# Paste content
# Restart Claude Code
# Repeat for each skill
# Remember where you got it from
# Manually check for updates
```

### After sksup
```bash
sksup install gh:acme/marketing-skills
# Done. All 3 skills installed. Source tracked. Updates available via 'sksup list'.
```

**The killer insight:** Publishers maintain repos, users install collections. One command installs a curated set of related skills. Updates propagate with one command.

---

## Non-Goals (For This MVP)

1. **No registry/discovery** — just install from git URLs
2. **No publishing tools** — use GitHub
3. **No marketplace integration** — that's a separate MVP
4. **No skill creation** — use any text editor
5. **No dependency resolution** — skills are independent
6. **No GUI** — CLI only

---

## Success Metrics

1. **Time to install first skill:** < 30 seconds (vs 5+ minutes manual)
2. **Skills installed per user:** Track growth
3. **Update adoption rate:** % of users running latest versions
4. **Multi-platform usage:** % installing to 2+ agent platforms

---

## Technical Notes

### Implementation Stack
- CLI: Node.js with TypeScript
- Git operations: `isomorphic-git` or shell out to `git`
- Config: XDG-compliant paths
- Distribution: npm (`npm install -g sksup`)

### Platform-Specific Paths

| Platform | Personal Skills | Project Skills |
|----------|-----------------|----------------|
| Claude Code | `~/.claude/skills/` | `.claude/skills/` |
| OpenCode | `~/.config/opencode/skill/` | `.opencode/skill/` |
| Codex | `~/.codex/skills/` | `.codex/skills/` |

### Git Cache Management

```bash
sksup cache clear           # Remove all cached repos
sksup cache list            # Show cache size and repos
sksup cache prune           # Remove repos not referenced by installed skills
```
