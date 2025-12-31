# Implement agents.toml + Zod validation + Claude plugin dependencies

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document must be maintained in accordance with `./.agent/PLANS.md`.

## Purpose / Big Picture

After this change, sk uses `agents.toml` as the only manifest format and validates it with Zod. Users can declare dependencies under `[dependencies]`, and package authors can export skills via `[exports.auto_discover]` without duplicating names. Claude plugin dependencies become first-class: they install natively for Claude Code and have skills extracted for non-Claude agents. A user can run `sk sync` in a repo with `agents.toml` and see skills installed across agents; invalid manifests or unsupported plugin sources fail loudly with clear errors.

## Progress

- [x] (2025-12-30 23:25Z) Created and validated design doc in `docs/plans/2025-12-30-package-toml-design.md`.
- [x] (2025-12-30 23:45Z) Add Zod to `packages/sk` and define manifest schema + parser that outputs validated internal models.
- [x] (2025-12-30 23:45Z) Replace `skills.toml` usage with `agents.toml` across discovery, CLI edits, and sync pipeline.
- [x] (2025-12-30 23:45Z) Implement exports auto-discovery for manifest packages and update skill extraction/detection accordingly.
- [x] (2025-12-30 23:45Z) Implement Claude plugin dependency resolution and per-agent behavior.
- [x] (2025-12-30 23:45Z) Run `npm run biome`.
- [ ] (2025-12-30 23:45Z) Validate via `sk sync --dry-run` smoke scenario and commit with `--no-gpg-sign`.

## Surprises & Discoveries

- Claude marketplace manifests use `plugins[].source` as either a relative path string or an object with `{ source: "github", repo }` / `{ source: "url", url }`, plus optional `metadata.pluginRoot`. Claude CLI also accepts marketplace URLs pointing to `marketplace.json`.

## Decision Log

- Decision: Use `agents.toml` only; no `skills.toml` compatibility layer.
  Rationale: Alpha software; migration is explicit and avoids dual-path complexity.
  Date/Author: 2025-12-30 / Codex
- Decision: `[exports.auto_discover].skills` is the only skill discovery config in v1; `false` disables discovery.
  Rationale: Keep authoring minimal and preserve frontmatter as source of truth.
  Date/Author: 2025-12-30 / Codex
- Decision: Claude plugins are dependency types; Claude Code installs natively while other agents extract skills from plugin layout.
  Rationale: Aligns with Claude’s plugin ecosystem while keeping sk agent-agnostic.
  Date/Author: 2025-12-30 / Codex
- Decision: Plugin source paths resolve relative to marketplace root (not `.claude-plugin`), and bare source strings are treated as local paths if they exist; otherwise they are parsed as GitHub slugs.
  Rationale: Keeps relative plugin sources aligned with marketplace layout while avoiding silent ambiguity.
  Date/Author: 2025-12-30 / Codex
- Decision: Claude Code plugin installs are attempted via `claude --command` running `/plugin marketplace add` and `/plugin install`, while dry-run only validates and warns.
  Rationale: Honors native plugin workflow without blocking non-Claude agents; still fails loudly when the CLI is unavailable.
  Date/Author: 2025-12-30 / Codex
- Decision: Marketplace parsing follows Claude’s schema (`plugins[].source` string for relative paths, or `{ source: "github" | "url", ... }`), honors `metadata.pluginRoot`, and supports marketplace URLs pointing to `marketplace.json`.
  Rationale: Aligns extraction behavior with Claude’s official marketplace format and CLI inputs.
  Date/Author: 2025-12-30 / Codex

## Outcomes & Retrospective

- (not started)

## Context and Orientation

The sk CLI lives in `packages/sk/src`. Manifest parsing is implemented in `packages/sk/src/core/manifest`, with discovery in `discover.ts`, parsing in `parse.ts`, merging in `merge.ts`, and serialization in `write.ts`. The sync pipeline is in `packages/sk/src/core/sync/sync.ts` and uses package detection in `packages/sk/src/core/packages/detect.ts`, extraction in `packages/sk/src/core/packages/extract.ts`, and dependency resolution in `packages/sk/src/core/packages/resolve.ts`. CLI commands that edit manifests live in `packages/sk/src/commands/*` and reference `agents.toml` and `[dependencies]`.

A “skill” is a directory containing `SKILL.md` with YAML frontmatter including a `name` field. The install pipeline uses `AgentDefinition.skillsPath` and installs skills with the `<prefix>-<skillname>` naming rule.

## Plan of Work

First, add Zod to `packages/sk` and define a manifest schema that validates `[package]`, `[dependencies]`, `[agents]`, and `[exports.auto_discover]`. Update `parseManifest` to parse TOML via `smol-toml`, validate with Zod, and return a normalized internal model. Replace `Manifest` and related types to use `dependencies` instead of `packages`, and add a `ClaudePluginDeclaration` type.

Second, switch all manifest discovery and CLI editing to `agents.toml`. Update `discover.ts`, `commands/manifest.ts`, `commands/pkg/*`, `commands/agent/*`, and user-facing messages to refer to `agents.toml`. Update serializer to write `[dependencies]` and (when present) `[agents]`.

