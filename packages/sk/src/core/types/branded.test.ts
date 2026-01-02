/**
 * Unit tests for branded types and coercion functions
 *
 * These tests validate the BOUNDARY where raw strings become trusted branded types.
 * Once coercion passes, the type system guarantees validity - no runtime checks needed downstream.
 */

import { describe, expect, it } from "vitest"
import "@/tests/helpers/assertions"
import {
	coerceAbsolutePath,
	coerceAbsolutePathDirect,
	coerceAbsolutePathWithError,
	coerceAlias,
	coerceAliasWithError,
	coerceGithubRef,
	coerceGithubRefWithError,
	coerceGitRef,
	coerceGitUrl,
	coerceGitUrlWithError,
	coerceNonEmpty,
	coerceNonEmptyWithError,
	isAbsolutePath,
	isAlias,
	isGithubRef,
	isGitUrl,
	isNonEmpty,
} from "@/src/core/types/coerce"

// ============================================================================
// NonEmptyString
// ============================================================================

describe("coerceNonEmpty", () => {
	describe("valid inputs", () => {
		it("accepts simple string", () => {
			const result = coerceNonEmpty("hello")
			expect(result).toBe("hello")
		})

		it("trims whitespace and returns trimmed value", () => {
			expect(coerceNonEmpty("  hello  ")).toBe("hello")
			expect(coerceNonEmpty("\thello\n")).toBe("hello")
		})

		it("accepts single character", () => {
			expect(coerceNonEmpty("a")).toBe("a")
		})

		it("accepts strings with internal whitespace", () => {
			expect(coerceNonEmpty("hello world")).toBe("hello world")
		})

		it("accepts unicode strings", () => {
			expect(coerceNonEmpty("hello")).toBe("hello")
		})
	})

	describe("invalid inputs", () => {
		it("rejects empty string", () => {
			expect(coerceNonEmpty("")).toBeNull()
		})

		it("rejects whitespace-only string", () => {
			expect(coerceNonEmpty("   ")).toBeNull()
			expect(coerceNonEmpty("\t\n")).toBeNull()
		})
	})
})

describe("coerceNonEmptyWithError", () => {
	it("returns ok result for valid input", () => {
		const result = coerceNonEmptyWithError("hello", "name")
		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value).toBe("hello")
		}
	})

	it("returns error with field name for invalid input", () => {
		const result = coerceNonEmptyWithError("", "name")
		expect(result).toBeErr()
		if (!result.ok) {
			expect(result.error.field).toBe("name")
			expect(result.error.reason).toContain("non-empty")
		}
	})
})

describe("isNonEmpty", () => {
	it("returns true for non-empty string", () => {
		expect(isNonEmpty("hello")).toBe(true)
	})

	it("returns false for empty string", () => {
		expect(isNonEmpty("")).toBe(false)
	})
})

// ============================================================================
// Alias
// ============================================================================

describe("coerceAlias", () => {
	describe("valid inputs", () => {
		it("accepts simple alias", () => {
			expect(coerceAlias("my-package")).toBe("my-package")
		})

		it("accepts alias with underscores", () => {
			expect(coerceAlias("my_package")).toBe("my_package")
		})

		it("accepts alias with numbers", () => {
			expect(coerceAlias("package123")).toBe("package123")
		})

		it("accepts single character alias", () => {
			expect(coerceAlias("a")).toBe("a")
		})

		it("trims whitespace", () => {
			expect(coerceAlias("  my-pkg  ")).toBe("my-pkg")
		})

		it("accepts hyphenated names", () => {
			expect(coerceAlias("some-long-package-name")).toBe("some-long-package-name")
		})
	})

	describe("invalid inputs", () => {
		it("rejects empty string", () => {
			expect(coerceAlias("")).toBeNull()
		})

		it("rejects whitespace-only", () => {
			expect(coerceAlias("   ")).toBeNull()
		})

		it("rejects forward slashes", () => {
			expect(coerceAlias("org/repo")).toBeNull()
		})

		it("rejects backslashes", () => {
			expect(coerceAlias("foo\\bar")).toBeNull()
		})

		it("rejects dots", () => {
			expect(coerceAlias("my.package")).toBeNull()
		})

		it("rejects colons", () => {
			expect(coerceAlias("foo:bar")).toBeNull()
		})

		it("rejects path-like strings", () => {
			expect(coerceAlias("./local")).toBeNull()
			expect(coerceAlias("../parent")).toBeNull()
		})
	})
})

