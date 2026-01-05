import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type ScanUnit, scanRepo } from "./scan"

async function createTempDir(): Promise<string> {
	const base = path.join(tmpdir(), "discovery-test")
	const dir = path.join(
		base,
		`test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	)
	await mkdir(dir, { recursive: true })
	return dir
}

async function cleanupTempDir(dir: string): Promise<void> {
	try {
		await rm(dir, { force: true, recursive: true })
	} catch {
		// Ignore cleanup errors
	}
}

describe("scanRepo", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await createTempDir()
	})

	afterEach(async () => {
		await cleanupTempDir(tempDir)
	})

	it("indexes marketplace plugins at repo root", async () => {
		const pluginDir = path.join(tempDir, ".claude-plugin")
		await mkdir(pluginDir, { recursive: true })
		await writeFile(
			path.join(pluginDir, "marketplace.json"),
			JSON.stringify({
				name: "Test Market",
				plugins: [
					{
						description: "Alpha plugin",
						name: "alpha",
						source: "plugins/alpha",
					},
					{
						name: "beta",
						source: { repo: "acme/beta", source: "github" },
					},
				],
			}),
		)
		await writeFile(
			path.join(pluginDir, "plugin.json"),
			JSON.stringify({ name: "ignored" }),
		)

		const result = await scanRepo(tempDir, "owner/repo")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toHaveLength(2)
			const names = result.value.units.map((unit: ScanUnit) => unit.metadata?.name)
			expect(names).toEqual(["alpha", "beta"])
			for (const unit of result.value.units) {
				expect(unit.kind).toBe("marketplace")
				expect(unit.declaration.type).toBe("claude-plugin")
				if (unit.declaration.type === "claude-plugin") {
					expect(unit.declaration.marketplace).toBe("owner/repo")
				}
			}
		}
	})

	it("indexes marketplace and manifest packages together at repo root", async () => {
		const pluginDir = path.join(tempDir, ".claude-plugin")
		await mkdir(pluginDir, { recursive: true })
		await writeFile(
			path.join(pluginDir, "marketplace.json"),
			JSON.stringify({
				name: "Dual Market",
				plugins: [{ name: "alpha", source: "plugins/alpha" }],
			}),
		)
		await writeFile(
			path.join(tempDir, "agents.toml"),
			`[package]\nname = "pkg"\nversion = "1.2.3"\n`,
		)

		const result = await scanRepo(tempDir, "owner/repo")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toHaveLength(2)
			const kinds = result.value.units.map((unit: ScanUnit) => unit.kind).sort()
			expect(kinds).toEqual(["manifest", "marketplace"])
		}
	})

	it("skips marketplace files outside repo root", async () => {
		const nested = path.join(tempDir, "nested", ".claude-plugin")
		await mkdir(nested, { recursive: true })
		await writeFile(
			path.join(nested, "marketplace.json"),
			JSON.stringify({ name: "Nested Market", plugins: [] }),
		)

		const result = await scanRepo(tempDir, "owner/repo")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toEqual([])
		}
	})

	it("skips standalone plugin repos", async () => {
		const pluginDir = path.join(tempDir, ".claude-plugin")
		await mkdir(pluginDir, { recursive: true })
		await writeFile(
			path.join(pluginDir, "plugin.json"),
			JSON.stringify({ name: "Only Plugin" }),
		)

		const result = await scanRepo(tempDir, "owner/repo")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toEqual([])
		}
	})

	it("indexes manifest packages only when [package] exists", async () => {
		await writeFile(
			path.join(tempDir, "agents.toml"),
			`[package]\nname = "pkg"\nversion = "1.0.0"\n`,
		)

		const result = await scanRepo(tempDir, "owner/repo")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toHaveLength(1)
			const unit = result.value.units[0]
			expect(unit).toBeDefined()
			if (!unit) {
				return
			}
			expect(unit.kind).toBe("manifest")
			expect(unit.metadata?.name).toBe("pkg")
			expect(unit.declaration.type).toBe("github")
		}
	})

	it("skips manifests without [package]", async () => {
		await writeFile(
			path.join(tempDir, "agents.toml"),
			`[dependencies]\nfoo = { gh = "owner/dep" }\n`,
		)

		const result = await scanRepo(tempDir, "owner/repo")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toEqual([])
		}
	})

	it("indexes subdir skills via frontmatter", async () => {
		const skillDir = path.join(tempDir, "skills", "one")
		await mkdir(skillDir, { recursive: true })
		await writeFile(
			path.join(skillDir, "SKILL.md"),
			"---\nname: one\ndescription: First\n---\n\n# One",
		)

		const result = await scanRepo(tempDir, "owner/repo")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toHaveLength(1)
			const unit = result.value.units[0]
			expect(unit).toBeDefined()
			if (!unit) {
				return
			}
			expect(unit.kind).toBe("subdir")
			expect(unit.metadata?.name).toBe("skills")
			expect(unit.path).toBe("skills")
		}
	})

	it("indexes a single skill at repo root", async () => {
		await writeFile(
			path.join(tempDir, "SKILL.md"),
			"---\nname: root-skill\n---\n\n# Root",
		)

		const result = await scanRepo(tempDir, "owner/repo")
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toHaveLength(1)
			const unit = result.value.units[0]
			expect(unit).toBeDefined()
			if (!unit) {
				return
			}
			expect(unit.kind).toBe("single")
			expect(unit.metadata?.name).toBe("root-skill")
			expect(unit.path).toBeNull()
		}
	})

	it("stops after root manifest and ignores nested skills", async () => {
		await writeFile(
			path.join(tempDir, "agents.toml"),
			`[package]\nname = "pkg"\nversion = "1.0.0"\n`,
		)
		const nested = path.join(tempDir, "skills", "one")
		await mkdir(nested, { recursive: true })
		await writeFile(
			path.join(nested, "SKILL.md"),
			"---\nname: nested\n---\n\n# Nested",
		)

		const result = await scanRepo(tempDir, "owner/repo")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toHaveLength(1)
			expect(result.value.units[0]?.kind).toBe("manifest")
		}
	})

	it("stops after root marketplace and ignores nested skills", async () => {
		const pluginDir = path.join(tempDir, ".claude-plugin")
		await mkdir(pluginDir, { recursive: true })
		await writeFile(
			path.join(pluginDir, "marketplace.json"),
			JSON.stringify({
				name: "Root Market",
				plugins: [{ name: "alpha", source: "plugins/alpha" }],
			}),
		)
		const nested = path.join(tempDir, "skills", "one")
		await mkdir(nested, { recursive: true })
		await writeFile(
			path.join(nested, "SKILL.md"),
			"---\nname: nested\n---\n\n# Nested",
		)

		const result = await scanRepo(tempDir, "owner/repo")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toHaveLength(1)
			expect(result.value.units[0]?.kind).toBe("marketplace")
		}
	})

	it("does not recurse into subdir packages", async () => {
		const subdir = path.join(tempDir, "skills", "one")
		await mkdir(subdir, { recursive: true })
		await writeFile(path.join(subdir, "SKILL.md"), "---\nname: one\n---\n\n# One")
		const nested = path.join(subdir, "nested")
		await mkdir(nested, { recursive: true })
		await writeFile(
			path.join(nested, "SKILL.md"),
			"---\nname: nested\n---\n\n# Nested",
		)

		const result = await scanRepo(tempDir, "owner/repo")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.units).toHaveLength(1)
			const unit = result.value.units[0]
			expect(unit?.kind).toBe("subdir")
			expect(unit?.path).toBe("skills")
		}
	})
})
