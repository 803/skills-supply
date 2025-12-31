# Inheritance Rules Design

> Manifest defines project scope. Global config is separate. No inheritance.

## Problem

Current `discoverManifests` walks up from CWD to home directory (or filesystem root), then appends `~/.sk/package.toml`. This causes:

1. **Reproducibility issues**: Same project on different machines inherits different parent configs
2. **Mental model mismatch**: Claude/Codex already use PROJECT + HOME as separate scopes, not a linear chain
3. **Confusing "global" behavior**: `~/.sk/package.toml` is part of inheritance instead of being user-level only

## Solution

Two completely separate scopes, aligned with npm/cargo/uv model:

| Scope | Discovery | Install target |
|-------|-----------|----------------|
| Local | Walk up to find `package.toml` (project root) | `{project_root}/.{agent}/skills/` |
| Global | `~/.sk/package.toml` only | `~/.{agent}/skills/` |

**Key principles:**
- **Manifest = boundary**: First `package.toml` found walking up is project root
- **No inheritance**: Single manifest per project, no merging
- **Install at project root**: Not CWD, always project root

Claude/Codex handle the merge at runtime. sk just puts files in the right places.

## Discovery Algorithm

### Local Scope (default)

```
findProjectRoot(startDir):
  1. Walk up from startDir looking for package.toml
  2. Stop conditions (in order checked):
     - Found package.toml → return that directory
     - Hit home directory (~) → return null
     - Hit filesystem root (/) → return null
  3. Never walk above home directory

discoverManifest(startDir):
  1. projectRoot = findProjectRoot(startDir)
  2. If projectRoot: return projectRoot/package.toml
  3. Else: return null
```

