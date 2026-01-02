/**
 * Integration tests for manifest discovery
 */

import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { findGlobalRoot, findProjectRoot } from "@/src/core/manifest/discover"
import { withTempDir } from "@/tests/helpers/fs"

import "@/tests/helpers/assertions"

describe("findProjectRoot", () => {
	it("returns cwd when agents.toml exists in start directory", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "agents.toml"), 'name = "test"')

			const result = await findProjectRoot(dir)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value).toBe(dir)
			}
		})
	})

	it("returns parent when agents.toml exists above start directory", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "agents.toml"), 'name = "parent"')
			const child = join(dir, "child")
			await mkdir(child)

			const result = await findProjectRoot(child)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value).toBe(dir)
			}
		})
	})

	it("returns null when no agents.toml exists", async () => {
		await withTempDir(async (dir) => {
			const nested = join(dir, "a", "b")
			await mkdir(nested, { recursive: true })

			const result = await findProjectRoot(nested)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value).toBeNull()
			}
		})
	})

	it("returns error when start path does not exist", async () => {
		const result = await findProjectRoot("/definitely/does/not/exist/path")

		expect(result).toBeErr()
		if (!result.ok) {
			expect(result.error.type).toBe("invalid_start")
			expect(result.error.message).toContain("does not exist")
		}
	})

	it("returns error when start path is a file", async () => {
		await withTempDir(async (dir) => {
			const filePath = join(dir, "somefile.txt")
			await writeFile(filePath, "content")

			const result = await findProjectRoot(filePath)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_start")
				expect(result.error.message).toContain("must be a directory")
			}
		})
	})

	it("returns error when agents.toml is a directory", async () => {
		await withTempDir(async (dir) => {
			await mkdir(join(dir, "agents.toml"))

			const result = await findProjectRoot(dir)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("io_error")
				expect(result.error.message).toContain("not a file")
			}
		})
	})

	it("returns absolute path", async () => {
		await withTempDir(async (dir) => {
			await writeFile(join(dir, "agents.toml"), 'name = "test"')

			const result = await findProjectRoot(dir)

			expect(result).toBeOk()
			if (result.ok && result.value) {
				expect(result.value.startsWith("/")).toBe(true)
			}
		})
	})

	it("stops at home directory boundary when inside home", async () => {
		await withTempDir(async (dir) => {
			const home = homedir()
			if (dir.startsWith(home)) {
				const nested = join(dir, "nested")
				await mkdir(nested)

				const result = await findProjectRoot(nested)

				expect(result).toBeOk()
				if (result.ok) {
					if (result.value) {
						expect(result.value.startsWith(home)).toBe(true)
					}
				}
			}
		})
	})
})

describe("findGlobalRoot", () => {
	it("returns null or ~/.sk directory", async () => {
		const result = await findGlobalRoot()

		expect(result).toBeOk()
		if (result.ok && result.value) {
			expect(result.value).toBe(join(homedir(), ".sk"))
		}
	})
})
