/**
 * Unit tests for agent registry
 *
 * Tests the path resolution logic for different agents and scopes.
 * This is critical because agents like Amp and OpenCode have different
 * paths for local vs global scope.
 */

import path from "node:path"
import type { AbsolutePath } from "@skills-supply/core"
import { describe, expect, it } from "vitest"
import { getAgentById, getAgentDetectionMap, listAgents, resolveAgent } from "./registry"

// =============================================================================
// resolveAgent TESTS
// =============================================================================

describe("resolveAgent", () => {
	describe("local scope", () => {
		const localScope = {
			projectRoot: "/projects/my-app" as AbsolutePath,
			type: "local" as const,
		}

		it("resolves Amp to .agents/skills/ for local scope", () => {
			const agent = getAgentById("amp")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, localScope)

			expect(resolved.id).toBe("amp")
			expect(resolved.displayName).toBe("Amp")
			expect(resolved.rootPath).toBe("/projects/my-app/.agents")
			expect(resolved.skillsPath).toBe("/projects/my-app/.agents/skills")
		})

		it("resolves Claude Code to .claude/skills/ for local scope", () => {
			const agent = getAgentById("claude-code")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, localScope)

			expect(resolved.id).toBe("claude-code")
			expect(resolved.rootPath).toBe("/projects/my-app/.claude")
			expect(resolved.skillsPath).toBe("/projects/my-app/.claude/skills")
		})

		it("resolves Codex to .codex/skills/ for local scope", () => {
			const agent = getAgentById("codex")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, localScope)

			expect(resolved.id).toBe("codex")
			expect(resolved.rootPath).toBe("/projects/my-app/.codex")
			expect(resolved.skillsPath).toBe("/projects/my-app/.codex/skills")
		})

		it("resolves Factory to .factory/skills/ for local scope", () => {
			const agent = getAgentById("factory")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, localScope)

			expect(resolved.id).toBe("factory")
			expect(resolved.rootPath).toBe("/projects/my-app/.factory")
			expect(resolved.skillsPath).toBe("/projects/my-app/.factory/skills")
		})

		it("resolves OpenCode to .opencode/skill/ for local scope (NOT .config/opencode)", () => {
			// This test documents the bug fix: OpenCode's local path should be
			// .opencode, not .config/opencode
			const agent = getAgentById("opencode")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, localScope)

			expect(resolved.id).toBe("opencode")
			expect(resolved.rootPath).toBe("/projects/my-app/.opencode")
			expect(resolved.skillsPath).toBe("/projects/my-app/.opencode/skill")
			// Note: OpenCode uses singular "skill" not "skills"
		})
	})

	describe("global scope", () => {
		const globalScope = {
			homeDir: "/home/user" as AbsolutePath,
			type: "global" as const,
		}

		it("resolves Amp to ~/.config/agents/skills/ for global scope", () => {
			const agent = getAgentById("amp")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, globalScope)

			expect(resolved.id).toBe("amp")
			expect(resolved.displayName).toBe("Amp")
			expect(resolved.rootPath).toBe("/home/user/.config/agents")
			expect(resolved.skillsPath).toBe("/home/user/.config/agents/skills")
		})

		it("resolves Claude Code to ~/.claude/skills/ for global scope", () => {
			const agent = getAgentById("claude-code")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, globalScope)

			expect(resolved.id).toBe("claude-code")
			expect(resolved.rootPath).toBe("/home/user/.claude")
			expect(resolved.skillsPath).toBe("/home/user/.claude/skills")
		})

		it("resolves Codex to ~/.codex/skills/ for global scope", () => {
			const agent = getAgentById("codex")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, globalScope)

			expect(resolved.id).toBe("codex")
			expect(resolved.rootPath).toBe("/home/user/.codex")
			expect(resolved.skillsPath).toBe("/home/user/.codex/skills")
		})

		it("resolves Factory to ~/.factory/skills/ for global scope", () => {
			const agent = getAgentById("factory")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, globalScope)

			expect(resolved.id).toBe("factory")
			expect(resolved.rootPath).toBe("/home/user/.factory")
			expect(resolved.skillsPath).toBe("/home/user/.factory/skills")
		})

		it("resolves OpenCode to ~/.config/opencode/skill/ for global scope", () => {
			const agent = getAgentById("opencode")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const resolved = resolveAgent(agent.value, globalScope)

			expect(resolved.id).toBe("opencode")
			expect(resolved.rootPath).toBe("/home/user/.config/opencode")
			expect(resolved.skillsPath).toBe("/home/user/.config/opencode/skill")
		})
	})

	describe("asymmetric paths (the key design)", () => {
		// These tests explicitly verify the asymmetric path behavior
		// that was the whole point of the localBasePath/globalBasePath change

		it("Amp uses different base paths for local vs global", () => {
			const agent = getAgentById("amp")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const local = resolveAgent(agent.value, {
				projectRoot: "/project" as AbsolutePath,
				type: "local",
			})
			const global = resolveAgent(agent.value, {
				homeDir: "/home/user" as AbsolutePath,
				type: "global",
			})

			// Local: .agents (simple dot-directory in project)
			expect(local.rootPath).toBe("/project/.agents")

			// Global: .config/agents (XDG-style in home)
			expect(global.rootPath).toBe("/home/user/.config/agents")

			// These are deliberately different!
			expect(path.basename(local.rootPath)).not.toBe(path.basename(global.rootPath))
		})

		it("OpenCode uses different base paths for local vs global", () => {
			const agent = getAgentById("opencode")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const local = resolveAgent(agent.value, {
				projectRoot: "/project" as AbsolutePath,
				type: "local",
			})
			const global = resolveAgent(agent.value, {
				homeDir: "/home/user" as AbsolutePath,
				type: "global",
			})

			// Local: .opencode (simple dot-directory in project)
			expect(local.rootPath).toBe("/project/.opencode")

			// Global: .config/opencode (XDG-style in home)
			expect(global.rootPath).toBe("/home/user/.config/opencode")
		})

		it("Claude Code uses same base path for both scopes", () => {
			const agent = getAgentById("claude-code")
			expect(agent.ok).toBe(true)
			if (!agent.ok) return

			const local = resolveAgent(agent.value, {
				projectRoot: "/project" as AbsolutePath,
				type: "local",
			})
			const global = resolveAgent(agent.value, {
				homeDir: "/home/user" as AbsolutePath,
				type: "global",
			})

			// Both use .claude
			expect(path.basename(local.rootPath)).toBe(".claude")
			expect(path.basename(global.rootPath)).toBe(".claude")
		})
	})
})

