import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AbsolutePath, DetectedStructure } from "@skills-supply/core"
import { coerceAbsolutePathDirect } from "@skills-supply/core"
import { describe, expect, it } from "vitest"
import type { CanonicalPackage } from "@/packages/types"
import { selectDetectedStructure } from "@/sync/sync"
import { abs, alias, ghRef, nes } from "@/tests/helpers/branded"

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = path.join(tmpdir(), `sk-sync-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	try {
		return await fn(dir)
	} finally {
		await rm(dir, { force: true, recursive: true })
	}
}

function makeCanonical(): CanonicalPackage {
	return {
		fetchStrategy: { mode: "clone", sparse: false },
		gh: ghRef("org/repo"),
		origin: { alias: alias("pkg"), manifestPath: abs("/test/agents.toml") },
		path: undefined,
		ref: undefined,
		type: "github",
	}
}

function makeClaudePlugin(): CanonicalPackage {
	return {
		fetchStrategy: { mode: "clone", sparse: false },
		marketplace: ghRef("org/marketplace"),
		origin: { alias: alias("plugin"), manifestPath: abs("/test/agents.toml") },
		plugin: nes("alpha"),
		type: "claude-plugin",
	}
}

function mustAbsolute(value: string): AbsolutePath {
	const absolute = coerceAbsolutePathDirect(value)
	if (!absolute) {
		throw new Error(`Invalid test path: ${value}`)
	}
	return absolute
}

describe("selectDetectedStructure", () => {
	it("prefers manifest with [package]", async () => {
		await withTempDir(async (dir) => {
			const manifestPath = path.join(dir, "agents.toml")
			await writeFile(manifestPath, '[package]\nname = "pkg"\nversion = "1.0.0"\n')

			const structures: DetectedStructure[] = [
				{
					manifestPath: mustAbsolute(manifestPath),
					method: "manifest",
				},
				{
					method: "plugin",
					pluginJsonPath: mustAbsolute(path.join(dir, "plugin.json")),
					skillsDir: null,
				},
				{ method: "subdir", rootDir: mustAbsolute(dir) },
			]

			const result = await selectDetectedStructure(makeCanonical(), structures)
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value.method).toBe("manifest")
			}
		})
	})

	it("falls back when manifest has no [package]", async () => {
		await withTempDir(async (dir) => {
			const manifestPath = path.join(dir, "agents.toml")
			await writeFile(
				manifestPath,
				'[dependencies]\nsuperpowers = "superpowers@1.0.0"\n',
			)

			const structures: DetectedStructure[] = [
				{
					manifestPath: mustAbsolute(manifestPath),
					method: "manifest",
				},
				{
					method: "plugin",
					pluginJsonPath: mustAbsolute(path.join(dir, "plugin.json")),
					skillsDir: null,
				},
			]

			const result = await selectDetectedStructure(makeCanonical(), structures)
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value.method).toBe("plugin")
			}
		})
	})

	it("prefers plugin over subdir and single", async () => {
		const structures: DetectedStructure[] = [
			{
				method: "plugin",
				pluginJsonPath: abs("/tmp/plugin.json"),
				skillsDir: null,
			},
			{ method: "subdir", rootDir: abs("/tmp/root") },
			{ method: "single", skillPath: abs("/tmp/root") },
		]

		const result = await selectDetectedStructure(makeCanonical(), structures)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.method).toBe("plugin")
		}
	})

	it("prefers subdir over single when both are present", async () => {
		const structures: DetectedStructure[] = [
			{ method: "single", skillPath: abs("/tmp/root/SKILL.md") },
			{ method: "subdir", rootDir: abs("/tmp/root") },
		]

		const result = await selectDetectedStructure(makeCanonical(), structures)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.method).toBe("subdir")
		}
	})

	it("requires plugin structure for claude-plugin packages", async () => {
		const structures: DetectedStructure[] = [
			{ method: "subdir", rootDir: abs("/tmp/root") },
		]

		const result = await selectDetectedStructure(makeClaudePlugin(), structures)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("structure")
			}
		}
	})

	it("uses plugin structure for claude-plugin packages", async () => {
		const structures: DetectedStructure[] = [
			{
				method: "plugin",
				pluginJsonPath: abs("/tmp/plugin.json"),
				skillsDir: null,
			},
			{
				manifestPath: abs("/tmp/agents.toml"),
				method: "manifest",
			},
		]

		const result = await selectDetectedStructure(makeClaudePlugin(), structures)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.method).toBe("plugin")
		}
	})

	it("errors on marketplace-only structure", async () => {
		const structures: DetectedStructure[] = [
			{
				marketplaceJsonPath: abs("/tmp/marketplace.json"),
				method: "marketplace",
			},
		]

		const result = await selectDetectedStructure(makeCanonical(), structures)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("structure")
			}
		}
	})
})
