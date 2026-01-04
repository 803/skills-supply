# Skills Supply Specification

> Authoritative behavioral specification for the skills-supply package system.

## Type Definitions

### Branded Types

```typescript
type NonEmptyString = string & { readonly __brand: "NonEmptyString" }
type AbsolutePath = string & { readonly __brand: "AbsolutePath" }
type GitUrl = string & { readonly __brand: "GitUrl" }           // Git repository URL (https://github.com/..., git@github.com:...)
type GithubRef = string & { readonly __brand: "GithubRef" }     // "owner/repo" format
type RemoteMarketplaceUrl = string & { readonly __brand: "RemoteMarketplaceUrl" }  // Direct URL to a hosted marketplace.json (e.g., https://example.com/marketplace.json)
type Alias = string & { readonly __brand: "Alias" }             // Package alias (no slashes/dots)
```

### Declaration Pipeline

**Stage 1: Raw (user input)**

```typescript
type RawDeclaration =
  | string  // "owner/repo" shorthand or "package-name@version" for registry
  | { gh: string; tag?: string; branch?: string; rev?: string; path?: string }
  | { git: string; tag?: string; branch?: string; rev?: string; path?: string }
  | { registry: string; version?: string }
  | { path: string }  // Local path (absolute or relative)
  | { type: "claude-plugin"; plugin: string; marketplace: string }
```

**Stage 2: Validated (guaranteed structure)**

```typescript
type ValidatedDeclaration =
  | { type: "github"; gh: GithubRef; ref?: GitRef; path?: NonEmptyString }
  | { type: "git"; url: GitUrl; ref?: GitRef; path?: NonEmptyString }
  | { type: "registry"; name: NonEmptyString; org?: NonEmptyString; version: NonEmptyString }
  | { type: "local"; path: AbsolutePath }
  | { type: "claude-plugin"; plugin: NonEmptyString; marketplace: GithubRef | GitUrl | AbsolutePath | RemoteMarketplaceUrl }

type GitRef =
  | { type: "tag"; value: NonEmptyString }
  | { type: "branch"; value: NonEmptyString }
  | { type: "rev"; value: NonEmptyString }
```

Note: Using `?` (optional) rather than `| null` matches the codebase convention and avoids storing nulls.

## Detection Priority

### sk add auto-detect flow (Authoritative Reference)

When a user runs `sk add <target>` or `sk pkg add <target>`, the system auto-detects what type of declaration to create.

**Supported target types:**

| Target type | Example | How it's identified |
|-------------|---------|---------------------|
| `GithubRef` | `owner/repo` | Matches `owner/repo` pattern (no protocol, no `.git`) |
| `GitUrl` | `https://github.com/owner/repo.git`, `git@github.com:owner/repo.git` | Git protocol URL or `.git` suffix |
| `AbsolutePath` | `/path/to/package`, `./relative/path` | Starts with `/`, `./`, or `../` |
| `RemoteMarketplaceUrl` | `https://example.com/marketplace.json` | HTTP(S) URL ending in `marketplace.json` |

---

#### Branch 1: RemoteMarketplaceUrl target

When the target is a `RemoteMarketplaceUrl` (direct URL to a hosted marketplace.json file):

- **No detection needed** — we already know it's a marketplace
- **Action**: Fetch and parse the marketplace.json, show user the list of plugins, user selects one or more
- **Declaration type**: `claude-plugin` (one per selected plugin)
- **marketplace field**: the `RemoteMarketplaceUrl`
- **plugin field**: name from the selected marketplace.json entry

This is the simplest path — no cloning, no structure detection.

---

#### Branch 2: GithubRef, GitUrl, or AbsolutePath target

When the target is a `GithubRef`, `GitUrl`, or `AbsolutePath`:

1. **For remote targets** (`GithubRef`, `GitUrl`): Clone the repo
2. **For local targets** (`AbsolutePath`): Use the path directly
3. **Run structure detection** on the target location
4. **Apply priority order** (see below)

Detection follows this **strict priority order**:

---

**Priority 1: agents.toml with [package] section**

- **Detection**: `agents.toml` file exists AND contains a `[package]` section
- **Action**: Direct add
- **Declaration type**: `github`, `git`, or `local` (depending on target type)
- **Rationale**: A manifest with `[package]` is the most explicit package declaration—it declares "this repo IS a package with this metadata"

