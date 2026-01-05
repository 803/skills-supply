import { describe, expect, it } from "vitest"
import { parseFrontmatter } from "@/parsing/frontmatter"

describe("parseFrontmatter", () => {
	it("fails when frontmatter is missing", () => {
		const result = parseFrontmatter("# Title\n\nNo frontmatter")

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("frontmatter")
			}
		}
	})

	it("fails when frontmatter is unclosed", () => {
		const result = parseFrontmatter("---\nname: test\n")

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("frontmatter")
			}
		}
	})

	it("keeps zod errors for invalid frontmatter fields", () => {
		const result = parseFrontmatter("---\ndescription: Works\n---\n\n# Title")

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("frontmatter")
				if (result.error.source === "zod") {
					expect(result.error.zodError).toBeTruthy()
				}
			}
		}
	})

	it("parses name and description", () => {
		const result = parseFrontmatter(
			"---\nname: my-skill\ndescription: Works\n---\n\n# Title",
		)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				description: "Works",
				name: "my-skill",
			})
		}
	})
})
