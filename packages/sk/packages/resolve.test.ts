/**
 * Tests for packages/resolve.ts
 *
 * This module converts ValidatedDeclaration to CanonicalPackage.
 * Since inputs are already validated (branded types), tests focus on:
 * - Correct mapping of each dependency type
 * - Fetch strategy determination
 * - Origin preservation
 */

import { describe, expect, it } from "vitest"
import "@/tests/helpers/assertions"
import type { ValidatedDeclaration } from "@skills-supply/core"
import type { Manifest } from "@/manifest/types"
import { resolveManifestPackages, resolveValidatedDependency } from "@/packages/resolve"
import { abs, alias, ghRef, gitUrl, nes } from "@/tests/helpers/branded"
import type { ManifestOrigin, PackageOrigin } from "@/types/context"

type ValidatedRegistryDependency = Extract<ValidatedDeclaration, { type: "registry" }>
type ValidatedGithubDependency = Extract<ValidatedDeclaration, { type: "github" }>
type ValidatedGitDependency = Extract<ValidatedDeclaration, { type: "git" }>
type ValidatedLocalDependency = Extract<ValidatedDeclaration, { type: "local" }>
type ValidatedClaudePluginDependency = Extract<
	ValidatedDeclaration,
	{ type: "claude-plugin" }
>

// =============================================================================
// TEST HELPERS - fixture builders using branded helpers
// =============================================================================

function makeOrigin(aliasStr: string, path = "/test/agents.toml"): PackageOrigin {
	return {
		alias: alias(aliasStr),
		manifestPath: abs(path),
	}
}

function makeManifestOrigin(
	path = "/test/agents.toml",
	discoveredAt: "cwd" | "parent" | "home" | "sk-global" = "cwd",
): ManifestOrigin {
	return {
		discoveredAt,
		sourcePath: abs(path),
	}
}

function makeManifest(
	dependencies: Array<[string, ValidatedDeclaration]>,
	originPath = "/test/agents.toml",
): Manifest {
	return {
		agents: new Map(),
		dependencies: new Map(dependencies.map(([key, value]) => [alias(key), value])),
		origin: makeManifestOrigin(originPath),
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
				    "manifestPath": "/test/agents.toml",
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

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				name: "my-skill",
				org: undefined,
				origin: {
					alias: "my-skill",
					manifestPath: "/test/agents.toml",
				},
				registry: "skills.supply",
				type: "registry",
				version: "2.0.0",
			})
		})

		it("preserves origin information", () => {
			const dep: ValidatedRegistryDependency = {
				name: nes("pkg"),
				type: "registry",
				version: nes("1.0.0"),
			}
			const origin = makeOrigin("custom-alias", "/custom/path/agents.toml")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.origin).toEqual({
				alias: "custom-alias",
				manifestPath: "/custom/path/agents.toml",
			})
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
				    "manifestPath": "/test/agents.toml",
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

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				gh: "org/repo",
				origin: {
					alias: "repo",
					manifestPath: "/test/agents.toml",
				},
				path: undefined,
				ref: { type: "tag", value: "v1.0.0" },
				type: "github",
			})
		})

		it("resolves github dependency with branch ref", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/repo"),
				ref: { type: "branch", value: nes("develop") },
				type: "github",
			}
			const origin = makeOrigin("repo")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				gh: "org/repo",
				origin: {
					alias: "repo",
					manifestPath: "/test/agents.toml",
				},
				path: undefined,
				ref: { type: "branch", value: "develop" },
				type: "github",
			})
		})

		it("resolves github dependency with rev ref", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/repo"),
				ref: { type: "rev", value: nes("abc123") },
				type: "github",
			}
			const origin = makeOrigin("repo")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				gh: "org/repo",
				origin: {
					alias: "repo",
					manifestPath: "/test/agents.toml",
				},
				path: undefined,
				ref: { type: "rev", value: "abc123" },
				type: "github",
			})
		})

		it("resolves github dependency with path (sparse clone)", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/monorepo"),
				path: nes("packages/my-skill"),
				type: "github",
			}
			const origin = makeOrigin("my-skill")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: true },
				gh: "org/monorepo",
				origin: {
					alias: "my-skill",
					manifestPath: "/test/agents.toml",
				},
				path: "packages/my-skill",
				ref: undefined,
				type: "github",
			})
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
				    "manifestPath": "/test/agents.toml",
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
				    "manifestPath": "/test/agents.toml",
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

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				origin: {
					alias: "repo",
					manifestPath: "/test/agents.toml",
				},
				path: undefined,
				ref: { type: "tag", value: "v1.0.0" },
				type: "git",
				url: "https://gitlab.com/org/repo",
			})
		})

		it("resolves git dependency with path (sparse clone)", () => {
			const dep: ValidatedGitDependency = {
				path: nes("packages/core"),
				type: "git",
				url: gitUrl("https://bitbucket.org/org/monorepo"),
			}
			const origin = makeOrigin("core")

			const result = resolveValidatedDependency(dep, origin)

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: true },
				origin: {
					alias: "core",
					manifestPath: "/test/agents.toml",
				},
				path: "packages/core",
				ref: undefined,
				type: "git",
				url: "https://bitbucket.org/org/monorepo",
			})
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
				    "manifestPath": "/test/agents.toml",
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
				    "manifestPath": "/test/agents.toml",
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

			expect(result).toEqual({
				absolutePath: "/Users/developer/my-org/skills/my-skill",
				fetchStrategy: { mode: "symlink" },
				origin: {
					alias: "my-skill",
					manifestPath: "/test/agents.toml",
				},
				type: "local",
			})
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
				    "manifestPath": "/test/agents.toml",
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
// resolveManifestPackages
// =============================================================================