// =============================================================================
// getAgentById TESTS
// =============================================================================

describe("getAgentById", () => {
	it("returns Amp agent for 'amp'", () => {
		const result = getAgentById("amp")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.id).toBe("amp")
			expect(result.value.displayName).toBe("Amp")
		}
	})

	it("returns Claude Code agent for 'claude-code'", () => {
		const result = getAgentById("claude-code")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value.id).toBe("claude-code")
			expect(result.value.displayName).toBe("Claude Code")
		}
	})

	it("returns error for unknown agent id", () => {
		const result = getAgentById("unknown-agent")

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("not_found")
			expect(result.error.message).toContain("Unknown agent")
		}
	})

	it("returns error for empty string", () => {
		const result = getAgentById("")

		expect(result.ok).toBe(false)
	})
})

// =============================================================================
// listAgents TESTS
// =============================================================================

describe("listAgents", () => {
	it("includes all 5 supported agents", () => {
		const agents = listAgents()

		expect(agents).toHaveLength(5)

		const ids = agents.map((a) => a.id)
		expect(ids).toContain("amp")
		expect(ids).toContain("claude-code")
		expect(ids).toContain("codex")
		expect(ids).toContain("factory")
		expect(ids).toContain("opencode")
	})

	it("returns agents in alphabetical order by id", () => {
		const agents = listAgents()
		const ids = agents.map((a) => a.id)

		expect(ids).toEqual(["amp", "claude-code", "codex", "factory", "opencode"])
	})

	it("each agent has required properties", () => {
		const agents = listAgents()

		for (const agent of agents) {
			expect(agent.id).toBeDefined()
			expect(agent.displayName).toBeDefined()
			expect(agent.localBasePath).toBeDefined()
			expect(agent.globalBasePath).toBeDefined()
			expect(agent.skillsDir).toBeDefined()
			expect(typeof agent.detect).toBe("function")
		}
	})
})

// =============================================================================
// getAgentDetectionMap TESTS
// =============================================================================

describe("getAgentDetectionMap", () => {
	it("returns a map with all 5 agents", async () => {
		const result = await getAgentDetectionMap()

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const map = result.value
		expect(Object.keys(map)).toHaveLength(5)
		expect("amp" in map).toBe(true)
		expect("claude-code" in map).toBe(true)
		expect("codex" in map).toBe(true)
		expect("factory" in map).toBe(true)
		expect("opencode" in map).toBe(true)
	})

	it("returns boolean values for each agent", async () => {
		const result = await getAgentDetectionMap()

		expect(result.ok).toBe(true)
		if (!result.ok) return

		const map = result.value
		for (const [, detected] of Object.entries(map)) {
			expect(typeof detected).toBe("boolean")
		}
	})
})
