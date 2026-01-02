import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { detectPackageContents } from "@/src/core/packages/detect"
import type { AbsolutePath } from "@/src/core/types/branded"
import { setupFixtureMarketplace, setupFixturePlugin, withTempDir } from "@/tests/helpers"

describe("detectPackageContents", () => {
	describe("plugin detection", () => {
		it("detects plugin when both marketplace.json and plugin.json exist", async () => {
			await withTempDir(async (dir) => {
				const pkgDir = join(dir, "dual-package")

				// This mirrors the superpowers repo structure:
				// A plugin that also acts as a dev marketplace
				await setupFixturePlugin(pkgDir, {
					includeMarketplace: true,
					marketplaceName: "superpowers-dev",
					name: "superpowers",
					skills: [{ name: "brainstorming" }, { name: "debugging" }],
				})

				const result = await detectPackageContents(pkgDir as AbsolutePath)

				expect(result.ok).toBe(true)
				if (result.ok) {
					// Should detect as "plugin", NOT "marketplace"
					// because plugin.json exists and has extractable skills
					expect(result.value.method).toBe("plugin")
					expect(result.value.skillPaths).toHaveLength(2)
				}
			})
		})

		it("detects plugin when only plugin.json exists", async () => {
			await withTempDir(async (dir) => {
				const pkgDir = join(dir, "standard-plugin")

				await setupFixturePlugin(pkgDir, {
					includeMarketplace: false,
					name: "my-plugin",
					skills: [{ name: "my-skill" }],
				})

				const result = await detectPackageContents(pkgDir as AbsolutePath)

				expect(result.ok).toBe(true)
				if (result.ok) {
					expect(result.value.method).toBe("plugin")
					expect(result.value.skillPaths).toHaveLength(1)
				}
			})
		})

		it("detects plugin with no skills directory", async () => {
			await withTempDir(async (dir) => {
				const pkgDir = join(dir, "skillless-plugin")

				// Plugin with no skills - should still be detected as plugin
				await setupFixturePlugin(pkgDir, {
					name: "no-skills",
					skills: [], // No skills
				})

				const result = await detectPackageContents(pkgDir as AbsolutePath)

				expect(result.ok).toBe(true)
				if (result.ok) {
					expect(result.value.method).toBe("plugin")
					expect(result.value.skillPaths).toHaveLength(0)
				}
			})
		})
	})

	describe("marketplace detection", () => {
		it("detects marketplace when only marketplace.json exists", async () => {
			await withTempDir(async (dir) => {
				const pkgDir = join(dir, "pure-marketplace")

				await setupFixtureMarketplace(pkgDir, {
					name: "my-marketplace",
					plugins: [
						{ name: "plugin-a", source: "github:org/plugin-a" },
						{ name: "plugin-b", source: "github:org/plugin-b" },
					],
				})

				const result = await detectPackageContents(pkgDir as AbsolutePath)

				expect(result.ok).toBe(true)
				if (result.ok) {
					expect(result.value.method).toBe("marketplace")
					expect(result.value.skillPaths).toEqual([])
				}
			})
		})
	})
})
