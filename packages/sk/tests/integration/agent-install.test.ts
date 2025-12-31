/**
 * Integration tests for agent skill installation
 *
 * Tests the install.ts module with real filesystem operations.
 * Uses temporary directories to avoid polluting the actual filesystem.
 */

import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	type AgentInstallPlan,
	applyAgentInstall,
	type InstallGuard,
	type InstallTask,
	planAgentInstall,
} from "../../src/core/agents/install"
import type { AgentDefinition, InstallablePackage } from "../../src/core/agents/types"
import type { CanonicalPackage, Skill } from "../../src/core/packages/types"
import type { AbsolutePath, Alias, NonEmptyString } from "../../src/core/types/branded"
import { exists, isDirectory, withTempDir } from "../helpers"

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a branded NonEmptyString for tests.
 * Only use in tests - production code uses coerce functions.
 */
function nes(s: string): NonEmptyString {
	return s as NonEmptyString
}

/**
 * Create a branded AbsolutePath for tests.
 */
function abs(s: string): AbsolutePath {
	return s as AbsolutePath
}

/**
 * Create a branded Alias for tests.
 */
function alias(s: string): Alias {
	return s as Alias
}

/**
 * Create a test agent definition.
 */
function makeAgent(skillsPath: string): AgentDefinition {
	return {
		detect: async () => ({ ok: true, value: true }),
		displayName: "Claude Code",
		id: "claude-code",
		skillsPath,
	}
}

/**
 * Create a local canonical package for tests.
 */
function makeLocalPackage(absolutePath: string): CanonicalPackage {
	return {
		absolutePath: abs(absolutePath),
		fetchStrategy: { mode: "symlink" },
		origin: {
			alias: alias("test-pkg"),
			manifestPath: abs("/test/package.toml"),
		},
		type: "local",
	}
}

/**
 * Create a github canonical package for tests.
 */
function makeGithubPackage(): CanonicalPackage {
	return {
		fetchStrategy: { mode: "clone", sparse: false },
		gh: "org/repo" as NonEmptyString & { readonly [Symbol.species]: "GithubRef" },
		origin: {
			alias: alias("github-pkg"),
			manifestPath: abs("/test/package.toml"),
		},
		type: "github",
	}
}

/**
 * Create a skill for tests.
 */
function makeSkill(name: string, sourcePath: string): Skill {
	return {
		name: nes(name),
		origin: {
			alias: alias("test-pkg"),
			manifestPath: abs("/test/package.toml"),
		},
		sourcePath: abs(sourcePath),
	}
}

/**
 * Create an installable package for tests.
 */
function makeInstallablePackage(
	canonical: CanonicalPackage,
	prefix: string,
	skills: Skill[],
): InstallablePackage {
	return { canonical, prefix, skills }
}

/**
 * Create a source skill directory with files.
 */
async function createSkillSource(
	baseDir: string,
	skillName: string,
	files: Record<string, string>,
): Promise<string> {
	const skillDir = join(baseDir, skillName)
	await mkdir(skillDir, { recursive: true })
	for (const [name, content] of Object.entries(files)) {
		await writeFile(join(skillDir, name), content)
	}
	return skillDir
}

// =============================================================================
// planAgentInstall TESTS
// =============================================================================

