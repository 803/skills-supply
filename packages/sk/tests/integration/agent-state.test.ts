/**
 * Integration tests for agent state management
 *
 * Tests the read/write cycle of agent state using real filesystem operations.
 * Uses withTempDir to create isolated test environments.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	buildAgentState,
	readAgentState,
	resolveStatePath,
	writeAgentState,
} from "@/src/core/agents/state"
import type { AgentDefinition, AgentId } from "@/src/core/agents/types"
import { exists, isFile, withTempDir } from "@/tests/helpers/fs"

// Import assertions to register custom matchers
import "@/tests/helpers/assertions"

/**
 * Creates a minimal agent definition for testing.
 * The detect function is stubbed since we don't test detection here.
 */
function createTestAgent(
	skillsPath: string,
	id: AgentId = "claude-code",
): AgentDefinition {
	return {
		detect: async () => ({ ok: true, value: true }),
		displayName: "Test Agent",
		id,
		skillsPath,
	}
}

describe("readAgentState", () => {
	it("returns null when state file does not exist (fresh install)", async () => {
		await withTempDir(async (dir) => {
			const agent = createTestAgent(dir)

			const result = await readAgentState(agent)

			expect(result).toBeOk()
			if (result.ok) {
				expect(result.value).toBeNull()
			}
		})
	})

	it("reads valid state file from disk", async () => {
		await withTempDir(async (dir) => {
			const agent = createTestAgent(dir)
			const statePath = resolveStatePath(agent)

			const stateData = {
				skills: ["greeting", "farewell"],
				updatedAt: "2025-01-15T10:30:00.000Z",
				version: 1,
			}

			await writeFile(statePath, JSON.stringify(stateData, null, 2))

			const result = await readAgentState(agent)

			expect(result).toBeOk()
			if (result.ok && result.value) {
				expect(result.value.version).toBe(1)
				expect(result.value.skills).toEqual(["greeting", "farewell"])
				expect(result.value.updatedAt).toBe("2025-01-15T10:30:00.000Z")
			}
		})
	})

	it("reads state from nested directory structure", async () => {
		await withTempDir(async (dir) => {
			const nestedPath = join(dir, "deeply", "nested", "skills")
			await mkdir(nestedPath, { recursive: true })

			const agent = createTestAgent(nestedPath)
			const statePath = resolveStatePath(agent)

			const stateData = {
				skills: ["test-skill"],
				updatedAt: "2025-01-15T10:30:00.000Z",
				version: 1,
			}

			await writeFile(statePath, JSON.stringify(stateData))

			const result = await readAgentState(agent)

			expect(result).toBeOk()
			if (result.ok && result.value) {
				expect(result.value.skills).toEqual(["test-skill"])
			}
		})
	})

	describe("state file format validation", () => {
		it("rejects non-JSON content", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(statePath, "not valid json {{{")

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("Invalid JSON")
				}
			})
		})

		it("rejects non-object JSON (array)", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(statePath, JSON.stringify(["not", "an", "object"]))

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("JSON object")
				}
			})
		})

		it("rejects missing version field", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(
					statePath,
					JSON.stringify({
						skills: [],
						updatedAt: "2025-01-15T10:30:00.000Z",
					}),
				)

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("version")
				}
			})
		})

		it("rejects unsupported version", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(
					statePath,
					JSON.stringify({
						skills: [],
						updatedAt: "2025-01-15T10:30:00.000Z",
						version: 999,
					}),
				)

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain(
						"Unsupported state file version",
					)
				}
			})
		})

		it("rejects non-array skills field", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(
					statePath,
					JSON.stringify({
						skills: "not-an-array",
						updatedAt: "2025-01-15T10:30:00.000Z",
						version: 1,
					}),
				)

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("skills")
				}
			})
		})

		it("rejects skills array with non-string entries", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(
					statePath,
					JSON.stringify({
						skills: ["valid", 123, "also-valid"],
						updatedAt: "2025-01-15T10:30:00.000Z",
						version: 1,
					}),
				)

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("skills")
				}
			})
		})

		it("rejects empty skill names", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(
					statePath,
					JSON.stringify({
						skills: ["valid", "", "also-valid"],
						updatedAt: "2025-01-15T10:30:00.000Z",
						version: 1,
					}),
				)

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("empty")
				}
			})
		})

		it("rejects skill names with path separators", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(
					statePath,
					JSON.stringify({
						skills: ["valid", "sub/dir/skill", "also-valid"],
						updatedAt: "2025-01-15T10:30:00.000Z",
						version: 1,
					}),
				)

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("path separator")
				}
			})
		})

		it("rejects dot and double-dot skill names", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(
					statePath,
					JSON.stringify({
						skills: [".", "valid-skill"],
						updatedAt: "2025-01-15T10:30:00.000Z",
						version: 1,
					}),
				)

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("invalid")
				}
			})
		})

		it("rejects missing updatedAt field", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(
					statePath,
					JSON.stringify({
						skills: [],
						version: 1,
					}),
				)

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("updatedAt")
				}
			})
		})

		it("rejects empty updatedAt field", async () => {
			await withTempDir(async (dir) => {
				const agent = createTestAgent(dir)
				const statePath = resolveStatePath(agent)

				await writeFile(
					statePath,
					JSON.stringify({
						skills: [],
						updatedAt: "   ",
						version: 1,
					}),
				)

				const result = await readAgentState(agent)

				expect(result).toBeErr()
				if (!result.ok) {
					expect(result.error.message).toContain("updatedAt")
				}
			})
		})
	})

	it("returns error when state path is a directory, not a file", async () => {
		await withTempDir(async (dir) => {
			const agent = createTestAgent(dir)
			const statePath = resolveStatePath(agent)

			// Create a directory where the state file should be
			await mkdir(statePath, { recursive: true })

			const result = await readAgentState(agent)

			expect(result).toBeErr()
			if (!result.ok) {
				expect(result.error.message).toContain("Expected file")
			}
		})
	})
})

