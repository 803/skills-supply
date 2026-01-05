import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { AbsolutePath, DetectedStructure } from "@skills-supply/core"
import { coerceAbsolutePathDirect } from "@skills-supply/core"
import { describe, expect, it } from "vitest"
import { resolveDetection } from "@/packages/auto-detect"

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = path.join(tmpdir(), `sk-auto-detect-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	try {
		return await fn(dir)
	} finally {
		await rm(dir, { force: true, recursive: true })
	}
}

async function setupPlugin(dir: string, name: string): Promise<string> {
	const pluginDir = path.join(dir, ".claude-plugin")
	await mkdir(pluginDir, { recursive: true })
	const pluginPath = path.join(pluginDir, "plugin.json")
	await writeFile(pluginPath, JSON.stringify({ name }))
	return pluginPath
}

async function setupMarketplace(dir: string, plugins: string[]): Promise<string> {
	const pluginDir = path.join(dir, ".claude-plugin")
	await mkdir(pluginDir, { recursive: true })
	const marketplacePath = path.join(pluginDir, "marketplace.json")
	await writeFile(
		marketplacePath,
		JSON.stringify({
			name: "Market",
			plugins: plugins.map((name) => ({ name, source: "./" })),
		}),
	)
	return marketplacePath
}

function mustAbsolute(value: string): AbsolutePath {
	const absolute = coerceAbsolutePathDirect(value)
	if (!absolute) {
		throw new Error(`Invalid test path: ${value}`)
	}
	return absolute
}

describe("resolveDetection", () => {
	it("prefers manifest with [package]", async () => {
		await withTempDir(async (dir) => {
			const manifestPath = path.join(dir, "agents.toml")
			await writeFile(manifestPath, '[package]\nname = "pkg"\nversion = "1.0.0"\n')
			const pluginPath = await setupPlugin(dir, "alpha")
			const marketplacePath = await setupMarketplace(dir, ["alpha"])

			const structures: DetectedStructure[] = [
				{
					manifestPath: mustAbsolute(manifestPath),
					method: "manifest",
				},
				{
					method: "plugin",
					pluginJsonPath: mustAbsolute(pluginPath),
					skillsDir: null,
				},
				{
					marketplaceJsonPath: mustAbsolute(marketplacePath),
					method: "marketplace",
				},
			]

			const result = await resolveDetection(structures, { hasSubpath: false })
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value).toEqual({ method: "manifest" })
			}
		})
	})

	it("ignores manifests without [package]", async () => {
		await withTempDir(async (dir) => {
			const manifestPath = path.join(dir, "agents.toml")
			await writeFile(manifestPath, '[dependencies]\nfoo = "superpowers@1.0.0"\n')

			const structures: DetectedStructure[] = [
				{
					manifestPath: mustAbsolute(manifestPath),
					method: "manifest",
				},
				{ method: "subdir", rootDir: mustAbsolute(dir) },
			]

			const result = await resolveDetection(structures, { hasSubpath: false })
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value).toEqual({ method: "subdir" })
			}
		})
	})

	it("returns claude-plugin when plugin belongs to marketplace", async () => {
		await withTempDir(async (dir) => {
			const pluginPath = await setupPlugin(dir, "alpha")
			const marketplacePath = await setupMarketplace(dir, ["alpha", "beta"])

			const structures: DetectedStructure[] = [
				{
					method: "plugin",
					pluginJsonPath: mustAbsolute(pluginPath),
					skillsDir: null,
				},
				{
					marketplaceJsonPath: mustAbsolute(marketplacePath),
					method: "marketplace",
				},
			]

			const result = await resolveDetection(structures, { hasSubpath: false })
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value).toEqual({
					method: "claude-plugin",
					pluginName: "alpha",
				})
			}
		})
	})

	it("returns plugin-mismatch when plugin is missing from marketplace", async () => {
		await withTempDir(async (dir) => {
			const pluginPath = await setupPlugin(dir, "alpha")
			const marketplacePath = await setupMarketplace(dir, ["beta"])

			const structures: DetectedStructure[] = [
				{
					method: "plugin",
					pluginJsonPath: mustAbsolute(pluginPath),
					skillsDir: null,
				},
				{
					marketplaceJsonPath: mustAbsolute(marketplacePath),
					method: "marketplace",
				},
			]

			const result = await resolveDetection(structures, { hasSubpath: false })
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value.method).toBe("plugin-mismatch")
				if (result.value.method === "plugin-mismatch") {
					expect(result.value.pluginName).toBe("alpha")
					expect(result.value.marketplace.plugins).toEqual(["beta"])
				}
			}
		})
	})

	it("returns marketplace when only marketplace is present", async () => {
		await withTempDir(async (dir) => {
			const marketplacePath = await setupMarketplace(dir, ["alpha"])

			const structures: DetectedStructure[] = [
				{
					marketplaceJsonPath: mustAbsolute(marketplacePath),
					method: "marketplace",
				},
			]

			const result = await resolveDetection(structures, { hasSubpath: false })
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value.method).toBe("marketplace")
			}
		})
	})

	it("returns plugin when only plugin is present", async () => {
		await withTempDir(async (dir) => {
			const pluginPath = await setupPlugin(dir, "alpha")

			const structures: DetectedStructure[] = [
				{
					method: "plugin",
					pluginJsonPath: mustAbsolute(pluginPath),
					skillsDir: null,
				},
			]

			const result = await resolveDetection(structures, { hasSubpath: false })
			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value).toEqual({ method: "plugin", pluginName: "alpha" })
			}
		})
	})

	it("prefers subdir over single when both are present", async () => {
		const structures: DetectedStructure[] = [
			{ method: "single", skillPath: mustAbsolute("/tmp/skill") },
			{ method: "subdir", rootDir: mustAbsolute("/tmp/skills") },
		]

		const result = await resolveDetection(structures, { hasSubpath: false })
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({ method: "subdir" })
		}
	})

	it("fails when marketplace is detected under a subpath for remote packages", async () => {
		await withTempDir(async (dir) => {
			const marketplacePath = await setupMarketplace(dir, ["alpha"])

			const structures: DetectedStructure[] = [
				{
					marketplaceJsonPath: mustAbsolute(marketplacePath),
					method: "marketplace",
				},
			]

			const result = await resolveDetection(structures, { hasSubpath: true })
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.error.type).toBe("validation")
				if (result.error.type === "validation") {
					expect(result.error.field).toBe("path")
					expect(result.error.message).toContain(
						"Marketplaces must live at repo root",
					)
				}
			}
		})
	})

	it("fails when plugin and marketplace are detected under a subpath for remote packages", async () => {
		await withTempDir(async (dir) => {
			const pluginPath = await setupPlugin(dir, "alpha")
			const marketplacePath = await setupMarketplace(dir, ["alpha"])

			const structures: DetectedStructure[] = [
				{
					method: "plugin",
					pluginJsonPath: mustAbsolute(pluginPath),
					skillsDir: null,
				},
				{
					marketplaceJsonPath: mustAbsolute(marketplacePath),
					method: "marketplace",
				},
			]

			const result = await resolveDetection(structures, { hasSubpath: true })
			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.error.type).toBe("validation")
				if (result.error.type === "validation") {
					expect(result.error.field).toBe("path")
					expect(result.error.message).toContain(
						"Marketplaces must live at repo root",
					)
				}
			}
		})
	})
})
