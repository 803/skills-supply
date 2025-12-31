# Refactor sk sync pipeline + marketplace resolution

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

After this change, `sk sync` will warn when different aliases resolve to the same underlying dependency, and the sync pipeline will read as a linear, staged flow with marketplace/plugin handling isolated in its own module. The user-visible output is the same except for new warnings on deduped dependencies. You can see it working by running `sk sync --dry-run` in a workspace with multiple manifests that reference the same package under different aliases and observing warning lines.

## Progress

- [x] (2025-12-30 23:36Z) Capture current sync pipeline structure and identify the plugin/marketplace code paths to extract.
- [x] (2025-12-30 23:36Z) Add dedupe warnings to manifest merge and propagate them into `sk sync` output.
- [x] (2025-12-30 23:36Z) Extract marketplace and Claude plugin handling into `packages/sk/src/core/sync/marketplace.ts` and make `sync.ts` orchestration linear.
- [x] (2025-12-30 23:36Z) Move repo temp directory helpers into a shared module if needed by both sync orchestration and marketplace code.
- [x] (2025-12-30 23:36Z) Run `npm run biome` from the repo root and record the result.

## Surprises & Discoveries

- None yet.

## Decision Log

- Decision: Use `MergedManifest.warnings: string[]` to carry dedupe warnings from `mergeManifests` into `SyncSummary`.
  Rationale: Warnings are already string-based in `SyncSummary`, so this keeps formatting localized and avoids new warning types.
  Date/Author: 2025-12-30 Codex

- Decision: Move marketplace and Claude plugin resolution into `packages/sk/src/core/sync/marketplace.ts` behind a single `resolveAgentPackages` helper.
  Rationale: It keeps `syncAgent` linear without branching on plugin logic, while preserving current behavior.
  Date/Author: 2025-12-30 Codex

- Decision: Extract `buildRepoKey` and `buildRepoDir` into `packages/sk/src/core/sync/repo.ts` for reuse.
  Rationale: Both sync orchestration and marketplace resolution need the same repo temp directory logic.
  Date/Author: 2025-12-30 Codex

## Outcomes & Retrospective

- Added merge warnings for deduped aliases, extracted marketplace/plugin handling into a dedicated module, and centralized repo temp directory helpers. `sync.ts` now reads as a linear pipeline with warnings flowing into CLI output.

## Context and Orientation

`packages/sk/src/core/sync/sync.ts` orchestrates the full sync pipeline, including fetching dependencies, detecting skill layouts, installing skills, and handling Claude plugin marketplaces. The plugin/marketplace logic currently lives inside `sync.ts` along with the pipeline, which makes the dataflow hard to follow. Dependency deduplication happens in `packages/sk/src/core/manifest/merge.ts`, but it silently drops duplicate aliases. `SyncSummary.warnings` is already used to surface warnings to the CLI (`packages/sk/src/commands/sync.ts`).

A “marketplace” here is a repository or URL that contains a `marketplace.json` manifest listing plugins; Claude plugin dependencies refer to plugins in those marketplaces. We need to preserve current behavior: Claude plugins install directly only for the Claude Code agent, and for other agents they resolve to package dependencies.

## Plan of Work

First, update manifest merging to record warnings when different aliases resolve to the same canonical dependency. Keep merge behavior unchanged, just collect warnings in the merge result. Next, refactor sync orchestration by moving marketplace and Claude plugin functions out of `sync.ts` into `packages/sk/src/core/sync/marketplace.ts`, and introduce a single helper (for example `resolveAgentPackages`) that returns a resolved package list plus warnings. If both `sync.ts` and the marketplace module need repo temp directory helpers, extract them into a small shared module such as `packages/sk/src/core/sync/repo.ts`. Finally, wire the warnings into `SyncSummary` and run Biome.

## Concrete Steps

From the repo root, identify the plugin and marketplace functions in sync:

  rg "Claude plugin|marketplace" packages/sk/src/core/sync/sync.ts

Add `warnings: string[]` to `MergedManifest` in `packages/sk/src/core/manifest/types.ts` and collect dedupe warnings in `packages/sk/src/core/manifest/merge.ts` when a new alias resolves to an existing canonical package. Use a `Set` to avoid warning duplicates. Update `packages/sk/src/core/sync/sync.ts` to include these warnings in the `SyncSummary` returned by `runSync`.

Create `packages/sk/src/core/sync/marketplace.ts` and move the marketplace/plugin helper functions out of `sync.ts`. Implement and export a `resolveAgentPackages` function that takes `{ agent, packages, tempRoot, dryRun }` and returns `{ packages, warnings }` in a `SyncResult`. Update `sync.ts` to call this helper and then proceed linearly through fetch -> detect -> extract -> validate -> plan -> install -> reconcile. Remove the plugin/marketplace helpers from `sync.ts` once the new module is wired.

If needed, create `packages/sk/src/core/sync/repo.ts` to hold `buildRepoKey` and `buildRepoDir`, and update imports in both `sync.ts` and the marketplace module.

Run `npm run biome` from the repo root and record the output in Artifacts.

## Validation and Acceptance

`npm run biome` passes. Running `sk sync --dry-run` in a workspace where multiple manifests reference the same underlying dependency under different aliases prints warning lines describing the dedupe (alias, source path, and the alias kept). The sync output otherwise matches current behavior, and the pipeline code in `packages/sk/src/core/sync/sync.ts` reads as a linear orchestration without marketplace-specific branches.

## Idempotence and Recovery

All steps are safe to repeat. If a moved function breaks imports, move it back temporarily and re-run the refactor step. If the new marketplace module causes runtime errors, revert to the previous `sync.ts` implementation and re-apply changes incrementally.

## Artifacts and Notes

`npm run biome` output:

  > @skills-supply@0.1.0 biome
  > npx biome check --fix .
  Checked 99 files in 32ms. Fixed 2 files.

## Interfaces and Dependencies

In `packages/sk/src/core/manifest/types.ts`, update `MergedManifest` to include:

- `warnings: string[]`

In `packages/sk/src/core/sync/marketplace.ts`, define and export:

- `export async function resolveAgentPackages(options: { agent: AgentDefinition; packages: CanonicalPackage[]; tempRoot: string; dryRun: boolean; }): Promise<SyncResult<{ packages: CanonicalPackage[]; warnings: string[] }>>`

If adding `packages/sk/src/core/sync/repo.ts`, it must export:

- `export function buildRepoKey(type: "github" | "git", identity: string, ref: GitRef | undefined): string`
- `export function buildRepoDir(tempRoot: string, key: string, alias: string): string`