describe("resolveManifestPackages", () => {
	it("resolves empty manifest to empty array", () => {
		const manifest = makeManifest([])

		const result = resolveManifestPackages(manifest)

		expect(result).toEqual([])
	})

	it("resolves single dependency", () => {
		const manifest = makeManifest([
			[
				"my-pkg",
				{
					gh: ghRef("org/repo"),
					type: "github",
				} as ValidatedGithubDependency,
			],
		])

		const result = resolveManifestPackages(manifest)

		expect(result).toHaveLength(1)
		expect(result[0]).toEqual({
			fetchStrategy: { mode: "clone", sparse: false },
			gh: "org/repo",
			origin: {
				alias: "my-pkg",
				manifestPath: "/test/agents.toml",
			},
			path: undefined,
			ref: undefined,
			type: "github",
		})
	})

	it("resolves multiple dependencies", () => {
		const manifest = makeManifest([
			[
				"github-pkg",
				{
					gh: ghRef("org/repo1"),
					type: "github",
				} as ValidatedGithubDependency,
			],
			[
				"local-pkg",
				{
					path: abs("/local/path"),
					type: "local",
				} as ValidatedLocalDependency,
			],
			[
				"registry-pkg",
				{
					name: nes("skill"),
					org: nes("my-org"),
					type: "registry",
					version: nes("1.0.0"),
				} as ValidatedRegistryDependency,
			],
		])

		const result = resolveManifestPackages(manifest)

		expect(result).toHaveLength(3)

		// Sort by alias for deterministic comparison
		const sorted = [...result].sort((a, b) =>
			(a.origin.alias as string).localeCompare(b.origin.alias as string),
		)

		expect(sorted[0]).toEqual({
			fetchStrategy: { mode: "clone", sparse: false },
			gh: "org/repo1",
			origin: {
				alias: "github-pkg",
				manifestPath: "/test/agents.toml",
			},
			path: undefined,
			ref: undefined,
			type: "github",
		})

		expect(sorted[1]).toEqual({
			absolutePath: "/local/path",
			fetchStrategy: { mode: "symlink" },
			origin: {
				alias: "local-pkg",
				manifestPath: "/test/agents.toml",
			},
			type: "local",
		})

		expect(sorted[2]).toEqual({
			fetchStrategy: { mode: "clone", sparse: false },
			name: "skill",
			org: "my-org",
			origin: {
				alias: "registry-pkg",
				manifestPath: "/test/agents.toml",
			},
			registry: "skills.supply",
			type: "registry",
			version: "1.0.0",
		})
	})

	it("preserves manifest origin in package origin", () => {
		const manifest = makeManifest(
			[
				[
					"my-pkg",
					{
						gh: ghRef("org/repo"),
						type: "github",
					} as ValidatedGithubDependency,
				],
			],
			"/custom/manifest/path.toml",
		)

		const result = resolveManifestPackages(manifest)

		expect(result).toHaveLength(1)
		expect(result[0]).toEqual({
			fetchStrategy: { mode: "clone", sparse: false },
			gh: "org/repo",
			origin: {
				alias: "my-pkg",
				manifestPath: "/custom/manifest/path.toml",
			},
			path: undefined,
			ref: undefined,
			type: "github",
		})
	})

	it("handles mixed dependency types", () => {
		const manifest = makeManifest([
			[
				"github-simple",
				{
					gh: ghRef("org/simple"),
					type: "github",
				} as ValidatedGithubDependency,
			],
			[
				"github-full",
				{
					gh: ghRef("org/full"),
					path: nes("packages/sub"),
					ref: { type: "tag", value: nes("v1.0.0") },
					type: "github",
				} as ValidatedGithubDependency,
			],
			[
				"git-pkg",
				{
					type: "git",
					url: gitUrl("https://gitlab.com/org/repo"),
				} as ValidatedGitDependency,
			],
			[
				"local-pkg",
				{
					path: abs("/home/user/local"),
					type: "local",
				} as ValidatedLocalDependency,
			],
			[
				"plugin-pkg",
				{
					marketplace: gitUrl("https://github.com/anthropics/plugins"),
					plugin: nes("my-plugin"),
					type: "claude-plugin",
				} as ValidatedClaudePluginDependency,
			],
		])

		const result = resolveManifestPackages(manifest)

		expect(result).toHaveLength(5)

		const byAlias = new Map(result.map((p) => [p.origin.alias, p]))

		expect(byAlias.get(alias("github-simple"))).toEqual({
			fetchStrategy: { mode: "clone", sparse: false },
			gh: "org/simple",
			origin: {
				alias: "github-simple",
				manifestPath: "/test/agents.toml",
			},
			path: undefined,
			ref: undefined,
			type: "github",
		})

		expect(byAlias.get(alias("github-full"))).toEqual({
			fetchStrategy: { mode: "clone", sparse: true },
			gh: "org/full",
			origin: {
				alias: "github-full",
				manifestPath: "/test/agents.toml",
			},
			path: "packages/sub",
			ref: { type: "tag", value: "v1.0.0" },
			type: "github",
		})

		expect(byAlias.get(alias("git-pkg"))).toEqual({
			fetchStrategy: { mode: "clone", sparse: false },
			origin: {
				alias: "git-pkg",
				manifestPath: "/test/agents.toml",
			},
			path: undefined,
			ref: undefined,
			type: "git",
			url: "https://gitlab.com/org/repo",
		})

		expect(byAlias.get(alias("local-pkg"))).toEqual({
			absolutePath: "/home/user/local",
			fetchStrategy: { mode: "symlink" },
			origin: {
				alias: "local-pkg",
				manifestPath: "/test/agents.toml",
			},
			type: "local",
		})

		expect(byAlias.get(alias("plugin-pkg"))).toEqual({
			fetchStrategy: { mode: "clone", sparse: false },
			marketplace: "https://github.com/anthropics/plugins",
			origin: {
				alias: "plugin-pkg",
				manifestPath: "/test/agents.toml",
			},
			plugin: "my-plugin",
			type: "claude-plugin",
		})
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

// =============================================================================
// Edge cases
// =============================================================================

describe("edge cases", () => {
	describe("path handling", () => {
		it("github with deeply nested path still uses sparse clone", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/monorepo"),
				path: nes("packages/core/utils/helpers"),
				type: "github",
			}
			const result = resolveValidatedDependency(dep, makeOrigin("helpers"))

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: true },
				gh: "org/monorepo",
				origin: {
					alias: "helpers",
					manifestPath: "/test/agents.toml",
				},
				path: "packages/core/utils/helpers",
				ref: undefined,
				type: "github",
			})
		})

		it("git with single-level path uses sparse clone", () => {
			const dep: ValidatedGitDependency = {
				path: nes("plugin"),
				type: "git",
				url: gitUrl("https://example.com/repo.git"),
			}
			const result = resolveValidatedDependency(dep, makeOrigin("plugin"))

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: true },
				origin: {
					alias: "plugin",
					manifestPath: "/test/agents.toml",
				},
				path: "plugin",
				ref: undefined,
				type: "git",
				url: "https://example.com/repo.git",
			})
		})

		it("local path with trailing segments preserved", () => {
			const dep: ValidatedLocalDependency = {
				path: abs("/Users/dev/projects/my-skill"),
				type: "local",
			}
			const result = resolveValidatedDependency(dep, makeOrigin("my-skill"))

			expect(result).toEqual({
				absolutePath: "/Users/dev/projects/my-skill",
				fetchStrategy: { mode: "symlink" },
				origin: {
					alias: "my-skill",
					manifestPath: "/test/agents.toml",
				},
				type: "local",
			})
		})
	})

	describe("git URL formats", () => {
		it("handles https URLs with .git suffix", () => {
			const dep: ValidatedGitDependency = {
				type: "git",
				url: gitUrl("https://github.com/org/repo.git"),
			}
			const result = resolveValidatedDependency(dep, makeOrigin("repo"))

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				origin: {
					alias: "repo",
					manifestPath: "/test/agents.toml",
				},
				path: undefined,
				ref: undefined,
				type: "git",
				url: "https://github.com/org/repo.git",
			})
		})

		it("handles ssh-style git URLs", () => {
			const dep: ValidatedGitDependency = {
				type: "git",
				url: gitUrl("git@github.com:org/repo.git"),
			}
			const result = resolveValidatedDependency(dep, makeOrigin("repo"))

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				origin: {
					alias: "repo",
					manifestPath: "/test/agents.toml",
				},
				path: undefined,
				ref: undefined,
				type: "git",
				url: "git@github.com:org/repo.git",
			})
		})

		it("handles gitlab URLs", () => {
			const dep: ValidatedGitDependency = {
				type: "git",
				url: gitUrl("https://gitlab.com/group/subgroup/project"),
			}
			const result = resolveValidatedDependency(dep, makeOrigin("project"))

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				origin: {
					alias: "project",
					manifestPath: "/test/agents.toml",
				},
				path: undefined,
				ref: undefined,
				type: "git",
				url: "https://gitlab.com/group/subgroup/project",
			})
		})
	})

	describe("registry packages", () => {
		it("handles org with hyphens", () => {
			const dep: ValidatedRegistryDependency = {
				name: nes("my-skill"),
				org: nes("my-org-name"),
				type: "registry",
				version: nes("1.0.0-beta.1"),
			}
			const result = resolveValidatedDependency(dep, makeOrigin("my-skill"))

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				name: "my-skill",
				org: "my-org-name",
				origin: {
					alias: "my-skill",
					manifestPath: "/test/agents.toml",
				},
				registry: "skills.supply",
				type: "registry",
				version: "1.0.0-beta.1",
			})
		})

		it("handles semver prerelease versions", () => {
			const dep: ValidatedRegistryDependency = {
				name: nes("pkg"),
				type: "registry",
				version: nes("2.0.0-alpha.5+build.123"),
			}
			const result = resolveValidatedDependency(dep, makeOrigin("pkg"))

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				name: "pkg",
				org: undefined,
				origin: {
					alias: "pkg",
					manifestPath: "/test/agents.toml",
				},
				registry: "skills.supply",
				type: "registry",
				version: "2.0.0-alpha.5+build.123",
			})
		})
	})

	describe("origin preservation", () => {
		it("preserves alias that differs from package name", () => {
			const dep: ValidatedRegistryDependency = {
				name: nes("superpowers"),
				org: nes("superpowers-marketplace"),
				type: "registry",
				version: nes("1.0.0"),
			}
			const origin = makeOrigin("sp", "/project/agents.toml")

			const result = resolveValidatedDependency(dep, origin)

			expect(result.origin).toEqual({
				alias: "sp",
				manifestPath: "/project/agents.toml",
			})
		})

		it("preserves complex manifest paths", () => {
			const dep: ValidatedLocalDependency = {
				path: abs("/local/skill"),
				type: "local",
			}
			const origin = makeOrigin(
				"skill",
				"/Users/dev/My Projects/claude-skills/agents.toml",
			)

			const result = resolveValidatedDependency(dep, origin)

			expect(result.origin).toEqual({
				alias: "skill",
				manifestPath: "/Users/dev/My Projects/claude-skills/agents.toml",
			})
		})
	})

	describe("ref types", () => {
		it("github with full SHA commit ref", () => {
			const dep: ValidatedGithubDependency = {
				gh: ghRef("org/repo"),
				ref: {
					type: "rev",
					value: nes("abc123def456789012345678901234567890abcd"),
				},
				type: "github",
			}
			const result = resolveValidatedDependency(dep, makeOrigin("repo"))

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				gh: "org/repo",
				origin: {
					alias: "repo",
					manifestPath: "/test/agents.toml",
				},
				path: undefined,
				ref: {
					type: "rev",
					value: "abc123def456789012345678901234567890abcd",
				},
				type: "github",
			})
		})

		it("git with branch containing slashes", () => {
			const dep: ValidatedGitDependency = {
				ref: { type: "branch", value: nes("feature/my-feature") },
				type: "git",
				url: gitUrl("https://github.com/org/repo"),
			}
			const result = resolveValidatedDependency(dep, makeOrigin("repo"))

			expect(result).toEqual({
				fetchStrategy: { mode: "clone", sparse: false },
				origin: {
					alias: "repo",
					manifestPath: "/test/agents.toml",
				},
				path: undefined,
				ref: { type: "branch", value: "feature/my-feature" },
				type: "git",
				url: "https://github.com/org/repo",
			})
		})
	})
})