**Key behaviors**:
- No inheritance, no merging, single manifest
- Home directory is an upper bound (won't find package.toml in /usr/share/something)
- Git is NOT used as a boundary marker
- **First found wins**: In nested scenarios (monorepo), closest package.toml is the project root. Parent manifests are ignored.

### Global Scope (`--global` flag)

```
discoverGlobalManifest():
  - Return ~/.sk/package.toml if exists
  - No inheritance, single file
```

## Examples

### Example 1: At project root

```
~/projects/myapp/
├── package.toml        ← contains "superpowers"
└── src/
```

`sk sync` from `~/projects/myapp/`:
- Discovery: Found `package.toml` in CWD
- Project root: `~/projects/myapp/`
- Install to: `~/projects/myapp/.claude/skills/`

### Example 2: In subdirectory of project

```
~/projects/myapp/
├── package.toml        ← contains "superpowers"
└── src/
    └── lib/            ← no package.toml here
```

`sk sync` from `~/projects/myapp/src/lib/`:
- Discovery: Walk up, find `package.toml` at `myapp/`
- Project root: `~/projects/myapp/`
- **Blocking prompt** (single prompt with warning + choices):
  ```
  ⚠ Found package.toml at ~/projects/myapp/
    Skills will install to ~/projects/myapp/.claude/skills/
    Note: Running claude from ~/projects/myapp/src/lib/ won't find these skills.

  [c] Continue with parent manifest
  [n] Create new package.toml here instead
  [q] Cancel
  ```
- If `c`: Install to `~/projects/myapp/.claude/skills/`
- If `n`: Create `~/projects/myapp/src/lib/package.toml`, install to `~/projects/myapp/src/lib/.claude/skills/`

### Example 3: Nested package.toml (monorepo)

```
~/projects/monorepo/
├── package.toml        ← contains "monorepo-tools"
└── packages/
    └── sub-app/
        ├── package.toml    ← contains "sub-app-tools"
        └── src/
```

`sk sync` from `~/projects/monorepo/packages/sub-app/`:
- Discovery: Found `package.toml` in CWD (first found wins)
- Project root: `~/projects/monorepo/packages/sub-app/`
- Manifest: `sub-app/package.toml` only (monorepo's is ignored)
- Install to: `~/projects/monorepo/packages/sub-app/.claude/skills/`

### Example 4: No package.toml anywhere

```
~/random-folder/
└── subfolder/          ← no package.toml anywhere up to ~
```

`sk sync` from `~/random-folder/subfolder/`:
- Discovery: Walk up, hit home dir, no package.toml found
- **Prompt**: "No package.toml found. Create one here?"
- If yes: Create `~/random-folder/subfolder/package.toml`
- Install to: `~/random-folder/subfolder/.claude/skills/`

### Example 5: Global flag

```
~/projects/myapp/
├── package.toml        ← contains "superpowers"

~/.sk/
└── package.toml        ← contains "global-helpers"
```

`sk sync --global` from anywhere:
- Ignores CWD entirely
- Manifest: `~/.sk/package.toml` only
- Install to: `~/.claude/skills/` (or `~/.codex/skills/` depending on agents)

### Example 6: pkg add from subdirectory

```
~/projects/myapp/
├── package.toml        ← current contents
└── src/
    └── lib/
```

`sk pkg add superpowers` from `~/projects/myapp/src/lib/`:
- Discovery: Walk up, find `package.toml` at `myapp/`
- **Blocking prompt** (single prompt with warning + choices):
  ```
  ⚠ Found package.toml at ~/projects/myapp/
    This will modify ~/projects/myapp/package.toml
    Note: Running claude from ~/projects/myapp/src/lib/ won't find skills installed there.

  [c] Continue with parent manifest
  [n] Create new package.toml here instead
  [q] Cancel
  ```
- If `c`: Modifies `~/projects/myapp/package.toml` (adds superpowers)
- If `n`: Creates `~/projects/myapp/src/lib/package.toml` with superpowers

## Install Locations by Agent

Install location depends on scope + enabled agents:

| Scope | Agent ID | Install location |
|-------|----------|------------------|
| Local | `claude-code` | `{project_root}/.claude/skills/` |
| Local | `codex` | `{project_root}/.codex/skills/` |
| Local | `opencode` | `{project_root}/.config/opencode/skill/` |
| Global | `claude-code` | `~/.claude/skills/` |
| Global | `codex` | `~/.codex/skills/` |
| Global | `opencode` | `~/.config/opencode/skill/` |

If multiple agents enabled, install to all their locations.

## Manifest Structure

A consumer manifest (project using skills) only needs `[agents]` and `[dependencies]`:

```toml
[agents]
claude-code = true

[dependencies]
superpowers = "superpowers-marketplace/superpowers"
```

The `[package]` section is only required for publishable skill packages (name, version required).

## Agent Configuration

### [agents] section

The manifest MAY include an `[agents]` section specifying which agents to install skills for:

```toml
[agents]
claude-code = true
codex = true
opencode = false
```

**Key behaviors:**
- **Optional but explicit**: `[agents]` is not required, but when present, only listed agents receive skills
- **No inheritance**: Agents are defined per-manifest, no merging with global
- **Directory creation**: sk creates agent directories (`.claude/`, `.codex/`, etc.) automatically if they don't exist

### When [agents] is missing

| Mode | Behavior |
|------|----------|
| `sk sync` (interactive) | Show multi-select of auto-detected installed agents. User chooses which to enable. Saves to manifest. |
| `sk sync --non-interactive` | No-op with message: "No agents configured. Run interactively or add [agents] section." Exit 0. |

**Auto-detection populates options, user explicitly enables.** This balances convenience with explicitness.

## Manifest Discovery UX

### Case 1: package.toml found in CWD
- Use it as project root
- Install to `CWD/.{agent}/skills/`

### Case 2: package.toml found in PARENT (not CWD)
- **CRITICAL**: Blocking confirmation required
- Why: Running `sk sync` here installs to parent, but running claude/codex HERE won't find those skills
- **Single prompt with two choices**:
  ```
  ⚠ Found package.toml at ~/projects/myapp/
    Skills will install to ~/projects/myapp/.claude/skills/
    Note: Running claude from ~/projects/myapp/src/lib/ won't find these skills.

  [c] Continue with parent manifest
  [n] Create new package.toml here instead
  [q] Cancel
  ```
- Default is Cancel (q)
- `--non-interactive` flag: Skip prompts, use discovered manifest (for CI/scripting)

### Known gap: Agent skill discovery

Claude/codex look for skills relative to where they're launched, not where package.toml lives. If user:
1. Runs `sk sync` from project root (skills install to `/repo/.claude/skills/`)
2. Runs `claude` from `/repo/src/lib/`

Claude won't find the skills. **This is a known gap.**

**Warning behavior**: Anytime a command (sync, pkg add, pkg remove) runs from a subdirectory (CWD != project_root), print a warning:
```
⚠ Skills installed to ~/projects/myapp/.claude/skills/
  Run claude from ~/projects/myapp/ to use them.
```

This covers Case 2 and any scenario where the user might be confused about where skills landed.

### Case 3: No package.toml found anywhere
- Prompt: "No package.toml found. Create one here? [y/N]"
- Default is No (safe default)
- If yes: CWD becomes the new project root

### Command behavior table

| Command | Target location | Behavior when missing |
|---------|-----------------|----------------------|
| `sk sync` | Project root | Case 2 or 3 above |
| `sk sync --global` | `~/.sk/package.toml` | Prompt to create |
| `sk pkg add <dep>` | Project root | Case 2 or 3 above |
| `sk pkg add --global <dep>` | `~/.sk/package.toml` | Prompt to create |
| `sk pkg remove <dep>` | Project root | Error if no project found |
| `sk pkg remove --global <dep>` | `~/.sk/package.toml` | Error if missing |

## Command Behavior

### `sk sync`

```
sk sync:
  1. projectRoot = findProjectRoot(cwd)
  2. If projectRoot found in PARENT (not CWD):
       - Show single prompt with warning + choices (c/n/q)
       - If 'c': use discovered projectRoot
       - If 'n': create package.toml at CWD, use CWD as projectRoot
       - If 'q': exit
  3. If no projectRoot found:
       - Prompt: "No package.toml found. Create one here? [y/N]"
       - Default is No (safe default)
       - If yes: create package.toml at CWD
  4. manifest = loadManifest(projectRoot/package.toml)
  5. For each enabled agent:
       installTo(projectRoot/.{agent}/skills/, manifest.dependencies)

sk sync --global:
  1. manifest = discoverGlobalManifest()
  2. If not exists → prompt to create ~/.sk/package.toml
  3. For each enabled agent:
       installTo(~/.{agent}/skills/, manifest.dependencies)

sk sync --non-interactive:
  - Skip all prompts
  - Use discovered manifest (including parent if found there)
  - Error if no manifest found (CI should ensure manifest exists)
  - Error if no agents configured in manifest

Empty manifest behavior:
  - If manifest has zero dependencies AND no previously-installed skills: print "No dependencies to sync" and exit
  - If manifest has zero dependencies BUT skills were previously installed: remove all orphaned skills (sync = make installed match manifest)
  - Don't create empty .claude/skills/ directories if nothing to install

Orphan removal:
  - Remove skills from .{agent}/skills/ that are no longer in manifest
  - Like npm prune - sync means "make installed match manifest"

Partial failure handling:
  - Each skill install is atomic and independent
  - Successfully installed skills are kept
  - Failed skills are reported, can be retried with next sync
  - Exit code non-zero if any skill failed

sk sync --dry-run:
  - Show what would be installed/removed without making changes
  - Useful for previewing sync before committing
```

### `sk pkg add/remove`

```
sk pkg add <dep>:
  - Find project root (walk up to package.toml)
  - If projectRoot found in PARENT (not CWD):
      - Show single prompt with warning + choices (c/n/q) - same as sync
      - If 'c': modify discovered manifest
      - If 'n': create package.toml at CWD with the dependency
      - If 'q': exit
  - If projectRoot in CWD: modify that package.toml
  - If no project found: prompt to create at CWD

sk pkg add --non-interactive <dep>:
  - Skip prompts, use discovered manifest
  - If manifest in parent: use it silently (like npm from subdirs)
  - Error if no manifest found (use --init to create one)

sk pkg add --init <dep>:
  - If no project found: create package.toml at CWD (no prompt)
  - Created manifest has empty [agents] and [dependencies] sections
  - Useful for: sk pkg add --non-interactive --init superpowers

sk pkg add --global <dep>:
  - Target: ~/.sk/package.toml
  - If missing: prompt "Create ~/.sk/package.toml? [y/N]" (consistent with local behavior)

sk pkg remove <dep>:
  - Find project root, modify that package.toml
  - If projectRoot found in PARENT: same blocking confirmation as add
  - Error if no project found

sk pkg remove --non-interactive <dep>:
  - Skip prompts, use discovered manifest
  - If manifest in parent: use it silently (like npm from subdirs)
  - Error if no manifest found

sk pkg remove --global <dep>:
  - Target: ~/.sk/package.toml
  - Error if manifest missing
```

### `sk init`

```
sk init:
  - Create package.toml in CWD with:
    - [agents] section (prompt with auto-detected options)
    - Empty [dependencies] section
    - NO [package] section (optional, user adds if publishing)
  - Error if package.toml already exists in CWD

sk init --global:
  - Create ~/.sk/package.toml with:
    - [agents] section (prompt with auto-detected options)
    - Empty [dependencies] section
  - Error if ~/.sk/package.toml already exists

sk init --agents claude-code,codex:
  - Specify which agents to enable (comma-separated)
  - Validates agent IDs before creating manifest
  - Invalid agent ID → error with list of valid agents (claude-code, codex, opencode)
  - Can combine with --non-interactive and/or --global

sk init --non-interactive:
  - Create package.toml with:
    - Empty [dependencies] section
    - No [agents] section (unless --agents provided)
    - No [package] section
  - No prompts

Example CI usage:
  sk init --non-interactive --agents claude-code
  sk init --global --non-interactive --agents claude-code
```

### `sk status`

Out of scope for this design. Will be addressed separately.

## Exit Codes

Simple binary exit codes:
- **0**: Success
- **1**: Any failure (user error, system error, partial failure)

Error messages provide details; exit code just indicates success/failure.

## State Tracking

sk tracks which skills it has installed to enable orphan removal (removing skills that are no longer in the manifest).

### State file location

| Scope | Location |
|-------|----------|
| Local | `{project_root}/.{agent}/.sk-state.json` |
| Global | `~/.{agent}/.sk-state.json` |

Each agent has its own state file at its root directory (not inside skills/).

### State file contents

```json
{
  "version": 1,
  "skills": ["superpowers", "my-skill"],
  "updated_at": "2025-12-31T12:00:00Z"
}
```

### Orphan removal behavior

On `sk sync`:
1. Read current state file to get list of sk-installed skills
2. If no state file exists: skip orphan removal (only add new skills)
3. Compare with manifest dependencies
4. Remove skills that are in state but not in manifest
5. Update state file with new list

This allows sk to safely remove skills it installed without affecting manually-added skills.

**Missing state file**: When state file doesn't exist (first sync, or user has manually-managed skills), sk will only install new skills and create the state file. It won't remove anything since it can't know what it previously installed.

## Future Considerations

### Lockfile

Other package managers have lockfiles (package-lock.json, Cargo.lock, uv.lock) for reproducible installs. sk does not have a lockfile yet.

**Status**: Deferred. Design should not preclude adding a lockfile later, but don't implement now.

## Implementation Changes

### `agents/registry.ts`

Current behavior:
- All agent paths are hardcoded to global (`~/`) locations only
- `AgentDefinition.skillsPath` is a single string

New behavior:
- Agent registry provides base paths (`.claude`, `.codex`, `.config/opencode`)
- Install logic computes: `{project_root}/{agentBasePath}/skills/` for local scope
- Keep `~/{agentBasePath}/skills/` for global scope
- Add `detectInstalledAgents()` function to check which agent CLIs are installed (for populating interactive prompts)

### `discover.ts`

Current behavior:
- Walks up to `homeDir` or filesystem root
- Always appends `~/.sk/package.toml`
- Collects multiple manifests for merging

New behavior:
- Walk up looking for `package.toml` (not `.git/`)
- Stop at home directory or filesystem root
- Return single manifest (first found), no inheritance
- Never include `~/.sk/package.toml` in local discovery
- Add separate `discoverGlobalManifest()` function

### New utility: `findProjectRoot()`

```typescript
async function findProjectRoot(startDir: string): Promise<string | null> {
  // Walk up from startDir looking for package.toml
  // Stop at ~ or /
  // Return the directory containing package.toml, or null if not found
}
```

Replaces the git-based approach. Can reuse traversal patterns from current `discoverManifests()`.

### Remove: `mergeManifests()`

No longer needed - single manifest per project, no merging.

### Commands needing `--global` flag

- `sync.ts`
- `pkg/add.ts`
- `pkg/remove.ts`
- `init.ts`

### Commands needing `--non-interactive` flag

- `sync.ts`
- `pkg/add.ts`
- `pkg/remove.ts`
- `init.ts`

### Commands needing `--agents` flag

- `init.ts` (specifies which agents to enable, comma-separated)

### Commands needing `--init` flag

- `pkg/add.ts` (creates manifest if none found, for CI use with `--non-interactive`)

### New command: `init.ts`

- Create new `sk init` command for project initialization

### UX changes in commands

- Add blocking confirmation when package.toml found in parent (not CWD)
- Add prompt to create package.toml when none found

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Symlinked directories | Follow symlinks normally during traversal |
| Permission denied on parent dir | Error: "Cannot access parent directory. Check permissions." |
| `package.toml` is a directory | Error: "package.toml exists but is not a file" |
| Home directory has `package.toml` | Valid project root (not treated specially) |
| Running from `~` itself | Check for `~/package.toml`, stop there |
| Nested manifests (monorepo) | First found wins - closest to CWD is project root |
| Empty `package.toml` | Valid manifest with no dependencies |
| `~/.sk/package.toml` during local discovery | Ignored - only used with `--global` |
| No `[agents]` section | Interactive: prompt with auto-detected options. Non-interactive: no-op with message. |

## Related Work

- `skillssupply-5ib`: Add --global flag to pkg add/remove (this design supersedes/expands that issue)
