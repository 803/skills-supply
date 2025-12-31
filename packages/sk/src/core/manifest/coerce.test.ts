/**
 * Tests for manifest/coerce.ts
 *
 * These tests validate the COERCION BOUNDARY - where raw parsed TOML data
 * becomes type-safe branded types. This is critical because once data passes
 * coercion, the type system guarantees validity throughout the core logic.
 */

import { describe, expect, it } from "vitest"
import {
	coerceDependency,
	coerceManifest,
	type RawParsedManifest,
} from "@/src/core/manifest/coerce"
import type {
	ClaudePluginDeclaration,
	DependencyDeclaration,
	GithubPackageDeclaration,
	GitPackageDeclaration,
	LocalPackageDeclaration,
} from "@/src/core/manifest/types"
import type { AbsolutePath, ManifestDiscoveredAt } from "@/src/core/types/branded"
import { coerceAlias } from "@/src/core/types/coerce"
import "@/tests/helpers/assertions"

// =============================================================================
// TEST FIXTURES
// =============================================================================

const TEST_SOURCE_PATH = "/test/project/package.toml" as AbsolutePath
const TEST_DISCOVERED_AT: ManifestDiscoveredAt = "cwd"

function alias(value: string) {
	const coerced = coerceAlias(value)
	if (!coerced) {
		throw new Error(`Invalid alias in test: ${value}`)
	}
	return coerced
}

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
			// /test/project/package.toml -> /test/project -> /test/other-pkg
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

	it("rejects invalid marketplace URL", () => {
		const decl: ClaudePluginDeclaration = {
			marketplace: "not-a-url",
			plugin: "my-plugin",
			type: "claude-plugin",
		}
		const result = coerceDependency(decl, "my-dep", TEST_SOURCE_PATH)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid marketplace URL")
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

// =============================================================================
// coerceManifest - FULL MANIFEST COERCION
// =============================================================================

describe("coerceManifest", () => {
	it("coerces minimal manifest", () => {
		const raw: RawParsedManifest = {}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.agents.size).toBe(0)
			expect(result.value.dependencies.size).toBe(0)
			expect(result.value.package).toBeUndefined()
			expect(result.value.exports).toBeUndefined()
			expect(result.value.origin.sourcePath).toBe(TEST_SOURCE_PATH)
			expect(result.value.origin.discoveredAt).toBe("cwd")
		}
	})

	it("coerces manifest with valid agents", () => {
		const raw: RawParsedManifest = {
			agents: { "claude-code": true, codex: false, opencode: true },
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.agents.get("claude-code")).toBe(true)
			expect(result.value.agents.get("codex")).toBe(false)
			expect(result.value.agents.get("opencode")).toBe(true)
		}
	})

	it("silently ignores unknown agent IDs", () => {
		const raw: RawParsedManifest = {
			agents: { "claude-code": true, "unknown-agent": true },
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.agents.size).toBe(1)
			expect(result.value.agents.get("claude-code")).toBe(true)
		}
	})

	it("coerces manifest with dependencies", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				"gh-pkg": { gh: "owner/repo" },
				"my-pkg": "some-org/some-pkg@1.0.0",
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.dependencies.size).toBe(2)
			const myPkg = result.value.dependencies.get(alias("my-pkg"))
			expect(myPkg?.type).toBe("registry")
			const ghPkg = result.value.dependencies.get(alias("gh-pkg"))
			expect(ghPkg?.type).toBe("github")
		}
	})

	it("rejects invalid alias", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				"invalid/alias": { gh: "owner/repo" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid alias")
		expect(result).toBeErrContaining("slashes")
	})

	it("rejects alias with dots", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				"invalid.alias": { gh: "owner/repo" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid alias")
	})

	it("rejects alias with colons", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				"invalid:alias": { gh: "owner/repo" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid alias")
	})

	it("propagates dependency coercion errors", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				"my-dep": { gh: "invalid-gh-ref" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid GitHub reference")
	})
})

// =============================================================================
// coerceManifest - PACKAGE METADATA
// =============================================================================