---

**Priority 2: plugin.json + marketplace.json both exist**

- **Detection**: Both `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` exist
- **Action**: Check if the plugin defined in `plugin.json` belongs to the `marketplace.json`
  - **Case A: Plugin belongs to marketplace** (plugin name from `plugin.json` matches one of the entries in `marketplace.json`)
    - Add as `claude-plugin` declaration
    - `marketplace` field = the target (`GithubRef`, `GitUrl`, or `AbsolutePath`)
    - `plugin` field = the plugin name from the matching `marketplace.json` entry
  - **Case B: Plugin does NOT belong to marketplace** (plugin.json defines a plugin not listed in marketplace.json)
    - This is ambiguous—we don't know which marketplace owns this plugin
    - **Prompt user** to choose one of:
      1. **Select plugin(s) from marketplace.json** → Add each selected as `claude-plugin` declaration(s) (marketplace = this target, plugin = selected name)
      2. **Add as github/git/local** → Add as `github`, `git`, or `local` declaration (not `claude-plugin`)
      3. **Find external marketplace** → User provides the marketplace URL that contains this plugin → Add as `claude-plugin` declaration
- **Declaration type**: `claude-plugin` (Case A), or user-selected type (Case B)
- **Rationale**: When both exist and match, we know this location is both a plugin AND hosts its own marketplace—`claude-plugin` ensures claude-code agent compatibility

---

**Priority 3: marketplace.json only**

- **Detection**: `.claude-plugin/marketplace.json` exists but `.claude-plugin/plugin.json` does NOT exist
- **Action**: Parse marketplace.json, show user the list of plugins, user selects one or more
- **Declaration type**: `claude-plugin` (one per selected plugin)
- **marketplace field**: the target (`GithubRef`, `GitUrl`, or `AbsolutePath`)
- **plugin field**: name from the selected marketplace.json entry
- **Rationale**: A marketplace without a local plugin.json is a pure plugin registry—user chooses which plugins to install

---

**Priority 4: plugin.json only**

- **Detection**: `.claude-plugin/plugin.json` exists but `.claude-plugin/marketplace.json` does NOT exist
- **Action**: Cannot add as `claude-plugin` (no marketplace info). **Prompt user** to choose:
  1. **Add as github/git/local** → Add as `github`, `git`, or `local` declaration
  2. **Find external marketplace** → User provides the marketplace URL → Add as `claude-plugin` declaration
- **Declaration type**: User decides (`github`/`git`/`local` or `claude-plugin`)
- **Rationale**: A standalone plugin.json cannot be installed via claude-code's native plugin flow (which requires a marketplace). The plugin likely exists in a marketplace elsewhere.

---

**Priority 5: Subdir structure**

- **Detection**: In the root (or specified subpath), there are one or more **direct subdirectories** (not nested) that each contain a `SKILL.md` file with valid frontmatter
- **Action**: Direct add
- **Declaration type**: `github`, `git`, or `local` (depending on target type)
- **Package structure**: `subdir`
- **Rationale**: This is the "skills package" pattern—a directory of related skills

---

**Priority 6: Single skill**

- **Detection**: In the root (or specified subpath), there is a `SKILL.md` file with valid frontmatter
- **Action**: Direct add
- **Declaration type**: `github`, `git`, or `local` (depending on target type)
- **Package structure**: `single`
- **Rationale**: A single skill is the simplest package type

---

**Important constraints:**

- **Marketplace subpath limitation (remote targets only)**: For `claude-plugin` declarations with `GithubRef` or `GitUrl` marketplace, the marketplace MUST be at the repo root. Claude-code's native plugin install does not support marketplace.json at subpaths. If user provides a remote URL with a subpath and detection finds marketplace.json at that subpath, this is an error—cannot create a valid `claude-plugin` declaration.
- **Local paths can have marketplace at any depth**: Unlike remote targets, `AbsolutePath` targets can point directly to a directory containing `.claude-plugin/marketplace.json` at any depth. The `AbsolutePath` becomes the marketplace field directly.
- **Declaration type vs package structure**: Declaration type (`github`, `git`, `local`, `claude-plugin`) describes HOW to fetch/access the package. Package structure (`manifest`, `plugin`, `subdir`, `single`) describes WHAT the package contains. These are orthogonal.

