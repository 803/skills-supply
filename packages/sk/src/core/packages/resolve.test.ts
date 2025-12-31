/**
 * Tests for packages/resolve.ts
 *
 * This module converts ValidatedDependency to CanonicalPackage.
 * Since inputs are already validated (branded types), tests focus on:
 * - Correct mapping of each dependency type
 * - Fetch strategy determination
 * - Origin preservation
 */

import { describe, expect, it } from "vitest"
import "@/tests/helpers/assertions"
import type {
	ManifestDependencyEntry,
	MergedManifest,
	ValidatedClaudePluginDependency,
	ValidatedGitDependency,
	ValidatedGithubDependency,
	ValidatedLocalDependency,
	ValidatedRegistryDependency,
} from "@/src/core/manifest/types"
import {
	resolveMergedPackages,
	resolveValidatedDependency,
} from "@/src/core/packages/resolve"
import type {
	AbsolutePath,
	AgentId,
	Alias,
	GithubRef,
	ManifestOrigin,
	NonEmptyString,
	NormalizedGitUrl,
	PackageOrigin,
} from "@/src/core/types/branded"

// =============================================================================
// TEST HELPERS - create branded types for test fixtures
// =============================================================================

function alias(s: string): Alias {
	return s as Alias
}

function nonEmpty(s: string): NonEmptyString {
	return s as NonEmptyString
}

function absPath(s: string): AbsolutePath {
	return s as AbsolutePath
}

function gitUrl(s: string): NormalizedGitUrl {
	return s as NormalizedGitUrl
}

function ghRef(s: string): GithubRef {
	return s as GithubRef
}

function makeOrigin(aliasStr: string, path = "/test/package.toml"): PackageOrigin {
	return {
		alias: alias(aliasStr),
		manifestPath: absPath(path),
	}
}

function makeManifestOrigin(
	path = "/test/package.toml",
	discoveredAt: "cwd" | "parent" | "home" | "sk-global" = "cwd",
): ManifestOrigin {
	return {
		discoveredAt,
		sourcePath: absPath(path),
	}
}

// =============================================================================
// resolveValidatedDependency - Registry packages
// =============================================================================