describe("planAgentInstall", () => {
	it("creates a valid plan for a single skill", async () => {
		await withTempDir(async (dir) => {
			const skillSource = await createSkillSource(dir, "my-skill", {
				"index.md": "# My Skill",
			})

			const agent = makeAgent(join(dir, "agent-skills"))
			const packages = [
				makeInstallablePackage(makeLocalPackage(dir), "my-pkg", [
					makeSkill("my-skill", skillSource),
				]),
			]

			const result = planAgentInstall(agent, packages)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agentId).toBe("claude-code")
				expect(result.value.basePath).toBe(join(dir, "agent-skills"))
				expect(result.value.tasks).toHaveLength(1)
				expect(result.value.tasks[0].targetName).toBe("my-pkg-my-skill")
				expect(result.value.tasks[0].mode).toBe("symlink") // local package
			}
		})
	})

	it("uses copy mode for github packages", async () => {
		await withTempDir(async (dir) => {
			const skillSource = await createSkillSource(dir, "remote-skill", {
				"index.md": "# Remote Skill",
			})

			const agent = makeAgent(join(dir, "agent-skills"))
			const packages = [
				makeInstallablePackage(makeGithubPackage(), "github-pkg", [
					makeSkill("remote-skill", skillSource),
				]),
			]

			const result = planAgentInstall(agent, packages)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.tasks[0].mode).toBe("copy") // github package
			}
		})
	})

	it("rejects packages with no skills", async () => {
		await withTempDir(async (dir) => {
			const agent = makeAgent(join(dir, "agent-skills"))
			const packages = [
				makeInstallablePackage(makeLocalPackage(dir), "empty-pkg", []),
			]

			const result = planAgentInstall(agent, packages)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_input")
				expect(result.error.message).toContain("no skills")
			}
		})
	})

	it("rejects duplicate target paths", async () => {
		await withTempDir(async (dir) => {
			const skillSource = await createSkillSource(dir, "dup-skill", {
				"index.md": "# Duplicate",
			})

			const agent = makeAgent(join(dir, "agent-skills"))
			// Two skills with the same name in the same package = duplicate target
			const packages = [
				makeInstallablePackage(makeLocalPackage(dir), "pkg", [
					makeSkill("skill", skillSource),
					makeSkill("skill", skillSource), // duplicate
				]),
			]

			const result = planAgentInstall(agent, packages)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("conflict")
				expect(result.error.message).toContain("Duplicate target")
			}
		})
	})

	it("rejects prefix with path separators", async () => {
		await withTempDir(async (dir) => {
			const skillSource = await createSkillSource(dir, "skill", {
				"index.md": "# Test",
			})

			const agent = makeAgent(join(dir, "agent-skills"))
			const packages = [
				makeInstallablePackage(
					makeLocalPackage(dir),
					"../malicious", // path separator in prefix
					[makeSkill("skill", skillSource)],
				),
			]

			const result = planAgentInstall(agent, packages)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_input")
				expect(result.error.message).toContain("path separators")
			}
		})
	})

	it("rejects skill name with path separators", async () => {
		await withTempDir(async (dir) => {
			const skillSource = await createSkillSource(dir, "skill", {
				"index.md": "# Test",
			})

			const agent = makeAgent(join(dir, "agent-skills"))
			const packages = [
				makeInstallablePackage(makeLocalPackage(dir), "pkg", [
					makeSkill("../../escape", skillSource),
				]),
			]

			const result = planAgentInstall(agent, packages)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_input")
			}
		})
	})

	it("rejects empty skills path", async () => {
		await withTempDir(async (dir) => {
			const skillSource = await createSkillSource(dir, "skill", {
				"index.md": "# Test",
			})

			const agent = makeAgent("  ") // empty/whitespace path
			const packages = [
				makeInstallablePackage(makeLocalPackage(dir), "pkg", [
					makeSkill("skill", skillSource),
				]),
			]

			const result = planAgentInstall(agent, packages)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_target")
				expect(result.error.message).toContain("empty")
			}
		})
	})

	it("handles multiple packages with multiple skills", async () => {
		await withTempDir(async (dir) => {
			const skill1 = await createSkillSource(dir, "skill1", { "a.md": "A" })
			const skill2 = await createSkillSource(dir, "skill2", { "b.md": "B" })
			const skill3 = await createSkillSource(dir, "skill3", { "c.md": "C" })

			const agent = makeAgent(join(dir, "agent-skills"))
			const packages = [
				makeInstallablePackage(makeLocalPackage(dir), "pkg-a", [
					makeSkill("skill1", skill1),
					makeSkill("skill2", skill2),
				]),
				makeInstallablePackage(makeLocalPackage(dir), "pkg-b", [
					makeSkill("skill3", skill3),
				]),
			]

			const result = planAgentInstall(agent, packages)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.tasks).toHaveLength(3)
				const names = result.value.tasks.map((t) => t.targetName)
				expect(names).toContain("pkg-a-skill1")
				expect(names).toContain("pkg-a-skill2")
				expect(names).toContain("pkg-b-skill3")
			}
		})
	})
})

// =============================================================================
// applyAgentInstall TESTS
// =============================================================================

