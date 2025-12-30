# Rename legacy CLI to sk, migrate to Commander, and standardize docs

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan is maintained in accordance with `./.agent/PLANS.md`.

## Purpose / Big Picture

After this change, users run a single `sk` command to manage Skills Supply packages. The CLI implementation uses Commander 14 for command parsing and Consola for logging, while keeping @clack/prompts for interactive input. User-facing docs are aligned to `package.toml` (not `skills.toml`) and the new `sk` command, so the docs and CLI behavior agree.

## Progress

- [x] (2025-12-30 17:05Z) Create this ExecPlan and confirm scope and decisions for rename + CLI refactor.
- [x] (2025-12-30 23:50Z) Rename the CLI package directory to `packages/sk` and update all workspace references, build outputs, and bin names.
- [x] (2025-12-30 23:55Z) Replace CAC with Commander 14.0.2 in `packages/sk/src/cli.ts` and verify command routing (sync/pkg/agent/auth/status/logout/whoami).
- [x] (2025-12-30 23:58Z) Replace clack logging/spinner usage with Consola in all CLI commands, keeping @clack/prompts for input.
- [x] (2025-12-31 00:05Z) Update config/state naming to `~/.sk/` and `.sk-state.json` and update all CLI strings accordingly.
- [x] (2025-12-31 00:20Z) Update legacy docs to reference `package.toml` and the `sk` command; update any remaining legacy CLI references.
- [x] (2025-12-31 00:25Z) Run `npm run biome`.
- [ ] Run a CLI smoke run (`sk --help` at minimum), then commit with `--no-gpg-sign`.

## Surprises & Discoveries

- (none yet)

## Decision Log

- Decision: Set the config/manifest base directory to `~/.sk` and rename the agent state file to `.sk-state.json`.
  Rationale: Aligns user-facing paths with the `sk` command name; backwards compatibility is not required in alpha.
  Date/Author: 2025-12-30 / Codex
- Decision: Set the env override to `SK_BASE_URL` only.
  Rationale: Keep environment naming consistent with the new CLI brand; backwards compatibility is not required.
  Date/Author: 2025-12-30 / Codex

## Outcomes & Retrospective

- (not started)

## Context and Orientation

The CLI lives under `packages/sk/src` and is invoked by `packages/sk/src/cli.ts` via Commander. Commands live under `packages/sk/src/commands` and use `@clack/prompts` for input and `consola` for output. The sync pipeline and install logic is in `packages/sk/src/core`.

User-facing manifest discovery in `packages/sk/src/core/manifest/discover.ts` uses a base directory `~/.sk`, while agent state lives in `.sk-state.json` inside each agent’s skills directory in `packages/sk/src/core/agents/state.ts`. The CLI base URL is read from `packages/sk/src/env.ts` and used by auth/status commands.

Docs in `docs/` include older `skills.toml` references and legacy CLI usage that should be aligned to `package.toml` and `sk`.

## Plan of Work

First, rename the workspace directory and package metadata. Rename the CLI package directory to `packages/sk`, update `packages/sk/package.json` to change the package name to `@skills-supply/sk`, update the bin entry to `sk`, and update build/bundle output paths. Update `tsconfig.json` references and any code or docs referencing the old path.

Second, migrate the CLI entrypoint from CAC to Commander. Replace the CAC setup in `packages/sk/src/cli.ts` with Commander 14.0.2, define commands and subcommands (`pkg`, `agent`, `sync`, `auth`, `status`, `logout`, `whoami`), and preserve current behavior for required arguments and default help output. Remove CAC from dependencies and add Commander 14.0.2 to `packages/sk/package.json`.

Third, replace clack logging and spinners with Consola. Keep `@clack/prompts` only for interactive input functions (`select`, `multiselect`, `text`, `confirm`, `isCancel`). For logging, replace `intro`, `outro`, `log`, `note`, and `spinner` usage in `packages/sk/src/commands/*` with `consola` calls. Use a consistent pattern: `consola.start` for progress, `consola.success/info/warn/error` for outcomes, and keep messages unchanged except for the CLI name.

Fourth, update config naming. Change `USER_MANIFEST_DIR` in `packages/sk/src/core/manifest/discover.ts` to `.sk`, update the agent state file name in `packages/sk/src/core/agents/state.ts` to `.sk-state.json`, and update any temp directory prefixes or error strings that include the legacy CLI name to `sk`. Update `packages/sk/src/env.ts` to read `SK_BASE_URL` and update all references to the renamed constant.

Finally, update documentation. Replace `skills.toml` references with `package.toml` where they describe the active manifest format, and replace legacy CLI command references with `sk`. Skip `docs/2025-12-30-skills-directory-design.md` entirely as requested. Capture any doc that is historical and add a short note if it is intentionally outdated rather than rewritten.

## Concrete Steps

Work from repository root `./`.

  - Rename the CLI package folder and update workspace references.
    - Ensure the CLI package folder is `packages/sk`.
    - Update `tsconfig.json` references and any legacy path mentions.

  - Update `packages/sk/package.json`:
    - name `@skills-supply/sk`, bin `sk`, bundle output to `./bin/sk`.
    - Add `commander@14.0.2` and `consola` as dependencies, remove `cac`.

  - Replace CAC with Commander in `packages/sk/src/cli.ts` and update all legacy CLI strings to `sk`.

  - Replace clack logging/spinner usage with Consola in `packages/sk/src/commands/*`.

  - Update config naming and environment variable in:
    - `packages/sk/src/core/manifest/discover.ts`
    - `packages/sk/src/core/agents/state.ts`
    - `packages/sk/src/env.ts`
    - Any other legacy CLI string or path in CLI/core code.

  - Update docs (excluding `docs/2025-12-30-skills-directory-design.md`) to use `package.toml` and `sk`.

  - Run `npm run biome`.
  - Run `node packages/sk/dist/cli.js --help` (or `sk --help` if built) to confirm command output.

## Validation and Acceptance

Validation is complete when:

  - `node packages/sk/dist/cli.js --help` prints `sk` usage and lists `sync`, `pkg`, `agent`, `auth`, `status`, `logout`, `whoami`.
  - `npm run biome` succeeds with no warnings.
  - Docs reference `package.toml` and `sk` for the active CLI.

## Idempotence and Recovery

Renames and edits can be re-run safely as long as the new `packages/sk` directory exists. If a rename step fails, restore the previous path and re-run the step after fixing conflicts. For CLI parsing changes, rerun `npm run biome` to catch type errors before proceeding.

## Artifacts and Notes

`npm run biome` (2025-12-31): clean, no fixes applied.

## Interfaces and Dependencies

In `packages/sk/package.json`, depend on:

  - `commander` version `14.0.2` for CLI parsing.
  - `consola` for logging and spinners (keep `@clack/prompts` for input only).

In `packages/sk/src/env.ts`, define:

  - `export const SK_BASE_URL = normalizeBaseUrl(process.env.SK_BASE_URL ?? "https://api.skills.supply")`

In `packages/sk/src/core/manifest/discover.ts`, set:

  - `const USER_MANIFEST_DIR = ".sk"`

In `packages/sk/src/core/agents/state.ts`, set:

  - `const STATE_FILENAME = ".sk-state.json"`

Plan Update (2025-12-31): Marked doc updates and Biome validation complete.
