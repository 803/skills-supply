import path from "node:path"
import { describe, expect, it } from "vitest"
import { resolvePluginSource } from "@/marketplace/resolve"
import { parseMarketplace } from "@/parsing/marketplace"
import type { AbsolutePath } from "@/types/branded"
import { coerceAbsolutePathDirect } from "@/types/coerce"
import type { MarketplaceInfo } from "@/types/content"

function mustAbsolute(value: string): AbsolutePath {
	const absolute = coerceAbsolutePathDirect(value)
	if (!absolute) {
		throw new Error(`Invalid test path: ${value}`)
	}
	return absolute
}

function makeMarketplace(
	plugins: Array<{ name: string; source: unknown }>,
): MarketplaceInfo {
	const parsed = parseMarketplace(JSON.stringify({ name: "Test Market", plugins }))
	if (!parsed.ok) {
		throw new Error("Failed to build marketplace fixture")
	}
	return parsed.value
}

describe("resolvePluginSource", () => {
	it("resolves string sources to local paths", () => {
		const marketplace = makeMarketplace([{ name: "alpha", source: "plugins/alpha" }])
		const basePath = mustAbsolute("/tmp/marketplace")

		const result = resolvePluginSource(marketplace, "alpha", basePath)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				path: path.join(basePath, "plugins/alpha"),
				type: "local",
			})
		}
	})

	it("resolves github sources to github declarations", () => {
		const marketplace = makeMarketplace([
			{
				name: "alpha",
				source: { repo: "org/repo", source: "github" },
			},
		])
		const basePath = mustAbsolute("/tmp/marketplace")

		const result = resolvePluginSource(marketplace, "alpha", basePath)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({ gh: "org/repo", type: "github" })
		}
	})

	it("resolves url sources to git declarations", () => {
		const marketplace = makeMarketplace([
			{
				name: "alpha",
				source: { source: "url", url: "https://example.com/repo.git" },
			},
		])
		const basePath = mustAbsolute("/tmp/marketplace")

		const result = resolvePluginSource(marketplace, "alpha", basePath)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				type: "git",
				url: "https://example.com/repo",
			})
		}
	})

	it("fails when the plugin is missing", () => {
		const marketplace = makeMarketplace([{ name: "alpha", source: "plugins/alpha" }])
		const basePath = mustAbsolute("/tmp/marketplace")

		const result = resolvePluginSource(marketplace, "missing", basePath)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("not_found")
		}
	})

	it("fails for unsupported source types", () => {
		const marketplace = makeMarketplace([
			{ name: "alpha", source: { source: "unknown" } },
		])
		const basePath = mustAbsolute("/tmp/marketplace")

		const result = resolvePluginSource(marketplace, "alpha", basePath)

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("source")
			}
		}
	})
})