describe("resolveValidatedDependency", () => {
	describe("registry dependencies", () => {
		it("resolves basic registry dependency", () => {
			const dep: ValidatedRegistryDependency = {
				name: nonEmpty("superpowers"),
				org: nonEmpty("superpowers-marketplace"),
				type: "registry",
				version: nonEmpty("1.0.0"),
			}
			const origin = makeOrigin("superpowers")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toMatchInlineSnapshot(`
				{
				  "fetchStrategy": {
				    "mode": "clone",
				    "sparse": false,
				  },
				  "name": "superpowers",
				  "org": "superpowers-marketplace",
				  "origin": {
				    "alias": "superpowers",
				    "manifestPath": "/test/package.toml",
				  },
				  "registry": "skills.supply",
				  "type": "registry",
				  "version": "1.0.0",
				}
			`)
		})

		it("resolves registry dependency without org", () => {
			const dep: ValidatedRegistryDependency = {
				name: nonEmpty("my-skill"),
				type: "registry",
				version: nonEmpty("2.0.0"),
			}
			const origin = makeOrigin("my-skill")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.type).toBe("registry")
			if (result.type === "registry") {
				expect(result.name).toBe("my-skill")
				expect(result.org).toBeUndefined()
				expect(result.version).toBe("2.0.0")
				expect(result.registry).toBe("skills.supply")
			}
		})

		it("preserves origin information", () => {
			const dep: ValidatedRegistryDependency = {
				name: nonEmpty("pkg"),
				type: "registry",
				version: nonEmpty("1.0.0"),
			}
			const origin = makeOrigin("custom-alias", "/custom/path/package.toml")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.origin.alias).toBe("custom-alias")
			expect(result.origin.manifestPath).toBe("/custom/path/package.toml")
		})

		it("uses clone fetch strategy without sparse", () => {
			const dep: ValidatedRegistryDependency = {
				name: nonEmpty("pkg"),
				type: "registry",
				version: nonEmpty("1.0.0"),
			}
			const origin = makeOrigin("pkg")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: false })
		})
	})

	// =============================================================================
	// resolveValidatedDependency - GitHub packages
	// =============================================================================

	describe("github dependencies", () => {
		it("resolves basic github dependency", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("superpowers-marketplace/superpowers"),
				type: "github",
			}
			const origin = makeOrigin("superpowers")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toMatchInlineSnapshot(`
				{
				  "fetchStrategy": {
				    "mode": "clone",
				    "sparse": false,
				  },
				  "gh": "superpowers-marketplace/superpowers",
				  "origin": {
				    "alias": "superpowers",
				    "manifestPath": "/test/package.toml",
				  },
				  "path": undefined,
				  "ref": undefined,
				  "type": "github",
				}
			`)
		})

		it("resolves github dependency with tag ref", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/repo"),
				ref: { type: "tag", value: nonEmpty("v1.0.0") },
				type: "github",
			}
			const origin = makeOrigin("repo")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.type).toBe("github")
			if (result.type === "github") {
				expect(result.ref).toEqual({ type: "tag", value: "v1.0.0" })
			}
		})

		it("resolves github dependency with branch ref", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/repo"),
				ref: { type: "branch", value: nonEmpty("develop") },
				type: "github",
			}
			const origin = makeOrigin("repo")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.type).toBe("github")
			if (result.type === "github") {
				expect(result.ref).toEqual({ type: "branch", value: "develop" })
			}
		})

		it("resolves github dependency with rev ref", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/repo"),
				ref: { type: "rev", value: nonEmpty("abc123") },
				type: "github",
			}
			const origin = makeOrigin("repo")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.type).toBe("github")
			if (result.type === "github") {
				expect(result.ref).toEqual({ type: "rev", value: "abc123" })
			}
		})

		it("resolves github dependency with path (sparse clone)", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/monorepo"),
				path: nonEmpty("packages/my-skill"),
				type: "github",
			}
			const origin = makeOrigin("my-skill")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.type).toBe("github")
			if (result.type === "github") {
				expect(result.path).toBe("packages/my-skill")
				expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: true })
			}
		})

		it("uses non-sparse clone when no path specified", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/repo"),
				type: "github",
			}
			const origin = makeOrigin("repo")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: false })
		})

		it("resolves github dependency with all fields", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("superpowers-marketplace/elements-of-style"),
				path: nonEmpty("skills"),
				ref: { type: "tag", value: nonEmpty("v2.0.0") },
				type: "github",
			}
			const origin = makeOrigin("elements")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toMatchInlineSnapshot(`
				{
				  "fetchStrategy": {
				    "mode": "clone",
				    "sparse": true,
				  },
				  "gh": "superpowers-marketplace/elements-of-style",
				  "origin": {
				    "alias": "elements",
				    "manifestPath": "/test/package.toml",
				  },
				  "path": "skills",
				  "ref": {
				    "type": "tag",
				    "value": "v2.0.0",
				  },
				  "type": "github",
				}
			`)
		})
	})

	// =============================================================================
	// resolveValidatedDependency - Git packages
	// =============================================================================

	describe("git dependencies", () => {
		it("resolves basic git dependency", () => {
			const dep: ValidatedGitDependency = {
				type: "git",
				url: gitUrl("https://github.com/org/repo"),
			}
			const origin = makeOrigin("repo")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toMatchInlineSnapshot(`
				{
				  "fetchStrategy": {
				    "mode": "clone",
				    "sparse": false,
				  },
				  "origin": {
				    "alias": "repo",
				    "manifestPath": "/test/package.toml",
				  },
				  "path": undefined,
				  "ref": undefined,
				  "type": "git",
				  "url": "https://github.com/org/repo",
				}
			`)
		})

		it("resolves git dependency with ref", () => {
			const dep: ValidatedGitDependency = {
				ref: { type: "tag", value: nonEmpty("v1.0.0") },
				type: "git",
				url: gitUrl("https://gitlab.com/org/repo"),
			}
			const origin = makeOrigin("repo")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.type).toBe("git")
			if (result.type === "git") {
				expect(result.url).toBe("https://gitlab.com/org/repo")
				expect(result.ref).toEqual({ type: "tag", value: "v1.0.0" })
			}
		})

		it("resolves git dependency with path (sparse clone)", () => {
			const dep: ValidatedGitDependency = {
				path: nonEmpty("packages/core"),
				type: "git",
				url: gitUrl("https://bitbucket.org/org/monorepo"),
			}
			const origin = makeOrigin("core")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.type).toBe("git")
			if (result.type === "git") {
				expect(result.path).toBe("packages/core")
				expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: true })
			}
		})

		it("resolves git dependency with all fields", () => {
			const dep: ValidatedGitDependency = {
				path: nonEmpty("skills/utils"),
				ref: { type: "branch", value: nonEmpty("main") },
				type: "git",
				url: gitUrl("https://gitlab.com/my-org/my-repo"),
			}
			const origin = makeOrigin("utils")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toMatchInlineSnapshot(`
				{
				  "fetchStrategy": {
				    "mode": "clone",
				    "sparse": true,
				  },
				  "origin": {
				    "alias": "utils",
				    "manifestPath": "/test/package.toml",
				  },
				  "path": "skills/utils",
				  "ref": {
				    "type": "branch",
				    "value": "main",
				  },
				  "type": "git",
				  "url": "https://gitlab.com/my-org/my-repo",
				}
			`)
		})
	})

	// =============================================================================
	// resolveValidatedDependency - Local packages
	// =============================================================================

	describe("local dependencies", () => {
		it("resolves local dependency", () => {
			const dep: ValidatedLocalDependency = {
				path: absPath("/home/user/projects/my-skill"),
				type: "local",
			}
			const origin = makeOrigin("my-skill")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toMatchInlineSnapshot(`
				{
				  "absolutePath": "/home/user/projects/my-skill",
				  "fetchStrategy": {
				    "mode": "symlink",
				  },
				  "origin": {
				    "alias": "my-skill",
				    "manifestPath": "/test/package.toml",
				  },
				  "type": "local",
				}
			`)
		})

		it("uses symlink fetch strategy for local packages", () => {
			const dep: ValidatedLocalDependency = {
				path: absPath("/some/path"),
				type: "local",
			}
			const origin = makeOrigin("local-pkg")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.fetchStrategy).toEqual({ mode: "symlink" })
		})

		it("preserves absolute path", () => {
			const dep: ValidatedLocalDependency = {
				path: absPath("/Users/developer/my-org/skills/my-skill"),
				type: "local",
			}
			const origin = makeOrigin("my-skill")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.type).toBe("local")
			if (result.type === "local") {
				expect(result.absolutePath).toBe(
					"/Users/developer/my-org/skills/my-skill",
				)
			}
		})
	})

	// =============================================================================
	// resolveValidatedDependency - Claude Plugin packages
	// =============================================================================

	describe("claude-plugin dependencies", () => {
		it("resolves claude plugin dependency", () => {
			const dep: ValidatedClaudePluginDependency = {
				marketplace: gitUrl("https://github.com/anthropics/claude-plugins"),
				plugin: nonEmpty("web-search"),
				type: "claude-plugin",
			}
			const origin = makeOrigin("web-search")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toMatchInlineSnapshot(`
				{
				  "fetchStrategy": {
				    "mode": "clone",
				    "sparse": false,
				  },
				  "marketplace": "https://github.com/anthropics/claude-plugins",
				  "origin": {
				    "alias": "web-search",
				    "manifestPath": "/test/package.toml",
				  },
				  "plugin": "web-search",
				  "type": "claude-plugin",
				}
			`)
		})

		it("uses non-sparse clone for plugins", () => {
			const dep: ValidatedClaudePluginDependency = {
				marketplace: gitUrl("https://github.com/some-org/plugins"),
				plugin: nonEmpty("my-plugin"),
				type: "claude-plugin",
			}
			const origin = makeOrigin("my-plugin")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: false })
		})
	})
})

