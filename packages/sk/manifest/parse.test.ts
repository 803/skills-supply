import { describe, expect, it } from "vitest"
import "@/tests/helpers/assertions"
import type { AbsolutePath } from "@skills-supply/core"
import { coerceAlias } from "@skills-supply/core"
import { parseManifest } from "@/manifest/parse"

const testPath = "/test/agents.toml" as AbsolutePath

describe("parseManifest", () => {
	it("reports invalid TOML syntax", () => {
		const result = parseManifest("[package", testPath, "cwd")

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("parse")
			if (result.error.type === "parse") {
				expect(result.error.source).toBe("agents.toml")
				expect(result.error.message).toContain("Invalid TOML")
				expect(result.error.path).toBe(testPath)
			}
		}
	})

	it("parses empty manifest", () => {
		const result = parseManifest("", testPath, "cwd")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.dependencies.size).toBe(0)
			expect(result.value.agents.size).toBe(0)
			expect(result.value.origin.sourcePath).toBe(testPath)
		}
	})

	it("resolves local dependency paths relative to the manifest", () => {
		const toml = `
[dependencies]
local = { path = "./skills" }
`
		const result = parseManifest(toml, testPath, "cwd")

		expect(result.ok).toBe(true)
		if (result.ok) {
			const alias = coerceAlias("local")
			expect(alias).toBeTruthy()
			if (alias) {
				expect(result.value.dependencies.get(alias)).toEqual({
					path: "/test/skills",
					type: "local",
				})
			}
		}
	})
})
