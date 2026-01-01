import { describe, expect, it } from "vitest"
import "@/tests/helpers/assertions"
import { parseMarketplaceJson } from "@/src/core/marketplace/parse"

describe("parseMarketplaceJson", () => {
	it("parses a valid marketplace manifest", () => {
		const manifest = JSON.stringify({
			metadata: { pluginRoot: "./plugins" },
			name: "example-market",
			plugins: [
				{ name: "alpha", source: "./plugins/alpha" },
				{
					name: "beta",
					source: { repo: "owner/repo", source: "github" },
				},
			],
		})

		const result = parseMarketplaceJson(manifest, "/tmp/marketplace.json")

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.name).toBe("example-market")
			expect(result.value.pluginRoot).toBe("./plugins")
			expect(result.value.plugins).toEqual([
				{ name: "alpha", source: "./plugins/alpha" },
				{
					name: "beta",
					source: { repo: "owner/repo", source: "github" },
				},
			])
		}
	})

	it("rejects missing plugins", () => {
		const manifest = JSON.stringify({
			name: "missing-plugins",
		})

		const result = parseMarketplaceJson(manifest, "/tmp/marketplace.json")

		expect(result).toBeErrContaining("plugins array")
	})

	it("rejects plugins without source", () => {
		const manifest = JSON.stringify({
			name: "bad-plugin",
			plugins: [{ name: "alpha" }],
		})

		const result = parseMarketplaceJson(manifest, "/tmp/marketplace.json")

		expect(result).toBeErrContaining("missing source")
	})
})