describe("applyAgentInstall", () => {
	describe("directory creation", () => {
		it("creates the base directory if it does not exist", async () => {
			await withTempDir(async (dir) => {
				const skillSource = await createSkillSource(dir, "skill", {
					"index.md": "# Test Skill",
				})

				const targetBase = join(dir, "nonexistent", "nested", "path")
				expect(await exists(targetBase)).toBe(false)

				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: skillSource,
							targetName: "pkg-skill",
							targetPath: join(targetBase, "pkg-skill"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeOk()
				expect(await isDirectory(targetBase)).toBe(true)
			})
		})

		it("works when base directory already exists", async () => {
			await withTempDir(async (dir) => {
				const skillSource = await createSkillSource(dir, "skill", {
					"index.md": "# Test",
				})

				const targetBase = join(dir, "existing-dir")
				await mkdir(targetBase, { recursive: true })

				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: skillSource,
							targetName: "pkg-skill",
							targetPath: join(targetBase, "pkg-skill"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeOk()
			})
		})
	})

	describe("copy mode", () => {
		it("copies skill directory contents", async () => {
			await withTempDir(async (dir) => {
				const skillSource = await createSkillSource(dir, "skill", {
					"helper.md": "# Helper",
					"index.md": "# My Skill\nContent here",
				})

				const targetBase = join(dir, "agent-skills")
				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: skillSource,
							targetName: "pkg-skill",
							targetPath: join(targetBase, "pkg-skill"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeOk()
				if (result.ok) {
					expect(result.value).toHaveLength(1)
					expect(result.value[0].name).toBe("skill")
					expect(result.value[0].targetPath).toBe(join(targetBase, "pkg-skill"))

					// Verify files were copied
					const targetDir = join(targetBase, "pkg-skill")
					expect(await isDirectory(targetDir)).toBe(true)

					const files = await readdir(targetDir)
					expect(files).toContain("index.md")
					expect(files).toContain("helper.md")

					const content = await readFile(join(targetDir, "index.md"), "utf-8")
					expect(content).toBe("# My Skill\nContent here")
				}
			})
		})

		it("copies nested directory structures", async () => {
			await withTempDir(async (dir) => {
				const skillSource = join(dir, "skill")
				await mkdir(join(skillSource, "sub", "nested"), { recursive: true })
				await writeFile(join(skillSource, "root.md"), "root")
				await writeFile(join(skillSource, "sub", "child.md"), "child")
				await writeFile(join(skillSource, "sub", "nested", "deep.md"), "deep")

				const targetBase = join(dir, "agent-skills")
				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: skillSource,
							targetName: "pkg-skill",
							targetPath: join(targetBase, "pkg-skill"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeOk()

				// Verify nested structure
				const target = join(targetBase, "pkg-skill")
				expect(await exists(join(target, "root.md"))).toBe(true)
				expect(await exists(join(target, "sub", "child.md"))).toBe(true)
				expect(await exists(join(target, "sub", "nested", "deep.md"))).toBe(true)
			})
		})
	})

	describe("symlink mode", () => {
		it("creates symlink to source directory", async () => {
			await withTempDir(async (dir) => {
				const skillSource = await createSkillSource(dir, "skill", {
					"index.md": "# Symlinked Skill",
				})

				const targetBase = join(dir, "agent-skills")
				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "symlink",
							skillName: "skill",
							sourcePath: skillSource,
							targetName: "pkg-skill",
							targetPath: join(targetBase, "pkg-skill"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeOk()
				if (result.ok) {
					const targetPath = join(targetBase, "pkg-skill")
					const stats = await lstat(targetPath)
					expect(stats.isSymbolicLink()).toBe(true)

					// Verify symlink resolves correctly
					const content = await readFile(join(targetPath, "index.md"), "utf-8")
					expect(content).toBe("# Symlinked Skill")
				}
			})
		})
	})

	describe("install guard (stale skill removal)", () => {
		it("replaces existing tracked skill", async () => {
			await withTempDir(async (dir) => {
				const skillSource = await createSkillSource(dir, "skill", {
					"index.md": "# New Version",
				})

				const targetBase = join(dir, "agent-skills")
				const targetPath = join(targetBase, "pkg-skill")

				// Create existing "stale" skill
				await mkdir(targetPath, { recursive: true })
				await writeFile(join(targetPath, "old.md"), "# Old Version")

				const guard: InstallGuard = {
					trackedPaths: new Set([targetPath]),
				}

				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: skillSource,
							targetName: "pkg-skill",
							targetPath,
						},
					],
				}

				const result = await applyAgentInstall(plan, guard)

				expect(result).toBeOk()

				// Old file should be gone
				expect(await exists(join(targetPath, "old.md"))).toBe(false)
				// New file should exist
				expect(await exists(join(targetPath, "index.md"))).toBe(true)
			})
		})

		it("fails when target exists but is not tracked", async () => {
			await withTempDir(async (dir) => {
				const skillSource = await createSkillSource(dir, "skill", {
					"index.md": "# Test",
				})

				const targetBase = join(dir, "agent-skills")
				const targetPath = join(targetBase, "pkg-skill")

				// Create existing untracked skill
				await mkdir(targetPath, { recursive: true })
				await writeFile(join(targetPath, "manual.md"), "# Manual")

				const guard: InstallGuard = {
					trackedPaths: new Set(), // Not tracking this path
				}

				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: skillSource,
							targetName: "pkg-skill",
							targetPath,
						},
					],
				}

				const result = await applyAgentInstall(plan, guard)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("conflict")
					expect(result.error.message).toContain("already exists")
				}
			})
		})

		it("fails when target exists and no guard provided", async () => {
			await withTempDir(async (dir) => {
				const skillSource = await createSkillSource(dir, "skill", {
					"index.md": "# Test",
				})

				const targetBase = join(dir, "agent-skills")
				const targetPath = join(targetBase, "pkg-skill")

				// Create existing skill
				await mkdir(targetPath, { recursive: true })
				await writeFile(join(targetPath, "existing.md"), "# Existing")

				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: skillSource,
							targetName: "pkg-skill",
							targetPath,
						},
					],
				}

				const result = await applyAgentInstall(plan) // No guard

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("conflict")
				}
			})
		})
	})

	describe("error cases", () => {
		it("fails when source directory does not exist", async () => {
			await withTempDir(async (dir) => {
				const targetBase = join(dir, "agent-skills")
				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: join(dir, "nonexistent-source"),
							targetName: "pkg-skill",
							targetPath: join(targetBase, "pkg-skill"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("invalid_input")
					expect(result.error.message).toContain("does not exist")
				}
			})
		})

		it("fails when source is a file, not a directory", async () => {
			await withTempDir(async (dir) => {
				const sourceFile = join(dir, "source-file.md")
				await writeFile(sourceFile, "# Not a directory")

				const targetBase = join(dir, "agent-skills")
				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: sourceFile,
							targetName: "pkg-skill",
							targetPath: join(targetBase, "pkg-skill"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("invalid_input")
					expect(result.error.message).toContain("not a directory")
				}
			})
		})

		it("fails when base path is a file", async () => {
			await withTempDir(async (dir) => {
				const skillSource = await createSkillSource(dir, "skill", {
					"index.md": "# Test",
				})

				const targetBase = join(dir, "not-a-dir")
				await writeFile(targetBase, "I am a file")

				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill",
							sourcePath: skillSource,
							targetName: "pkg-skill",
							targetPath: join(targetBase, "pkg-skill"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("invalid_target")
					expect(result.error.message).toContain("Expected directory")
				}
			})
		})
	})

	describe("multiple skills in one install", () => {
		it("installs multiple skills from one plan", async () => {
			await withTempDir(async (dir) => {
				const skill1 = await createSkillSource(dir, "skill1", {
					"1.md": "First",
				})
				const skill2 = await createSkillSource(dir, "skill2", {
					"2.md": "Second",
				})
				const skill3 = await createSkillSource(dir, "skill3", {
					"3.md": "Third",
				})

				const targetBase = join(dir, "agent-skills")
				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill1",
							sourcePath: skill1,
							targetName: "pkg-skill1",
							targetPath: join(targetBase, "pkg-skill1"),
						},
						{
							agentId: "claude-code",
							mode: "symlink",
							skillName: "skill2",
							sourcePath: skill2,
							targetName: "pkg-skill2",
							targetPath: join(targetBase, "pkg-skill2"),
						},
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill3",
							sourcePath: skill3,
							targetName: "pkg-skill3",
							targetPath: join(targetBase, "pkg-skill3"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeOk()
				if (result.ok) {
					expect(result.value).toHaveLength(3)

					// Check all installed
					expect(await exists(join(targetBase, "pkg-skill1", "1.md"))).toBe(
						true,
					)
					expect(await exists(join(targetBase, "pkg-skill2", "2.md"))).toBe(
						true,
					)
					expect(await exists(join(targetBase, "pkg-skill3", "3.md"))).toBe(
						true,
					)

					// Check symlink for skill2
					const skill2Stats = await lstat(join(targetBase, "pkg-skill2"))
					expect(skill2Stats.isSymbolicLink()).toBe(true)
				}
			})
		})

		it("stops on first failure and reports error", async () => {
			await withTempDir(async (dir) => {
				const skill1 = await createSkillSource(dir, "skill1", {
					"1.md": "First",
				})
				// skill2 does not exist (will fail)
				const skill3 = await createSkillSource(dir, "skill3", {
					"3.md": "Third",
				})

				const targetBase = join(dir, "agent-skills")
				const plan: AgentInstallPlan = {
					agentId: "claude-code",
					basePath: targetBase,
					tasks: [
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill1",
							sourcePath: skill1,
							targetName: "pkg-skill1",
							targetPath: join(targetBase, "pkg-skill1"),
						},
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill2",
							sourcePath: join(dir, "nonexistent"), // Will fail
							targetName: "pkg-skill2",
							targetPath: join(targetBase, "pkg-skill2"),
						},
						{
							agentId: "claude-code",
							mode: "copy",
							skillName: "skill3",
							sourcePath: skill3,
							targetName: "pkg-skill3",
							targetPath: join(targetBase, "pkg-skill3"),
						},
					],
				}

				const result = await applyAgentInstall(plan)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("does not exist")
				}

				// First skill was installed before failure
				expect(await exists(join(targetBase, "pkg-skill1", "1.md"))).toBe(true)
				// Third skill was NOT installed
				expect(await exists(join(targetBase, "pkg-skill3"))).toBe(false)
			})
		})
	})
})
