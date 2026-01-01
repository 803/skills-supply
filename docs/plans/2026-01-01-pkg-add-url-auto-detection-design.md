# Design: `sk pkg add <url>` Auto-Detection

## Problem

Currently, adding a package requires specifying the type explicitly:

```bash
sk pkg add github nathan-gage/ngage-marketplace
sk pkg add git https://github.com/nathan-gage/ngage-marketplace.git
```

Users often have a URL and want `sk` to figure out the right thing to do:

```bash
sk pkg add https://github.com/nathan-gage/ngage-marketplace
```

## Solution Overview

When `sk pkg add` receives a single argument that looks like a URL (instead of `<type> <spec>`), it should:

1. Detect the URL pattern
2. Shallow-clone the repo to a temp directory
3. Inspect the repo contents to determine the highest-precedence package type
4. Create the appropriate declaration in `agents.toml`

## URL Pattern Detection

Recognize these patterns as "auto-detect" mode (no `<type>` argument needed):

| Pattern | Example |
|---------|---------|
| GitHub HTTPS | `https://github.com/owner/repo` |
| GitHub HTTPS with .git | `https://github.com/owner/repo.git` |
| git+ssh (with or without .git) | `git@github.com:owner/repo` or `git@github.com:owner/repo.git` |
| Generic HTTPS ending in .git | `https://gitlab.com/owner/repo.git` |

### Detection Logic

```typescript
function isAutoDetectUrl(input: string): boolean {
  // GitHub HTTPS (with or without .git suffix)
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(input)) return true

  // git+ssh format (with or without .git suffix)
  if (/^git@[^:]+:.+/.test(input)) return true

  // Any HTTPS URL ending in .git
  if (/^https:\/\/.+\.git$/.test(input)) return true

  return false
}
```

## Content Detection Precedence

After shallow-cloning, inspect the repo to determine what kind of package it is. Check in this order (first match wins):

| Priority | Marker File | Detection Type | Declaration Type |
|----------|-------------|----------------|------------------|
| 1 | `agents.toml` | manifest | `github` or `git` |
| 2 | `.claude-plugin/marketplace.json` | marketplace | `claude-plugin` |
| 3 | `.claude-plugin/plugin.json` | plugin | `github` or `git` |
| 4 | `*/SKILL.md` (subdirectories) | subdir | `github` or `git` |
| 5 | `SKILL.md` (root) | single | `github` or `git` |

### Detection → Declaration Mapping

**For `manifest`, `plugin`, `subdir`, `single`:**
- If original URL was GitHub → create `github` declaration (`gh: "owner/repo"`)
- Otherwise → create `git` declaration, preserving original URL format

**For `marketplace`:**
- Always create `claude-plugin` declaration
- Requires reading `marketplace.json` to get plugin list

### URL → Declaration Algorithm

```
1. Trim the URL, remove trailing .git suffix
2. If URL points to github.com (HTTPS or SSH):
   a. Extract owner/repo from path
   b. Return { gh: "owner/repo" } (github declaration)
3. Else (non-GitHub):
   a. Preserve original URL format (SSH stays SSH, HTTPS stays HTTPS)
   b. Return { git: cleanedUrl } (git declaration)
```

**Examples:**

| Input URL | Declaration |
|-----------|-------------|
| `https://github.com/owner/repo` | `{ gh: "owner/repo" }` |
| `https://github.com/owner/repo.git` | `{ gh: "owner/repo" }` |
| `git@github.com:owner/repo.git` | `{ gh: "owner/repo" }` |
| `https://gitlab.com/owner/repo.git` | `{ git: "https://gitlab.com/owner/repo" }` |
| `git@gitlab.com:owner/repo.git` | `{ git: "git@gitlab.com:owner/repo" }` |

**Important:** SSH URLs must be preserved as-is (not converted to HTTPS). See bead `skillssupply-bhk` for the related bug fix in `coerceGitUrl()`.

**Alias derivation:** Extract repo name (last path segment, without `.git`).

## Marketplace Special Case

When the repo is a marketplace (has `.claude-plugin/marketplace.json`):

### marketplace.json Schema

```json
{
  "name": "marketplace-name",
  "plugins": [
    { "name": "plugin-a", "source": "./plugins/plugin-a" },
    { "name": "plugin-b", "source": { "source": "github", "repo": "owner/repo" } }
  ],
  "metadata": {
    "pluginRoot": "./plugins"
  }
}
```

- `name` (required): Marketplace name
- `plugins` (required): Array of plugin entries
  - `name` (required): Plugin name
  - `source` (required): Path string or source object
- `metadata.pluginRoot` (optional): Base path for relative plugin sources

### Selection Flow

1. Parse `marketplace.json` to get the list of plugins
2. **If exactly 1 plugin:** auto-select it, log what's happening
3. **If multiple plugins:** interactive prompt to choose one
4. Create `claude-plugin` declaration:
   ```toml
   # For GitHub marketplace:
   [dependencies.selected-plugin]
   type = "claude-plugin"
   plugin = "selected-plugin"
   marketplace = "owner/repo"

   # For non-GitHub marketplace:
   [dependencies.selected-plugin]
   type = "claude-plugin"
   plugin = "selected-plugin"
   marketplace = "https://gitlab.com/owner/repo"  # full URL
   ```

### Example Flows

**Single plugin marketplace:**
```
$ sk pkg add https://github.com/nathan-gage/ngage-marketplace

ℹ Cloning repository...
ℹ Detected marketplace with 1 plugin: "ngage"
ℹ Auto-selecting plugin: ngage
✓ Added dependency: ngage
```

