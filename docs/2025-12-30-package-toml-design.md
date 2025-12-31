# agents.toml Design (sk)

Date: 2025-12-30
Status: Validated (Brainstorming)

## Summary

We will replace `skills.toml` with a single `agents.toml` manifest that serves both consumers and package authors. The schema is Cargo-inspired: `[package]` contains author metadata, while `[dependencies]` always defines install targets. For v1, exports only support auto-discovery of skills via `[exports.auto_discover]`. Claude plugins are dependency types; for Claude Code they are installed natively, and for non-Claude agents we extract skills from the plugin layout. Validation is enforced via Zod at the parsing boundary.

## Goals

- Single manifest file: `agents.toml` only.
- Cargo-style mental model: `[package]` and `[dependencies]` in the same file.
- Multi-resource future without schema migrations; v1 remains skills-only.
- Claude plugin dependencies are supported and treated as first-class dependency types.
- Strong boundary validation using Zod, with consistent error shapes and loud failures.

## Non-goals (v1)

- No transitive dependency resolution.
- No per-skill overrides, renames, filters, or include/exclude rules.
- No non-skill exports (commands/hooks/agents). These are explicitly out of scope in v1.
- No plugin marketplace overrides (custom skills paths) for Claude plugins.

## Manifest Discovery and Merge

- Discover `agents.toml` by walking up from CWD to home/root.
- Always include `~/.sk/agents.toml` as the base layer.
- Merge with “closest wins” semantics at the dependency entry level.
- Relative `path` resolves from the directory containing the defining manifest.

## Schema Overview

### [package]

Author metadata (required when present):

```toml
[package]
name = "my-tools"
version = "1.2.0"
description = "Internal tooling"
license = "MIT"
```

### [dependencies]

Unified install target list for both consumer and package manifests. In v1, dependencies are installed only as direct dependencies; transitive resolution is not implemented.

Supported sources:
- Registry: `name = "^1.2.0"`
- GitHub: `{ gh = "org/repo", tag|branch|rev, path }`
- Git: `{ git = "https://...", tag|branch|rev, path }`
- Local: `{ path = "../pkg" }`
- Claude plugin: `{ type = "claude-plugin", plugin = "review", marketplace = "github:owner/repo" }`

### [exports]

Only auto-discovery is supported in v1.

```toml
[exports.auto_discover]
skills = "./skills"  # default if omitted
```

Rules:
- If `exports` is omitted, default is `./skills`.
- If `skills = false`, auto-discovery is disabled.
- If `skills` is a string, it is the directory to scan.
- Any other keys or types under `exports.auto_discover` are errors.

### [agents]

Same as current design: toggle install targets by agent. All dependencies apply to all enabled agents.

```toml
[agents]
claude-code = true
cursor = true
windsurf = false
```

## Claude Plugin Dependencies

Dependency shape:

```toml
[dependencies]
review = { type = "claude-plugin", plugin = "review", marketplace = "github:owner/repo" }
```

Semantics:
- `marketplace` is any Claude marketplace source spec string (GitHub slug, git URL, local path, or marketplace URL).
- `plugin` is the Claude plugin name.
- `review` is the local alias used for display and mapping.

Install behavior:
- Target agent `claude-code`: run `/plugin marketplace add <marketplace-spec>` and `/plugin install <plugin>@<marketplace-name>`, where `<marketplace-name>` comes from the marketplace’s `marketplace.json`.
- Target agent non-Claude: resolve the plugin source from the marketplace’s `marketplace.json` (`source` string for relative paths, or `{ source = "github" | "url", ... }` for remote sources), respect `metadata.pluginRoot` for relative paths, require `.claude-plugin/plugin.json`, and scan `./skills` at the plugin root. Ignore commands/hooks/agents in v1.

## Validation with Zod

We will add Zod to `packages/sksup` and validate immediately after parsing TOML:

- `package`: required fields when present, types enforced.
- `dependencies`: key names are strings; values are valid source specs.
- `claude-plugin`: requires `type`, `plugin`, `marketplace`; no extra keys.
- `exports.auto_discover.skills`: only `false` or string; no other keys.
- `agents`: boolean flags only.

Zod transforms the parsed TOML into internal data models; downstream logic only handles validated data.

## Error Handling

- Invalid manifest structure or unknown keys: hard error with file path and TOML path.
- Missing skills directory for auto-discovery: hard error.
- Missing or invalid skill frontmatter: hard error.
- Missing `.claude-plugin/plugin.json` for Claude plugin dependency: hard error.
- Any ambiguity or unsupported configuration: error loud and explicit.

## Testing

- Schema validation unit tests (good/bad fixtures for each section).
- Merge behavior tests (closest-wins, relative path resolution).
- Claude plugin dependency parsing (valid/invalid).
- Auto-discover tests: default, override string, `false`, invalid type.
- Extraction tests: minimal package with `skills/`, minimal Claude plugin layout.

## Future Extensions (explicitly deferred)

- Per-skill overrides (agent targeting, renames, disables).
- Commands/hooks/agents exports.
- Plugin marketplace overrides (custom skills path).
- Transitive dependency resolution.
