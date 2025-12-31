/**
 * E2E tests for the sync flow
 *
 * These tests exercise the complete sync pipeline:
 * parse -> resolve -> fetch -> extract -> install
 *
 * Uses local packages to avoid network dependencies.
 * Uses resolved agent definitions with isolated skills paths.
 */

import { readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ResolvedAgent } from "@/src/core/agents/types"
import { loadManifest } from "@/src/core/manifest/fs"
import { runSync } from "@/src/core/sync/sync"
import { coerceAbsolutePathDirect } from "@/src/core/types/coerce"
import {
	createTestProject,
	exists,
	isDirectory,
	setupFixturePackage,
	withTempDir,
} from "@/tests/helpers"

function createResolvedAgent(rootPath: string, skillsPath: string): ResolvedAgent {
	return {
		displayName: "Test Agent",
		id: "claude-code",
		rootPath,
		skillsPath,
	}
}

function buildAgentPaths(baseDir: string): { rootPath: string; skillsPath: string } {
	const rootPath = join(baseDir, "agent-root")
	return { rootPath, skillsPath: join(rootPath, "skills") }
}

async function loadProjectManifest(projectDir: string) {
	const manifestPath = coerceAbsolutePathDirect(join(projectDir, "package.toml"))
	if (!manifestPath) {
		throw new Error("Invalid manifest path.")
	}
	const loaded = await loadManifest(manifestPath, "cwd")
	return loaded.manifest
}

/**
 * Helper to read the .sk-state.json file from an agent root directory.
 */
async function readAgentState(rootPath: string): Promise<{
	version: number
	skills: string[]
	updated_at: string
} | null> {
	const statePath = join(rootPath, ".sk-state.json")
	try {
		const content = await readFile(statePath, "utf-8")
		return JSON.parse(content)
	} catch {
		return null
	}
}

/**
 * Helper to list installed skills (entries in skills path, excluding dot files).
 */
async function listInstalledSkills(skillsPath: string): Promise<string[]> {
	try {
		const entries = await readdir(skillsPath)
		return entries.filter((e) => !e.startsWith("."))
	} catch {
		return []
	}
}