**Multi-plugin marketplace:**
```
$ sk pkg add https://github.com/example/multi-marketplace

ℹ Cloning repository...
ℹ Detected marketplace with 3 plugins

? Select a plugin to add:
  ❯ plugin-a
    plugin-b
    plugin-c

✓ Added dependency: plugin-a
```

**Direct plugin or skills repo:**
```
$ sk pkg add https://github.com/anthropic/sensei

ℹ Cloning repository...
ℹ Detected plugin package
✓ Added dependency: sensei
```

## CLI Interface Changes

### Current
```
sk pkg add <type> <spec> [options]
```

### New (additive)
```
sk pkg add <type> <spec> [options]   # existing behavior
sk pkg add <url> [options]           # new auto-detect mode
```

The command detects which mode based on argument count and URL pattern matching.

### Options (apply to both modes)
- `--as <alias>` — override the package alias
- `--tag <tag>` — use specific git tag
- `--branch <branch>` — use specific branch
- `--rev <rev>` — use specific commit
- `--path <path>` — subdirectory within repo
- `--global` — use global manifest
- `--init` — create manifest if missing
- `--non-interactive` — fail instead of prompting

## Implementation Approach

### File Structure (Split by Concern)

| File | Responsibility |
|------|----------------|
| `spec.ts` | Add `isAutoDetectUrl()` — URL pattern matching (already handles CLI input parsing) |
| `detect.ts` | Add marketplace detection — content-based detection (already handles "what's in this repo?") |
| **New** `auto-detect.ts` | Orchestration — clone → detect → map to declaration type |

### New File
- `packages/sk/src/core/packages/auto-detect.ts` — orchestration: clones repo, calls detection, returns declaration

### Modified Files
- `packages/sk/src/commands/pkg/spec.ts` — add `isAutoDetectUrl()` for URL pattern matching
- `packages/sk/src/commands/pkg/add.ts` — handle single-argument URL mode, call orchestration
- `packages/sk/src/cli.ts` — change arguments from `<type> <spec>` to `[typeOrUrl] [spec]`
- `packages/sk/src/core/packages/detect.ts` — add marketplace detection (priority 2, before plugin.json)

### Core Functions

**In `spec.ts`:**
```typescript
// Determine if input should trigger auto-detect mode
function isAutoDetectUrl(input: string): boolean
```

**In `detect.ts`:**
```typescript
// Extended detection result (add "marketplace" to existing types)
type DetectionMethod = "manifest" | "marketplace" | "plugin" | "subdir" | "single"
```

**In `auto-detect.ts`:**
```typescript
// Clone repo to temp dir, inspect contents, return PackageSpec
// Returns PackageSpec to integrate with existing pkgAdd() flow
async function autoDetectPackage(url: string, options: AutoDetectOptions): Promise<AutoDetectResult>

interface AutoDetectOptions {
  path?: string        // --path subdirectory
  tag?: string         // --tag
  branch?: string      // --branch
  rev?: string         // --rev
  nonInteractive?: boolean
}

// Returns a PackageSpec (same as buildPackageSpec output) for seamless integration
type AutoDetectResult =
  | { ok: true; packageSpec: PackageSpec }  // reuses existing type from spec.ts
  | { ok: false; error: string }

// For marketplace: prompt or auto-select plugin
async function selectMarketplacePlugin(
  plugins: string[],
  nonInteractive: boolean
): Promise<{ ok: true; plugin: string } | { ok: false; error: string }>
```

**Integration with `pkgAdd()`:** The `autoDetectPackage()` function returns a `PackageSpec`, which is the same type returned by `buildPackageSpec()`. This allows the existing coercion and save logic in `pkgAdd()` to be reused without modification.

## Edge Cases

### No recognized content
If the repo doesn't match any detection pattern:
```
✗ Could not detect package type. No agents.toml, plugin, or skills found.
```

### Non-interactive with multi-plugin marketplace
```
✗ Marketplace has multiple plugins. Run interactively to select which plugin to install.
```

### URL with --path option
The `--path` option already exists and should work with auto-detect:
- Clone the repo
- Inspect contents at the specified subdirectory path
- Detection runs against that subdirectory

### Repo has both marketplace.json and plugin.json
If `.claude-plugin/` contains both files, treat as marketplace (marketplace wins per precedence order).

## Out of Scope

- Registry package auto-detection (e.g., `sk pkg add some-pkg@1.0.0` without type)
- Local path auto-detection (e.g., `sk pkg add ../my-local-pkg`)
- These could be future enhancements but add complexity to argument parsing

## Decisions

1. **Cleanup:** Delete temp clone after detection. `sk sync` will clone again with proper caching.
   - *Rationale:* Matches existing pattern in `sync.ts` — always cleanup in `finally` block.

2. **Alias derivation for marketplace plugins:** Use the plugin name as alias.
   - *Rationale:* Matches current `claude-plugin` behavior.

3. **Non-interactive with multi-plugin marketplace:** Error with clear message.
   - *Message:* "Marketplace has multiple plugins. Run interactively to select which plugin to install."
   - *Rationale:* `--as` is for alias override only, not plugin selection. Don't overload its meaning.

4. **Both marketplace.json and plugin.json:** Marketplace wins.
   - *Rationale:* Follows the precedence order (marketplace is priority 2, plugin is priority 3). Consistent behavior.

5. **agents.toml takes precedence over everything:** If a repo has `agents.toml`, treat as manifest package regardless of other files present.
   - *Rationale:* Follows the precedence order (manifest is priority 1). The manifest is the authoritative declaration.
