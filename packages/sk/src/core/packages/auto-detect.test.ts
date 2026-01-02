import { describe, expect, it } from "vitest"
import "@/tests/helpers/assertions"
import { parseAutoDetectUrl } from "@/src/core/packages/auto-detect"

describe("parseAutoDetectUrl", () => {
	it("parses GitHub HTTPS and SSH URLs", () => {
		const https = parseAutoDetectUrl("https://github.com/owner/repo")
		expect(https).toBeOk()
		if (https.ok) {
			expect(https.value).toEqual({ slug: "owner/repo", type: "github" })
		}

		const ssh = parseAutoDetectUrl("git@github.com:owner/repo.git")
		expect(ssh).toBeOk()
		if (ssh.ok) {
			expect(ssh.value).toEqual({ slug: "owner/repo", type: "github" })
		}
	})

	it("parses non-GitHub HTTPS URLs ending in .git", () => {
		const result = parseAutoDetectUrl("https://gitlab.com/org/repo.git")
		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value).toEqual({
				type: "git",
				url: "https://gitlab.com/org/repo",
			})
		}
	})

	it("rejects unsupported formats", () => {
		const result = parseAutoDetectUrl("owner/repo")
		expect(result).toBeErrContaining("Unsupported URL format")
	})
})