---

**Summary table (Branch 2 only — GithubRef, GitUrl, AbsolutePath targets):**

| Priority | Detection | User interaction | Declaration type |
|----------|-----------|------------------|------------------|
| 1 | agents.toml + [package] | None (direct add) | `github` / `git` / `local` |
| 2a | plugin.json + marketplace.json (plugin belongs) | None (direct add) | `claude-plugin` |
| 2b | plugin.json + marketplace.json (plugin doesn't belong) | Choose: marketplace plugins / direct / find marketplace | User decides |
| 3 | marketplace.json only | Select plugin(s) from list | `claude-plugin` |
| 4 | plugin.json only | Choose: direct / find marketplace | User decides |
| 5 | subdir (SKILL.md in subdirs) | None (direct add) | `github` / `git` / `local` |
| 6 | single (SKILL.md at root) | None (direct add) | `github` / `git` / `local` |

**Marketplace field by target type (for `claude-plugin` declarations):**

| Target type | Marketplace field type | Example |
|-------------|----------------------|---------|
| `GithubRef` | `GithubRef` | `"anthropics/claude-code"` |
| `GitUrl` | `GitUrl` | `"https://github.com/anthropics/claude-code.git"` |
| `AbsolutePath` | `AbsolutePath` | `"/Users/dev/my-marketplace"` |
| `RemoteMarketplaceUrl` | `RemoteMarketplaceUrl` | `"https://example.com/marketplace.json"` |

**sk sync flow** (extracting skills from already-fetched package):

| Structure | Skill extraction behavior |
|-----------|--------------------------|
| manifest | Discover skills from configured auto_discover.skills path |
| plugin | Discover skills from plugin's skills directory |
| subdir | Discover skills from direct-descendant subdirs in the cwd |
| single | Extract the single skill directly |

**discovery scan flow** (what to index):

| Priority | Condition | Action | Indexed as |
|----------|-----------|--------|------------|
| 1 | marketplace in list | Index each plugin listed | N × `claude-plugin` |
| 2 | plugin only (no marketplace) | **SKIP** - exists in a marketplace somewhere | — |
| 3 | manifest with `[package]` | Index the package | `github` |
| 4 | subdir | Index the parent directory as one package | 1 × `github` |
| 5 | single | Index the skill | 1 × `github` |

#### Why These Priorities? (sk add)

**Priority 1: Manifest with [package] section** because:
- A manifest (`agents.toml` with `[package]`) is the most explicit package declaration
- It contains all metadata needed: name, version, description, agent compatibility
- If a repo has a manifest, that's the authoritative definition of what it is

**Priority 2: Plugin + marketplace together** because:
- When both exist AND the plugin belongs to the marketplace, the repo IS a plugin AND hosts its own marketplace
- Using `claude-plugin` type ensures claude-code agent compatibility (native install)
- The marketplace field points to THIS repo; plugin name comes from the matched marketplace.json entry
- When both exist BUT the plugin doesn't belong, it's ambiguous—user must decide

**Priority 3: Marketplace only** because:
- A pure marketplace (no local plugin.json) is a plugin registry
- User browses available plugins and selects which to install
- Each selection becomes a `claude-plugin` declaration

**Priority 4: Plugin only** because:
- A standalone plugin.json cannot be installed via claude-code native flow (requires marketplace)
- The plugin likely exists in a marketplace *somewhere*—but we don't know where
- User can either: (a) add as github/git for non-claude-code agents, or (b) find the marketplace

**Priority 5-6: Subdir/single** because:
- These are the "raw skills" patterns—no claude-code plugin infrastructure
- Direct github/git declaration is the only option

### sk sync flow (Authoritative Reference)

`sk sync` reads the user's manifest (`agents.toml`) and installs all declared dependencies. The flow is organized by **declaration type** (what's declared in the manifest), not by package structure.

```
User manifest (agents.toml)
  → @skills-supply/agents-toml.parse() → AgentsTomlOutput
  → adaptManifest() → ManifestInfo { dependencies: Map<Alias, ValidatedDeclaration> }
  → sk adds origin → Manifest (with discoveredAt context)
  → for each declaration, branch by type (see below)
  → install extracted skills (sk-specific)
```

---

