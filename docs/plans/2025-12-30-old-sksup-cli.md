# Implement sync pipeline, commands, and ephemeral fetch (excluding package-level skills.toml
  schema)

  This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision
  Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

  This plan follows `.agent/PLANS.md` in the repository root and must be maintained in accordance
  with that file.

  ## Purpose / Big Picture

  After this change, a user can manage skills end‑to‑end with `sksup sync`, add/remove packages with
  `sksup pkg add/remove`, and use interactive agent/package menus. Sync will be a real pipeline that
  discovers manifests, resolves packages, performs ephemeral shallow clones per agent, detects and
  extracts skills, installs them, and reconciles removed skills with guardrails so only
  sksup‑created artifacts are removed. The user can see it working by running `sksup sync --dry-run`
  in a repo with `skills.toml` and observing a plan summary with no filesystem modifications, then
  running `sksup sync` to install and remove skills safely.

  ## Progress

  - [x] (2025-12-30 12:45Z) Add core pipeline types and stage‑tagged error wrappers, plus shared IO
  helpers used across the new pipeline and commands.
  - [x] (2025-12-30 12:55Z) Refactor package fetching to per‑agent ephemeral shallow clones and
  implement invariant validation + reconciliation guardrails.
  - [x] (2025-12-30 13:05Z) Implement sync command and pkg/agent commands (add/remove/interactive)
  with clack prompts and manifest writes; update CLI wiring.
  - [x] (2025-12-30 13:25Z) Validate end‑to‑end behavior with dry‑run and install scenarios; run
  `npm run biome` and `npm run build --workspace @skills-supply/sksup`.

  ## Surprises & Discoveries

  - Observation: Legacy `core/pipeline` and `core/reconcile` files still referenced removed fetch
  helpers and broke the build.
    Evidence: `bun build` failed with missing exports from `core/packages/fetch.ts` until the stale
  pipeline/reconcile modules were removed.

  ## Decision Log

  - Decision: Defer package‑level `skills.toml` schema and extraction (issue `skillssupply-nkt`) for
  later.
    Rationale: The schema is still undefined; implementing it now risks rework. We will keep
  manifest packages unsupported for extraction in this plan.
    Date/Author: 2025-12-29 / Codex + user.
  - Decision: Use ephemeral per‑agent shallow clones (no cache) during sync, with fallback to deeper
  or full fetch for pinned commit SHAs.
    Rationale: Removes cache complexity and makes updates deterministic; fallback handles SHA fetch
  in shallow clones.
    Date/Author: 2025-12-29 / Codex + user.
  - Decision: Full reconciliation removes only sksup‑created artifacts (guardrail).
    Rationale: Avoids deleting user‑managed skills; track created entries with a local state file.
    Date/Author: 2025-12-29 / Codex + user.
  - Decision: `sksup` without subcommand should show help, not run sync; `sksup sync` accepts
  `--dry-run`.
    Rationale: Explicit operation reduces surprises; dry‑run enables verification.
    Date/Author: 2025-12-29 / Codex + user.
  - Decision: Group git/GitHub packages by repo + ref to reuse a single sparse checkout per agent.
    Rationale: Reduces sparse checkout duplication within a sync run while still keeping per‑agent
  ephemeral clones.
    Date/Author: 2025-12-30 / Codex.
  - Decision: Include warnings and manifest/package counts in the sync summary output.
    Rationale: Makes guardrail behavior and pipeline scope visible during dry‑runs and installs.
    Date/Author: 2025-12-30 / Codex.

  ## Outcomes & Retrospective

  Completed all milestones in this plan. The sync pipeline now runs with ephemeral per-agent clones,
  guardrail reconciliation via agent state, and clack-based commands for sync, pkg, and agent flows.
  The main lesson was to remove the legacy pipeline/reconcile modules to avoid conflicting entry
  points.

  ## Context and Orientation

  This repo’s CLI lives under `packages/sksup`. Key existing modules:

  - `packages/sksup/src/core/manifest/` has `discover.ts`, `parse.ts`, `merge.ts`, and `write.ts`
  (TOML serialization).
  - `packages/sksup/src/core/packages/` has `resolve.ts`, `fetch.ts`, `detect.ts`, `extract.ts`, and
  `types.ts`.
  - `packages/sksup/src/core/agents/` has `registry.ts` and `install.ts`.
  - CLI commands are under `packages/sksup/src/commands/` and already use `@clack/prompts`.
  - `packages/sksup/src/cli.ts` wires commands via `cac`.
  - `packages/sksup/tsconfig.json` uses `@/*` alias and has `noEmit: true`.

  Terminology used in this plan:
  - “Sync pipeline” means the full flow: discover manifests, parse/merge, resolve packages, fetch
  packages, detect skill layout, extract skills, install into agent dirs, and reconcile removals.
  - “Ephemeral clone” means a temporary clone created inside an OS temp directory that is removed
  after installation. No shared cache.
  - “Guardrail reconciliation” means removing only skills that were installed by sksup (tracked in a
  state file).

  ## Plan of Work

  Milestone 1: Core pipeline types, error wrapper, and IO helpers. Create a `packages/sksup/src/
  core/sync/` folder with a `types.ts` file defining pipeline data structures (resolved manifest,
  fetched package, detected package, extracted package, install plan) and a `SyncStage` enum or
  union of stage names. Add `errors.ts` to define `SyncError` with a `stage` field and helper
  `failSync(stage, error, message)` that wraps module‑level error shapes into a uniform error.
  Create `packages/sksup/src/core/io/fs.ts` (or similar) to centralize `safeStat`, `readTextFile`,
  `writeTextFile`, `ensureDir`, `listDir`, `removePath` with a consistent `IoError` shape. Update
  new pipeline code to use these helpers; existing modules can keep their local helpers for now
  unless already being refactored as part of the sync work. Add `packages/sksup/src/core/agents/
  state.ts` to read/write a `.sksup-state.json` (or similar) in each agent’s skills directory. This
  state file will list skill directory names and last updated timestamp, and will be used for
  reconciliation guardrails.

  Milestone 2: Ephemeral fetch + invariants + reconciliation. Refactor `packages/sksup/src/core/
  packages/fetch.ts` to remove cache root logic and accept explicit destination directories.
  Implement a `cloneRepository` helper that supports shallow clones (depth 1), optional sparse
  checkout for `path`, and a fallback path for pinned `rev` if the commit isn’t reachable. Group
  git/GitHub packages by repo + ref during sync so each agent uses a single sparse checkout per repo
  (reducing duplication) while still cloning per agent. Add an invariant validator `packages/sksup/
  src/core/sync/validate.ts` that checks: packages have skills, no duplicate `prefix-skill` names
  across packages, and extracted skill names are non‑empty. Implement reconciliation logic in
  `packages/sksup/src/core/agents/reconcile.ts` that reads the per‑agent state file and removes only
  entries tracked by sksup that are no longer desired. Ensure local path packages remain symlink
  installs and are still tracked in state.

  Milestone 3: Sync command and CLI commands. Add `packages/sksup/src/core/sync/sync.ts` to
  orchestrate the pipeline. It should discover manifests, parse/merge, resolve packages, compute
  enabled agents (if merged manifest has no agents, auto‑detect installed agents), then for each
  agent create a temp directory (using `fs.mkdtemp` under OS temp). It should fetch/detect/extract
  each package into that temp directory (shallow clone per agent), validate invariants, install via
  `core/agents/install.ts`, update agent state, and reconcile removals. Always delete the temp
  directory at the end. Add a `dryRun` option to skip installation and reconciliation but still
  perform fetch/detect/extract and output a plan summary. Implement command modules for `sksup
  sync`, `sksup pkg add`, `sksup pkg remove`, `sksup pkg` interactive, and `sksup agent`
  interactive, all using clack prompts. Update `packages/sksup/src/cli.ts` to register these
  commands. For `pkg add`, parse `type` and `spec`, accept `--tag`, `--branch`, `--rev`, `--path`,
  `--as`, and write to `./skills.toml` in cwd. If the file doesn’t exist, prompt to create it. For
  `pkg remove`, delete by alias and fail if missing. For interactive modes, use simple prompts that
  let a user pick and apply changes; default to current manifest values.

  ## Concrete Steps

  All commands are run from the repo root: `/Users/alizain/Experiments/skillssupply`.

  1) Create core sync folders and files and update module exports and imports.
     - Add `packages/sksup/src/core/sync/types.ts`, `errors.ts`, `validate.ts`, and `sync.ts`.
     - Add `packages/sksup/src/core/io/fs.ts`.
     - Add `packages/sksup/src/core/agents/state.ts` and `reconcile.ts`.
     - Update `packages/sksup/src/core/agents/install.ts` to return installed skill names and to not
  delete any paths itself (reconciliation handles deletions).

  2) Refactor `packages/sksup/src/core/packages/fetch.ts` to accept a destination directory instead
  of a cache root.
     - Remove `CACHE_ROOT` and `buildCachePathFromUrl`.
     - Introduce `fetchGithubRepository(...)` and `fetchGitRepository(...)` helpers that clone into
  a caller-supplied temp subdir (use a hash of repo+ref for uniqueness).
     - Implement shallow clone with optional sparse checkout for `path` (support multiple paths per
  repo group).
     - For `ref.rev`, try shallow `fetch` of the SHA; if not found, retry with a deeper fetch.
     - Continue to return `PackageFetchResult` with `packagePath` and `repoPath` for each package.

  3) Implement `core/sync/sync.ts` pipeline.
     - Use `discoverManifests`, `parseManifest`, `mergeManifests`, per-entry `resolvePackageDeclaration`,
  `detectPackageType`, `extractSkills`.
     - Determine enabled agents. If merged agents map is empty, call `detectInstalledAgents` and
  enable those agents.
     - For each agent, create a temp dir, group git/GitHub packages by repo+ref, fetch/detect/extract
  per package, validate invariants, and call `applyAgentInstall`.
     - If not dry‑run, write agent state and reconcile stale skills using guardrail state.
     - Clean up the temp directory whether success or failure.

  4) Add commands for sync and packages/agents.
     - `packages/sksup/src/commands/sync.ts` exposes `syncCommand({ dryRun })` using clack output.
     - `packages/sksup/src/commands/pkg/add.ts`, `packages/sksup/src/commands/pkg/remove.ts`,
  `packages/sksup/src/commands/pkg/index.ts` for interactive.
     - `packages/sksup/src/commands/agent/index.ts` for interactive selection with clack.
     - Update `packages/sksup/src/cli.ts` to register new commands.

  5) Run formatting and build checks.
     - `npm run biome`
     - `npm run build --workspace @skills-supply/sksup`

  Expected short transcript for a dry run after implementation:

      $ node packages/sksup/dist/cli.js sync --dry-run
      sksup sync
      • Found 2 manifests
      • Resolved 3 packages
      • Enabled agents: Claude Code, Codex
      • Would install 4 skills, remove 1 stale skill
      Done.

  ## Validation and Acceptance

  Acceptance is behavior‑based:

  - Running `node packages/sksup/dist/cli.js sync --dry-run` in a folder with a valid `skills.toml`
  prints a clear plan summary and does not modify any files under agent skill directories.
  - Running `node packages/sksup/dist/cli.js sync` installs skill directories for enabled agents,
  writes a per‑agent state file (e.g., `.sksup-state.json` under the agent skills root), and removes
  only entries previously installed by sksup that are no longer in the manifest.
  - `node packages/sksup/dist/cli.js pkg add gh alice/tools` adds a `packages` entry to `./
  skills.toml` (creates the file if confirmed).
  - `node packages/sksup/dist/cli.js pkg remove tools` deletes the alias from `./skills.toml`, with
  a clear error if missing.
  - `node packages/sksup/dist/cli.js pkg` and `node packages/sksup/dist/cli.js agent` present clack
  menus that apply changes to `./skills.toml`.
  - `npm run biome` and `npm run build --workspace @skills-supply/sksup` complete without errors.

  ## Idempotence and Recovery

  The steps are safe to repeat. If a sync run fails mid‑way, the temporary clone directory is
  removed at the end of the run. If a state file is missing, reconciliation skips deletions
  (guardrail), so no user content is removed. If `skills.toml` is missing and a command needs it,
  the user is prompted to create it; if declined, no file is created.

  ## Artifacts and Notes

  Keep these short snippets updated during implementation, for example:

      Example state file (agent skills root/.sksup-state.json):
        {
          "version": 1,
          "skills": ["superpowers-brainstorming", "tools-debugging"],
          "updatedAt": "2025-12-29T21:00:00Z"
        }

      Example dry-run output:
        sksup sync
        • Found 1 manifest
        • Resolved 2 packages
        • Enabled agents: Claude Code
        • Would install 3 skills, remove 0 stale skills
        Done.

  ## Interfaces and Dependencies

  Use the following module interfaces:

  - In `packages/sksup/src/core/sync/types.ts`, define:

      export type SyncStage = "discover" | "parse" | "merge" | "resolve" | "fetch" | "detect" |
  "extract" | "validate" | "install" | "reconcile" | "agents"

      export interface SyncError { stage: SyncStage; message: string; details?: unknown }

      export type SyncResult<T> = { ok: true; value: T } | { ok: false; error: SyncError }

      export interface ResolvedManifest { manifests: Manifest[]; merged: MergedManifest; packages:
  CanonicalPackage[]; agents: AgentDefinition[] }

      export interface ExtractedPackage { canonical: CanonicalPackage; prefix: string; skills:
  Skill[] }

  - In `packages/sksup/src/core/io/fs.ts`, define helpers returning `{ ok: true; value } | { ok:
  false; error: IoError }` where `IoError` has `type: "io_error"`, `message`, and `path`.

  - In `packages/sksup/src/core/agents/state.ts`, define:

      export interface AgentInstallState { version: number; skills: string[]; updatedAt: string }

      export function readAgentState(agent: AgentDefinition): Result<AgentInstallState | null,
  IoError>

      export function writeAgentState(agent: AgentDefinition, state: AgentInstallState):
  Result<void, IoError>

  - In `packages/sksup/src/core/sync/sync.ts`, define:

      export interface SyncOptions { dryRun: boolean }

      export async function runSync(options: SyncOptions): Promise<SyncResult<SyncSummary>>

      export interface SyncSummary { agents: string[]; dryRun: boolean; installed: number;
  manifests: number; packages: number; removed: number; warnings: string[] }

  - In `packages/sksup/src/commands/sync.ts`, define:

      export async function syncCommand(options: { dryRun: boolean }): Promise<void>

  Keep `@clack/prompts` as the only interactive UI dependency. Do not reintroduce Ink or React.

  Updates made on 2025-12-30 to mark completed milestones, record the repo grouping and warning
  output decisions, and align the interfaces/state example with the implemented sync summary and
  state shape.
