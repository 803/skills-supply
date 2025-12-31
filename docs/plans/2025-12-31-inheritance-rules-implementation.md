# Implement Inheritance Rules Design

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

Follow the rules in `.agent/PLANS.md` from the repository root. This plan must be maintained in accordance with that document.

## Purpose / Big Picture

Users should be able to run `sk` commands with a clear, non-inherited manifest model that matches the design doc in `docs/2025-12-31-inheritance-rules-design.md`. The CLI must treat project manifests and global manifests as separate scopes, stop manifest discovery at the home directory boundary, install skills at the project root, and provide the new prompts and flags (`--global`, `--non-interactive`, `--init`, `--agents`) with predictable behavior. The change is considered complete when `sk sync`, `sk pkg add/remove`, `sk agent add/remove`, and `sk init` all follow the new discovery rules and the sync pipeline installs to the correct scope-specific agent paths without inheritance or merging.

## Progress

- [x] (2025-12-31 16:29Z) Created initial ExecPlan capturing scope, dataflow, and command behaviors from the design doc and user clarifications.
- [x] (2025-12-31 12:20Z) Implemented single-manifest discovery, global discovery, and empty-section serialization.
- [x] (2025-12-31 12:25Z) Refactored agent registry and sync pipeline for scope-aware installs, added agent root paths, and aligned state file location/schema.
- [x] (2025-12-31 12:30Z) Updated commands and CLI flags for sync/pkg/agent/init with new prompts, non-interactive behavior, and scope handling.
- [x] (2025-12-31 12:35Z) Updated tests for discovery, state tracking, and sync flows; ran `npm run biome` and `npm test`.

## Surprises & Discoveries

- Observation: State files were previously stored under the skills directory with camelCase `updatedAt`, but the design specifies agent-root placement and `updated_at`.
  Evidence: Updated `packages/sk/src/core/agents/state.ts` and integration tests to reflect root-level `.sk-state.json` with `updated_at`.

## Decision Log

- Decision: `sk sync --non-interactive` with no `[agents]` section will be a no-op that prints a message and exits 0.
  Rationale: Explicit user clarification overrides ambiguous spec section.
  Date/Author: 2025-12-31 / Codex
- Decision: `sk pkg add --init` will emit an empty `[agents]` section in newly created manifests.
  Rationale: Explicit user clarification.
  Date/Author: 2025-12-31 / Codex
- Decision: `sk agent add/remove` will follow the same discovery rules as other commands (parent prompt, `--global`, `--non-interactive`).
  Rationale: Explicit user clarification.
  Date/Author: 2025-12-31 / Codex
- Decision: Move agent state tracking to the agent root directory and emit `updated_at` in the JSON schema.
  Rationale: Align implementation with the design spec and avoid ambiguity about state file location.
  Date/Author: 2025-12-31 / Codex
- Decision: Add `rootPath` to `ResolvedAgent` so install paths and state paths are derived from a shared scope root.
  Rationale: Keeps state tracking and skills installation aligned without implicit path math.
  Date/Author: 2025-12-31 / Codex
- Decision: `sk init --non-interactive` omits `[agents]` unless `--agents` is provided.
  Rationale: Match the design doc's non-interactive behavior while keeping interactive init explicit.
  Date/Author: 2025-12-31 / Codex

## Outcomes & Retrospective

Delivered the inheritance-rule refactor end-to-end: single-manifest discovery, scope-aware installs, new CLI flags/prompts, and updated state tracking. Tests and formatting checks pass. No follow-up gaps identified in this plan.

## Context and Orientation

The CLI implementation lives in `packages/sk/src`. Manifest discovery currently happens in `packages/sk/src/core/manifest/discover.ts`, which walks up the filesystem and returns multiple manifests, then appends `~/.sk/agents.toml`. Merging is handled in `packages/sk/src/core/manifest/merge.ts`, and sync uses `packages/sk/src/core/sync/sync.ts` to discover, parse, merge, resolve packages, and install skills. Agent installation relies on `AgentDefinition.skillsPath` from `packages/sk/src/core/agents/registry.ts`, which today is always a global path under the home directory. Commands are defined in `packages/sk/src/commands/*` and wired in `packages/sk/src/cli.ts`.