describe("coerceAliasWithError", () => {
	it("returns ok for valid alias", () => {
		const result = coerceAliasWithError("my-pkg", "alias")
		expect(result).toBeOk()
	})

	it("returns error with helpful message for invalid alias", () => {
		const result = coerceAliasWithError("org/repo", "dependency")
		expect(result).toBeErr()
		if (!result.ok) {
			expect(result.error.field).toBe("dependency")
			expect(result.error.reason).toContain("slashes")
		}
	})
})

describe("isAlias", () => {
	it("returns true for valid alias", () => {
		expect(isAlias("my-pkg")).toBe(true)
	})

	it("returns false for invalid alias", () => {
		expect(isAlias("org/repo")).toBe(false)
	})
})

// ============================================================================
// AbsolutePath
// ============================================================================

describe("coerceAbsolutePath", () => {
	describe("valid inputs", () => {
		it("accepts absolute path", () => {
			const result = coerceAbsolutePath("/Users/test/project")
			expect(result).toBe("/Users/test/project")
		})

		it("normalizes path with . and ..", () => {
			const result = coerceAbsolutePath("/Users/test/../other/./project")
			expect(result).toBe("/Users/other/project")
		})

		it("resolves relative path against base", () => {
			const result = coerceAbsolutePath("subdir/file", "/Users/test")
			expect(result).toBe("/Users/test/subdir/file")
		})

		it("trims whitespace", () => {
			const result = coerceAbsolutePath("  /Users/test  ")
			expect(result).toBe("/Users/test")
		})

		it("handles root path", () => {
			expect(coerceAbsolutePath("/")).toBe("/")
		})
	})

	describe("invalid inputs", () => {
		it("rejects empty string", () => {
			expect(coerceAbsolutePath("")).toBeNull()
		})

		it("rejects whitespace-only", () => {
			expect(coerceAbsolutePath("   ")).toBeNull()
		})

		it("rejects relative path without base", () => {
			expect(coerceAbsolutePath("./relative")).toBeNull()
			expect(coerceAbsolutePath("relative/path")).toBeNull()
		})
	})
})

describe("coerceAbsolutePathDirect", () => {
	it("accepts absolute path", () => {
		const result = coerceAbsolutePathDirect("/Users/test")
		expect(result).toBe("/Users/test")
	})

	it("normalizes the path", () => {
		const result = coerceAbsolutePathDirect("/Users/test/../other")
		expect(result).toBe("/Users/other")
	})

	it("rejects relative path even with valid format", () => {
		expect(coerceAbsolutePathDirect("./relative")).toBeNull()
		expect(coerceAbsolutePathDirect("relative")).toBeNull()
	})

	it("rejects empty string", () => {
		expect(coerceAbsolutePathDirect("")).toBeNull()
	})
})

describe("coerceAbsolutePathWithError", () => {
	it("returns ok for valid absolute path", () => {
		const result = coerceAbsolutePathWithError("/Users/test", undefined, "path")
		expect(result).toBeOk()
	})

	it("returns ok for relative path with base", () => {
		const result = coerceAbsolutePathWithError("subdir", "/Users/test", "path")
		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value).toBe("/Users/test/subdir")
		}
	})

	it("returns error for relative path without base", () => {
		const result = coerceAbsolutePathWithError("relative", undefined, "path")
		expect(result).toBeErr()
		if (!result.ok) {
			expect(result.error.reason).toContain("absolute")
		}
	})
})

describe("isAbsolutePath", () => {
	it("returns true for absolute path", () => {
		expect(isAbsolutePath("/Users/test")).toBe(true)
	})

	it("returns false for relative path", () => {
		expect(isAbsolutePath("./relative")).toBe(false)
		expect(isAbsolutePath("relative")).toBe(false)
	})
})

// ============================================================================
// GitUrl
// ============================================================================

