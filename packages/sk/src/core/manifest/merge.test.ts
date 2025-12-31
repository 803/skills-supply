/**
 * Tests for manifest/merge.ts
 *
 * Documents the merge behavior:
 * - Agents: first occurrence wins (earlier manifests take precedence)
 * - Dependencies: deduplicated by canonical form
 *   - Same alias, different package -> error
 *   - Same package, different alias -> warning, first alias wins
 */

import { describe, expect, it } from "vitest"
import "../../../tests/helpers/assertions"
import type { AbsolutePath, AgentId, Alias, ManifestOrigin } from "@/core/types/branded"
import { mergeManifests } from "./merge"
import type { Manifest, ValidatedDependency } from "./types"

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a ManifestOrigin for testing.
 */
function makeOrigin(
	sourcePath: string,
	discoveredAt: "cwd" | "parent" | "home" | "sk-global" = "cwd",
): ManifestOrigin {
	return {
		discoveredAt,
		sourcePath: sourcePath as AbsolutePath,
	}
}

/**
 * Create a validated GitHub dependency.
 */
function makeGithubDep(gh: string, opts: { path?: string } = {}): ValidatedDependency {
	return {
		gh: gh as ValidatedDependency & { type: "github" } extends { gh: infer T }
			? T
			: never,
		path: opts.path as ValidatedDependency & { type: "github" } extends {
			path?: infer T
		}
			? T
			: never,
		type: "github",
	} as ValidatedDependency
}

/**
 * Create a validated local dependency.
 */
function makeLocalDep(path: string): ValidatedDependency {
	return {
		path: path as AbsolutePath,
		type: "local",
	}
}

/**
 * Create a validated registry dependency.
 */
function makeRegistryDep(
	name: string,
	version: string,
	org?: string,
): ValidatedDependency {
	const dep: ValidatedDependency = {
		name: name as ValidatedDependency & { type: "registry" } extends {
			name: infer T
		}
			? T
			: never,
		type: "registry",
		version: version as ValidatedDependency & { type: "registry" } extends {
			version: infer T
		}
			? T
			: never,
	} as ValidatedDependency

	if (org) {
		;(dep as { org?: unknown }).org = org
	}

	return dep
}

/**
 * Create a validated git dependency.
 */
function makeGitDep(url: string, opts: { path?: string } = {}): ValidatedDependency {
	return {
		path: opts.path as ValidatedDependency & { type: "git" } extends {
			path?: infer T
		}
			? T
			: never,
		type: "git",
		url: url as ValidatedDependency & { type: "git" } extends { url: infer T }
			? T
			: never,
	} as ValidatedDependency
}

/**
 * Create a validated claude-plugin dependency.
 */
function makeClaudePluginDep(plugin: string, marketplace: string): ValidatedDependency {
	return {
		marketplace: marketplace as ValidatedDependency & {
			type: "claude-plugin"
		} extends { marketplace: infer T }
			? T
			: never,
		plugin: plugin as ValidatedDependency & { type: "claude-plugin" } extends {
			plugin: infer T
		}
			? T
			: never,
		type: "claude-plugin",
	} as ValidatedDependency
}

/**
 * Create a Manifest for testing.
 */
function makeManifest(opts: {
	agents?: Record<string, boolean>
	dependencies?: Record<string, ValidatedDependency>
	sourcePath?: string
	discoveredAt?: "cwd" | "parent" | "home" | "sk-global"
}): Manifest {
	const agents = new Map<AgentId, boolean>()
	if (opts.agents) {
		for (const [id, enabled] of Object.entries(opts.agents)) {
			agents.set(id as AgentId, enabled)
		}
	}

	const dependencies = new Map<Alias, ValidatedDependency>()
	if (opts.dependencies) {
		for (const [alias, dep] of Object.entries(opts.dependencies)) {
			dependencies.set(alias as Alias, dep)
		}
	}

	return {
		agents,
		dependencies,
		origin: makeOrigin(opts.sourcePath ?? "/test/package.toml", opts.discoveredAt),
	}
}

