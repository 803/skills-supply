import { describe, expect, it } from "vitest"
import { parseMarketplace } from "@/parsing/marketplace"

describe("parseMarketplace", () => {
	it("fails on invalid JSON", () => {
		const result = parseMarketplace("{not-json}")

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("parse")
			if (result.error.type === "parse") {
				expect(result.error.source).toBe("marketplace.json")
			}
		}
	})

	it("fails on missing required fields", () => {
		const result = parseMarketplace(JSON.stringify({ name: "Test" }))

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("marketplace")
			}
		}
	})

	it("parses a minimal valid marketplace", () => {
		const result = parseMarketplace(
			JSON.stringify({
				name: "Test Market",
				plugins: [{ name: "alpha", source: "plugins/alpha" }],
			}),
		)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.name).toBe("Test Market")
			expect(result.value.plugins).toHaveLength(1)
			expect(result.value.plugins[0]).toEqual({
				name: "alpha",
				source: "plugins/alpha",
			})
		}
	})
})
