import { describe, expect, it } from "vitest"
import { parsePlugin } from "@/parsing/plugin"

describe("parsePlugin", () => {
	it("fails on invalid JSON", () => {
		const result = parsePlugin("{not-json}")

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("parse")
			if (result.error.type === "parse") {
				expect(result.error.source).toBe("plugin.json")
			}
		}
	})

	it("fails when required fields are missing", () => {
		const result = parsePlugin(JSON.stringify({ description: "Missing name" }))

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("plugin")
			}
		}
	})

	it("parses a minimal valid plugin", () => {
		const result = parsePlugin(JSON.stringify({ name: "alpha" }))

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({ name: "alpha" })
		}
	})
})