describe("coerceManifest - package metadata", () => {
	it("coerces valid package metadata", () => {
		const raw: RawParsedManifest = {
			package: {
				name: "my-package",
				version: "1.0.0",
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.package?.name).toBe("my-package")
			expect(result.value.package?.version).toBe("1.0.0")
		}
	})

	it("coerces package with optional fields", () => {
		const raw: RawParsedManifest = {
			package: {
				description: "A test package",
				license: "MIT",
				name: "my-package",
				org: "my-org",
				version: "1.0.0",
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.package?.description).toBe("A test package")
			expect(result.value.package?.license).toBe("MIT")
			expect(result.value.package?.org).toBe("my-org")
		}
	})

	it("rejects empty package name", () => {
		const raw: RawParsedManifest = {
			package: {
				name: "",
				version: "1.0.0",
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("package.name must be non-empty")
	})

	it("rejects whitespace-only package name", () => {
		const raw: RawParsedManifest = {
			package: {
				name: "   ",
				version: "1.0.0",
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
	})

	it("rejects empty package version", () => {
		const raw: RawParsedManifest = {
			package: {
				name: "my-package",
				version: "",
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("package.version must be non-empty")
	})

	it("handles empty optional fields by omitting them", () => {
		const raw: RawParsedManifest = {
			package: {
				description: "",
				license: "   ",
				name: "my-package",
				version: "1.0.0",
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.package?.description).toBeUndefined()
			expect(result.value.package?.license).toBeUndefined()
		}
	})
})

// =============================================================================
// coerceManifest - EXPORTS
// =============================================================================

describe("coerceManifest - exports", () => {
	it("coerces exports with skills glob", () => {
		const raw: RawParsedManifest = {
			exports: {
				autoDiscover: { skills: "**/*.md" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.exports?.autoDiscover.skills).toBe("**/*.md")
		}
	})

	it("coerces exports with skills disabled", () => {
		const raw: RawParsedManifest = {
			exports: {
				autoDiscover: { skills: false },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.exports?.autoDiscover.skills).toBe(false)
		}
	})

	it("rejects empty skills glob", () => {
		const raw: RawParsedManifest = {
			exports: {
				autoDiscover: { skills: "" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
		expect(result).toBeErrContaining(
			"exports.auto_discover.skills must be non-empty or false",
		)
	})

	it("rejects whitespace-only skills glob", () => {
		const raw: RawParsedManifest = {
			exports: {
				autoDiscover: { skills: "   " },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
	})
})

// =============================================================================
// coerceManifest - ORIGIN TRACKING
// =============================================================================

describe("coerceManifest - origin tracking", () => {
	it("tracks cwd origin", () => {
		const raw: RawParsedManifest = {}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, "cwd")

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.origin.discoveredAt).toBe("cwd")
			expect(result.value.origin.sourcePath).toBe(TEST_SOURCE_PATH)
		}
	})

	it("tracks parent origin", () => {
		const raw: RawParsedManifest = {}
		const result = coerceManifest(
			raw,
			"/parent/package.toml" as AbsolutePath,
			"parent",
		)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.origin.discoveredAt).toBe("parent")
		}
	})

	it("tracks home origin", () => {
		const raw: RawParsedManifest = {}
		const result = coerceManifest(
			raw,
			"/home/user/package.toml" as AbsolutePath,
			"home",
		)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.origin.discoveredAt).toBe("home")
		}
	})

	it("tracks sk-global origin", () => {
		const raw: RawParsedManifest = {}
		const result = coerceManifest(
			raw,
			"/home/user/.sk/package.toml" as AbsolutePath,
			"sk-global",
		)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.origin.discoveredAt).toBe("sk-global")
		}
	})
})

// =============================================================================
// EDGE CASES AND BOUNDARY CONDITIONS
// =============================================================================

describe("coercion edge cases", () => {
	it("trims whitespace from string values", () => {
		const raw: RawParsedManifest = {
			package: {
				name: "  my-package  ",
				version: "  1.0.0  ",
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.package?.name).toBe("my-package")
			expect(result.value.package?.version).toBe("1.0.0")
		}
	})

	it("handles complex dependency alias names", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				"my-complex-alias-123": { gh: "owner/repo" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.dependencies.has(alias("my-complex-alias-123"))).toBe(
				true,
			)
		}
	})

	it("handles underscores in alias names", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				my_alias_with_underscores: { gh: "owner/repo" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(
				result.value.dependencies.has(alias("my_alias_with_underscores")),
			).toBe(true)
		}
	})

	it("rejects empty alias", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				"": { gh: "owner/repo" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
		expect(result).toBeErrContaining("Invalid alias")
	})

	it("rejects whitespace-only alias", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				"   ": { gh: "owner/repo" },
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeErr()
	})

	it("handles multiple dependencies of different types", () => {
		const raw: RawParsedManifest = {
			dependencies: {
				git: { git: "https://github.com/owner/repo2" },
				github: { gh: "owner/repo" },
				local: { path: "/local/path" },
				registry: "org/pkg@1.0.0",
			},
		}
		const result = coerceManifest(raw, TEST_SOURCE_PATH, TEST_DISCOVERED_AT)

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.dependencies.size).toBe(4)
			expect(result.value.dependencies.get(alias("registry"))?.type).toBe(
				"registry",
			)
			expect(result.value.dependencies.get(alias("github"))?.type).toBe("github")
			expect(result.value.dependencies.get(alias("git"))?.type).toBe("git")
			expect(result.value.dependencies.get(alias("local"))?.type).toBe("local")
		}
	})
})
