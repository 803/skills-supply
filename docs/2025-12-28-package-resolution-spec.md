# Package Resolution & Installation Specification

> How sksup resolves, deduplicates, and installs skill packages.

---

## Overview

This spec defines how sksup processes package declarations from `skills.toml` files, discovers skills within packages, and installs them for use by AI agents.

**Agent compatibility:** This spec is agent-agnostic. Skills installed by sksup work with any agent that supports the [Agent Skills specification](https://github.com/agentskills/agentskills), including Claude Code, OpenAI Codex, OpenCode, and others.

---

## Definitions

| Term | Meaning |
|------|---------|
| **User alias** | The key in `skills.toml` (e.g., `my-pkg` in `my-pkg = { gh = "..." }`). Used as the skill prefix when installing for an agent. |
| **Package** | A container that holds one or more skills |
| **Skill** | A directory with a `SKILL.md` file |
| **Canonical dependency definition** | Normalized representation of a package declaration |
| **Canonical package name** | The package name derived from source (registry name, manifest, repo name, etc.). Used for skill prefix derivation. |
| **Dedupe keys** | Fields used to determine if two declarations refer to the same package |

---

## Detection Order

When sksup fetches a package (or looks at a path), it determines the package structure using this priority order:

1. **`skills.toml`** — Our manifest format (highest priority)
2. **`plugin.json`** — Claude Code plugin format
3. **Subdirectories with `SKILL.md`** — Multiple skills, no manifest
4. **`SKILL.md` at root** — Single skill (lowest priority)

If none of the above are found, sksup errors.

**Not supported:**
- `AGENTS.md` only (no SKILL.md)
- Repositories with no recognizable skill structure

---

## Package Types

### 1. skills.toml Manifest

**Detection:** File `skills.toml` exists at package root.

**Folder structure:**
```
package-root/
├── skills.toml
├── skill-a/
│   └── SKILL.md
├── skill-b/
│   └── SKILL.md
└── ...
```

The `skills.toml` manifest declares package metadata and which subdirectories are skills. (Manifest schema TBD.)

---

### 2. Claude Code Plugin

**Detection:** Directory `.claude-plugin/` exists at package root containing `plugin.json` (and no `skills.toml`).

**Folder structure:**
```
package-root/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── skill-a/
│   │   └── SKILL.md
│   └── skill-b/
│       └── SKILL.md
└── ...
```

The `plugin.json` file follows the Claude Code plugin format. Skills are located according to the plugin manifest.

> **Status:** Resolution rules for this package type are deferred. Claude Code plugins have their own marketplace-based distribution model (`{plugin}@{marketplace}`) which adds complexity. We suspect plugins may be better supported as a **dependency type** rather than a package type, allowing sksup to reference plugins from Claude's existing plugin infrastructure. To be revisited.

---

### 3. Subdirectories with SKILL.md

**Detection:** No manifest files, but one or more **immediate** subdirectories (one level deep only) contain `SKILL.md`.

**Folder structure:**
```
package-root/
├── skill-a/
│   └── SKILL.md
├── skill-b/
│   └── SKILL.md
├── other-stuff/        # ignored (no SKILL.md)
└── nested/
    └── deep/
        └── SKILL.md    # ignored (too deep)
```

Only immediate children of package root are checked. Each immediate subdirectory containing a `SKILL.md` is treated as a skill. Deeper nesting is not searched.

---

### 4. Single SKILL.md at Root

**Detection:** No manifest files, no subdirectory skills, but `SKILL.md` exists at package root.

**Folder structure:**
```
package-root/
├── SKILL.md
└── ...
```

The entire package is a single skill. The skill name comes from the SKILL.md frontmatter `name` field.

---

## Dependency Types

### 1. Registry

```toml
superpowers = "^4.0"
```

**Canonical dependency definition:**
```json
{
  "type": "registry",
  "registry": "skills.supply",
  "name": "superpowers",
  "version": "^4.0"
}
```

**Dedupe keys:** `registry` + `name`

---

### 1b. Registry with Org (Scoped)

```toml
"@obra/superpowers" = "^2.0"
```

**Canonical dependency definition:**
```json
{
  "type": "registry",
  "registry": "skills.supply",
  "org": "obra",
  "name": "superpowers",
  "version": "^2.0"
}
```

**Dedupe keys:** `registry` + `org` + `name`

---

### 1c. Registry with Alias

```toml
sp = { registry = "superpowers", version = "^4.0" }
```

**Canonical dependency definition:**
```json
{
  "type": "registry",
  "registry": "skills.supply",
  "name": "superpowers",
  "version": "^4.0",
  "alias": "sp"
}
```

**Dedupe keys:** `registry` + `name`

---

### 1d. Registry with Org and Alias

```toml
op = { registry = "@obra/superpowers", version = "^2.0" }
```

**Canonical dependency definition:**
```json
{
  "type": "registry",
  "registry": "skills.supply",
  "org": "obra",
  "name": "superpowers",
  "version": "^2.0",
  "alias": "op"
}
```

**Dedupe keys:** `registry` + `org` + `name`

---

### 2. GitHub

```toml
pkg = { gh = "alice/repo" }
```

**Canonical dependency definition:**
```json
{
  "type": "github",
  "gh": "alice/repo",
  "alias": "pkg"
}
```

**Dedupe keys:** `gh`

---

### 3. GitHub with Path

```toml
pkg = { gh = "alice/monorepo", path = "packages/foo" }
```

**Canonical dependency definition:**
```json
{
  "type": "github",
  "gh": "alice/monorepo",
  "path": "packages/foo",
  "alias": "pkg"
}
```

**Dedupe keys:** `gh` + `path`

---

### 4. Git

```toml
pkg = { git = "https://gitlab.com/org/repo.git" }
```

**Canonical dependency definition:**
```json
{
  "type": "git",
  "git": "https://gitlab.com/org/repo.git",
  "alias": "pkg"
}
```

**Dedupe keys:** `git` (normalized URL)

**URL normalization:**
- Remove trailing `.git` for comparison
- Normalize protocol (https preferred)
- Lowercase hostname

---

### 5. Git with Path

```toml
pkg = { git = "https://gitlab.com/org/repo.git", path = "packages/foo" }
```

**Canonical dependency definition:**
```json
{
  "type": "git",
  "git": "https://gitlab.com/org/repo.git",
  "path": "packages/foo",
  "alias": "pkg"
}
```

**Dedupe keys:** `git` + `path`

---

### 6. Local Path

```toml
pkg = { path = "../my-pkg" }
```

**Canonical dependency definition:**
```json
{
  "type": "local",
  "path": "/absolute/resolved/path/to/my-pkg",
  "alias": "pkg"
}
```

**Dedupe keys:** `path` (resolved absolute path)

**Path resolution:** Relative paths are resolved from the directory containing the `skills.toml` file where the package was defined — not from cwd.

---

## Resolution Matrix

How each combination of **Dependency Type × Package Type** resolves to canonical package name, user alias, and installed skill names.

### Package Type: skills.toml Manifest

When a package has a `skills.toml` manifest, the resolution rules are **the same for all dependency types**:

| Field | Rule |
|-------|------|
| **Canonical package name** | From package's `skills.toml`: `name` field, or `org/name` if `org` is present |
| **User alias** | Present if explicit in dependency syntax, otherwise none |
| **Skill prefix** | User alias if present; otherwise canonical package name (with `/` → `-`) |
| **Installed skills** | `{skill-prefix}-{skill-name-from-frontmatter}` |

#### Examples

**Registry (no alias):**
```toml
superpowers = "^4.0"
```
- Canonical: `superpowers` (from `skills.toml`)
- User alias: _(none)_
- Skill prefix: `superpowers`
- Installed: `superpowers-brainstorming`, `superpowers-debugging`

**Registry with org (no alias):**
```toml
"@obra/superpowers" = "^2.0"
```
- Canonical: `obra/superpowers` (from `skills.toml` with `org = "obra"`)
- User alias: _(none)_
- Skill prefix: `obra-superpowers` (slash → hyphen)
- Installed: `obra-superpowers-brainstorming`, `obra-superpowers-debugging`

**Any dependency type with explicit alias:**
```toml
sp = { registry = "superpowers", version = "^4.0" }
pkg = { gh = "alice/tools" }
my-tools = { path = "../local-pkg" }
```
- Canonical: from package's `skills.toml`
- User alias: `sp`, `pkg`, `my-tools` (explicit)
- Skill prefix: = user alias
- Installed: `sp-{skill}`, `pkg-{skill}`, `my-tools-{skill}`

---

### Package Type: Subdirectories with SKILL.md

No manifest — skills are immediate subdirectories containing `SKILL.md`.

#### Registry (1, 1b, 1c, 1d)

**Not Applicable!** — Registry packages require a `skills.toml` manifest for publishing.

#### All Other Dependency Types

For GitHub, Git, and Local Path dependencies (with or without subdirectory path), the resolution rules are the same:

| Field | Rule |
|-------|------|
| **User alias** | Always explicit (required by syntax) |
| **Skill prefix** | = user alias |
| **Installed skills** | `{skill-prefix}-{skill-name-from-frontmatter}` |

#### Examples

**GitHub:**
```toml
tools = { gh = "alice/tools" }
```

Package structure:
```
alice/tools/              ← package root
├── brainstorming/
│   └── SKILL.md
├── debugging/
│   └── SKILL.md
└── README.md             # ignored
```

- User alias: `tools`
- Skill prefix: `tools`
- Installed: `tools-brainstorming`, `tools-debugging`

**GitHub with path (monorepo):**
```toml
utils = { gh = "alice/monorepo", path = "packages/utils" }
```

Package structure:
```
alice/monorepo/           ← repo root
└── packages/
    └── utils/            ← package root (from path)
        ├── formatting/
        │   └── SKILL.md
        └── validation/
            └── SKILL.md
```

- User alias: `utils`
- Skill prefix: `utils`
- Installed: `utils-formatting`, `utils-validation`

---

### Package Type: Single SKILL.md at Root

No manifest, no subdirectory skills — just a single `SKILL.md` at package root. The skill name comes from the SKILL.md frontmatter `name` field.

#### Registry (1, 1b, 1c, 1d)

**Not Applicable!** — Registry packages require a `skills.toml` manifest for publishing.

#### All Other Dependency Types

For GitHub, Git, and Local Path dependencies (with or without subdirectory path), the resolution rules are the same:

| Field | Rule |
|-------|------|
| **User alias** | Always explicit (required by syntax) |
| **Skill prefix** | = user alias |
| **Installed skill** | `{skill-prefix}-{skill-name-from-frontmatter}` |

#### Examples

**GitHub:**
```toml
helper = { gh = "alice/json-formatter" }
```

Package structure:
```
json-formatter/           ← package root
├── SKILL.md              # frontmatter: name = "json-formatter"
└── README.md
```

- User alias: `helper`
- Skill prefix: `helper`
- Installed: `helper-json-formatter`

**Local path:**
```toml
dev = { path = "../my-wip-skill" }
```

Package structure:
```
my-wip-skill/             ← package root
├── SKILL.md              # frontmatter: name = "formatter"
└── README.md
```

- User alias: `dev`
- Skill prefix: `dev`
- Installed: `dev-formatter`

---

## Inheritance & Merge Behavior

### Discovery

sksup discovers `skills.toml` files by walking up the directory tree from cwd, stopping at home directory or filesystem root. The user-level file at `~/.sksup/skills.toml` is always included as the base layer.

### Priority Order (highest to lowest)

1. `./skills.toml` — current directory
2. `../skills.toml` — parent directory
3. `../../skills.toml` — grandparent, etc.
4. _(stops at home directory or filesystem root)_
5. `~/.sksup/skills.toml` — user-level base (always included, lowest priority)

### Merge Behavior

All discovered files are merged into a single resolved manifest. Files are processed in priority order (highest/closest first).

For each package declaration:

1. **Compute dedupe keys** for the dependency type
2. **Check dedupe keys**: If a declaration with the same dedupe keys already exists → skip (same package already claimed by higher priority)
3. **Check user alias**: If the alias already exists but dedupe keys are different → **ERROR** (two different packages cannot share the same alias)
4. Otherwise, add the declaration

**Result:** Each unique package (by dedupe keys) appears once, using the alias and version from the highest-priority file that declared it.

### Example

```
~/.sksup/skills.toml:
    [packages]
    superpowers = "^3.0"
    utils = { gh = "alice/utils" }

~/projects/skills.toml:
    [packages]
    superpowers = "^4.0"

~/projects/myapp/skills.toml:
    [packages]
    my-tools = { path = "../tools" }
```

Running sksup in `~/projects/myapp/` resolves to:

| Alias | Source File | Dedupe Keys |
|-------|-------------|-------------|
| superpowers | ~/projects/skills.toml | `registry: skills.supply`, `name: superpowers` |
| utils | ~/.sksup/skills.toml | `gh: alice/utils` |
| my-tools | ~/projects/myapp/skills.toml | `path: /Users/you/projects/tools` |

---

## Conflict Handling

### Same Package, Different Aliases (Dedupe)

Two declarations with the same dedupe keys = same package. Higher priority wins, lower priority is ignored.

```toml
# ~/.sksup/skills.toml
sp = { gh = "alice/superpowers" }

# ./skills.toml
superpowers = { gh = "alice/superpowers" }  # Same dedupe keys, different alias
```

Result: One package installed using alias `superpowers` (from `./skills.toml`). The `sp` alias is never used.

---

### Same Alias, Different Packages (Error)

Two different packages cannot share the same alias. This is a **hard error**.

```toml
# ~/.sksup/skills.toml
foo = { gh = "alice/foo" }

# ./skills.toml
foo = "^1.0"  # Different package (registry), same alias
```

Result: **ERROR** — alias `foo` refers to two different packages.

### Skill-Level Collisions

After prefixing, skill directory names are unique by construction:

- `superpowers` package, `debugging` skill → `superpowers-debugging`
- `my-tools` package, `debugging` skill → `my-tools-debugging`

No collision possible (different packages = different prefixes).

**Edge case:** Package `my-tools` with skill `cool` and package `my` with skill `tools-cool` would both produce `my-tools-cool`. This is astronomically unlikely. If it occurs, RAISE AN ERROR.

---

## Future Considerations

The following are explicitly out of scope for v1 but may be added later:

- **Lockfile** (`skills.lock`) — Required for reproducible installs and caching. Without pinned versions, we can't safely cache packages (a branch-based dependency might have moved).
- **Caching** — Once we have a lockfile, packages can be cached in `~/.sksup/cache/` using `{canonical-name}/{resolved-version}` as the key.
- **Workspaces** — Monorepo support for managing multiple related packages.
- **Dependency resolution** — Resolving dependencies between skill packages (if packages depend on other packages).
- **Private registries** — Support for registries beyond Skills Supply.