The new design requires a single manifest per scope, no merging, project-root installs, and explicit prompts when a parent manifest is found. This will touch manifest discovery, manifest serialization, agent registry path resolution, sync behavior, and multiple commands (sync, pkg add/remove, agent add/remove, init). Tests live in `packages/sk/tests`, with discovery tests in `packages/sk/tests/integration/manifest-discovery.test.ts` and sync flow tests in `packages/sk/tests/e2e/sync-flow.test.ts`.

## Plan of Work

First, replace manifest discovery with a single-manifest model. Implement `findProjectRoot` and `discoverGlobalManifest` in `packages/sk/src/core/manifest/discover.ts`, update discovery result types in `packages/sk/src/core/manifest/types.ts`, and add a path-based manifest loader in `packages/sk/src/core/manifest/fs.ts`. Extend manifest serialization in `packages/sk/src/core/manifest/write.ts` to optionally emit empty `[agents]` and `[dependencies]` sections for new manifests created by `sk init` or `--init`. Remove `packages/sk/src/core/manifest/merge.ts` and any merge-specific types, and update package resolution in `packages/sk/src/core/packages/resolve.ts` to accept a single `Manifest`.

Next, refactor the agent registry to resolve skills paths by scope. Update `packages/sk/src/core/agents/types.ts` to distinguish between agent definitions (base paths + detection) and resolved agents (rootPath + skillsPath). Add a registry helper to resolve skills paths for local vs global scope and update the sync pipeline in `packages/sk/src/core/sync/sync.ts` to accept a single manifest and a resolved agent list. Ensure sync implements the empty-manifest behavior (no dependencies and no prior state results in a no-op message without creating directories), and stores state in `{agentRoot}/.sk-state.json` with an `updated_at` field while installing skills under `{agentRoot}/{skillsDir}`.

Then, update commands and CLI wiring. Add `--global` and `--non-interactive` flags to `sk sync`, `sk pkg add/remove`, and `sk agent add/remove`, add `--init` to `sk pkg add`, and add a new `sk init` command with `--global`, `--non-interactive`, and `--agents`. Replace `packages/sk/src/commands/manifest-prompt.ts` with a new shared command helper that performs discovery, handles the parent-manifest prompt, and optionally creates manifests with empty sections. Use that helper in `sync.ts`, `pkg/add.ts`, `pkg/remove.ts`, `agent/add.ts`, `agent/remove.ts`, and `agent/index.ts`. Implement agent auto-detection and interactive selection in `sync.ts` when `[agents]` is missing, writing the chosen agents back to the manifest. Ensure warnings about running from a subdirectory are printed for sync/pkg add/pkg remove after manifest selection.

Finally, update tests. Replace manifest discovery integration tests to cover `findProjectRoot` and `discoverGlobalManifest`, adjust package resolution tests to use the single-manifest API, and update sync flow tests to pass explicit manifests and resolved agents. Remove merge tests or replace them with targeted tests for the new behavior. After code changes, run `npm run biome` from the repo root and run the appropriate test target(s) to validate changes.

## Concrete Steps

Work from the repository root.

1. Edit `packages/sk/src/core/manifest/discover.ts`, `packages/sk/src/core/manifest/types.ts`, `packages/sk/src/core/manifest/fs.ts`, and `packages/sk/src/core/manifest/write.ts` to implement single-manifest discovery, path-based loading, and empty-section serialization.
2. Remove `packages/sk/src/core/manifest/merge.ts` and update imports and call sites to use the single-manifest flow.
3. Update `packages/sk/src/core/packages/resolve.ts`, `packages/sk/src/core/sync/types.ts`, and `packages/sk/src/core/sync/sync.ts` to accept a single manifest and scope-resolved agents, including the empty-manifest no-op path.
4. Update agent registry and types in `packages/sk/src/core/agents/types.ts` and `packages/sk/src/core/agents/registry.ts`, then update `packages/sk/src/core/agents/install.ts`, `packages/sk/src/core/agents/state.ts`, and `packages/sk/src/core/agents/reconcile.ts` to use resolved agents.
5. Implement new command helper for manifest selection and creation, then update command files under `packages/sk/src/commands/` and CLI wiring in `packages/sk/src/cli.ts` for the new flags and the `sk init` command.
6. Update tests under `packages/sk/tests/` to match the new discovery and sync behavior, and remove merge tests.
7. Run `npm run biome` and the test command(s) relevant to `packages/sk` (likely `npm test`), noting outcomes in this plan.

