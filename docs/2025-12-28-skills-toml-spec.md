# skills.toml Specification

> Package manifest format for sksup, the Skills Supply package manager.

---

## Overview

`skills.toml` is the manifest file for declaring skill packages. It defines which packages to install and from what sources (registry, GitHub, git, or local path).

**Design principles:**
- TOML format for human readability
- npm-style semver for version constraints
- Cargo-style inline tables for non-registry sources
- Recursive inheritance with closest-wins merge semantics

---

## File Locations & Inheritance

### Discovery

The CLI discovers `skills.toml` files by walking up the directory tree from the current working directory, stopping at the user's home directory or filesystem root. The user-level file at `~/.sksup/skills.toml` is always included as the base layer.

### Priority Order (highest to lowest)

1. `./skills.toml` — current directory
2. `../skills.toml` — parent directory
3. `../../skills.toml` — grandparent, etc.
4. _(stops at home directory or filesystem root)_
5. `~/.sksup/skills.toml` — user-level base (always included, lowest priority)

### Merge Behavior

All discovered files are merged into a single resolved manifest. When the same package appears in multiple files, the definition from the highest-priority (closest) file wins completely — no partial merging of fields.

### Example

```
~/.sksup/skills.toml:
    [packages]
    superpowers = "^4.0"
    utils = "^2.0"

~/projects/skills.toml:
    [packages]
    superpowers = "^3.0"

~/projects/myapp/skills.toml:
    [packages]
    my-tools = "^1.0"
```

Running `sksup` in `~/projects/myapp/` resolves to:

| Package | Version | Source File |
|---------|---------|-------------|
| my-tools | ^1.0 | ~/projects/myapp/skills.toml |
| superpowers | ^3.0 | ~/projects/skills.toml |
| utils | ^2.0 | ~/.sksup/skills.toml |

---

## Package Sources

### Registry (Skills Supply)

Packages from the official Skills Supply registry use simple `name = "version"` syntax.

**Unscoped packages (global namespace):**

```toml
[packages]
superpowers = "^4.0.0"
utils = "~1.2.0"
exact-dep = "2.0.0"
```

**Scoped packages (publisher namespace):**

```toml
[packages]
"@alice/custom-tools" = "^1.0.0"
"@corp/internal-utils" = ">=2.0.0 <3.0.0"
```

Scopes follow npm conventions: `@scope/package-name`. The scope typically represents a publisher, organization, or user.

---

### GitHub (`gh`)

For packages hosted on GitHub but not published to the registry. We can chose here to use HTTPS or SSH as the protocol depending on implementation concerns.

```toml
[packages]
# Default branch (latest commit)
my-tools = { gh = "alice/my-tools" }

# Specific tag
my-tools = { gh = "alice/my-tools", tag = "v1.0.0" }

# Specific branch
my-tools = { gh = "alice/my-tools", branch = "develop" }

# Specific commit SHA
my-tools = { gh = "alice/my-tools", rev = "abc123f" }

# Subdirectory within a monorepo
core = { gh = "alice/monorepo", tag = "v1.0", path = "packages/core" }
```

**Rules:**
- Only one of `tag`, `branch`, or `rev` may be specified per package
- `path` is optional; specifies a subdirectory within the repository
- Omitting `tag`/`branch`/`rev` uses the repository's default branch

---

### Git (`git`)

For non-GitHub hosts, self-hosted git servers, or HTTPS/SSH URLs.

```toml
[packages]
# GitLab via HTTPS
private = { git = "https://gitlab.com/corp/private.git", tag = "v2.0" }

# GitHub via SSH
internal = { git = "git@github.com:corp/internal.git", branch = "main" }

# Self-hosted git server
custom = { git = "https://git.internal.co/tools.git", rev = "def456" }

# With subdirectory
mono-pkg = { git = "https://github.com/org/monorepo.git", tag = "v1.0", path = "packages/pkg" }
```

**Rules:**
- URLs should end in `.git`
- Supports both HTTPS and SSH protocols
- Same `tag`/`branch`/`rev`/`path` options as `gh`

---

### Local Path (`path`)

For development, vendored packages, or monorepo setups.

```toml
[packages]
# Relative path (from this skills.toml's directory)
my-dev-pkg = { path = "../my-package" }

# Absolute path
vendored = { path = "/opt/shared/skills/utils" }

# Current directory
self = { path = "." }
```

**Path Resolution:**

Relative paths resolve from the directory containing the `skills.toml` file where the package was defined — not from the current working directory, and not from the highest-priority file.

This is critical for correct inheritance behavior:

```
~/projects/skills.toml:
    [packages]
    shared = { path = "./shared-pkg" }
    # Resolves to: ~/projects/shared-pkg

~/projects/app/skills.toml:
    [packages]
    shared = { path = "../other-shared" }
    # Resolves to: ~/projects/other-shared

# Running sksup in ~/projects/app/:
# "shared" comes from ~/projects/app/skills.toml (highest priority)
# Path resolves to ~/projects/other-shared
```

