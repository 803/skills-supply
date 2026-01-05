import { describe, expect, it } from "vitest"
import { isAutoDetectUrl } from "@/commands/pkg/spec"

describe("isAutoDetectUrl", () => {
	it("accepts GitHub shorthand", () => {
		expect(isAutoDetectUrl("owner/repo")).toBe(true)
	})

	it("accepts GitHub HTTPS URLs", () => {
		expect(isAutoDetectUrl("https://github.com/owner/repo")).toBe(true)
		expect(isAutoDetectUrl("https://github.com/owner/repo.git")).toBe(true)
	})

	it("accepts git SSH and https .git URLs", () => {
		expect(isAutoDetectUrl("git@github.com:owner/repo")).toBe(true)
		expect(isAutoDetectUrl("https://gitlab.com/org/repo.git")).toBe(true)
	})

	it("accepts local paths", () => {
		expect(isAutoDetectUrl("/tmp/my-skills")).toBe(true)
		expect(isAutoDetectUrl("./skills")).toBe(true)
		expect(isAutoDetectUrl("../skills")).toBe(true)
	})

	it("accepts marketplace.json URLs", () => {
		expect(isAutoDetectUrl("https://example.com/marketplace.json")).toBe(true)
	})

	it("rejects empty input", () => {
		expect(isAutoDetectUrl("")).toBe(false)
		expect(isAutoDetectUrl("   ")).toBe(false)
	})

	it("rejects non-auto-detect specs", () => {
		expect(isAutoDetectUrl("my-pkg@1.2.3")).toBe(false)
		expect(isAutoDetectUrl("not a url")).toBe(false)
	})
})
