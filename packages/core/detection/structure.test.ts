import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { detectStructure } from "@/detection/structure"
import type { AbsolutePath } from "@/types/branded"
import { coerceAbsolutePathDirect } from "@/types/coerce"
import type { ValidatedDeclaration } from "@/types/declaration"

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = path.join(tmpdir(), `core-detect-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	try {
		return await fn(dir)
	} finally {
		await rm(dir, { force: true, recursive: true })
	}
}

function makeDeclaration(root: string): ValidatedDeclaration {
	return { path: mustAbsolute(root), type: "local" }
}

function mustAbsolute(value: string): AbsolutePath {
	const absolute = coerceAbsolutePathDirect(value)
	if (!absolute) {
		throw new Error(`Invalid test path: ${value}`)
	}
	return absolute
}

describe("detectStructure", () => {
	it("detects manifest packages", async () => {
		await withTempDir(async (dir) => {
			await writeFile(
				path.join(dir, "agents.toml"),
				'[package]\nname = "pkg"\nversion = "1.0.0"\n',
			)

			const result = await detectStructure({
				declaration: makeDeclaration(dir),
				packagePath: mustAbsolute(dir),
			})

			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ method: "manifest" }),
					]),
				)
			}
		})
	})

	it("detects plugin and marketplace structures", async () => {
		await withTempDir(async (dir) => {
			const pluginDir = path.join(dir, ".claude-plugin")
			await mkdir(pluginDir, { recursive: true })
			await writeFile(
				path.join(pluginDir, "plugin.json"),
				JSON.stringify({ name: "alpha" }),
			)
			await writeFile(
				path.join(pluginDir, "marketplace.json"),
				JSON.stringify({ name: "Market", plugins: [] }),
			)
			await mkdir(path.join(dir, "skills"), { recursive: true })

			const result = await detectStructure({
				declaration: makeDeclaration(dir),
				packagePath: mustAbsolute(dir),
			})

			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ method: "plugin" }),
						expect.objectContaining({ method: "marketplace" }),
					]),
				)
			}
		})
	})

	it("detects subdir skill packages", async () => {
		await withTempDir(async (dir) => {
			const skillDir = path.join(dir, "example")
			await mkdir(skillDir, { recursive: true })
			await writeFile(
				path.join(skillDir, "SKILL.md"),
				"---\nname: example\n---\n\n# Example",
			)

			const result = await detectStructure({
				declaration: makeDeclaration(dir),
				packagePath: mustAbsolute(dir),
			})

			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ method: "subdir" }),
					]),
				)
			}
		})
	})

	it("detects single skill packages", async () => {
		await withTempDir(async (dir) => {
			await writeFile(
				path.join(dir, "SKILL.md"),
				"---\nname: root-skill\n---\n\n# Root",
			)

			const result = await detectStructure({
				declaration: makeDeclaration(dir),
				packagePath: mustAbsolute(dir),
			})

			expect(result.ok).toBe(true)
			if (result.ok) {
				expect(result.value).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ method: "single" }),
					]),
				)
			}
		})
	})

	it("fails when plugin directory has no plugin or marketplace files", async () => {
		await withTempDir(async (dir) => {
			await mkdir(path.join(dir, ".claude-plugin"), { recursive: true })

			const result = await detectStructure({
				declaration: makeDeclaration(dir),
				packagePath: mustAbsolute(dir),
			})

			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.error.type).toBe("detection")
				expect(result.error.message).toContain(".claude-plugin")
			}
		})
	})
})