// =============================================================================
// resolveMergedPackages
// =============================================================================

describe("resolveMergedPackages", () => {
	it("resolves empty manifest to empty array", () => {
		const manifest: MergedManifest = {
			agents: new Map<AgentId, boolean>([["claude-code", true]]),
			dependencies: new Map(),
			warnings: [],
		}

		const result = resolveMergedPackages(manifest)

		expect(result).toEqual([])
	})

	it("resolves single dependency", () => {
		const entry: ManifestDependencyEntry = {
			dependency: {
				gh: ghRef("org/repo"),
				type: "github",
			} as ValidatedGithubDependency,
			origin: makeManifestOrigin(),
		}

		const manifest: MergedManifest = {
			agents: new Map<AgentId, boolean>([["claude-code", true]]),
			dependencies: new Map([[alias("my-pkg"), entry]]),
			warnings: [],
		}

		const result = resolveMergedPackages(manifest)

		expect(result).toHaveLength(1)
		expect(result[0].type).toBe("github")
		expect(result[0].origin.alias).toBe("my-pkg")
	})

	it("resolves multiple dependencies", () => {
		const githubEntry: ManifestDependencyEntry = {
			dependency: {
				gh: ghRef("org/repo1"),
				type: "github",
			} as ValidatedGithubDependency,
			origin: makeManifestOrigin(),
		}

		const localEntry: ManifestDependencyEntry = {
			dependency: {
				path: absPath("/local/path"),
				type: "local",
			} as ValidatedLocalDependency,
			origin: makeManifestOrigin(),
		}

		const registryEntry: ManifestDependencyEntry = {
			dependency: {
				name: nonEmpty("skill"),
				org: nonEmpty("my-org"),
				type: "registry",
				version: nonEmpty("1.0.0"),
			} as ValidatedRegistryDependency,
			origin: makeManifestOrigin(),
		}

		const manifest: MergedManifest = {
			agents: new Map<AgentId, boolean>([["claude-code", true]]),
			dependencies: new Map([
				[alias("github-pkg"), githubEntry],
				[alias("local-pkg"), localEntry],
				[alias("registry-pkg"), registryEntry],
			]),
			warnings: [],
		}

		const result = resolveMergedPackages(manifest)

		expect(result).toHaveLength(3)

		const types = result.map((p) => p.type).sort()
		expect(types).toEqual(["github", "local", "registry"])

		const aliases = result.map((p) => p.origin.alias).sort()
		expect(aliases).toEqual(["github-pkg", "local-pkg", "registry-pkg"])
	})

	it("preserves manifest origin in package origin", () => {
		const entry: ManifestDependencyEntry = {
			dependency: {
				gh: ghRef("org/repo"),
				type: "github",
			} as ValidatedGithubDependency,
			origin: makeManifestOrigin("/custom/manifest/path.toml", "home"),
		}

		const manifest: MergedManifest = {
			agents: new Map<AgentId, boolean>([["claude-code", true]]),
			dependencies: new Map([[alias("my-pkg"), entry]]),
			warnings: [],
		}

		const result = resolveMergedPackages(manifest)

		expect(result[0].origin.manifestPath).toBe("/custom/manifest/path.toml")
	})

	it("handles mixed dependency types", () => {
		const deps = new Map<Alias, ManifestDependencyEntry>([
			[
				alias("github-simple"),
				{
					dependency: {
						gh: ghRef("org/simple"),
						type: "github",
					} as ValidatedGithubDependency,
					origin: makeManifestOrigin(),
				},
			],
			[
				alias("github-full"),
				{
					dependency: {
						gh: ghRef("org/full"),
						path: nonEmpty("packages/sub"),
						ref: { type: "tag", value: nonEmpty("v1.0.0") },
						type: "github",
					} as ValidatedGithubDependency,
					origin: makeManifestOrigin(),
				},
			],
			[
				alias("git-pkg"),
				{
					dependency: {
						type: "git",
						url: gitUrl("https://gitlab.com/org/repo"),
					} as ValidatedGitDependency,
					origin: makeManifestOrigin(),
				},
			],
			[
				alias("local-pkg"),
				{
					dependency: {
						path: absPath("/home/user/local"),
						type: "local",
					} as ValidatedLocalDependency,
					origin: makeManifestOrigin(),
				},
			],
			[
				alias("plugin-pkg"),
				{
					dependency: {
						marketplace: gitUrl("https://github.com/anthropics/plugins"),
						plugin: nonEmpty("my-plugin"),
						type: "claude-plugin",
					} as ValidatedClaudePluginDependency,
					origin: makeManifestOrigin(),
				},
			],
		])

		const manifest: MergedManifest = {
			agents: new Map<AgentId, boolean>([["claude-code", true]]),
			dependencies: deps,
			warnings: [],
		}

		const result = resolveMergedPackages(manifest)

		expect(result).toHaveLength(5)

		// Verify each package was correctly resolved
		const byAlias = new Map(result.map((p) => [p.origin.alias, p]))

		const githubSimple = byAlias.get("github-simple")
		expect(githubSimple?.type).toBe("github")
		expect(githubSimple?.fetchStrategy).toEqual({ mode: "clone", sparse: false })

		const githubFull = byAlias.get("github-full")
		expect(githubFull?.type).toBe("github")
		expect(githubFull?.fetchStrategy).toEqual({ mode: "clone", sparse: true })

		const gitPkg = byAlias.get("git-pkg")
		expect(gitPkg?.type).toBe("git")

		const localPkg = byAlias.get("local-pkg")
		expect(localPkg?.type).toBe("local")
		expect(localPkg?.fetchStrategy).toEqual({ mode: "symlink" })

		const pluginPkg = byAlias.get("plugin-pkg")
		expect(pluginPkg?.type).toBe("claude-plugin")
	})
})