describe("writeAgentState", () => {
	it("writes state to disk in correct format", async () => {
		await withTempDir(async (dir) => {
			const agent = createTestAgent(dir)
			const state = buildAgentState(["greeting", "farewell"])

			const result = await writeAgentState(agent, state)

			expect(result).toBeOk()

			// Verify file exists
			const statePath = resolveStatePath(agent)
			expect(await isFile(statePath)).toBe(true)

			// Verify content
			const content = await readFile(statePath, "utf-8")
			const parsed = JSON.parse(content)

			expect(parsed.version).toBe(1)
			expect(parsed.skills).toEqual(["farewell", "greeting"]) // sorted
			expect(parsed.updatedAt).toBeDefined()
		})
	})

	it("creates parent directories if they don't exist", async () => {
		await withTempDir(async (dir) => {
			const nestedPath = join(dir, "new", "nested", "path")
			const agent = createTestAgent(nestedPath)
			const state = buildAgentState(["test-skill"])

			// Parent directories don't exist yet
			expect(await exists(nestedPath)).toBe(false)

			const result = await writeAgentState(agent, state)

			expect(result).toBeOk()

			// Verify file was created
			const statePath = resolveStatePath(agent)
			expect(await isFile(statePath)).toBe(true)
		})
	})

	it("overwrites existing state file", async () => {
		await withTempDir(async (dir) => {
			const agent = createTestAgent(dir)
			const statePath = resolveStatePath(agent)

			// Write initial state
			const initialState = buildAgentState(["skill-a"])
			await writeAgentState(agent, initialState)

			// Write updated state
			const updatedState = buildAgentState(["skill-b", "skill-c"])
			const result = await writeAgentState(agent, updatedState)

			expect(result).toBeOk()

			// Verify content is updated
			const content = await readFile(statePath, "utf-8")
			const parsed = JSON.parse(content)

			expect(parsed.skills).toEqual(["skill-b", "skill-c"])
		})
	})

	it("writes state with empty skills array", async () => {
		await withTempDir(async (dir) => {
			const agent = createTestAgent(dir)
			const state = buildAgentState([])

			const result = await writeAgentState(agent, state)

			expect(result).toBeOk()

			const statePath = resolveStatePath(agent)
			const content = await readFile(statePath, "utf-8")
			const parsed = JSON.parse(content)

			expect(parsed.skills).toEqual([])
		})
	})

	it("outputs pretty-printed JSON with trailing newline", async () => {
		await withTempDir(async (dir) => {
			const agent = createTestAgent(dir)
			const state = buildAgentState(["skill"])

			await writeAgentState(agent, state)

			const statePath = resolveStatePath(agent)
			const content = await readFile(statePath, "utf-8")

			// Should be indented (pretty-printed)
			expect(content).toContain("  ")
			// Should end with newline
			expect(content.endsWith("\n")).toBe(true)
		})
	})
})

