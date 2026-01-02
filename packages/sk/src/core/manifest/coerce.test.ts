/**
 * Tests for manifest/coerce.ts
 *
 * These tests validate dependency coercion from raw declarations into
 * branded, validated dependency types.
 */

import { describe, expect, it } from "vitest"
import { coerceDependency } from "@/src/core/manifest/coerce"
import type {
	ClaudePluginDeclaration,
	DependencyDeclaration,
	GithubPackageDeclaration,
	GitPackageDeclaration,
	LocalPackageDeclaration,
} from "@/src/core/manifest/types"
import type { AbsolutePath } from "@/src/core/types/branded"
import "@/tests/helpers/assertions"

// =============================================================================
// TEST FIXTURES
// =============================================================================

const TEST_SOURCE_PATH = "/test/project/agents.toml" as AbsolutePath

// =============================================================================
// coerceDependency - REGISTRY DEPENDENCIES
// =============================================================================

describe("coerceDependency - registry strings", () => {
	it("parses simple name@version format", () => {
		const result = coerceDependency("my-pkg@1.0.0", "alias", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.type).toBe("registry")
			if (result.value.type === "registry") {
				expect(result.value.name).toBe("my-pkg")
				expect(result.value.version).toBe("1.0.0")
				expect(result.value.org).toBeUndefined()
			}
		}
	})

	it("parses @org/name@version format", () => {
		const result = coerceDependency("@my-org/pkg@2.0.0", "alias", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.type).toBe("registry")
			if (result.value.type === "registry") {
				expect(result.value.org).toBe("my-org")
				expect(result.value.name).toBe("pkg")
				expect(result.value.version).toBe("2.0.0")
			}
		}
	})

	it("rejects missing version", () => {
		const result = coerceDependency("my-pkg", "alias", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid registry dependency format")
	})

	it("rejects empty name in simple format", () => {
		const result = coerceDependency("@1.0.0", "alias", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})

	it("rejects empty org in @org/name format", () => {
		const result = coerceDependency("@/pkg@1.0.0", "alias", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})

	it("rejects empty version", () => {
		const result = coerceDependency("my-pkg@", "alias", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})

	it("rejects whitespace-only version", () => {
		const result = coerceDependency("my-pkg@   ", "alias", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})

	it("handles complex version strings", () => {
		const result = coerceDependency(
			"pkg@1.0.0-beta.1+build.123",
			"alias",
			TEST_SOURCE_PATH,
		)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "registry") {
			expect(result.value.version).toBe("1.0.0-beta.1+build.123")
		}
	})
})

// =============================================================================
// coerceDependency - GITHUB DEPENDENCIES
// =============================================================================

describe("coerceDependency - github", () => {
	it("coerces valid github dependency with gh field only", () => {
		const decl: GithubPackageDeclaration = { gh: "owner/repo" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.type).toBe("github")
			if (result.value.type === "github") {
				expect(result.value.gh).toBe("owner/repo")
				expect(result.value.ref).toBeUndefined()
				expect(result.value.path).toBeUndefined()
			}
		}
	})

	it("coerces github dependency with tag", () => {
		const decl: GithubPackageDeclaration = { gh: "owner/repo", tag: "v1.0.0" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "github") {
			expect(result.value.ref).toEqual({ type: "tag", value: "v1.0.0" })
		}
	})

	it("coerces github dependency with branch", () => {
		const decl: GithubPackageDeclaration = { branch: "main", gh: "owner/repo" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "github") {
			expect(result.value.ref).toEqual({ type: "branch", value: "main" })
		}
	})

	it("coerces github dependency with rev", () => {
		const decl: GithubPackageDeclaration = { gh: "owner/repo", rev: "abc123" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "github") {
			expect(result.value.ref).toEqual({ type: "rev", value: "abc123" })
		}
	})

	it("coerces github dependency with path", () => {
		const decl: GithubPackageDeclaration = { gh: "owner/repo", path: "packages/foo" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "github") {
			expect(result.value.path).toBe("packages/foo")
		}
	})

	it("rejects invalid github ref format", () => {
		const decl: GithubPackageDeclaration = { gh: "invalid" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid GitHub reference")
	})

	it("rejects empty owner", () => {
		const decl: GithubPackageDeclaration = { gh: "/repo" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})

	it("rejects empty repo", () => {
		const decl: GithubPackageDeclaration = { gh: "owner/" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})

	it("rejects multiple git refs", () => {
		const decl: GithubPackageDeclaration = {
			branch: "main",
			gh: "owner/repo",
			tag: "v1",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Multiple git refs")
	})

	it("rejects empty path", () => {
		const decl: GithubPackageDeclaration = { gh: "owner/repo", path: "" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("path must be non-empty")
	})

	it("rejects whitespace-only path", () => {
		const decl: GithubPackageDeclaration = { gh: "owner/repo", path: "   " }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})
})

// =============================================================================
// coerceDependency - GIT DEPENDENCIES
// =============================================================================

describe("coerceDependency - git", () => {
	it("coerces valid git dependency with https URL", () => {
		const decl: GitPackageDeclaration = { git: "https://github.com/owner/repo.git" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.type).toBe("git")
			if (result.value.type === "git") {
				expect(result.value.url).toBe("https://github.com/owner/repo")
			}
		}
	})

	it("coerces git dependency with ssh URL", () => {
		const decl: GitPackageDeclaration = { git: "git@github.com:owner/repo.git" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "git") {
			expect(result.value.url).toBe("https://github.com/owner/repo")
		}
	})

	it("coerces git dependency with tag", () => {
		const decl: GitPackageDeclaration = {
			git: "https://github.com/owner/repo",
			tag: "v2.0.0",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "git") {
			expect(result.value.ref).toEqual({ type: "tag", value: "v2.0.0" })
		}
	})

	it("coerces git dependency with branch", () => {
		const decl: GitPackageDeclaration = {
			branch: "develop",
			git: "https://github.com/owner/repo",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "git") {
			expect(result.value.ref).toEqual({ type: "branch", value: "develop" })
		}
	})

	it("coerces git dependency with path", () => {
		const decl: GitPackageDeclaration = {
			git: "https://github.com/owner/repo",
			path: "sub/dir",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "git") {
			expect(result.value.path).toBe("sub/dir")
		}
	})

	it("rejects invalid git URL", () => {
		const decl: GitPackageDeclaration = { git: "not-a-valid-url" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid git URL")
	})

	it("rejects empty git URL", () => {
		const decl: GitPackageDeclaration = { git: "" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})

	it("rejects multiple git refs", () => {
		const decl: GitPackageDeclaration = {
			git: "https://github.com/owner/repo",
			rev: "abc123",
			tag: "v1",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Multiple git refs")
	})
})

// =============================================================================
// coerceDependency - LOCAL DEPENDENCIES
// =============================================================================

describe("coerceDependency - local", () => {
	it("coerces absolute path", () => {
		const decl: LocalPackageDeclaration = { path: "/absolute/path/to/pkg" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.type).toBe("local")
			if (result.value.type === "local") {
				expect(result.value.path).toBe("/absolute/path/to/pkg")
			}
		}
	})

	it("resolves relative path against manifest directory", () => {
		const decl: LocalPackageDeclaration = { path: "../other-pkg" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "local") {
			// /test/project/agents.toml -> /test/project -> /test/other-pkg
			expect(result.value.path).toBe("/test/other-pkg")
		}
	})

	it("resolves ./relative path", () => {
		const decl: LocalPackageDeclaration = { path: "./sub-pkg" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "local") {
			expect(result.value.path).toBe("/test/project/sub-pkg")
		}
	})

	it("rejects empty path", () => {
		const decl: LocalPackageDeclaration = { path: "" }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid local path")
	})

	it("rejects whitespace-only path", () => {
		const decl: LocalPackageDeclaration = { path: "   " }
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})
})

// =============================================================================
// coerceDependency - CLAUDE PLUGIN DEPENDENCIES
// =============================================================================

describe("coerceDependency - claude-plugin", () => {
	it("coerces valid claude-plugin dependency", () => {
		const decl: ClaudePluginDeclaration = {
			marketplace: "https://github.com/org/marketplace",
			plugin: "my-plugin",
			type: "claude-plugin",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.type).toBe("claude-plugin")
			if (result.value.type === "claude-plugin") {
				expect(result.value.plugin).toBe("my-plugin")
				expect(result.value.marketplace).toBe(
					"https://github.com/org/marketplace",
				)
			}
		}
	})

	it("coerces claude-plugin with ssh marketplace URL", () => {
		const decl: ClaudePluginDeclaration = {
			marketplace: "git@github.com:org/sensei-marketplace.git",
			plugin: "sensei",
			type: "claude-plugin",
		}
		const result = coerceDependency(decl, "sensei", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "claude-plugin") {
			expect(result.value.marketplace).toBe(
				"https://github.com/org/sensei-marketplace",
			)
		}
	})

	it("rejects empty plugin name", () => {
		const decl: ClaudePluginDeclaration = {
			marketplace: "https://github.com/org/marketplace",
			plugin: "",
			type: "claude-plugin",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("plugin must be non-empty")
	})

	it("rejects invalid marketplace", () => {
		const decl: ClaudePluginDeclaration = {
			marketplace: "not-a-url",
			plugin: "my-plugin",
			type: "claude-plugin",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid marketplace")
	})

	it("accepts github shorthand marketplace", () => {
		const decl: ClaudePluginDeclaration = {
			marketplace: "owner/repo",
			plugin: "my-plugin",
			type: "claude-plugin",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeOk()
		if (result.ok && result.value.type === "claude-plugin") {
			expect(result.value.marketplace).toBe("owner/repo")
		}
	})
})

// =============================================================================
// coerceDependency - UNKNOWN TYPE
// =============================================================================

describe("coerceDependency - unknown types", () => {
	it("rejects unknown dependency type", () => {
		const decl = { unknown_field: "value" } as unknown as DependencyDeclaration
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Unknown dependency type")
	})

	it("rejects object with only unrecognized fields", () => {
		const decl = { baz: 123, foo: "bar" } as unknown as DependencyDeclaration
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
	})
})