#### Reusable Skills Extraction Processes

Before describing each declaration type, we define two reusable extraction processes:

**claude-plugin-skills-extraction-process:**
Given a fetched plugin directory (containing `.claude-plugin/plugin.json`):
1. Parse the plugin manifest
2. Discover skills from the `./skills` subdirectory (convention-based, not configurable)
3. Extract skills from paths

**manifest-skills-extraction-process:**
Given a fetched package directory (containing `agents.toml` with `[package]` section):
1. Parse the manifest to determine auto-discovery configuration
2. Discover skills from `[exports.auto_discover.skills]` path, or fallback to defaults
3. Extract skills from paths

These processes are referenced multiple times below.

---

#### Declaration Type 1: registry

**Status**: Unimplemented.

When implemented, this will be the simplest flow — fetch from a package registry by name/version.

---

#### Declaration Type 2: claude-plugin

A `claude-plugin` declaration specifies a plugin name and a marketplace source.

**The flow depends on which agent is being synced:**

**For claude-code agent:**
- Use Claude's built-in native plugin install commands
- sk does NOT extract skills — Claude handles everything internally
- This is a pass-through: sk tells claude-code to install the plugin, done

**For all other agents (codex, opencode, factory, etc.):**
- sk must extract skills itself using the **two-phase download** process:

Phase 1: Download and parse marketplace
1. Fetch the marketplace
2. Parse .claude-plugin/marketplace.json to find available plugins
3. Locate the requested plugin and resolve its source location

Phase 2: Download plugin and extract skills
1. Fetch the resolved plugin location
2. Apply **claude-plugin-skills-extraction-process** (defined above)

**Why the difference?**
- claude-code has native plugin support — it knows how to install plugins from marketplaces directly
- Other agents don't understand plugins — they only understand skills
- For other agents, sk must "unwrap" the plugin to extract the underlying skills

---

#### Declaration Type 3: github / git / local

These three declaration types share the same flow (differing only in how the package is fetched):
- `github`: Clone from GitHub using gh-shorthand
- `git`: Clone from any git URL
- `local`: Use local path directly (symlink or copy)

**Flow:**

```
Step 1: Fetch the package
  → apply subpath (if declared) and gitref (if declared, for github/git)
  → fetch/access the package directory

Step 2: Detect all matching package structures
  → apply priority order to select ONE structure (see below)

Step 3: Extract skills based on detected structure
  → use the appropriate extraction method for the selected structure
```

**Structure detection priority order (highest to lowest):**

| Priority | Detection | Action |
|----------|-----------|--------|
| 1 | `agents.toml` with `[package]` section | Apply **manifest-skills-extraction-process** |
| 2 | `.claude-plugin/plugin.json` exists | Apply **claude-plugin-skills-extraction-process** |
| 3 | Subdirectories with `SKILL.md` files | Extract all skills from subdirectories |
| 4 | Single `SKILL.md` at root | Extract the single skill |

**Detailed breakdown:**

**Priority 1: agents.toml with [package] section**
- **Detection**: `agents.toml` file exists AND contains a `[package]` section
- **Action**: This is an installable package with explicit metadata
- **Extraction**: Apply **manifest-skills-extraction-process**
- **Rationale**: Most explicit — the package author declared this as a distributable package

**Priority 2: .claude/plugin.json exists**
- **Detection**: `.claude-plugin/plugin.json` file exists
- **Action**: This is a Claude plugin structure
- **Extraction**: Apply **claude-plugin-skills-extraction-process**
- **Rationale**: Plugin structure is explicit and well-defined
- **Note**: This reuses the same extraction logic as claude-plugin declarations for non-claude-code agents

**Priority 3: Subdirectories with SKILL.md files**
- **Detection**: One or more direct subdirectories (not nested) contain a `SKILL.md` file with valid frontmatter
- **Action**: This is a "skills package" — a directory of related skills
- **Extraction**: Discover skills from direct-descendant subdirs in the cwd
- **Rationale**: Convention-based detection for multi-skill packages

**Priority 4: Single SKILL.md at root**
- **Detection**: A `SKILL.md` file with valid frontmatter exists at the package root
- **Action**: This is a single-skill package
- **Extraction**: Extract the skill directly from the root
- **Rationale**: Simplest case — one skill, no subdirectories

