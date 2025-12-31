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
	AgentId,
	Alias,
	ManifestOrigin,
	PackageOrigin,
} from "@/src/core/types/branded"
import { abs, alias, ghRef, gitUrl, nes } from "@/tests/helpers/branded"

// =============================================================================
// TEST HELPERS - fixture builders using branded helpers
// =============================================================================

function makeOrigin(aliasStr: string, path = "/test/package.toml"): PackageOrigin {
	return {
		alias: alias(aliasStr),
		manifestPath: abs(path),
	}
}

function makeManifestOrigin(
	path = "/test/package.toml",
	discoveredAt: "cwd" | "parent" | "home" | "sk-global" = "cwd",
): ManifestOrigin {
	return {
		discoveredAt,
		sourcePath: abs(path),
	}
}

// =============================================================================
// resolveValidatedDependency - Registry packages
// =============================================================================

describe("resolveValidatedDependency", () => {
	describe("registry dependencies", () => {
		it("resolves basic registry dependency", () => {
			const dep: ValidatedRegistryDependency = {
				name: nes("superpowers"),
				org: nes("superpowers-marketplace"),
				type: "registry",
				version: nes("1.0.0"),
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
				name: nes("my-skill"),
				type: "registry",
				version: nes("2.0.0"),
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
				name: nes("pkg"),
				type: "registry",
				version: nes("1.0.0"),
			}
			const origin = makeOrigin("custom-alias", "/custom/path/package.toml")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.origin.alias).toBe("custom-alias")
			expect(result.origin.manifestPath).toBe("/custom/path/package.toml")
		})

		it("uses clone fetch strategy without sparse", () => {
			const dep: ValidatedRegistryDependency = {
				name: nes("pkg"),
				type: "registry",
				version: nes("1.0.0"),
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
				ref: { type: "tag", value: nes("v1.0.0") },
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
				ref: { type: "branch", value: nes("develop") },
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
				ref: { type: "rev", value: nes("abc123") },
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
				path: nes("packages/my-skill"),
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
				path: nes("skills"),
				ref: { type: "tag", value: nes("v2.0.0") },
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
				ref: { type: "tag", value: nes("v1.0.0") },
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
				path: nes("packages/core"),
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
				path: nes("skills/utils"),
				ref: { type: "branch", value: nes("main") },
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
				path: abs("/home/user/projects/my-skill"),
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
				path: abs("/some/path"),
				type: "local",
			}
			const origin = makeOrigin("local-pkg")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.fetchStrategy).toEqual({ mode: "symlink" })
		})

		it("preserves absolute path", () => {
			const dep: ValidatedLocalDependency = {
				path: abs("/Users/developer/my-org/skills/my-skill"),
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
				plugin: nes("web-search"),
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
				plugin: nes("my-plugin"),
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
		const [resolved] = result
		if (!resolved) {
			throw new Error("Expected one resolved package")
		}
		expect(resolved.type).toBe("github")
		expect(resolved.origin.alias).toBe("my-pkg")
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
				path: abs("/local/path"),
				type: "local",
			} as ValidatedLocalDependency,
			origin: makeManifestOrigin(),
		}

		const registryEntry: ManifestDependencyEntry = {
			dependency: {
				name: nes("skill"),
				org: nes("my-org"),
				type: "registry",
				version: nes("1.0.0"),
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

		const [resolved] = result
		if (!resolved) {
			throw new Error("Expected one resolved package")
		}
		expect(resolved.origin.manifestPath).toBe("/custom/manifest/path.toml")
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
						path: nes("packages/sub"),
						ref: { type: "tag", value: nes("v1.0.0") },
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
						path: abs("/home/user/local"),
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
						plugin: nes("my-plugin"),
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

		const githubSimple = byAlias.get(alias("github-simple"))
		expect(githubSimple?.type).toBe("github")
		expect(githubSimple?.fetchStrategy).toEqual({ mode: "clone", sparse: false })

		const githubFull = byAlias.get(alias("github-full"))
		expect(githubFull?.type).toBe("github")
		expect(githubFull?.fetchStrategy).toEqual({ mode: "clone", sparse: true })

		const gitPkg = byAlias.get(alias("git-pkg"))
		expect(gitPkg?.type).toBe("git")

		const localPkg = byAlias.get(alias("local-pkg"))
		expect(localPkg?.type).toBe("local")
		expect(localPkg?.fetchStrategy).toEqual({ mode: "symlink" })

		const pluginPkg = byAlias.get(alias("plugin-pkg"))
		expect(pluginPkg?.type).toBe("claude-plugin")
	})
})

// =============================================================================
// Fetch strategy determination
// =============================================================================

describe("fetch strategy determination", () => {
	it("local packages always use symlink", () => {
		const dep: ValidatedLocalDependency = {
			path: abs("/any/path"),
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
			path: nes("subdir"),
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
			path: nes("packages/pkg"),
			type: "git",
			url: gitUrl("https://example.com/repo"),
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: true })
	})

	it("registry uses non-sparse clone", () => {
		const dep: ValidatedRegistryDependency = {
			name: nes("pkg"),
			type: "registry",
			version: nes("1.0.0"),
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: false })
	})

	it("claude-plugin uses non-sparse clone", () => {
		const dep: ValidatedClaudePluginDependency = {
			marketplace: gitUrl("https://github.com/org/plugins"),
			plugin: nes("plugin"),
			type: "claude-plugin",
		}
		const result = resolveValidatedDependency(dep, makeOrigin("pkg"))
		expect(result.fetchStrategy).toEqual({ mode: "clone", sparse: false })
	})
})