describe("buildAgentState", () => {
	it("creates state with sorted, deduplicated skills", async () => {
		const state = buildAgentState(["zebra", "alpha", "alpha", "beta"])

		expect(state.skills).toEqual(["alpha", "beta", "zebra"])
		expect(state.version).toBe(1)
		expect(state.updatedAt).toBeDefined()
	})

	it("creates state with empty skills array", async () => {
		const state = buildAgentState([])

		expect(state.skills).toEqual([])
		expect(state.version).toBe(1)
	})

	it("generates valid ISO timestamp", async () => {
		const state = buildAgentState(["test"])

		// Should be parseable as a date
		const date = new Date(state.updatedAt)
		expect(date.getTime()).not.toBeNaN()
	})
})

describe("resolveStatePath", () => {
	it("resolves state path within agent skills directory", async () => {
		const agent = createTestAgent("/home/user/.claude/skills")

		const statePath = resolveStatePath(agent)

		expect(statePath).toBe("/home/user/.claude/skills/.sk-state.json")
	})

	it("handles trailing slash in skills path", async () => {
		const agent = createTestAgent("/home/user/.claude/skills/")

		const statePath = resolveStatePath(agent)

		// path.join normalizes trailing slashes
		expect(statePath).toBe("/home/user/.claude/skills/.sk-state.json")
	})
})

describe("read/write roundtrip", () => {
	it("written state can be read back identically", async () => {
		await withTempDir(async (dir) => {
			const agent = createTestAgent(dir)
			const originalState = buildAgentState(["alpha", "beta", "gamma"])

			// Write
			const writeResult = await writeAgentState(agent, originalState)
			expect(writeResult).toBeOk()

			// Read back
			const readResult = await readAgentState(agent)
			expect(readResult).toBeOk()

			if (readResult.ok && readResult.value) {
				expect(readResult.value.version).toBe(originalState.version)
				expect(readResult.value.skills).toEqual(originalState.skills)
				expect(readResult.value.updatedAt).toBe(originalState.updatedAt)
			}
		})
	})

	it("supports multiple agents with separate state files", async () => {
		await withTempDir(async (dir) => {
			const claudeDir = join(dir, "claude-skills")
			const codexDir = join(dir, "codex-skills")

			const claudeAgent = createTestAgent(claudeDir, "claude-code")
			const codexAgent = createTestAgent(codexDir, "codex")

			// Write different state for each agent
			await writeAgentState(claudeAgent, buildAgentState(["claude-skill"]))
			await writeAgentState(codexAgent, buildAgentState(["codex-skill"]))

			// Read back and verify they're separate
			const claudeResult = await readAgentState(claudeAgent)
			const codexResult = await readAgentState(codexAgent)

			expect(claudeResult).toBeOk()
			expect(codexResult).toBeOk()

			if (claudeResult.ok && claudeResult.value) {
				expect(claudeResult.value.skills).toEqual(["claude-skill"])
			}

			if (codexResult.ok && codexResult.value) {
				expect(codexResult.value.skills).toEqual(["codex-skill"])
			}
		})
	})
})