## Validation and Acceptance

Success means:

- Running `sk sync` from a subdirectory with a parent `agents.toml` triggers the blocking prompt in interactive mode and installs to `{project_root}/.{agent}/skills` when continued. Running with `--non-interactive` uses the parent manifest silently. When no manifest exists, interactive mode prompts to create one; `--non-interactive` errors unless `--init` is used (for `pkg add`).
- `sk sync --global` uses only `~/.sk/agents.toml` and installs to `~/.{agent}/skills`.
- `sk sync --non-interactive` with no `[agents]` produces a no-op message and exits 0.
- `sk init` creates a manifest with an empty `[dependencies]` section and includes `[agents]` only when interactive or when `--agents` is provided; non-interactive runs without `--agents` omit `[agents]`. Errors if the target manifest already exists, and supports `--global` and `--non-interactive`.
- `sk pkg add/remove` and `sk agent add/remove` honor the same discovery rules and new flags.
- `npm run biome` completes without errors, and the updated tests pass.

## Idempotence and Recovery

All file creation steps are safe to rerun; if a manifest already exists at the target path, commands should return a clear error instead of overwriting. If a step fails, rerun the step after fixing the reported error. Removing merge logic is safe because no user data is deleted; manifests remain untouched. Sync operations should continue to be idempotent by reconciling installed skills to manifest contents.

## Artifacts and Notes

Capture short command transcripts for:

    npm run biome
    npm test

Include any failing test output or unexpected errors here if encountered.

    npm run biome
      > @skills-supply@0.1.0 biome
      > npx biome check --fix .
      Checked 120 files in 59ms. Fixed 12 files.

    npm test
      > @skills-supply@0.1.0 test
      > vitest run
      Test Files 9 passed (9)
      Tests 334 passed (334)

## Interfaces and Dependencies

Implement the following new interfaces and helper signatures:

- In `packages/sk/src/core/agents/types.ts`, define:

    interface AgentDefinition { id: AgentId; displayName: string; basePath: string; skillsDir: string; detect(): Promise<AgentDetectionResult> }
    interface ResolvedAgent { id: AgentId; displayName: string; rootPath: string; skillsPath: string }

- In `packages/sk/src/core/agents/registry.ts`, define:

    type AgentScope = { type: "local"; projectRoot: AbsolutePath } | { type: "global"; homeDir: AbsolutePath }
    function resolveAgent(agent: AgentDefinition, scope: AgentScope): ResolvedAgent

- In `packages/sk/src/core/manifest/discover.ts`, define:

    async function findProjectRoot(startDir: string): Promise<ManifestDiscoveryResult>
    async function discoverGlobalManifest(): Promise<ManifestDiscoveryResult>

- In `packages/sk/src/core/manifest/write.ts`, extend serialization to accept:

    serializeManifest(manifest: Manifest, options?: { includeEmptyAgents?: boolean; includeEmptyDependencies?: boolean }): string

- In `packages/sk/src/core/packages/resolve.ts`, replace `resolveMergedPackages` with:

    function resolveManifestPackages(manifest: Manifest): CanonicalPackage[]

- In `packages/sk/src/core/sync/sync.ts`, update `runSync` signature to:

    runSync(options: { dryRun: boolean; manifest: Manifest; agents: ResolvedAgent[] }): Promise<SyncResult<SyncSummary>>

Change Note: Initial plan created to implement inheritance rules design with user clarifications for non-interactive agents behavior, init manifest contents, and agent add/remove scope handling.

Change Note (2025-12-31): Updated progress, decisions, validation criteria, and interfaces to reflect root-level state files, `updated_at` schema, and non-interactive init behavior; recorded biome/test runs.
