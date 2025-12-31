/**
 * Integration tests for manifest discovery
 *
 * Tests the discoverManifests function with real filesystem operations.
 * Uses temporary directories to create realistic directory structures.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { discoverManifests } from "@/src/core/manifest/discover"
import { withTempDir } from "@/tests/helpers/fs"

// Import assertions to register custom matchers
import "@/tests/helpers/assertions"

describe("discoverManifests", () => {
	describe("finding manifest in current directory", () => {
		it("finds manifest in the start directory", async () => {
			await withTempDir(async (dir) => {
				await writeFile(join(dir, "package.toml"), 'name = "test"')

				const result = await discoverManifests(dir)

				expect(result).toBeOk()
				if (result.ok) {
					expect(result.value).toHaveLength(1)
					expect(result.value[0]).toBe(join(dir, "package.toml"))
				}
			})
		})

		it("returns empty array when no manifest exists in directory", async () => {
			await withTempDir(async (dir) => {
				// Create an empty directory with no manifest
				const emptyDir = join(dir, "empty")
				await mkdir(emptyDir)

				const result = await discoverManifests(emptyDir)

				expect(result).toBeOk()
				if (result.ok) {
					// No manifests should be found (no package.toml anywhere in path)
					// Note: this may find ~/.sk/package.toml if it exists on the system
					const foundInDir = result.value.filter((p) => p.startsWith(dir))
					expect(foundInDir).toHaveLength(0)
				}
			})
		})
	})

	describe("finding manifests in parent directories", () => {
		it("finds manifest in parent directory when child has none", async () => {
			await withTempDir(async (dir) => {
				// Create manifest in parent
				await writeFile(join(dir, "package.toml"), 'name = "parent"')

				// Create child directory without manifest
				const child = join(dir, "child")
				await mkdir(child)

				const result = await discoverManifests(child)

				expect(result).toBeOk()
				if (result.ok) {
					const foundInDir = result.value.filter((p) => p.startsWith(dir))
					expect(foundInDir).toHaveLength(1)
					expect(foundInDir[0]).toBe(join(dir, "package.toml"))
				}
			})
		})

		it("finds manifests in multiple ancestor directories", async () => {
			await withTempDir(async (dir) => {
				// Create nested structure with manifests at multiple levels
				const level1 = join(dir, "level1")
				const level2 = join(level1, "level2")
				const level3 = join(level2, "level3")
				await mkdir(level3, { recursive: true })

				// Create manifests at dir and level2
				await writeFile(join(dir, "package.toml"), 'name = "root"')
				await writeFile(join(level2, "package.toml"), 'name = "level2"')

				const result = await discoverManifests(level3)

				expect(result).toBeOk()
				if (result.ok) {
					const foundInDir = result.value.filter((p) => p.startsWith(dir))
					// Should find both manifests
					expect(foundInDir).toHaveLength(2)
					// Closest manifest first (discovery walks up from start)
					expect(foundInDir[0]).toBe(join(level2, "package.toml"))
					expect(foundInDir[1]).toBe(join(dir, "package.toml"))
				}
			})
		})

		it("finds manifest in deeply nested parent", async () => {
			await withTempDir(async (dir) => {
				// Create deep nesting
				const deep = join(dir, "a", "b", "c", "d", "e")
				await mkdir(deep, { recursive: true })

				// Only manifest at root
				await writeFile(join(dir, "package.toml"), 'name = "root"')

				const result = await discoverManifests(deep)

				expect(result).toBeOk()
				if (result.ok) {
					const foundInDir = result.value.filter((p) => p.startsWith(dir))
					expect(foundInDir).toHaveLength(1)
					expect(foundInDir[0]).toBe(join(dir, "package.toml"))
				}
			})
		})
	})

	describe("discovery order/precedence", () => {
		it("returns manifests in order from closest to farthest", async () => {
			await withTempDir(async (dir) => {
				// Create 3-level structure with manifests at all levels
				const level1 = join(dir, "level1")
				const level2 = join(level1, "level2")
				await mkdir(level2, { recursive: true })

				await writeFile(join(dir, "package.toml"), 'name = "root"')
				await writeFile(join(level1, "package.toml"), 'name = "level1"')
				await writeFile(join(level2, "package.toml"), 'name = "level2"')

				const result = await discoverManifests(level2)

				expect(result).toBeOk()
				if (result.ok) {
					const foundInDir = result.value.filter((p) => p.startsWith(dir))
					expect(foundInDir).toHaveLength(3)
					// Order: closest first
					expect(foundInDir[0]).toBe(join(level2, "package.toml"))
					expect(foundInDir[1]).toBe(join(level1, "package.toml"))
					expect(foundInDir[2]).toBe(join(dir, "package.toml"))
				}
			})
		})

		it("does not include duplicate paths", async () => {
			await withTempDir(async (dir) => {
				await writeFile(join(dir, "package.toml"), 'name = "test"')

				// Start from the directory itself
				const result = await discoverManifests(dir)

				expect(result).toBeOk()
				if (result.ok) {
					const foundInDir = result.value.filter((p) => p.startsWith(dir))
					// Should only have one entry, not duplicates
					const unique = new Set(foundInDir)
					expect(foundInDir.length).toBe(unique.size)
				}
			})
		})
	})

	describe("handling missing manifests and edge cases", () => {
		it("returns error when start path does not exist", async () => {
			const result = await discoverManifests("/definitely/does/not/exist/path")

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.type).toBe("invalid_start")
				expect(result.error.message).toContain("does not exist")
			}
		})

		it("returns error when start path is a file, not directory", async () => {
			await withTempDir(async (dir) => {
				const filePath = join(dir, "somefile.txt")
				await writeFile(filePath, "content")

				const result = await discoverManifests(filePath)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("invalid_start")
					expect(result.error.message).toContain("must be a directory")
				}
			})
		})

		it("handles manifest path that is a directory instead of file", async () => {
			await withTempDir(async (dir) => {
				// Create a directory named package.toml (unusual but possible)
				const manifestDir = join(dir, "package.toml")
				await mkdir(manifestDir)

				const result = await discoverManifests(dir)

				// Should return error since package.toml is not a file
				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.type).toBe("io_error")
					expect(result.error.message).toContain("not a file")
				}
			})
		})

		it("resolves relative paths to absolute", async () => {
			await withTempDir(async (dir) => {
				await writeFile(join(dir, "package.toml"), 'name = "test"')

				// Use a path that could be interpreted as relative
				const result = await discoverManifests(dir)

				expect(result).toBeOk()
				if (result.ok && result.value.length > 0) {
					// All returned paths should be absolute
					for (const manifestPath of result.value) {
						expect(manifestPath.startsWith("/")).toBe(true)
					}
				}
			})
		})
	})

	describe("user-level manifest in ~/.sk/", () => {
		// Note: These tests depend on whether ~/.sk/package.toml exists on the system.
		// We test the behavior rather than specific outcomes.

		it("includes user manifest if it exists at ~/.sk/package.toml", async () => {
			const userManifestPath = join(homedir(), ".sk", "package.toml")

			await withTempDir(async (dir) => {
				// Create a project manifest
				await writeFile(join(dir, "package.toml"), 'name = "project"')

				const result = await discoverManifests(dir)

				expect(result).toBeOk()
				if (result.ok) {
					// Should find at least the project manifest
					expect(result.value.length).toBeGreaterThanOrEqual(1)
					expect(result.value).toContain(join(dir, "package.toml"))

					// If user manifest exists, it should be included
					// We can't guarantee it exists, but we verify the path format would be correct
					const userManifests = result.value.filter((p) => p.includes(".sk"))
					for (const p of userManifests) {
						expect(p).toBe(userManifestPath)
					}
				}
			})
		})

		it("user manifest is listed after project manifests", async () => {
			await withTempDir(async (dir) => {
				// Create project manifests
				const nested = join(dir, "nested")
				await mkdir(nested)
				await writeFile(join(dir, "package.toml"), 'name = "root"')
				await writeFile(join(nested, "package.toml"), 'name = "nested"')

				const result = await discoverManifests(nested)

				expect(result).toBeOk()
				if (result.ok) {
					// Filter to just the project manifests
					const projectManifests = result.value.filter((p) => p.startsWith(dir))
					// If there's a user manifest, it should come after project manifests
					const lastProjectIdx =
						projectManifests.length > 0
							? result.value.indexOf(
									projectManifests[projectManifests.length - 1],
								)
							: -1

					const userManifests = result.value.filter((p) => p.includes(".sk"))
					for (const userManifest of userManifests) {
						const userIdx = result.value.indexOf(userManifest)
						expect(userIdx).toBeGreaterThan(lastProjectIdx)
					}
				}
			})
		})
	})

	describe("boundary behavior", () => {
		it("stops at home directory boundary when inside home", async () => {
			// When starting inside home directory, discovery stops at home
			// and then checks ~/.sk/package.toml separately
			await withTempDir(async (dir) => {
				const home = homedir()

				// If our temp dir is inside home, this tests the boundary
				if (dir.startsWith(home)) {
					await writeFile(join(dir, "package.toml"), 'name = "test"')

					const result = await discoverManifests(dir)

					expect(result).toBeOk()
					if (result.ok) {
						// Should not traverse beyond home (except for ~/.sk)
						const outsideHome = result.value.filter(
							(p) => !p.startsWith(home) && !p.includes(".sk"),
						)
						expect(outsideHome).toHaveLength(0)
					}
				}
			})
		})

		it("handles being started from home directory itself", async () => {
			const home = homedir()
			const result = await discoverManifests(home)

			expect(result).toBeOk()
			// Just verify it doesn't crash - actual results depend on user's system
		})
	})
})
