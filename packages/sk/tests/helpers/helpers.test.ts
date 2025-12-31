/**
 * Tests for test helpers
 *
 * Validates that the test utilities work correctly before using them
 * in actual tests.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { exists, isDirectory, isFile, setupFixturePackage, withTempDir } from "./fs"
import {
	buildManifestWithGithubDeps,
	buildManifestWithLocalDeps,
	buildMultiAgentManifest,
	buildRawManifest,
} from "./manifest"

// Import assertions to register custom matchers
import "./assertions"

describe("withTempDir", () => {
	it("creates a temporary directory that exists during callback", async () => {
		let capturedDir: string | null = null

		await withTempDir(async (dir) => {
			capturedDir = dir

			// Directory should exist during callback
			expect(await exists(dir)).toBe(true)
			expect(await isDirectory(dir)).toBe(true)
		})

		// Directory should be cleaned up after callback
		expect(capturedDir).not.toBeNull()
		expect(await exists(capturedDir!)).toBe(false)
	})

	it("cleans up even if callback throws", async () => {
		let capturedDir: string | null = null

		await expect(
			withTempDir(async (dir) => {
				capturedDir = dir
				throw new Error("Test error")
			}),
		).rejects.toThrow("Test error")

		// Directory should still be cleaned up
		expect(capturedDir).not.toBeNull()
		expect(await exists(capturedDir!)).toBe(false)
	})

	it("returns the value from the callback", async () => {
		const result = await withTempDir(async () => {
			return 42
		})

		expect(result).toBe(42)
	})
})

describe("exists, isDirectory, isFile", () => {
	it("returns false for non-existent paths", async () => {
		expect(await exists("/definitely/does/not/exist")).toBe(false)
		expect(await isDirectory("/definitely/does/not/exist")).toBe(false)
		expect(await isFile("/definitely/does/not/exist")).toBe(false)
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

			// Check package.toml exists and has correct content
			const manifestPath = join(pkgDir, "package.toml")
			expect(await exists(manifestPath)).toBe(true)

			const manifestContent = await readFile(manifestPath, "utf-8")
			expect(manifestContent).toContain('name = "my-package"')
			expect(manifestContent).toContain('version = "2.0.0"')
			expect(manifestContent).toContain('skills = "skills"')

			// Check skills exist (each skill is a directory with SKILL.md)
			expect(await exists(join(pkgDir, "skills", "greeting", "SKILL.md"))).toBe(
				true,
			)
			expect(await exists(join(pkgDir, "skills", "farewell", "SKILL.md"))).toBe(
				true,
			)

			// Check skill content (includes YAML frontmatter)
			const greetingContent = await readFile(
				join(pkgDir, "skills", "greeting", "SKILL.md"),
				"utf-8",
			)
			expect(greetingContent).toContain("name: greeting")
			expect(greetingContent).toContain("# Hello")
			expect(greetingContent).toContain("A greeting skill")
		})
	})

	it("uses defaults when options not provided", async () => {
		await withTempDir(async (dir) => {
			const pkgDir = join(dir, "default-pkg")

			await setupFixturePackage(pkgDir)

			// Should still create manifest with defaults
			const manifestPath = join(pkgDir, "package.toml")
			expect(await exists(manifestPath)).toBe(true)

			const manifestContent = await readFile(manifestPath, "utf-8")
			expect(manifestContent).toContain('name = "default-pkg"')
			expect(manifestContent).toContain('version = "1.0.0"')
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
			expect(await exists(join(pkgDir, "package.toml"))).toBe(false)

			// But skills should exist (each skill is a directory with SKILL.md)
			expect(await exists(join(pkgDir, "skills", "test", "SKILL.md"))).toBe(true)
		})
	})
})

describe("buildRawManifest", () => {
	it("returns a valid manifest with defaults", () => {
		const manifest = buildRawManifest()

		expect(manifest.package).toBeDefined()
		expect(manifest.package?.name).toBe("test-pkg")
		expect(manifest.package?.version).toBe("1.0.0")
		expect(manifest.agents).toEqual({ "claude-code": true })
		expect(manifest.dependencies).toEqual({})
		expect(manifest.sourcePath).toBe("/test/package.toml")
	})

	it("allows overriding package metadata", () => {
		const manifest = buildRawManifest({
			package: { description: "My package", name: "custom-name", version: "3.0.0" },
		})

		expect(manifest.package?.name).toBe("custom-name")
		expect(manifest.package?.version).toBe("3.0.0")
		expect(manifest.package?.description).toBe("My package")
	})

	it("allows overriding agents", () => {
		const manifest = buildRawManifest({
			agents: { "claude-code": false, codex: true },
		})

		expect(manifest.agents).toEqual({ "claude-code": false, codex: true })
	})

	it("allows overriding dependencies", () => {
		const manifest = buildRawManifest({
			dependencies: {
				"local-pkg": { path: "/local/path" },
				"my-pkg": { gh: "org/repo" },
			},
		})

		expect(manifest.dependencies["my-pkg"]).toEqual({ gh: "org/repo" })
		expect(manifest.dependencies["local-pkg"]).toEqual({ path: "/local/path" })
	})
})

describe("buildManifestWithGithubDeps", () => {
	it("creates manifest with string shorthand deps", () => {
		const manifest = buildManifestWithGithubDeps({
			sensei: "sensei-marketplace/sensei",
			superpowers: "superpowers-marketplace/superpowers",
		})

		expect(manifest.dependencies).toEqual({
			sensei: { gh: "sensei-marketplace/sensei" },
			superpowers: { gh: "superpowers-marketplace/superpowers" },
		})
	})

	it("creates manifest with structured deps", () => {
		const manifest = buildManifestWithGithubDeps({
			branched: { branch: "main", gh: "org/repo" },
			tagged: { gh: "org/repo", tag: "v1.0.0" },
		})

		expect(manifest.dependencies).toEqual({
			branched: { branch: "main", gh: "org/repo" },
			tagged: { gh: "org/repo", tag: "v1.0.0" },
		})
	})
})

describe("buildManifestWithLocalDeps", () => {
	it("creates manifest with local path deps", () => {
		const manifest = buildManifestWithLocalDeps({
			local1: "/absolute/path",
			local2: "../relative/path",
		})

		expect(manifest.dependencies).toEqual({
			local1: { path: "/absolute/path" },
			local2: { path: "../relative/path" },
		})
	})
})

describe("buildMultiAgentManifest", () => {
	it("creates manifest with multiple agents enabled", () => {
		const manifest = buildMultiAgentManifest(["claude-code", "codex", "opencode"])

		expect(manifest.agents).toEqual({
			"claude-code": true,
			codex: true,
			opencode: true,
		})
	})
})

describe("custom assertions", () => {
	it("toBeOk passes for ok results", () => {
		const okResult = { ok: true as const, value: "success" }
		expect(okResult).toBeOk()
	})

	it("toBeOk fails for error results", () => {
		const errResult = { error: "failed", ok: false as const }
		expect(() => expect(errResult).toBeOk()).toThrow()
	})

	it("toBeErr passes for error results", () => {
		const errResult = { error: "failed", ok: false as const }
		expect(errResult).toBeErr()
	})

	it("toBeErr fails for ok results", () => {
		const okResult = { ok: true as const, value: "success" }
		expect(() => expect(okResult).toBeErr()).toThrow()
	})

	it("toBeOkWith passes when predicate matches", () => {
		const result = { ok: true as const, value: { name: "test" } }
		expect(result).toBeOkWith((v: unknown) => (v as { name: string }).name === "test")
	})

	it("toBeOkWith fails when predicate doesn't match", () => {
		const result = { ok: true as const, value: { name: "test" } }
		expect(() =>
			expect(result).toBeOkWith(
				(v: unknown) => (v as { name: string }).name === "other",
			),
		).toThrow()
	})

	it("toBeErrContaining passes when error contains substring", () => {
		const result = { error: { message: "invalid input" }, ok: false as const }
		expect(result).toBeErrContaining("invalid")
	})

	it("toBeErrContaining fails when error doesn't contain substring", () => {
		const result = { error: { message: "something else" }, ok: false as const }
		expect(() => expect(result).toBeErrContaining("invalid")).toThrow()
	})
})