// =============================================================================
// Fetch strategy determination
// =============================================================================

describe("fetch strategy determination", () => {
	it("local packages always use symlink", () => {
		const dep: ValidatedLocalDependency = {
			path: absPath("/any/path"),
			type: "local",
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "symlink" })
	})

	it("github without path uses non-sparse clone", () => {
		const dep: ValidatedGithubDependency = {
			gh: ghRef("org/repo"),
			type: "github",
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: false })
	})

	it("github with path uses sparse clone", () => {
		const dep: ValidatedGithubDependency = {
			gh: ghRef("org/repo"),
			path: nonEmpty("subdir"),
			type: "github",
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: true })
	})

	it("git without path uses non-sparse clone", () => {
		const dep: ValidatedGitDependency = {
			type: "git",
			url: gitUrl("https://example.com/repo"),
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: false })
	})

	it("git with path uses sparse clone", () => {
		const dep: ValidatedGitDependency = {
			path: nonEmpty("packages/pkg"),
			type: "git",
			url: gitUrl("https://example.com/repo"),
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: true })
	})

	it("registry uses non-sparse clone", () => {
		const dep: ValidatedRegistryDependency = {
			name: nonEmpty("pkg"),
			type: "registry",
			version: nonEmpty("1.0.0"),
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: false })
	})

	it("claude-plugin uses non-sparse clone", () => {
		const dep: ValidatedClaudePluginDependency = {
			marketplace: gitUrl("https://github.com/org/plugins"),
			plugin: nonEmpty("plugin"),
			type: "claude-plugin",
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: false })
	})
})