describe("coerceGitUrl", () => {
	describe("SSH format", () => {
		it("normalizes git@github.com:owner/repo.git", () => {
			const result = coerceGitUrl("git@github.com:owner/repo.git")
			expect(result).toBe("git@github.com:owner/repo")
		})

		it("preserves git@github.com:owner/repo without .git", () => {
			const result = coerceGitUrl("git@github.com:owner/repo")
			expect(result).toBe("git@github.com:owner/repo")
		})

		it("handles other git hosts", () => {
			const result = coerceGitUrl("git@gitlab.com:org/project.git")
			expect(result).toBe("git@gitlab.com:org/project")
		})

		it("handles nested paths", () => {
			const result = coerceGitUrl("git@github.com:org/nested/repo.git")
			expect(result).toBe("git@github.com:org/nested/repo")
		})
	})

	describe("HTTP(S) format", () => {
		it("normalizes https with .git suffix", () => {
			const result = coerceGitUrl("https://github.com/owner/repo.git")
			expect(result).toBe("https://github.com/owner/repo")
		})

		it("preserves https without .git suffix", () => {
			const result = coerceGitUrl("https://github.com/owner/repo")
			expect(result).toBe("https://github.com/owner/repo")
		})

		it("preserves http scheme", () => {
			const result = coerceGitUrl("http://github.com/owner/repo")
			expect(result).toBe("http://github.com/owner/repo")
		})

		it("handles nested paths", () => {
			const result = coerceGitUrl("https://gitlab.com/org/sub/repo.git")
			expect(result).toBe("https://gitlab.com/org/sub/repo")
		})
	})

	describe("edge cases", () => {
		it("trims whitespace", () => {
			const result = coerceGitUrl("  git@github.com:owner/repo.git  ")
			expect(result).toBe("git@github.com:owner/repo")
		})

		it("handles repos with dots in name", () => {
			const result = coerceGitUrl("https://github.com/owner/my.project.git")
			expect(result).toBe("https://github.com/owner/my.project")
		})

		it("handles repos with hyphens", () => {
			const result = coerceGitUrl("git@github.com:my-org/my-repo.git")
			expect(result).toBe("git@github.com:my-org/my-repo")
		})
	})

	describe("invalid inputs", () => {
		it("rejects empty string", () => {
			expect(coerceGitUrl("")).toBeNull()
		})

		it("rejects whitespace-only", () => {
			expect(coerceGitUrl("   ")).toBeNull()
		})

		it("rejects plain owner/repo format", () => {
			expect(coerceGitUrl("owner/repo")).toBeNull()
		})

		it("rejects ftp URLs", () => {
			expect(coerceGitUrl("ftp://github.com/owner/repo")).toBeNull()
		})

		it("rejects malformed URLs", () => {
			expect(coerceGitUrl("github.com/owner/repo")).toBeNull()
		})

		it("rejects file paths", () => {
			expect(coerceGitUrl("/path/to/repo")).toBeNull()
		})
	})
})

describe("coerceGitUrlWithError", () => {
	it("returns ok for valid git URL", () => {
		const result = coerceGitUrlWithError("git@github.com:org/repo", "url")
		expect(result).toBeOk()
	})

	it("returns error with helpful message for invalid URL", () => {
		const result = coerceGitUrlWithError("not-a-url", "url")
		expect(result).toBeErr()
		if (!result.ok) {
			expect(result.error.reason).toContain("git URL")
		}
	})
})

describe("isGitUrl", () => {
	it("returns true for SSH format", () => {
		expect(isGitUrl("git@github.com:owner/repo")).toBe(true)
	})

	it("returns true for HTTPS format", () => {
		expect(isGitUrl("https://github.com/owner/repo")).toBe(true)
	})

	it("returns false for invalid format", () => {
		expect(isGitUrl("owner/repo")).toBe(false)
	})
})

// ============================================================================
// GithubRef
// ============================================================================

describe("coerceGithubRef", () => {
	describe("valid inputs", () => {
		it("accepts owner/repo format", () => {
			const result = coerceGithubRef("owner/repo")
			expect(result).toBe("owner/repo")
		})

		it("accepts owner with hyphens", () => {
			expect(coerceGithubRef("my-org/my-repo")).toBe("my-org/my-repo")
		})

		it("accepts owner with underscores", () => {
			expect(coerceGithubRef("my_org/my_repo")).toBe("my_org/my_repo")
		})

		it("accepts owner with dots", () => {
			expect(coerceGithubRef("my.org/my.repo")).toBe("my.org/my.repo")
		})

		it("accepts owner with numbers", () => {
			expect(coerceGithubRef("org123/repo456")).toBe("org123/repo456")
		})

		it("trims whitespace", () => {
			expect(coerceGithubRef("  owner/repo  ")).toBe("owner/repo")
		})

		it("accepts single character owner and repo", () => {
			expect(coerceGithubRef("a/b")).toBe("a/b")
		})
	})

	describe("invalid inputs", () => {
		it("rejects empty string", () => {
			expect(coerceGithubRef("")).toBeNull()
		})

		it("rejects whitespace-only", () => {
			expect(coerceGithubRef("   ")).toBeNull()
		})

		it("rejects no slash", () => {
			expect(coerceGithubRef("owner-repo")).toBeNull()
		})

		it("rejects multiple slashes", () => {
			expect(coerceGithubRef("owner/sub/repo")).toBeNull()
		})

		it("rejects empty owner", () => {
			expect(coerceGithubRef("/repo")).toBeNull()
		})

		it("rejects empty repo", () => {
			expect(coerceGithubRef("owner/")).toBeNull()
		})

		it("rejects full URLs", () => {
			expect(coerceGithubRef("https://github.com/owner/repo")).toBeNull()
		})

		it("rejects SSH format", () => {
			expect(coerceGithubRef("git@github.com:owner/repo")).toBeNull()
		})

		it("rejects special characters in owner", () => {
			expect(coerceGithubRef("owner@/repo")).toBeNull()
			expect(coerceGithubRef("owner!/repo")).toBeNull()
		})
	})
})