**Error case: marketplace.json without plugin.json**
- **Detection**: `.claude-plugin/marketplace.json` exists but `.claude-plugin/plugin.json` does NOT exist
- **Action**: **ERROR** — A github/git/local declaration cannot install from a marketplace
- **Rationale**: The declaration doesn't specify which plugin to install. If you want plugins from a marketplace, use a `claude-plugin` declaration with the plugin name.

---

#### Summary Table

| Declaration type | Agent | Flow |
|-----------------|-------|------|
| `registry` | all | Unimplemented |
| `claude-plugin` | claude-code | Native install (pass-through to Claude) |
| `claude-plugin` | other agents | Two-phase download → claude-plugin-skills-extraction-process |
| `github` / `git` / `local` | all | Fetch → detect structure → extract skills (priority order above) |

**Key insight**: The detection logic from `sk add` (auto-detect) is reused here to determine package structure for github/git/local declarations. The same priority concepts apply, but the outcome is different:
- In `sk add`: we're deciding what declaration type to CREATE
- In `sk sync`: we're deciding how to EXTRACT SKILLS from an already-declared package

### discovery scan flow (Authoritative Reference)

Discovery scans repos to create a searchable INDEX of installable packages. Each indexed record represents something a user can install with `sk add`.

---

#### Algorithm (for Github repositories)

For each repo to be indexed:

```
PHASE 1: Check repo root for primary package types (apply BOTH rules together)

  Rule A: Marketplace at root
    → if .claude-plugin/marketplace.json exists at repo root:
        → parse marketplace.json to get list of plugins
        → for EACH plugin in the list:
            → create an IndexedPackage record with:
                - declaration type: `claude-plugin`
                - marketplace: GithubRef
                - plugin: the plugin name from marketplace.json
                - metadata: from marketplace.json entry (name, description, keywords, etc.)
        → add all to results list

  Rule B: Manifest with [package] at root
    → if agents.toml exists at repo root AND contains [package] section:
        → create an IndexedPackage record :
            - declaration type of: `github`
            - gh: the repo reference (owner/repo) (GithubRef)
            - metadata: from [package] section (name, version, description, license, org)
        → add to results list

  IMPORTANT: Apply BOTH rules. A repo can have both a marketplace AND a manifest package.
             Combine the results from both into one list.

  → if results list has 1 or more packages: STOP. Indexing of this repo is complete.
  → if results list has 0 packages: continue to Phase 2.


PHASE 2: Recursive scan for skills (only if Phase 1 found nothing)

  Starting from repo root, recursively scan directories:

  For each directory:
    → check if dir matches SUBDIR pattern:
        (one or more direct subdirectories contain SKILL.md with valid frontmatter)

      → if YES:
          → create an IndexedPackage record with:
              - declaration type: `github`
              - gh: the repo reference (GithubRef)
              - path: relative path to this directory
              - metadata: aggregated from SKILL.md frontmatters or directory name
          → add to results list
          → DO NOT recurse into this directory's children (subdir pattern "claims" this directory)
          → return

      → if NO:
          → check if dir contains a single SKILL.md at its root:

            → if YES:
                → create an IndexedPackage record with:
                    - declaration type: `github`
                    - gh: the repo reference (GithubRef)
                    - path: relative path to this directory
                    - metadata: from SKILL.md frontmatter (name, description)
                → add to results list
                → return

            → if NO:
                → recurse into each subdirectory

  → store all results in database
```

---

#### What Gets Indexed (Summary)

| Detection | Location | Records created | Declaration type |
|-----------|----------|-----------------|------------------|
| marketplace.json | repo root only | N (one per plugin) | `claude-plugin` |
| agents.toml + [package] | repo root only | 1 | `github` |
| subdir pattern | anywhere (Phase 2) | 1 per matching dir | `github` with path |
| single SKILL.md | anywhere (Phase 2) | 1 per matching dir | `github` with path |

---

#### What Gets SKIPPED (Explicitly)

**plugin.json only (no marketplace.json):**
- **Detection**: `.claude-plugin/plugin.json` exists but `.claude-plugin/marketplace.json` does NOT exist
- **Action**: **SKIP — do not index**
- **Rationale**: This plugin exists in a marketplace *somewhere*. Indexing it here would create duplicates. It will be indexed when we scan its containing marketplace.
- **Note**: This case is implicitly skipped because Phase 1 only checks for marketplace.json and agents.toml with [package]. A repo with only plugin.json will fall through to Phase 2, where plugin.json is not checked.

