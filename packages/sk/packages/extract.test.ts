import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AbsolutePath, DetectedStructure } from "@skills-supply/core"
import { coerceAbsolutePathDirect } from "@skills-supply/core"
import { describe, expect, it } from "vitest"
import { extractSkills } from "@/packages/extract"
import type { CanonicalPackage, DetectedPackage } from "@/packages/types"
import { abs, alias } from "@/tests/helpers/branded"

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = path.join(tmpdir(), `sk-extract-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	try {
		return await fn(dir)
	} finally {
		await rm(dir, { force: true, recursive: true })
	}
}

function makeCanonical(root: string): CanonicalPackage {
	return {
		absolutePath: abs(root),
		fetchStrategy: { mode: "symlink" },
		origin: { alias: alias("pkg"), manifestPath: abs("/test/agents.toml") },
		type: "local",
	}
}

function makeDetected(root: string, detection: DetectedStructure): DetectedPackage {
	return {
		canonical: makeCanonical(root),
		detection,
		packagePath: abs(root),
	}
}

function mustAbsolute(value: string): AbsolutePath {
	const absolute = coerceAbsolutePathDirect(value)
	if (!absolute) {
		throw new Error(`Invalid test path: ${value}`)
	}
	return absolute
}

describe("extractSkills (plugin)", () => {
	it("fails when plugin skills directory is missing", async () => {
		await withTempDir(async (dir) => {
			const pluginDir = path.join(dir, ".claude-plugin")
			await mkdir(pluginDir, { recursive: true })
			const pluginJsonPath = path.join(pluginDir, "plugin.json")
			await writeFile(pluginJsonPath, JSON.stringify({ name: "alpha" }))

			const detection: DetectedStructure = {
				method: "plugin",
				pluginJsonPath: mustAbsolute(pluginJsonPath),
				skillsDir: null,
			}

			const result = await extractSkills(makeDetected(dir, detection))
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.error.type).toBe("validation")
				if (result.error.type === "validation") {
					expect(result.error.field).toBe("skills")
					expect(result.error.message).toContain(
						"Plugin skills directory not found",
					)
				}
			}
		})
	})

	it("fails when plugin skills directory has no skills", async () => {
		await withTempDir(async (dir) => {
			const skillsDir = path.join(dir, "skills")
			await mkdir(skillsDir, { recursive: true })
			const pluginDir = path.join(dir, ".claude-plugin")
			await mkdir(pluginDir, { recursive: true })
			const pluginJsonPath = path.join(pluginDir, "plugin.json")
			await writeFile(pluginJsonPath, JSON.stringify({ name: "alpha" }))

			const detection: DetectedStructure = {
				method: "plugin",
				pluginJsonPath: mustAbsolute(pluginJsonPath),
				skillsDir: mustAbsolute(skillsDir),
			}

			const result = await extractSkills(makeDetected(dir, detection))
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.error.type).toBe("validation")
				if (result.error.type === "validation") {
					expect(result.error.field).toBe("skills")
					expect(result.error.message).toContain("No skills found")
				}
			}
		})
	})

	it("extracts skills from plugin skills directory", async () => {
		await withTempDir(async (dir) => {
			const skillsDir = path.join(dir, "skills")
			const skillDir = path.join(skillsDir, "alpha")
			await mkdir(skillDir, { recursive: true })
			await writeFile(
				path.join(skillDir, "SKILL.md"),
				"---\nname: alpha\n---\n\n# Alpha",
			)
			const pluginDir = path.join(dir, ".claude-plugin")
			await mkdir(pluginDir, { recursive: true })
			const pluginJsonPath = path.join(pluginDir, "plugin.json")
			await writeFile(pluginJsonPath, JSON.stringify({ name: "alpha" }))

			const detection: DetectedStructure = {
				method: "plugin",
				pluginJsonPath: mustAbsolute(pluginJsonPath),
				skillsDir: mustAbsolute(skillsDir),
			}

			const result = await extractSkills(makeDetected(dir, detection))
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value).toHaveLength(1)
				expect(result.value[0]?.name).toBe("alpha")
			}
		})
	})
})
