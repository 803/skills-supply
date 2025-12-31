/**
 * Unit tests for manifest/parse.ts
 *
 * This module parses TOML manifest files into validated Manifest objects.
 * It handles:
 * - TOML syntax validation
 * - Schema validation (Zod)
 * - Coercion to branded types
 *
 * Two functions are exported:
 * - parseManifest: Full validation, returns Manifest with branded types
 * - parseLegacyManifest: Deprecated, returns LegacyManifest with raw strings
 */

import { describe, expect, it } from "vitest"
import "@/tests/helpers/assertions"
import { parseLegacyManifest, parseManifest } from "@/src/core/manifest/parse"
import type { AbsolutePath, ManifestDiscoveredAt } from "@/src/core/types/branded"
import { coerceAlias } from "@/src/core/types/coerce"

// Helper to create branded types for tests
const testPath = "/test/package.toml" as AbsolutePath
const discoveredAt: ManifestDiscoveredAt = "cwd"

function alias(value: string) {
	const coerced = coerceAlias(value)
	if (!coerced) {
		throw new Error(`Invalid alias in test: ${value}`)
	}
	return coerced
}

describe("parseManifest", () => {
	describe("TOML parsing", () => {
		it("rejects invalid TOML syntax", () => {
			const badToml = `
[package
name = "broken"
`
			const result = parseManifest(badToml, testPath, discoveredAt)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_toml")
				expect(result.error.message).toContain("Invalid TOML")
				expect(result.error.sourcePath).toBe(testPath)
			}
		})

		it("rejects TOML with syntax errors", () => {
			const badToml = `name = "unclosed string`

			const result = parseManifest(badToml, testPath, discoveredAt)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_toml")
			}
		})

		it("parses empty TOML as valid (all fields optional)", () => {
			const result = parseManifest("", testPath, discoveredAt)

			expect(result).toBeOk()
		})

		it("parses valid TOML structure", () => {
			const toml = `
[package]
name = "my-pkg"
version = "1.0.0"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
		})
	})

	describe("schema validation", () => {
		it("rejects unknown top-level keys (strict mode)", () => {
			const toml = `
unknown_key = "value"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_manifest")
			}
		})

		it("rejects unknown keys in [package] section", () => {
			const toml = `
[package]
name = "test"
version = "1.0.0"
extra_field = "not allowed"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_manifest")
			}
		})

		it("validates package.name is required when [package] present", () => {
			const toml = `
[package]
version = "1.0.0"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.message).toContain("name")
			}
		})

		it("validates package.version is required when [package] present", () => {
			const toml = `
[package]
name = "test"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.message).toContain("version")
			}
		})

		it("rejects empty package.name", () => {
			const toml = `
[package]
name = "   "
version = "1.0.0"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.message).toContain("empty")
			}
		})
	})

	describe("package metadata", () => {
		it("parses minimal package metadata", () => {
			const toml = `
[package]
name = "my-pkg"
version = "1.0.0"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.package?.name).toBe("my-pkg")
				expect(result.value.package?.version).toBe("1.0.0")
			}
		})

		it("parses full package metadata", () => {
			const toml = `
[package]
name = "my-pkg"
version = "2.0.0"
description = "A test package"
license = "MIT"
org = "my-org"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.package?.name).toBe("my-pkg")
				expect(result.value.package?.version).toBe("2.0.0")
				expect(result.value.package?.description).toBe("A test package")
				expect(result.value.package?.license).toBe("MIT")
				expect(result.value.package?.org).toBe("my-org")
			}
		})

		it("trims whitespace from package fields", () => {
			const toml = `
[package]
name = "  trimmed-name  "
version = "  1.0.0  "
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.package?.name).toBe("trimmed-name")
				expect(result.value.package?.version).toBe("1.0.0")
			}
		})
	})

	describe("agents section", () => {
		it("parses valid agent configuration", () => {
			const toml = `
[agents]
claude-code = true
codex = false
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.get("claude-code")).toBe(true)
				expect(result.value.agents.get("codex")).toBe(false)
			}
		})

		it("silently ignores unknown agent IDs (forward compatibility)", () => {
			const toml = `
[agents]
claude-code = true
future-agent = true
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.get("claude-code")).toBe(true)
				const agentIds: string[] = Array.from(result.value.agents.keys())
				expect(agentIds.includes("future-agent")).toBe(false)
			}
		})

		it("returns empty agents map when section missing", () => {
			const toml = `
[package]
name = "test"
version = "1.0.0"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.size).toBe(0)
			}
		})

		it("supports opencode agent", () => {
			const toml = `
[agents]
opencode = true
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.agents.get("opencode")).toBe(true)
			}
		})
	})

	describe("dependencies section", () => {
		describe("registry dependencies", () => {
			it("parses simple registry dependency (name@version)", () => {
				const toml = `
[dependencies]
my-dep = "some-pkg@1.0.0"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("my-dep"))
					expect(dep?.type).toBe("registry")
					if (dep?.type === "registry") {
						expect(dep.name).toBe("some-pkg")
						expect(dep.version).toBe("1.0.0")
						expect(dep.org).toBeUndefined()
					}
				}
			})

			it("parses org-scoped registry dependency (@org/name@version)", () => {
				const toml = `
[dependencies]
my-dep = "@my-org/my-pkg@2.0.0"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("my-dep"))
					expect(dep?.type).toBe("registry")
					if (dep?.type === "registry") {
						expect(dep.name).toBe("my-pkg")
						expect(dep.org).toBe("my-org")
						expect(dep.version).toBe("2.0.0")
					}
				}
			})

			it("rejects malformed registry dependency", () => {
				const toml = `
[dependencies]
my-dep = "no-version"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("coercion_failed")
					expect(result.error.key).toBe("my-dep")
				}
			})
		})

		describe("GitHub dependencies", () => {
			it("parses GitHub dependency with gh shorthand", () => {
				const toml = `
[dependencies.superpowers]
gh = "superpowers-marketplace/superpowers"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("superpowers"))
					expect(dep?.type).toBe("github")
					if (dep?.type === "github") {
						expect(dep.gh).toBe("superpowers-marketplace/superpowers")
					}
				}
			})

			it("parses GitHub dependency with tag ref", () => {
				const toml = `
[dependencies.elements]
gh = "superpowers-marketplace/elements"
tag = "v1.0.0"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("elements"))
					if (dep?.type === "github") {
						expect(dep.ref?.type).toBe("tag")
						expect(dep.ref?.value).toBe("v1.0.0")
					}
				}
			})

			it("parses GitHub dependency with branch ref", () => {
				const toml = `
[dependencies.dev]
gh = "org/repo"
branch = "develop"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("dev"))
					if (dep?.type === "github") {
						expect(dep.ref?.type).toBe("branch")
						expect(dep.ref?.value).toBe("develop")
					}
				}
			})

			it("parses GitHub dependency with rev ref", () => {
				const toml = `
[dependencies.pinned]
gh = "org/repo"
rev = "abc123"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("pinned"))
					if (dep?.type === "github") {
						expect(dep.ref?.type).toBe("rev")
						expect(dep.ref?.value).toBe("abc123")
					}
				}
			})

			it("parses GitHub dependency with subpath", () => {
				const toml = `
[dependencies.plugin]
gh = "org/monorepo"
path = "packages/plugin"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("plugin"))
					if (dep?.type === "github") {
						expect(dep.path).toBe("packages/plugin")
					}
				}
			})

			it("rejects multiple refs (tag + branch)", () => {
				const toml = `
[dependencies.bad]
gh = "org/repo"
tag = "v1.0.0"
branch = "main"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeErr()
			})

			it("rejects invalid GitHub ref format", () => {
				const toml = `
[dependencies.bad]
gh = "not-valid-format"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("coercion_failed")
				}
			})
		})

		describe("git dependencies", () => {
			it("parses git dependency with HTTPS URL", () => {
				const toml = `
[dependencies.external]
git = "https://gitlab.com/org/repo"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("external"))
					expect(dep?.type).toBe("git")
					if (dep?.type === "git") {
						expect(dep.url).toBe("https://gitlab.com/org/repo")
					}
				}
			})

			it("parses git dependency with SSH URL", () => {
				const toml = `
[dependencies.private]
git = "git@gitlab.com:org/repo.git"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("private"))
					expect(dep?.type).toBe("git")
					if (dep?.type === "git") {
						// URL is normalized to HTTPS
						expect(dep.url).toBe("https://gitlab.com/org/repo")
					}
				}
			})

			it("parses git dependency with tag", () => {
				const toml = `
[dependencies.tagged]
git = "https://gitlab.com/org/repo"
tag = "v2.0.0"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("tagged"))
					if (dep?.type === "git") {
						expect(dep.ref?.type).toBe("tag")
						expect(dep.ref?.value).toBe("v2.0.0")
					}
				}
			})
		})

		describe("local dependencies", () => {
			it("parses local dependency with absolute path", () => {
				const toml = `
[dependencies.local]
path = "/absolute/path/to/package"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("local"))
					expect(dep?.type).toBe("local")
					if (dep?.type === "local") {
						expect(dep.path).toBe("/absolute/path/to/package")
					}
				}
			})

			it("resolves local dependency with relative path", () => {
				const manifestPath = "/projects/my-app/package.toml" as AbsolutePath
				const toml = `
[dependencies.local]
path = "../shared-lib"
`
				const result = parseManifest(toml, manifestPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("local"))
					if (dep?.type === "local") {
						// Resolved relative to manifest directory
						expect(dep.path).toBe("/projects/shared-lib")
					}
				}
			})
		})

		describe("claude-plugin dependencies", () => {
			it("parses claude-plugin dependency", () => {
				const toml = `
[dependencies.sensei]
type = "claude-plugin"
plugin = "sensei"
marketplace = "https://github.com/sensei-marketplace/sensei"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeOk()
				if (result.ok) {
					const dep = result.value.dependencies.get(alias("sensei"))
					expect(dep?.type).toBe("claude-plugin")
					if (dep?.type === "claude-plugin") {
						expect(dep.plugin).toBe("sensei")
						expect(dep.marketplace).toBe(
							"https://github.com/sensei-marketplace/sensei",
						)
					}
				}
			})
		})

		describe("alias validation", () => {
			it("rejects alias containing slash", () => {
				const toml = `
[dependencies]
"bad/alias" = "pkg@1.0.0"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("coercion_failed")
					expect(result.error.message).toContain("alias")
				}
			})

			it("rejects alias containing dot", () => {
				const toml = `
[dependencies]
"bad.alias" = "pkg@1.0.0"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeErr()
			})

			it("rejects alias containing colon", () => {
				const toml = `
[dependencies]
"bad:alias" = "pkg@1.0.0"
`
				const result = parseManifest(toml, testPath, discoveredAt)

				expect(result).toBeErr()
			})
		})
	})

	describe("exports section", () => {
		it("parses exports with auto_discover.skills as string", () => {
			const toml = `
[exports.auto_discover]
skills = "skills/"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.exports?.autoDiscover.skills).toBe("skills/")
			}
		})

		it("parses exports with auto_discover.skills as false", () => {
			const toml = `
[exports.auto_discover]
skills = false
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.exports?.autoDiscover.skills).toBe(false)
			}
		})

		it("rejects empty skills path", () => {
			const toml = `
[exports.auto_discover]
skills = "   "
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeErr()
		})
	})

	describe("origin tracking", () => {
		it("includes source path in result", () => {
			const customPath = "/custom/manifest/path.toml" as AbsolutePath
			const result = parseManifest("", customPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.origin.sourcePath).toBe(customPath)
			}
		})

		it("includes discoveredAt in result", () => {
			const discovered: ManifestDiscoveredAt = "home"
			const result = parseManifest("", testPath, discovered)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value.origin.discoveredAt).toBe("home")
			}
		})

		it("includes source path in error", () => {
			const badToml = "[broken"
			const result = parseManifest(badToml, testPath, discoveredAt)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.sourcePath).toBe(testPath)
			}
		})
	})

	describe("comprehensive manifest", () => {
		it("parses a full manifest with all sections", () => {
			const toml = `
[package]
name = "full-example"
version = "1.0.0"
description = "A complete example manifest"
license = "MIT"
org = "example-org"

[agents]
claude-code = true
codex = true

[dependencies]
registry-dep = "@org/pkg@1.0.0"

[dependencies.github-dep]
gh = "owner/repo"
tag = "v1.0.0"

[dependencies.local-dep]
path = "/local/path"

[exports.auto_discover]
skills = "skills/"
`
			const result = parseManifest(toml, testPath, discoveredAt)

			expect(result).toBeOk()
			if (result.ok) {
				// Package
				expect(result.value.package?.name).toBe("full-example")
				expect(result.value.package?.version).toBe("1.0.0")
				expect(result.value.package?.org).toBe("example-org")

				// Agents
				expect(result.value.agents.get("claude-code")).toBe(true)
				expect(result.value.agents.get("codex")).toBe(true)

				// Dependencies
				expect(result.value.dependencies.size).toBe(3)
				expect(result.value.dependencies.get(alias("registry-dep"))?.type).toBe(
					"registry",
				)
				expect(result.value.dependencies.get(alias("github-dep"))?.type).toBe(
					"github",
				)
				expect(result.value.dependencies.get(alias("local-dep"))?.type).toBe(
					"local",
				)

				// Exports
				expect(result.value.exports?.autoDiscover.skills).toBe("skills/")
			}
		})
	})
})

describe("parseLegacyManifest", () => {
	it("parses valid manifest and returns LegacyManifest", () => {
		const toml = `
[package]
name = "legacy-test"
version = "1.0.0"

[agents]
claude-code = true

[dependencies]
my-dep = "pkg@1.0.0"
`
		const result = parseLegacyManifest(toml, "/legacy/path.toml")

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.package?.name).toBe("legacy-test")
			expect(result.value.agents["claude-code"]).toBe(true)
			expect(result.value.dependencies["my-dep"]).toBe("pkg@1.0.0")
			expect(result.value.sourcePath).toBe("/legacy/path.toml")
		}
	})

	it("rejects invalid TOML", () => {
		const result = parseLegacyManifest("[broken", "/path.toml")

		expect(result).toBeErr()
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_toml")
		}
	})

	it("rejects invalid manifest schema", () => {
		const toml = `unknown_field = "value"`
		const result = parseLegacyManifest(toml, "/path.toml")

		expect(result).toBeErr()
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_manifest")
		}
	})

	it("defaults to empty agents and dependencies when missing", () => {
		const toml = `
[package]
name = "minimal"
version = "1.0.0"
`
		const result = parseLegacyManifest(toml, "/path.toml")

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.agents).toEqual({})
			expect(result.value.dependencies).toEqual({})
		}
	})
})