Third, implement `exports.auto_discover` support for package manifests. Update `detect.ts` to look for `agents.toml` (not `skills.toml`). Update `extract.ts` so `manifest` packages read `agents.toml`, resolve the skills directory (default `./skills`), and scan immediate subdirectories for `SKILL.md`. If the skills directory is missing or auto-discover is `false`, return a hard error since v1 is skills-only. Keep existing support for subdir and single-skill packages.

Fourth, add Claude plugin dependency handling. Extend `PackageDeclaration` + `CanonicalPackage` with a `claude-plugin` type. In sync, partition dependencies per-agent: for `claude-code`, call Claude’s native plugin commands (`/plugin marketplace add` and `/plugin install`) using the marketplace source spec string and plugin name, then skip skill extraction for that dependency. For non-Claude agents, resolve the plugin marketplace source by reading `.claude-plugin/marketplace.json`, find the plugin entry by name, resolve its `source` into a GitHub/Git/Path package, fetch it, require `.claude-plugin/plugin.json`, and scan `./skills` at the plugin root. Return errors if the marketplace or plugin is invalid.

Finally, run `npm run biome`, run a dry-run sync to validate, and commit with `--no-gpg-sign`.

## Concrete Steps

Work in repository root `./`. Run these commands as the plan progresses:

  - `rg -n "agents.toml|dependencies" packages/sk/src` to find remaining references.
  - `npm run biome` after code changes.
  - `sk sync --dry-run` (from a sample repo with `agents.toml`) to smoke test behavior.

Expected outputs include Biome reporting clean checks and `sk sync --dry-run` printing a summary with manifests/packages detected and planned installs. Update this section with any new commands or transcripts as they are executed.

## Validation and Acceptance

Validation is complete when:

- Running `sk sync --dry-run` in a repo containing `agents.toml` succeeds, discovers manifests, and plans installs.
- A malformed manifest (wrong types or unknown keys) fails with a clear error that references the manifest path.
- A Claude plugin dependency for Claude Code triggers the plugin install path; the same dependency for a non-Claude agent extracts skills from the plugin `./skills` directory.
- `npm run biome` reports no issues.

## Idempotence and Recovery

All changes are additive and safe to re-run. If a step fails, re-run the same command after fixing the error. If manifest parsing is broken, revert the file edits and re-run `npm run biome` to confirm a clean state.

## Artifacts and Notes

No artifacts yet. Capture any useful transcripts or diffs as they appear.

## Interfaces and Dependencies

Add `zod` as a dependency in `packages/sk/package.json`.

In `packages/sk/src/core/manifest/types.ts`, define:

  - `export interface PackageMetadata { name: string; version: string; description?: string; license?: string; org?: string }` (extend as needed)
  - `export interface ManifestExportsAutoDiscover { skills: string | false }`
  - `export interface ManifestExports { autoDiscover: ManifestExportsAutoDiscover }`
  - `export interface ClaudePluginDeclaration { type: "claude-plugin"; plugin: string; marketplace: string }`
  - `export type DependencyDeclaration = RegistryPackageDeclaration | GithubPackageDeclaration | GitPackageDeclaration | LocalPackageDeclaration | ClaudePluginDeclaration`
  - `export interface Manifest { package?: PackageMetadata; agents: Record<string, boolean>; dependencies: Record<string, DependencyDeclaration>; exports?: ManifestExports; sourcePath: string }`

In `packages/sk/src/core/manifest/parse.ts`, export `parseManifest(contents, sourcePath)` that returns validated `Manifest` or a structured error with `type`, `message`, and `sourcePath`. This function must parse TOML, validate with Zod, and fail loudly on unknown keys.

In `packages/sk/src/core/packages/types.ts`, add:

  - `export interface ClaudePluginPackage { type: "claude-plugin"; alias: string; plugin: string; marketplace: string; sourcePath: string }`
  - extend `CanonicalPackage` with `ClaudePluginPackage`.

In `packages/sk/src/core/packages/resolve.ts`, add support for `ClaudePluginDeclaration` and return a `ClaudePluginPackage` for non-empty `plugin` and `marketplace` values.

In `packages/sk/src/core/sync/sync.ts`, update the pipeline to handle `claude-plugin` dependencies per agent as described in the Plan of Work.

When revising this plan, append a short “Plan Update” note at the bottom describing what changed and why.

Plan Update (2025-12-30): Marked completed milestones, split validation/commit into a remaining step, and recorded decisions about marketplace-relative plugin paths and Claude command execution. This keeps the plan aligned with current implementation and remaining validation work.
Plan Update (2025-12-30): Updated interface definitions to reflect the implemented `PackageMetadata` fields and `ClaudePluginPackage.sourcePath` needed for marketplace-relative resolution.
Plan Update (2025-12-30): Updated marketplace handling to match Claude’s `marketplace.json` schema (source object + pluginRoot) and noted support for marketplace URL specs.
