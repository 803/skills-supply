/**
 * Tests for test helpers
 *
 * Validates that the test utilities work correctly before using them
 * in actual tests.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	exists,
	isDirectory,
	isFile,
	setupFixtureMarketplace,
	setupFixturePackage,
	setupFixturePlugin,
	withTempDir,
} from "@/tests/helpers/fs"
// Import assertions to register custom matchers
import "@/tests/helpers/assertions"

describe("withTempDir", () => {
	it("creates a temporary directory that exists during callback", async () => {
		let capturedDir: string | null = null

		await withTempDir(async (dir) => {
			capturedDir = dir

			// Directory should exist during callback
			expect(await exists(dir)).toBe(true)
			expect(await isDirectory(dir)).toBe(true)
			// Should be a file path starting with temp directory prefix
			expect(dir).toMatch(/^.*sk-test-[a-zA-Z0-9]+$/)
		})

		// Directory should be cleaned up after callback
		expect(capturedDir).toMatch(/^.*sk-test-[a-zA-Z0-9]+$/)
		expect(await exists(capturedDir as unknown as string)).toBe(false)
	})

	it("cleans up even if callback throws", async () => {
		let capturedDir: string | null = null
		const testError = new Error("Test error")

		await expect(
			withTempDir(async (dir) => {
				capturedDir = dir
				throw testError
			}),
		).rejects.toThrow(testError)

		// Directory should still be cleaned up
		expect(capturedDir).toMatch(/^.*sk-test-[a-zA-Z0-9]+$/)
		expect(await exists(capturedDir as unknown as string)).toBe(false)
	})

	it("returns the value from the callback", async () => {
		const result = await withTempDir(async () => {
			return 42
		})

		expect(result).toBe(42)
	})

	it("returns complex objects from the callback", async () => {
		const result = await withTempDir(async () => {
			return { items: [1, 2, 3], name: "test" }
		})

		expect(result).toEqual({ items: [1, 2, 3], name: "test" })
	})

	it("returns undefined when callback has no return", async () => {
		const result = await withTempDir(async () => {
			// no return
		})

		expect(result).toBe(undefined)
	})

	it("creates unique directories for concurrent calls", async () => {
		const dirs: string[] = []

		await Promise.all([
			withTempDir(async (dir) => {
				dirs.push(dir)
			}),
			withTempDir(async (dir) => {
				dirs.push(dir)
			}),
			withTempDir(async (dir) => {
				dirs.push(dir)
			}),
		])

		expect(dirs).toHaveLength(3)
		// All directories should be unique
		const uniqueDirs = new Set(dirs)
		expect(uniqueDirs.size).toBe(3)
	})
})

describe("exists, isDirectory, isFile", () => {
	it("returns false for non-existent paths", async () => {
		expect(await exists("/definitely/does/not/exist")).toBe(false)
		expect(await isDirectory("/definitely/does/not/exist")).toBe(false)
		expect(await isFile("/definitely/does/not/exist")).toBe(false)
	})

	it("returns false for empty string path", async () => {
		expect(await exists("")).toBe(false)
		expect(await isDirectory("")).toBe(false)
		expect(await isFile("")).toBe(false)
	})

	it("correctly identifies directories and files", async () => {
		await withTempDir(async (dir) => {
			const filePath = join(dir, "test.txt")
			const subDir = join(dir, "subdir")

			// Create a file and subdirectory
			await writeFile(filePath, "hello")
			await mkdir(subDir, { recursive: true })
			await writeFile(join(subDir, "nested.txt"), "nested")

			// Test file
			expect(await exists(filePath)).toBe(true)
			expect(await isFile(filePath)).toBe(true)
			expect(await isDirectory(filePath)).toBe(false)

			// Test directory
			expect(await exists(subDir)).toBe(true)
			expect(await isDirectory(subDir)).toBe(true)
			expect(await isFile(subDir)).toBe(false)

			// Test nested file
			expect(await exists(join(subDir, "nested.txt"))).toBe(true)
			expect(await isFile(join(subDir, "nested.txt"))).toBe(true)
			expect(await isDirectory(join(subDir, "nested.txt"))).toBe(false)
		})
	})

	it("correctly identifies empty files", async () => {
		await withTempDir(async (dir) => {
			const emptyFile = join(dir, "empty.txt")
			await writeFile(emptyFile, "")

			expect(await exists(emptyFile)).toBe(true)
			expect(await isFile(emptyFile)).toBe(true)
			expect(await isDirectory(emptyFile)).toBe(false)
		})
	})

	it("correctly identifies empty directories", async () => {
		await withTempDir(async (dir) => {
			const emptyDir = join(dir, "empty-dir")
			await mkdir(emptyDir)

			expect(await exists(emptyDir)).toBe(true)
			expect(await isDirectory(emptyDir)).toBe(true)
			expect(await isFile(emptyDir)).toBe(false)
		})
	})
})

describe("setupFixturePackage", () => {
	it("creates a package with manifest and skills", async () => {
		await withTempDir(async (dir) => {
			const pkgDir = join(dir, "my-pkg")

			await setupFixturePackage(pkgDir, {
				name: "my-package",
				skills: [
					{ content: "# Hello\nA greeting skill", name: "greeting" },
					{ content: "# Goodbye\nA farewell skill", name: "farewell" },
				],
				version: "2.0.0",
			})

			// Check agents.toml exists and has correct content
			const manifestPath = join(pkgDir, "agents.toml")
			expect(await exists(manifestPath)).toBe(true)

			const manifestContent = await readFile(manifestPath, "utf-8")
			expect(manifestContent).toBe(`[package]
name = "my-package"
version = "2.0.0"

[exports.auto_discover]
skills = "skills"
`)

			// Check skills directory structure
			expect(await isDirectory(join(pkgDir, "skills"))).toBe(true)
			expect(await isDirectory(join(pkgDir, "skills", "greeting"))).toBe(true)
			expect(await isDirectory(join(pkgDir, "skills", "farewell"))).toBe(true)

			// Check skill files exist
			expect(await isFile(join(pkgDir, "skills", "greeting", "SKILL.md"))).toBe(
				true,
			)
			expect(await isFile(join(pkgDir, "skills", "farewell", "SKILL.md"))).toBe(
				true,
			)

			// Check exact skill content with frontmatter
			const greetingContent = await readFile(
				join(pkgDir, "skills", "greeting", "SKILL.md"),
				"utf-8",
			)
			expect(greetingContent).toBe(`---
name: greeting
---

# Hello
A greeting skill
`)

			const farewellContent = await readFile(
				join(pkgDir, "skills", "farewell", "SKILL.md"),
				"utf-8",
			)
			expect(farewellContent).toBe(`---
name: farewell
---

# Goodbye
A farewell skill
`)
		})
	})

	it("uses defaults when options not provided", async () => {
		await withTempDir(async (dir) => {
			const pkgDir = join(dir, "default-pkg")

			await setupFixturePackage(pkgDir)

			// Should still create manifest with defaults
			const manifestPath = join(pkgDir, "agents.toml")
			expect(await exists(manifestPath)).toBe(true)

			const manifestContent = await readFile(manifestPath, "utf-8")
			expect(manifestContent).toBe(`[package]
name = "default-pkg"
version = "1.0.0"

[exports.auto_discover]
skills = "skills"
`)
		})
	})

	it("uses directory basename as default name", async () => {
		await withTempDir(async (dir) => {
			const pkgDir = join(dir, "nested", "deep", "custom-name-pkg")

			await setupFixturePackage(pkgDir)

			const manifestContent = await readFile(join(pkgDir, "agents.toml"), "utf-8")
			expect(manifestContent).toContain('name = "custom-name-pkg"')
		})
	})

	it("can skip manifest creation", async () => {
		await withTempDir(async (dir) => {
			const pkgDir = join(dir, "no-manifest")

			await setupFixturePackage(pkgDir, {
				createManifest: false,
				skills: [{ content: "test content", name: "test" }],
			})

			// No manifest
			expect(await exists(join(pkgDir, "agents.toml"))).toBe(false)

			// But skills should exist
			expect(await isDirectory(join(pkgDir, "skills"))).toBe(true)
			expect(await isDirectory(join(pkgDir, "skills", "test"))).toBe(true)
			expect(await isFile(join(pkgDir, "skills", "test", "SKILL.md"))).toBe(true)
		})
	})

	it("can use custom skills directory name", async () => {
		await withTempDir(async (dir) => {
			const pkgDir = join(dir, "custom-skills-dir")

			await setupFixturePackage(pkgDir, {
				skills: [{ content: "content", name: "my-skill" }],
				skillsDir: "custom-skills",
			})

			// Manifest should reference custom skills directory
			const manifestContent = await readFile(join(pkgDir, "agents.toml"), "utf-8")
			expect(manifestContent).toContain('skills = "custom-skills"')

			// Skills should be in custom directory
			expect(await isDirectory(join(pkgDir, "custom-skills"))).toBe(true)
			expect(
				await isFile(join(pkgDir, "custom-skills", "my-skill", "SKILL.md")),
			).toBe(true)

			// Default skills directory should not exist
			expect(await exists(join(pkgDir, "skills"))).toBe(false)
		})
	})

	it("creates empty package when no skills provided", async () => {
		await withTempDir(async (dir) => {
			const pkgDir = join(dir, "empty-pkg")

			await setupFixturePackage(pkgDir, {
				name: "empty",
				skills: [],
			})

			// Manifest should exist
			expect(await isFile(join(pkgDir, "agents.toml"))).toBe(true)

			// Skills directory should not be created when no skills
			expect(await exists(join(pkgDir, "skills"))).toBe(false)
		})
	})

	it("strips .md extension from skill names when creating directories", async () => {
		await withTempDir(async (dir) => {
			const pkgDir = join(dir, "md-ext-pkg")

			await setupFixturePackage(pkgDir, {
				skills: [{ content: "content", name: "skill-with-ext.md" }],
			})

			// Directory should be named without .md
			expect(await isDirectory(join(pkgDir, "skills", "skill-with-ext"))).toBe(true)
			expect(
				await isFile(join(pkgDir, "skills", "skill-with-ext", "SKILL.md")),
			).toBe(true)

			// Frontmatter should also strip the extension
			const content = await readFile(
				join(pkgDir, "skills", "skill-with-ext", "SKILL.md"),
				"utf-8",
			)
			expect(content).toContain("name: skill-with-ext")
		})
	})
})

describe("setupFixturePlugin", () => {
	it("creates plugin structure with plugin.json", async () => {
		await withTempDir(async (dir) => {
			const pluginDir = join(dir, "my-plugin")

			await setupFixturePlugin(pluginDir, {
				name: "test-plugin",
				version: "2.0.0",
			})

			// Check .claude-plugin directory exists
			expect(await isDirectory(join(pluginDir, ".claude-plugin"))).toBe(true)

			// Check plugin.json exists with correct content
			const pluginJsonPath = join(pluginDir, ".claude-plugin", "plugin.json")
			expect(await isFile(pluginJsonPath)).toBe(true)

			const pluginJson = JSON.parse(await readFile(pluginJsonPath, "utf-8"))
			expect(pluginJson).toEqual({
				description: "Test plugin: test-plugin",
				name: "test-plugin",
				version: "2.0.0",
			})
		})
	})

	it("uses directory basename as default name", async () => {
		await withTempDir(async (dir) => {
			const pluginDir = join(dir, "auto-named-plugin")

			await setupFixturePlugin(pluginDir)

			const pluginJson = JSON.parse(
				await readFile(join(pluginDir, ".claude-plugin", "plugin.json"), "utf-8"),
			)
			expect(pluginJson.name).toBe("auto-named-plugin")
			expect(pluginJson.version).toBe("1.0.0")
		})
	})

	it("creates marketplace.json when includeMarketplace is true", async () => {
		await withTempDir(async (dir) => {
			const pluginDir = join(dir, "with-marketplace")

			await setupFixturePlugin(pluginDir, {
				includeMarketplace: true,
				marketplaceName: "custom-marketplace",
				name: "my-plugin",
				version: "1.2.3",
			})

			// Both files should exist
			expect(await isFile(join(pluginDir, ".claude-plugin", "plugin.json"))).toBe(
				true,
			)
			expect(
				await isFile(join(pluginDir, ".claude-plugin", "marketplace.json")),
			).toBe(true)

			const marketplaceJson = JSON.parse(
				await readFile(
					join(pluginDir, ".claude-plugin", "marketplace.json"),
					"utf-8",
				),
			)
			expect(marketplaceJson).toEqual({
				name: "custom-marketplace",
				plugins: [{ name: "my-plugin", source: "./", version: "1.2.3" }],
			})
		})
	})

	it("creates skills in plugin format", async () => {
		await withTempDir(async (dir) => {
			const pluginDir = join(dir, "plugin-with-skills")

			await setupFixturePlugin(pluginDir, {
				skills: [
					{ content: "Alpha skill content", name: "alpha" },
					{ name: "beta" }, // uses default content
				],
			})

			// Check skills structure
			expect(await isDirectory(join(pluginDir, "skills"))).toBe(true)
			expect(await isFile(join(pluginDir, "skills", "alpha", "SKILL.md"))).toBe(
				true,
			)
			expect(await isFile(join(pluginDir, "skills", "beta", "SKILL.md"))).toBe(true)

			// Check custom content
			const alphaContent = await readFile(
				join(pluginDir, "skills", "alpha", "SKILL.md"),
				"utf-8",
			)
			expect(alphaContent).toBe(`---
name: alpha
---

Alpha skill content
`)

			// Check default content
			const betaContent = await readFile(
				join(pluginDir, "skills", "beta", "SKILL.md"),
				"utf-8",
			)
			expect(betaContent).toBe(`---
name: beta
---

# beta

A test skill.
`)
		})
	})
})

describe("setupFixtureMarketplace", () => {
	it("creates marketplace-only structure", async () => {
		await withTempDir(async (dir) => {
			const marketplaceDir = join(dir, "my-marketplace")

			await setupFixtureMarketplace(marketplaceDir, {
				name: "custom-marketplace",
				plugins: [
					{ name: "plugin-a", source: "github:org/repo-a" },
					{ name: "plugin-b", source: "github:org/repo-b" },
				],
			})

			// Check .claude-plugin directory exists
			expect(await isDirectory(join(marketplaceDir, ".claude-plugin"))).toBe(true)

			// Check marketplace.json exists with correct content
			const marketplaceJsonPath = join(
				marketplaceDir,
				".claude-plugin",
				"marketplace.json",
			)
			expect(await isFile(marketplaceJsonPath)).toBe(true)

			const marketplaceJson = JSON.parse(
				await readFile(marketplaceJsonPath, "utf-8"),
			)
			expect(marketplaceJson).toEqual({
				name: "custom-marketplace",
				plugins: [
					{ name: "plugin-a", source: "github:org/repo-a" },
					{ name: "plugin-b", source: "github:org/repo-b" },
				],
			})

			// No plugin.json should exist
			expect(
				await exists(join(marketplaceDir, ".claude-plugin", "plugin.json")),
			).toBe(false)
		})
	})

	it("uses defaults when options not provided", async () => {
		await withTempDir(async (dir) => {
			const marketplaceDir = join(dir, "default-marketplace")

			await setupFixtureMarketplace(marketplaceDir)

			const marketplaceJson = JSON.parse(
				await readFile(
					join(marketplaceDir, ".claude-plugin", "marketplace.json"),
					"utf-8",
				),
			)
			expect(marketplaceJson).toEqual({
				name: "test-marketplace",
				plugins: [],
			})
		})
	})
})

describe("custom assertions", () => {
	describe("toBeOk", () => {
		it("passes for ok results with value", () => {
			const okResult = { ok: true as const, value: "success" }
			expect(okResult).toBeOk()
		})

		it("passes for ok results with null value", () => {
			const okResult = { ok: true as const, value: null }
			expect(okResult).toBeOk()
		})

		it("passes for ok results with undefined value", () => {
			const okResult = { ok: true as const, value: undefined }
			expect(okResult).toBeOk()
		})

		it("passes for ok results with complex object value", () => {
			const okResult = { ok: true as const, value: { nested: { deep: [1, 2, 3] } } }
			expect(okResult).toBeOk()
		})

		it("fails for error results with string error", () => {
			const errResult = { error: "failed", ok: false as const }
			expect(() => expect(errResult).toBeOk()).toThrow(
				/expected result to be ok, but got error/,
			)
		})

		it("fails for error results with object error", () => {
			const errResult = {
				error: { code: "E001", message: "failed" },
				ok: false as const,
			}
			expect(() => expect(errResult).toBeOk()).toThrow(
				/expected result to be ok, but got error/,
			)
		})
	})

	describe("toBeErr", () => {
		it("passes for error results with string error", () => {
			const errResult = { error: "failed", ok: false as const }
			expect(errResult).toBeErr()
		})

		it("passes for error results with object error", () => {
			const errResult = {
				error: { code: "E001", message: "failed" },
				ok: false as const,
			}
			expect(errResult).toBeErr()
		})

		it("passes for error results with null error", () => {
			const errResult = { error: null, ok: false as const }
			expect(errResult).toBeErr()
		})

		it("fails for ok results with value", () => {
			const okResult = { ok: true as const, value: "success" }
			expect(() => expect(okResult).toBeErr()).toThrow(
				/expected result to be an error, but got ok with value/,
			)
		})

		it("fails for ok results with null value", () => {
			const okResult = { ok: true as const, value: null }
			expect(() => expect(okResult).toBeErr()).toThrow(
				/expected result to be an error, but got ok with value/,
			)
		})
	})

	describe("toBeOkWith", () => {
		it("passes when predicate returns true", () => {
			const result = { ok: true as const, value: { count: 5, name: "test" } }
			expect(result).toBeOkWith(
				(v: unknown) => (v as { name: string; count: number }).name === "test",
			)
		})

		it("passes when predicate checks nested properties", () => {
			const result = { ok: true as const, value: { data: { items: [1, 2, 3] } } }
			expect(result).toBeOkWith(
				(v: unknown) =>
					(v as { data: { items: number[] } }).data.items.length === 3,
			)
		})

		it("fails when predicate returns false", () => {
			const result = { ok: true as const, value: { name: "test" } }
			expect(() =>
				expect(result).toBeOkWith(
					(v: unknown) => (v as { name: string }).name === "other",
				),
			).toThrow(/expected value to match predicate, but it didn't/)
		})

		it("fails when result is error", () => {
			const result = { error: "failed", ok: false as const }
			expect(() => expect(result).toBeOkWith(() => true)).toThrow(
				/expected result to be ok, but got error/,
			)
		})

		it("works with boolean predicates on primitive values", () => {
			const result = { ok: true as const, value: 42 }
			expect(result).toBeOkWith((v: unknown) => (v as number) > 40)
		})
	})

	describe("toBeErrContaining", () => {
		it("passes when string error contains substring", () => {
			const result = { error: "invalid input provided", ok: false as const }
			expect(result).toBeErrContaining("invalid")
		})

		it("passes when object error message contains substring", () => {
			const result = { error: { message: "invalid input" }, ok: false as const }
			expect(result).toBeErrContaining("invalid")
		})

		it("passes when nested error object contains substring", () => {
			const result = {
				error: { code: "E001", details: { reason: "missing field" } },
				ok: false as const,
			}
			expect(result).toBeErrContaining("missing field")
		})

		it("fails when error does not contain substring", () => {
			const result = { error: { message: "something else" }, ok: false as const }
			expect(() => expect(result).toBeErrContaining("invalid")).toThrow(
				/expected error to contain "invalid", but got/,
			)
		})

		it("fails when result is ok", () => {
			const result = { ok: true as const, value: "success" }
			expect(() => expect(result).toBeErrContaining("invalid")).toThrow(
				/expected result to be an error, but got ok with value/,
			)
		})

		it("works with case-sensitive matching", () => {
			const result = { error: "Invalid Input", ok: false as const }
			expect(result).toBeErrContaining("Invalid")
			expect(() => expect(result).toBeErrContaining("invalid")).toThrow()
		})
	})
})