describe("coerceGithubRefWithError", () => {
	it("returns ok for valid ref", () => {
		const result = coerceGithubRefWithError("owner/repo", "ref")
		expect(result).toBeOk()
	})

	it("returns error with helpful message for invalid ref", () => {
		const result = coerceGithubRefWithError("not-valid", "dependency")
		expect(result).toBeErr()
		if (!result.ok) {
			expect(result.error.reason).toContain("owner/repo")
		}
	})
})

describe("isGithubRef", () => {
	it("returns true for valid format", () => {
		expect(isGithubRef("owner/repo")).toBe(true)
	})

	it("returns false for invalid format", () => {
		expect(isGithubRef("owner-repo")).toBe(false)
	})
})

// ============================================================================
// GitRef (tag/branch/rev)
// ============================================================================

describe("coerceGitRef", () => {
	describe("single ref present", () => {
		it("creates tag ref", () => {
			const result = coerceGitRef({ tag: "v1.0.0" })
			expect(result).toEqual({ type: "tag", value: "v1.0.0" })
		})

		it("creates branch ref", () => {
			const result = coerceGitRef({ branch: "main" })
			expect(result).toEqual({ type: "branch", value: "main" })
		})

		it("creates rev ref", () => {
			const result = coerceGitRef({ rev: "abc123" })
			expect(result).toEqual({ type: "rev", value: "abc123" })
		})

		it("trims whitespace in values", () => {
			const result = coerceGitRef({ tag: "  v1.0.0  " })
			expect(result).toEqual({ type: "tag", value: "v1.0.0" })
		})
	})

	describe("no ref present", () => {
		it("returns null for empty object", () => {
			expect(coerceGitRef({})).toBeNull()
		})

		it("returns null for all undefined", () => {
			expect(
				coerceGitRef({ branch: undefined, rev: undefined, tag: undefined }),
			).toBeNull()
		})

		it("returns null for empty string values", () => {
			expect(coerceGitRef({ tag: "" })).toBeNull()
			expect(coerceGitRef({ tag: "   " })).toBeNull()
		})
	})

	describe("multiple refs present", () => {
		it("throws error for tag and branch", () => {
			expect(() => coerceGitRef({ branch: "main", tag: "v1.0" })).toThrow(
				/Multiple git refs/,
			)
		})

		it("throws error for all three", () => {
			expect(() => coerceGitRef({ branch: "main", rev: "abc", tag: "v1" })).toThrow(
				/Multiple git refs/,
			)
		})

		it("error message lists conflicting refs", () => {
			expect(() => coerceGitRef({ branch: "main", tag: "v1" })).toThrow(
				/tag.*branch|branch.*tag/,
			)
		})
	})

	describe("edge cases", () => {
		it("handles refs with slashes (branch names)", () => {
			const result = coerceGitRef({ branch: "feature/my-feature" })
			expect(result).toEqual({ type: "branch", value: "feature/my-feature" })
		})

		it("handles full commit SHA", () => {
			const result = coerceGitRef({
				rev: "abcdef1234567890abcdef1234567890abcdef12",
			})
			expect(result?.type).toBe("rev")
		})

		it("handles semver tags", () => {
			const result = coerceGitRef({ tag: "v2.0.0-beta.1" })
			expect(result).toEqual({ type: "tag", value: "v2.0.0-beta.1" })
		})
	})
})

// ============================================================================
// Type Utilities
// ============================================================================

describe("unwrap", () => {
	// Note: unwrap is just a passthrough, but we test to document the contract
	it("unwraps branded string to plain string", async () => {
		// Dynamic import to get unwrap
		const { unwrap } = await import("@/src/core/types/branded")
		const branded = coerceNonEmpty("hello")
		expect(branded).not.toBeNull()
		if (branded) {
			const plain: string = unwrap(branded)
			expect(plain).toBe("hello")
		}
	})
})
