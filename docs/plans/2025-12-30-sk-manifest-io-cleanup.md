# Clean up sk manifest IO + remove dead code

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

After this change, `sk` manifest read/write logic lives under `packages/sk/src/core/manifest`, command handlers share one prompt path for creating `package.toml`, and unused helpers are removed. This keeps review surfaces small while preserving the current CLI behavior. You can verify it by running `sk pkg add` or `sk agent` in a directory without a `package.toml` and seeing the same create prompt as before.

## Progress

- [x] (2025-12-30 23:19Z) Capture current manifest IO and command prompt call sites so the refactor keeps behavior identical.
- [x] (2025-12-30 23:19Z) Move manifest IO into `packages/sk/src/core/manifest/fs.ts` and update all imports.
- [x] (2025-12-30 23:19Z) Create a shared command-layer manifest prompt helper and delete duplicated implementations.
- [x] (2025-12-30 23:19Z) Remove unused helpers and empty `packages/sk/src/ui`, confirming with repository-wide `rg`.
- [x] (2025-12-30 23:19Z) Run `npm biome` from the repo root and record the result.

## Surprises & Discoveries

- Observation: `npm biome` is not a valid npm subcommand in this repo; `npm run biome` runs the Biome script.
  Evidence: `Unknown command: "biome"` followed by a successful `npm run biome` run.

## Decision Log

- Decision: Place manifest IO in `packages/sk/src/core/manifest/fs.ts` and keep the API identical to the current command-layer helpers.
  Rationale: It matches the existing `core/manifest` organization while keeping downstream changes minimal.
  Date/Author: 2025-12-30 Codex

- Decision: Introduce a command-layer helper `packages/sk/src/commands/manifest-prompt.ts` that wraps the "create package.toml?" prompt and returns `ManifestLoadResult`.
  Rationale: The prompt is UI-specific, but the manifest IO should stay in core.
  Date/Author: 2025-12-30 Codex

## Outcomes & Retrospective

- Completed manifest IO move to `core/manifest/fs.ts`, consolidated the manifest create prompt helper, removed unused helpers and empty UI directory, and ran Biome. Behavior is intended to be unchanged aside from simpler structure.

## Context and Orientation

The `sk` CLI reads and writes `package.toml` manifests. Today that IO lives in `packages/sk/src/commands/manifest.ts`, while `packages/sk/src/commands/pkg/add.ts`, `packages/sk/src/commands/pkg/index.ts`, and `packages/sk/src/commands/agent/index.ts` duplicate the same "create manifest" prompt flow. The `core/manifest` directory already contains parsing and serialization helpers, so the IO should live there as well. There are also unused helpers (`packages/sk/src/core/io/temp.ts`, unused fetch helpers, unused install helpers) and an empty `packages/sk/src/ui` directory.

## Plan of Work

Move the manifest IO helpers (`loadManifestFromCwd`, `saveManifest`, `ManifestNotFoundError`, `isManifestNotFoundError`, and `ManifestLoadResult`) into `packages/sk/src/core/manifest/fs.ts` without changing their behavior. Add a command-layer helper in `packages/sk/src/commands/manifest-prompt.ts` to encapsulate the create prompt and reuse it in `pkg/add`, `pkg/index`, and `agent/index`. Delete the duplicated prompt implementations and the old `packages/sk/src/commands/manifest.ts` module. Remove unused helpers and the empty UI directory after confirming no references with `rg`. Run `npm biome` at the end.

## Concrete Steps

From the repo root, search for the existing manifest prompt helpers and copy the IO module:

  rg "loadManifestForUpdate" packages/sk/src
  rg "loadManifestFromCwd" packages/sk/src

Create `packages/sk/src/core/manifest/fs.ts` with the IO code from `packages/sk/src/commands/manifest.ts`, updating imports to `core/manifest/parse` and `core/manifest/write`.

Create `packages/sk/src/commands/manifest-prompt.ts` that exports a single `loadManifestForUpdate` function returning `ManifestLoadResult` and using `confirm`/`isCancel` to prompt when `ManifestNotFoundError` is raised.

Update `packages/sk/src/commands/pkg/add.ts`, `packages/sk/src/commands/pkg/index.ts`, and `packages/sk/src/commands/agent/index.ts` to import `loadManifestFromCwd` and `saveManifest` from `packages/sk/src/core/manifest/fs.ts`, and to call the shared `loadManifestForUpdate` helper from `packages/sk/src/commands/manifest-prompt.ts`. Delete the duplicated local `loadManifestForUpdate` functions in those files.

Remove the old `packages/sk/src/commands/manifest.ts` file.

Verify unused helpers and remove them:

  rg "createTempDir|cleanupTempDir|fetchGithubPackage|fetchGitPackage|installPackagesForAgent|buildInstalledSkills" -g'*'

If those symbols have no remaining references, delete `packages/sk/src/core/io/temp.ts`, remove the unused exports from `packages/sk/src/core/packages/fetch.ts` and `packages/sk/src/core/agents/install.ts`, and delete the empty `packages/sk/src/ui` directory. Re-run `rg` to confirm.

Finally, run `npm biome` from the repository root and capture the output.

## Validation and Acceptance

Running `npm biome` from the repo root completes without errors. Manual verification: in a directory without `package.toml`, running `sk pkg add` or `sk agent` still prompts "package.toml not found. Create it?" and proceeds identically once confirmed. The codebase has no references to removed helpers, and `rg --files packages/sk/src/ui` returns nothing.

## Idempotence and Recovery

The refactor is safe to repeat; if a move step is misapplied, move the manifest IO functions back into a temporary file and re-run the import updates. If a deletion causes a missing symbol error, re-create the deleted helper or revert to the previous state and re-run `rg` to locate references.

## Artifacts and Notes

`npm run biome` output:

  > @skills-supply@0.1.0 biome
  > npx biome check --fix .
  Checked 97 files in 42ms. No fixes applied.

## Interfaces and Dependencies

In `packages/sk/src/core/manifest/fs.ts`, the following exports must exist and preserve current behavior:

- `export interface ManifestLoadResult { created: boolean; manifest: Manifest; manifestPath: string }`
- `export class ManifestNotFoundError extends Error`
- `export async function loadManifestFromCwd(options: { createIfMissing: boolean }): Promise<ManifestLoadResult>`
- `export async function saveManifest(manifest: Manifest, manifestPath: string): Promise<void>`
- `export function isManifestNotFoundError(error: unknown): error is ManifestNotFoundError`

In `packages/sk/src/commands/manifest-prompt.ts`, define:

- `export async function loadManifestForUpdate(): Promise<ManifestLoadResult>`

No new dependencies are introduced.