**marketplace.json at subpath (not root):**
- **Detection**: `.claude-plugin/marketplace.json` exists but NOT at repo root
- **Action**: **SKIP — do not create claude-plugin declarations**
- **Rationale**: `claude-plugin` declarations require `marketplace: GithubRef | GitUrl` with no path component. A subpath marketplace cannot be expressed.

**agents.toml WITHOUT [package] section:**
- **Detection**: `agents.toml` exists but has no `[package]` section
- **Action**: **SKIP — do not index**
- **Rationale**: This is a private project config, not a publishable package. The manifest's `[dependencies]` are NOT indexed — those repos get indexed when discovery scans *them* directly.

---

#### Metadata Sources

| Detection | Source |
|-----------|--------|
| marketplace.json | marketplace.json entry (name, description, keywords, version, author, etc.) |
| agents.toml + [package] | [package] section (name, version, description, license, org) |
| subdir pattern | Aggregated from SKILL.md frontmatters or directory name |
| single SKILL.md | SKILL.md frontmatter (name, description) |

**Uniform marketplace handling:**
- Discovery reads ONLY marketplace.json, never plugin.json for individual plugins
- Metadata comes from the marketplace.json entry only
- Plugin sources are recorded as-is — NO cloning for remote sources, NO reading plugin.json even for local sources
- This is uniform: all plugin sources treated the same regardless of local vs remote
- At install time, sk reads the real plugin.json anyway

---

#### Key Design Decisions

**Why marketplace and manifest can coexist:**
- A repo might be BOTH a marketplace (distributing multiple plugins) AND a package (with its own skills)
- These are not mutually exclusive — index both

**Why Phase 1 stops if anything found:**
- If a repo has a marketplace or manifest at root, that's the authoritative declaration of what this repo offers
- Don't also scan for loose skills — the author has explicitly declared the package structure

**Why recursion only in Phase 2:**
- Phase 1 handles "proper" packages (marketplace, manifest)
- Phase 2 handles "loose" skills that aren't formally packaged
- This supports both well-structured repos and simple skill collections

**Why subdir pattern "claims" a directory:**
- If a directory matches the subdir pattern, its children are skills, not separate packages
- Don't recurse into children — they're part of this package

---

### Notes on detection flows

**Critical distinction between sk and discovery:**

| App | Manifest section used | Why |
|-----|----------------------|-----|
| **sk** | `[dependencies]` | Needs to fetch and install what the manifest depends on |
| **discovery** | `[package]` | Needs to index what this repo offers as an installable package |

Discovery does NOT index dependencies. Dependencies are external references to other repos—those repos get indexed when discovery scans *them* directly. Indexing dependencies would create duplicates and use stale/incomplete metadata (the dependency's own repo is the source of truth).

---

## Claude-Plugin Two-Stage Fetch

The `claude-plugin` type is an indirection layer requiring two fetches:

1. **Fetch marketplace**: Download the marketplace repository (or use local path)
2. **Parse marketplace**: Read marketplace.json to find the requested plugin entry
3. **Resolve plugin source**: Follow the source reference defined in the marketplace entry (marketplace.json defines its own source format)
4. **Fetch plugin**: Download from the resolved location
5. **Extract skills**: Discover skills from the plugin's `./skills` subdirectory

**Structural guarantee**: A resolved plugin's `./skills` directory MUST match the SUBDIR detection pattern — at least one direct subdirectory contains a SKILL.md file with valid frontmatter.

**Important notes**:

- **No type conversion**: A `claude-plugin` declaration remains `claude-plugin` throughout the resolution process. We do not "unwrap" or convert it to `github`/`git`/`local` declarations.

- **Plugin sources are opaque**: The source references in marketplace.json follow their own schema defined by Claude plugins. They do not need to conform to our `GithubRef`, `GitUrl`, or other branded types — marketplace.json data structures are their own.

- **Skills extraction is predictable**: Regardless of how the plugin source is defined in marketplace.json, the skills extraction always follows the same pattern: discover skills from the `./skills` subdirectory using SUBDIR detection logic.
