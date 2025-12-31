/**
 * E2E test helpers
 *
 * Utilities for running full sync operations in isolated test environments.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { SyncOptions, SyncResult, SyncSummary } from "../../src/core/sync/types"

/**
 * Options for running sync in tests.
 */
export interface TestSyncOptions {
	/** Working directory to run sync from (required) */
	cwd: string
	/** Directory to use as agent home (for skill installation) */
	agentHome?: string
	/** Whether to run in dry-run mode (default: false) */
	dryRun?: boolean
}

/**
 * Result of running sync in tests.
 * Extends SyncSummary with additional test-useful information.
 */
export interface TestSyncResult {
	/** The raw sync result */
	result: SyncResult<SyncSummary>
	/** Quick accessor for installed skill names */
	installed: string[]
	/** Quick accessor for removed skill names */
	removed: string[]
	/** Quick accessor for warnings */
	warnings: string[]
}

/**
 * Run the sync operation with test-specific configuration.
 *
 * This is a placeholder for the actual sync runner. In a full implementation,
 * this would call the real sync with mocked paths.
 *
 * @example
 * await withTempDir(async (dir) => {
 *   const projectDir = join(dir, 'project')
 *   await setupProject(projectDir)
 *
 *   const result = await runSync({
 *     cwd: projectDir,
 *     agentHome: join(dir, 'agent-skills'),
 *     dryRun: true,
 *   })
 *
 *   expect(result.result.ok).toBe(true)
 * })
 */
export async function runSync(options: TestSyncOptions): Promise<TestSyncResult> {
	// This is a test helper that will be implemented when we wire up
	// the actual sync with injectable dependencies.
	// For now, return a placeholder result.

	const syncOptions: SyncOptions = {
		dryRun: options.dryRun ?? false,
	}

	// TODO: Actually call the sync operation with mocked paths
	// The real implementation will:
	// 1. Set process.cwd to options.cwd (or mock it)
	// 2. Override agent home directories to options.agentHome
	// 3. Run the sync
	// 4. Return the result

	// Placeholder return
	return {
		installed: [],
		removed: [],
		result: {
			ok: true,
			value: {
				agents: [],
				dependencies: 0,
				dryRun: syncOptions.dryRun,
				installed: 0,
				manifests: 0,
				removed: 0,
				warnings: [],
			},
		},
		warnings: [],
	}
}

/**
 * Create a project directory with a manifest file.
 *
 * @example
 * await createTestProject(projectDir, {
 *   dependencies: { 'my-pkg': 'github:org/repo' },
 *   agents: ['claude-code'],
 * })
 */
export interface TestProjectOptions {
	/** Dependencies to include */
	dependencies?: Record<string, string>
	/** Agents to enable */
	agents?: string[]
	/** Package name */
	name?: string
}

export async function createTestProject(
	projectDir: string,
	options: TestProjectOptions = {},
): Promise<void> {
	const { dependencies = {}, agents = ["claude-code"], name = "test-project" } = options

	await mkdir(projectDir, { recursive: true })

	const agentLines = agents.map((a) => `${a} = true`).join("\n")
	const depLines = Object.entries(dependencies)
		.map(([alias, spec]) => {
			// Handle both string specs and structured specs
			if (spec.startsWith("github:")) {
				return `${alias} = { gh = "${spec.slice(7)}" }`
			}
			if (spec.startsWith("local:")) {
				return `${alias} = { path = "${spec.slice(6)}" }`
			}
			// Assume it's a registry package
			return `${alias} = "${spec}"`
		})
		.join("\n")

	const manifest = `[package]
name = "${name}"
version = "1.0.0"

[agents]
${agentLines}

[dependencies]
${depLines}
`

	await writeFile(join(projectDir, "package.toml"), manifest)
}

/**
 * Re-export filesystem helpers for convenience.
 */
export { exists, isDirectory, isFile, setupFixturePackage, withTempDir } from "./fs"