// =============================================================================
// TESTS: BASIC MERGE BEHAVIOR
// =============================================================================

describe("mergeManifests", () => {
	describe("basic merge behavior", () => {
		it("returns empty merged manifest for empty input", () => {
			const result = mergeManifests([])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.size).toBe(0)
				expect(result.value.dependencies.size).toBe(0)
				expect(result.value.warnings).toEqual([])
			}
		})

		it("passes through single manifest unchanged", () => {
			const manifest = makeManifest({
				agents: { "claude-code": true },
				dependencies: {
					superpowers: makeGithubDep("superpowers-marketplace/superpowers"),
				},
			})

			const result = mergeManifests([manifest])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.size).toBe(1)
				expect(result.value.agents.get("claude-code")).toBe(true)
				expect(result.value.dependencies.size).toBe(1)
				expect(result.value.dependencies.get("superpowers" as Alias)).toBeTruthy()
			}
		})

		it("merges multiple manifests with distinct dependencies", () => {
			const manifest1 = makeManifest({
				agents: { "claude-code": true },
				dependencies: {
					foo: makeGithubDep("org/foo"),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				agents: { codex: true },
				dependencies: {
					bar: makeGithubDep("org/bar"),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(2)
				expect(result.value.dependencies.get("foo" as Alias)).toBeTruthy()
				expect(result.value.dependencies.get("bar" as Alias)).toBeTruthy()
			}
		})
	})

	// =============================================================================
	// TESTS: AGENT MERGING
	// =============================================================================

	describe("agent merging (first occurrence wins)", () => {
		it("uses first manifest's agent setting when enabled in first", () => {
			const manifest1 = makeManifest({
				agents: { "claude-code": true },
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				agents: { "claude-code": false },
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.get("claude-code")).toBe(true)
			}
		})

		it("uses first manifest's agent setting when disabled in first", () => {
			const manifest1 = makeManifest({
				agents: { "claude-code": false },
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				agents: { "claude-code": true },
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.get("claude-code")).toBe(false)
			}
		})

		it("collects all agents from multiple manifests", () => {
			const manifest1 = makeManifest({
				agents: { "claude-code": true },
			})

			const manifest2 = makeManifest({
				agents: { codex: true },
			})

			const manifest3 = makeManifest({
				agents: { opencode: false },
			})

			const result = mergeManifests([manifest1, manifest2, manifest3])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.size).toBe(3)
				expect(result.value.agents.get("claude-code")).toBe(true)
				expect(result.value.agents.get("codex")).toBe(true)
				expect(result.value.agents.get("opencode")).toBe(false)
			}
		})

		it("handles manifest with no agents", () => {
			const manifest1 = makeManifest({
				agents: {},
				dependencies: { foo: makeGithubDep("org/foo") },
			})

			const manifest2 = makeManifest({
				agents: { "claude-code": true },
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.size).toBe(1)
				expect(result.value.agents.get("claude-code")).toBe(true)
			}
		})
	})

	// =============================================================================
	// TESTS: DEPENDENCY DEDUPLICATION
	// =============================================================================

	describe("dependency deduplication", () => {
		it("deduplicates identical github dependencies with same alias", () => {
			const manifest1 = makeManifest({
				dependencies: {
					superpowers: makeGithubDep("superpowers-marketplace/superpowers"),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					superpowers: makeGithubDep("superpowers-marketplace/superpowers"),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(1)
				expect(result.value.warnings).toEqual([])
			}
		})

		it("deduplicates identical local dependencies with same alias", () => {
			const manifest1 = makeManifest({
				dependencies: {
					"my-local": makeLocalDep("/absolute/path/to/local"),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					"my-local": makeLocalDep("/absolute/path/to/local"),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(1)
			}
		})

		it("deduplicates identical registry dependencies with same alias", () => {
			const manifest1 = makeManifest({
				dependencies: {
					mypackage: makeRegistryDep("mypackage", "1.0.0"),
				},
			})

			const manifest2 = makeManifest({
				dependencies: {
					mypackage: makeRegistryDep("mypackage", "1.0.0"),
				},
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(1)
			}
		})

		it("keeps first occurrence origin in merged result", () => {
			const manifest1 = makeManifest({
				dependencies: {
					foo: makeGithubDep("org/foo"),
				},
				discoveredAt: "cwd",
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					foo: makeGithubDep("org/foo"),
				},
				discoveredAt: "home",
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				const entry = result.value.dependencies.get("foo" as Alias)
				expect(entry?.origin.sourcePath).toBe("/project/package.toml")
				expect(entry?.origin.discoveredAt).toBe("cwd")
			}
		})
	})

	// =============================================================================
	// TESTS: CONFLICT DETECTION
	// =============================================================================

	describe("conflict detection (same alias, different package)", () => {
		it("errors when same alias points to different github repos", () => {
			const manifest1 = makeManifest({
				dependencies: {
					superpowers: makeGithubDep("org-a/superpowers"),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					superpowers: makeGithubDep("org-b/superpowers"),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("alias_conflict")
				expect(result.error.alias).toBe("superpowers")
				expect(result.error.message).toContain("superpowers")
				expect(result.error.message).toContain("different dependencies")
			}
		})

		it("errors when same alias points to different dependency types", () => {
			const manifest1 = makeManifest({
				dependencies: {
					mypackage: makeGithubDep("org/mypackage"),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					mypackage: makeLocalDep("/path/to/mypackage"),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("alias_conflict")
			}
		})

		it("errors when github deps differ by path", () => {
			const manifest1 = makeManifest({
				dependencies: {
					skill: makeGithubDep("org/mono-repo", { path: "packages/skill-a" }),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					skill: makeGithubDep("org/mono-repo", { path: "packages/skill-b" }),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("alias_conflict")
			}
		})

		it("errors when local deps point to different paths", () => {
			const manifest1 = makeManifest({
				dependencies: {
					"my-local": makeLocalDep("/path/a"),
				},
			})

			const manifest2 = makeManifest({
				dependencies: {
					"my-local": makeLocalDep("/path/b"),
				},
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("alias_conflict")
			}
		})

		it("error message includes both manifest paths", () => {
			const manifest1 = makeManifest({
				dependencies: {
					foo: makeGithubDep("org-a/foo"),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					foo: makeGithubDep("org-b/foo"),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.message).toContain("/project/package.toml")
				expect(result.error.message).toContain("/home/user/package.toml")
			}
		})

		it("detects conflict in third manifest", () => {
			const manifest1 = makeManifest({
				dependencies: { foo: makeGithubDep("org/foo") },
				sourcePath: "/a/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: { bar: makeGithubDep("org/bar") },
				sourcePath: "/b/package.toml",
			})

			const manifest3 = makeManifest({
				dependencies: { foo: makeGithubDep("other/foo") },
				sourcePath: "/c/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2, manifest3])

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("alias_conflict")
				expect(result.error.alias).toBe("foo")
			}
		})
	})

	// =============================================================================
	// TESTS: WARNINGS (same package, different alias)
	// =============================================================================

	describe("warnings (same package, different alias)", () => {
		it("warns when same github package has different aliases", () => {
			const manifest1 = makeManifest({
				dependencies: {
					superpowers: makeGithubDep("superpowers-marketplace/superpowers"),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					sp: makeGithubDep("superpowers-marketplace/superpowers"),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				// First alias wins
				expect(result.value.dependencies.size).toBe(1)
				expect(result.value.dependencies.has("superpowers" as Alias)).toBe(true)
				expect(result.value.dependencies.has("sp" as Alias)).toBe(false)

				// Warning should be generated
				expect(result.value.warnings.length).toBe(1)
				expect(result.value.warnings[0]).toContain("sp")
				expect(result.value.warnings[0]).toContain("superpowers")
			}
		})

		it("warns when same local path has different aliases", () => {
			const manifest1 = makeManifest({
				dependencies: {
					"my-package": makeLocalDep("/shared/path"),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					"alt-name": makeLocalDep("/shared/path"),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(1)
				expect(result.value.dependencies.has("my-package" as Alias)).toBe(true)
				expect(result.value.warnings.length).toBe(1)
			}
		})

		it("warning includes both manifest paths", () => {
			const manifest1 = makeManifest({
				dependencies: {
					name1: makeGithubDep("org/repo"),
				},
				sourcePath: "/first/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					name2: makeGithubDep("org/repo"),
				},
				sourcePath: "/second/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.warnings[0]).toContain("/first/package.toml")
				expect(result.value.warnings[0]).toContain("/second/package.toml")
			}
		})

		it("only warns once per duplicate package", () => {
			const manifest1 = makeManifest({
				dependencies: {
					name1: makeGithubDep("org/repo"),
				},
			})

			const manifest2 = makeManifest({
				dependencies: {
					name2: makeGithubDep("org/repo"),
				},
			})

			const manifest3 = makeManifest({
				dependencies: {
					name3: makeGithubDep("org/repo"),
				},
			})

			const result = mergeManifests([manifest1, manifest2, manifest3])

			expect(result).toBeOk()
			if (result.ok) {
				// Should still only have one dependency
				expect(result.value.dependencies.size).toBe(1)
				// Should have two warnings (for name2 and name3)
				expect(result.value.warnings.length).toBe(2)
			}
		})
	})

	// =============================================================================
	// TESTS: DEDUPLICATION KEY BEHAVIOR
	// =============================================================================

	describe("deduplication key behavior", () => {
		it("treats github deps with different paths as different", () => {
			const manifest1 = makeManifest({
				dependencies: {
					"skill-a": makeGithubDep("org/mono-repo", { path: "packages/a" }),
					"skill-b": makeGithubDep("org/mono-repo", { path: "packages/b" }),
				},
			})

			const result = mergeManifests([manifest1])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(2)
			}
		})

		it("treats registry deps with different orgs as different", () => {
			const manifest = makeManifest({
				dependencies: {
					"pkg-a": makeRegistryDep("utils", "1.0.0", "org-a"),
					"pkg-b": makeRegistryDep("utils", "1.0.0", "org-b"),
				},
			})

			const result = mergeManifests([manifest])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(2)
			}
		})

		it("treats git deps with different paths as different", () => {
			const manifest = makeManifest({
				dependencies: {
					"skill-a": makeGitDep("https://example.com/repo", { path: "a" }),
					"skill-b": makeGitDep("https://example.com/repo", { path: "b" }),
				},
			})

			const result = mergeManifests([manifest])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(2)
			}
		})

		it("treats claude-plugin deps with different plugins as different", () => {
			const manifest = makeManifest({
				dependencies: {
					"plugin-a": makeClaudePluginDep(
						"plugin-a",
						"https://marketplace.example.com",
					),
					"plugin-b": makeClaudePluginDep(
						"plugin-b",
						"https://marketplace.example.com",
					),
				},
			})

			const result = mergeManifests([manifest])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(2)
			}
		})
	})

	// =============================================================================
	// TESTS: EDGE CASES
	// =============================================================================

	describe("edge cases", () => {
		it("handles manifest with only agents, no dependencies", () => {
			const manifest = makeManifest({
				agents: { "claude-code": true, codex: false },
				dependencies: {},
			})

			const result = mergeManifests([manifest])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.size).toBe(2)
				expect(result.value.dependencies.size).toBe(0)
			}
		})

		it("handles manifest with only dependencies, no agents", () => {
			const manifest = makeManifest({
				agents: {},
				dependencies: {
					foo: makeGithubDep("org/foo"),
				},
			})

			const result = mergeManifests([manifest])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.size).toBe(0)
				expect(result.value.dependencies.size).toBe(1)
			}
		})

		it("handles many manifests without conflicts", () => {
			const manifests = Array.from({ length: 10 }, (_, i) =>
				makeManifest({
					agents: { "claude-code": true },
					dependencies: {
						[`dep-${i}`]: makeGithubDep(`org/repo-${i}`),
					},
					sourcePath: `/path/${i}/package.toml`,
				}),
			)

			const result = mergeManifests(manifests)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(10)
				expect(result.value.agents.size).toBe(1)
			}
		})

		it("preserves order of manifests for agent priority", () => {
			// Create manifests with different agent settings
			const manifests = [
				makeManifest({ agents: { "claude-code": true } }),
				makeManifest({ agents: { "claude-code": false } }),
				makeManifest({ agents: { "claude-code": true } }),
			]

			const result = mergeManifests(manifests)

			expect(result).toBeOk()
			if (result.ok) {
				// First manifest's setting should win
				expect(result.value.agents.get("claude-code")).toBe(true)
			}
		})

		it("handles registry deps with no org", () => {
			const manifest1 = makeManifest({
				dependencies: {
					utils: makeRegistryDep("utils", "1.0.0"),
				},
			})

			const manifest2 = makeManifest({
				dependencies: {
					utils: makeRegistryDep("utils", "1.0.0"),
				},
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(1)
			}
		})
	})

	// =============================================================================
	// TESTS: COMPLEX SCENARIOS
	// =============================================================================

	describe("complex merge scenarios", () => {
		it("handles mix of deduplication and new dependencies", () => {
			const manifest1 = makeManifest({
				dependencies: {
					"only-in-first": makeGithubDep("org/first"),
					shared: makeGithubDep("org/shared"),
				},
				sourcePath: "/project/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					"only-in-second": makeGithubDep("org/second"),
					shared: makeGithubDep("org/shared"),
				},
				sourcePath: "/home/user/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(3)
				expect(result.value.warnings.length).toBe(0)
			}
		})

		it("stops at first conflict even if later deps would be ok", () => {
			const manifest1 = makeManifest({
				dependencies: {
					conflict: makeGithubDep("org-a/conflict"),
					"would-be-ok": makeGithubDep("org/ok"),
				},
				sourcePath: "/a/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					"also-ok": makeGithubDep("org/also-ok"),
					conflict: makeGithubDep("org-b/conflict"),
				},
				sourcePath: "/b/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.alias).toBe("conflict")
			}
		})

		it("handles all dependency types together", () => {
			const manifest = makeManifest({
				dependencies: {
					git: makeGitDep("https://git.example.com/repo"),
					github: makeGithubDep("org/repo"),
					local: makeLocalDep("/path/to/local"),
					plugin: makeClaudePluginDep(
						"plugin",
						"https://marketplace.example.com",
					),
					registry: makeRegistryDep("pkg", "1.0.0", "org"),
				},
			})

			const result = mergeManifests([manifest])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(5)
			}
		})

		it("handles warning and new dependency in same manifest", () => {
			const manifest1 = makeManifest({
				dependencies: {
					original: makeGithubDep("org/shared"),
				},
				sourcePath: "/a/package.toml",
			})

			const manifest2 = makeManifest({
				dependencies: {
					alias: makeGithubDep("org/shared"), // will warn
					unique: makeGithubDep("org/unique"), // will add
				},
				sourcePath: "/b/package.toml",
			})

			const result = mergeManifests([manifest1, manifest2])

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.dependencies.size).toBe(2)
				expect(result.value.dependencies.has("original" as Alias)).toBe(true)
				expect(result.value.dependencies.has("unique" as Alias)).toBe(true)
				expect(result.value.dependencies.has("alias" as Alias)).toBe(false)
				expect(result.value.warnings.length).toBe(1)
			}
		})
	})
})