describe("sync e2e", () => {
	let originalCwd: string
	let tempDir: string

	beforeEach(() => {
		originalCwd = process.cwd()
	})

	afterEach(async () => {
		process.chdir(originalCwd)

		if (tempDir) {
			try {
				await rm(tempDir, { force: true, recursive: true })
			} catch {
				// Ignore cleanup errors
			}
		}
	})

	describe("fresh sync", () => {
		it("installs skills from a local package to a new agent directory", async () => {
			await withTempDir(async (dir) => {
				tempDir = dir

				// Setup: Create a local package with skills
				const pkgDir = join(dir, "my-skills-pkg")
				await setupFixturePackage(pkgDir, {
					name: "my-skills",
					skills: [
						{
							content: "# Greeting\n\nA friendly greeting skill.",
							name: "greeting",
						},
						{
							content: "# Farewell\n\nA polite farewell skill.",
							name: "farewell",
						},
					],
				})

				// Setup: Create project with manifest pointing to local package
				const projectDir = join(dir, "project")
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						"my-skills": `local:${pkgDir}`,
					},
					name: "test-project",
				})

				// Setup: Set the mock agent skills directory
				const { rootPath: agentRootDir, skillsPath: agentSkillsDir } =
					buildAgentPaths(dir)
				const agent = createResolvedAgent(agentRootDir, agentSkillsDir)
				const manifest = await loadProjectManifest(projectDir)

				// Act: Run sync
				const result = await runSync({
					agents: [agent],
					dryRun: false,
					manifest,
				})

				// Assert: Sync should succeed
				expect(result.ok).toBe(true)
				if (!result.ok) {
					return
				}

				// Assert: Summary should report correct counts
				expect(result.value.manifests).toBe(1)
				expect(result.value.dependencies).toBe(1)
				expect(result.value.installed).toBeGreaterThan(0)

				// Assert: Skills directory should exist
				expect(await isDirectory(agentSkillsDir)).toBe(true)

				// Assert: State file should be created
				const state = await readAgentState(agentRootDir)
				expect(state).not.toBeNull()
				expect(state?.version).toBe(1)
				expect(state?.skills.length).toBeGreaterThan(0)

				// Assert: Skill directories should be installed
				const installedSkills = await listInstalledSkills(agentSkillsDir)
				expect(installedSkills.length).toBeGreaterThan(0)

				// Skills should have the prefix from the alias
				for (const skill of installedSkills) {
					expect(skill).toMatch(/^my-skills-/)
				}
			})
		})

		it("handles a package with no skills gracefully", async () => {
			await withTempDir(async (dir) => {
				tempDir = dir

				// Setup: Create an empty package (no skills)
				const pkgDir = join(dir, "empty-pkg")
				await setupFixturePackage(pkgDir, {
					name: "empty-pkg",
					skills: [],
				})

				// Setup: Create project with manifest
				const projectDir = join(dir, "project")
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						"empty-pkg": `local:${pkgDir}`,
					},
				})

				// Setup: Mock agent
				const { rootPath: agentRootDir, skillsPath: agentSkillsDir } =
					buildAgentPaths(dir)
				const agent = createResolvedAgent(agentRootDir, agentSkillsDir)
				const manifest = await loadProjectManifest(projectDir)

				// Act: Run sync - should fail because empty packages are invalid
				const result = await runSync({
					agents: [agent],
					dryRun: false,
					manifest,
				})

				// Assert: Should fail with appropriate error
				// (Empty packages fail at extract or install stage)
				if (result.ok) {
					// If it succeeds, installed should be 0
					expect(result.value.installed).toBe(0)
				} else {
					// Error is expected for packages with no skills
					expect(result.error.stage).toMatch(/extract|install/)
				}
			})
		})
	})

	describe("incremental add", () => {
		it("adds new skills when a new dependency is added", async () => {
			await withTempDir(async (dir) => {
				tempDir = dir

				// Setup: Create first package
				const pkg1Dir = join(dir, "pkg1")
				await setupFixturePackage(pkg1Dir, {
					name: "pkg1",
					skills: [
						{ content: "# Skill One\n\nFirst skill.", name: "skill-one" },
					],
				})

				// Setup: Create second package (to be added later)
				const pkg2Dir = join(dir, "pkg2")
				await setupFixturePackage(pkg2Dir, {
					name: "pkg2",
					skills: [
						{ content: "# Skill Two\n\nSecond skill.", name: "skill-two" },
					],
				})

				// Setup: Create project with only first package
				const projectDir = join(dir, "project")
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						pkg1: `local:${pkg1Dir}`,
					},
				})

				// Setup: Mock agent
				const { rootPath: agentRootDir, skillsPath: agentSkillsDir } =
					buildAgentPaths(dir)
				const agent = createResolvedAgent(agentRootDir, agentSkillsDir)

				// Act: First sync with pkg1 only
				const firstManifest = await loadProjectManifest(projectDir)
				const firstResult = await runSync({
					agents: [agent],
					dryRun: false,
					manifest: firstManifest,
				})
				expect(firstResult.ok).toBe(true)

				const firstState = await readAgentState(agentRootDir)
				const firstSkillCount = firstState?.skills.length ?? 0

				// Update manifest to add second package
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						pkg1: `local:${pkg1Dir}`,
						pkg2: `local:${pkg2Dir}`,
					},
				})

				// Act: Second sync with both packages
				const secondManifest = await loadProjectManifest(projectDir)
				const secondResult = await runSync({
					agents: [agent],
					dryRun: false,
					manifest: secondManifest,
				})
				expect(secondResult.ok).toBe(true)

				// Assert: More skills should be installed
				const secondState = await readAgentState(agentRootDir)
				expect(secondState?.skills.length).toBeGreaterThan(firstSkillCount)

				// Assert: Both package prefixes should be present
				const installedSkills = await listInstalledSkills(agentSkillsDir)
				const pkg1Skills = installedSkills.filter((s) => s.startsWith("pkg1-"))
				const pkg2Skills = installedSkills.filter((s) => s.startsWith("pkg2-"))

				expect(pkg1Skills.length).toBeGreaterThan(0)
				expect(pkg2Skills.length).toBeGreaterThan(0)
			})
		})
	})

	describe("remove dependency", () => {
		it("removes stale skills when a dependency is removed", async () => {
			await withTempDir(async (dir) => {
				tempDir = dir

				// Setup: Create two packages
				const pkg1Dir = join(dir, "pkg1")
				await setupFixturePackage(pkg1Dir, {
					name: "pkg1",
					skills: [{ content: "# Skill One", name: "skill-one" }],
				})

				const pkg2Dir = join(dir, "pkg2")
				await setupFixturePackage(pkg2Dir, {
					name: "pkg2",
					skills: [{ content: "# Skill Two", name: "skill-two" }],
				})

				// Setup: Create project with both packages
				const projectDir = join(dir, "project")
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						pkg1: `local:${pkg1Dir}`,
						pkg2: `local:${pkg2Dir}`,
					},
				})

				// Setup: Mock agent
				const { rootPath: agentRootDir, skillsPath: agentSkillsDir } =
					buildAgentPaths(dir)
				const agent = createResolvedAgent(agentRootDir, agentSkillsDir)

				// Act: First sync with both packages
				const firstManifest = await loadProjectManifest(projectDir)
				const firstResult = await runSync({
					agents: [agent],
					dryRun: false,
					manifest: firstManifest,
				})
				expect(firstResult.ok).toBe(true)

				// Verify both packages are installed
				let installedSkills = await listInstalledSkills(agentSkillsDir)
				expect(installedSkills.some((s) => s.startsWith("pkg1-"))).toBe(true)
				expect(installedSkills.some((s) => s.startsWith("pkg2-"))).toBe(true)

				// Update manifest to remove pkg2
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						pkg1: `local:${pkg1Dir}`,
					},
				})

				// Act: Second sync with only pkg1
				const secondManifest = await loadProjectManifest(projectDir)
				const secondResult = await runSync({
					agents: [agent],
					dryRun: false,
					manifest: secondManifest,
				})
				expect(secondResult.ok).toBe(true)

				// Assert: pkg2 skills should be removed
				if (secondResult.ok) {
					expect(secondResult.value.removed).toBeGreaterThan(0)
				}

				// Assert: Only pkg1 skills should remain
				installedSkills = await listInstalledSkills(agentSkillsDir)
				expect(installedSkills.some((s) => s.startsWith("pkg1-"))).toBe(true)
				expect(installedSkills.some((s) => s.startsWith("pkg2-"))).toBe(false)

				// Assert: State should only contain pkg1 skills
				const state = await readAgentState(agentRootDir)
				expect(state?.skills.every((s) => s.startsWith("pkg1-"))).toBe(true)
			})
		})
	})

	describe("dry run", () => {
		it("reports changes without applying them", async () => {
			await withTempDir(async (dir) => {
				tempDir = dir

				// Setup: Create a local package with skills
				const pkgDir = join(dir, "my-pkg")
				await setupFixturePackage(pkgDir, {
					name: "my-pkg",
					skills: [
						{ content: "# Hello", name: "hello" },
						{ content: "# World", name: "world" },
					],
				})

				// Setup: Create project with manifest
				const projectDir = join(dir, "project")
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						"my-pkg": `local:${pkgDir}`,
					},
				})

				// Setup: Mock agent
				const { rootPath: agentRootDir, skillsPath: agentSkillsDir } =
					buildAgentPaths(dir)
				const agent = createResolvedAgent(agentRootDir, agentSkillsDir)
				const manifest = await loadProjectManifest(projectDir)

				// Act: Run sync with dry-run enabled
				const result = await runSync({
					agents: [agent],
					dryRun: true,
					manifest,
				})

				// Assert: Should succeed
				expect(result.ok).toBe(true)
				if (!result.ok) {
					return
				}

				// Assert: Should report it was a dry run
				expect(result.value.dryRun).toBe(true)

				// Assert: Should report skills that would be installed
				expect(result.value.installed).toBeGreaterThan(0)

				// Assert: No actual installation should have happened
				expect(await exists(agentSkillsDir)).toBe(false)

				// Assert: No state file should exist
				const state = await readAgentState(agentRootDir)
				expect(state).toBeNull()
			})
		})

		it("reports removals in dry run mode", async () => {
			await withTempDir(async (dir) => {
				tempDir = dir

				// Setup: Create two packages
				const pkg1Dir = join(dir, "pkg1")
				await setupFixturePackage(pkg1Dir, {
					name: "pkg1",
					skills: [{ content: "# One", name: "one" }],
				})

				const pkg2Dir = join(dir, "pkg2")
				await setupFixturePackage(pkg2Dir, {
					name: "pkg2",
					skills: [{ content: "# Two", name: "two" }],
				})

				// Setup: Create project and agent
				const projectDir = join(dir, "project")
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						pkg1: `local:${pkg1Dir}`,
						pkg2: `local:${pkg2Dir}`,
					},
				})

				const { rootPath: agentRootDir, skillsPath: agentSkillsDir } =
					buildAgentPaths(dir)
				const agent = createResolvedAgent(agentRootDir, agentSkillsDir)

				// First: Do a real sync with both packages
				const firstManifest = await loadProjectManifest(projectDir)
				const firstResult = await runSync({
					agents: [agent],
					dryRun: false,
					manifest: firstManifest,
				})
				expect(firstResult.ok).toBe(true)

				// Verify both are installed
				let skills = await listInstalledSkills(agentSkillsDir)
				expect(skills.length).toBe(2)

				// Update manifest to remove pkg2
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						pkg1: `local:${pkg1Dir}`,
					},
				})

				// Act: Dry-run sync with pkg2 removed
				const dryManifest = await loadProjectManifest(projectDir)
				const dryRunResult = await runSync({
					agents: [agent],
					dryRun: true,
					manifest: dryManifest,
				})
				expect(dryRunResult.ok).toBe(true)

				if (!dryRunResult.ok) {
					return
				}

				// Assert: Should report removals
				expect(dryRunResult.value.removed).toBeGreaterThan(0)
				expect(dryRunResult.value.dryRun).toBe(true)

				// Assert: pkg2 should still exist (dry run doesn't apply changes)
				skills = await listInstalledSkills(agentSkillsDir)
				expect(skills.some((s) => s.startsWith("pkg2-"))).toBe(true)
			})
		})
	})

	describe("error cases", () => {
		it("fails when local package path does not exist", async () => {
			await withTempDir(async (dir) => {
				tempDir = dir

				// Setup: Create project pointing to non-existent local package
				const projectDir = join(dir, "project")
				await createTestProject(projectDir, {
					agents: ["claude-code"],
					dependencies: {
						"missing-pkg": `local:${join(dir, "non-existent-pkg")}`,
					},
				})

				const { rootPath: agentRootDir, skillsPath: agentSkillsDir } =
					buildAgentPaths(dir)
				const agent = createResolvedAgent(agentRootDir, agentSkillsDir)
				const manifest = await loadProjectManifest(projectDir)

				// Act: Run sync
				const result = await runSync({
					agents: [agent],
					dryRun: false,
					manifest,
				})

				// Assert: Should fail at fetch stage
				expect(result.ok).toBe(false)
				if (!result.ok) {
					expect(result.error.stage).toMatch(/fetch|detect/)
				}
			})
		})
	})
})