**Implementation requirement:** The CLI must track the source file for each package definition to correctly resolve relative paths after merging.

---

## Version Syntax

Version constraints follow [npm semver](https://docs.npmjs.com/cli/v6/using-npm/semver) semantics.

| Syntax | Meaning | Example Range |
|--------|---------|---------------|
| `^1.2.3` | Compatible with | >=1.2.3 <2.0.0 |
| `~1.2.3` | Approximately | >=1.2.3 <1.3.0 |
| `1.2.3` | Exact version | =1.2.3 |
| `>=1.0.0` | Greater or equal | >=1.0.0 |
| `<2.0.0` | Less than | <2.0.0 |
| `>=1.0.0 <2.0.0` | Range | >=1.0.0 <2.0.0 |
| `1.0.0 - 2.0.0` | Hyphen range | >=1.0.0 <=2.0.0 |
| `*` | Any version | >=0.0.0 |

**Caret (`^`) behavior:**
- `^1.2.3` → `>=1.2.3 <2.0.0`
- `^0.2.3` → `>=0.2.3 <0.3.0` (minor is treated as major for 0.x)
- `^0.0.3` → `>=0.0.3 <0.0.4` (patch is treated as major for 0.0.x)

**Tilde (`~`) behavior:**
- `~1.2.3` → `>=1.2.3 <1.3.0`
- `~1.2` → `>=1.2.0 <1.3.0`
- `~1` → `>=1.0.0 <2.0.0`

---

## Complete Example

A comprehensive `skills.toml` demonstrating all features:

```toml
# skills.toml

[packages]
# ─────────────────────────────────────────────────────────────
# Registry packages (Skills Supply)
# ─────────────────────────────────────────────────────────────

# Unscoped (global namespace)
superpowers = "^4.0.0"
direct-response = "~2.1.0"

# Scoped (publisher namespace)
"@alice/productivity" = "^1.0.0"
"@corp/internal-tools" = ">=2.0.0 <3.0.0"

# ─────────────────────────────────────────────────────────────
# GitHub packages
# ─────────────────────────────────────────────────────────────

# Latest from default branch
experimental = { gh = "alice/experimental-skills" }

# Pinned to tag
stable-fork = { gh = "bob/superpowers-fork", tag = "v4.1.0-custom" }

# Tracking a branch
bleeding-edge = { gh = "alice/new-features", branch = "develop" }

# Pinned to commit
audited = { gh = "corp/audited-pkg", rev = "8f4e2a1b" }

# From monorepo subdirectory
mono-core = { gh = "bigcorp/skill-monorepo", tag = "v2.0", path = "packages/core" }
mono-utils = { gh = "bigcorp/skill-monorepo", tag = "v2.0", path = "packages/utils" }

# ─────────────────────────────────────────────────────────────
# Git packages (non-GitHub)
# ─────────────────────────────────────────────────────────────

# GitLab
gitlab-pkg = { git = "https://gitlab.com/org/skills.git", tag = "v1.0" }

# Self-hosted
internal = { git = "https://git.internal.corp/tools.git", branch = "main" }

# SSH
private = { git = "git@github.com:corp/private-skills.git", tag = "v3.0" }

# ─────────────────────────────────────────────────────────────
# Local packages
# ─────────────────────────────────────────────────────────────

# Development (relative path)
my-wip-skills = { path = "../my-skills-dev" }

# Vendored (absolute path)
vendored-utils = { path = "/opt/vendored/skill-utils" }
```

---

## User-Level Configuration

The user-level file at `~/.sksup/skills.toml` serves as the base layer for all projects. Use it for packages you want available everywhere.

**Example `~/.sksup/skills.toml`:**

```toml
[packages]
# Always available
superpowers = "^4.0"
"@myuser/personal-tools" = "^1.0"
```

Projects can override these by defining the same package with a different version or source.

---

## Summary

| Source | Syntax |
|--------|--------|
| Registry (unscoped) | `name = "^1.0.0"` |
| Registry (scoped) | `"@scope/name" = "^1.0.0"` |
| GitHub | `name = { gh = "user/repo", tag = "v1.0" }` |
| Git URL | `name = { git = "https://...", branch = "main" }` |
| Local path | `name = { path = "../local-pkg" }` |

| Ref Type | Key |
|----------|-----|
| Tag | `tag = "v1.0.0"` |
| Branch | `branch = "main"` |
| Commit | `rev = "abc123"` |
| Subdirectory | `path = "packages/sub"` |

---

## Future Considerations

The following are explicitly out of scope for v1 but may be added later:

- **Lock file** (`skills.lock`) for reproducible installs
- **Workspaces** for monorepo support
- **Private registries** beyond Skills Supply
- **Dependency resolution** between packages
- **Scripts/hooks** (pre-install, post-install)
