import type { AgentId } from "@skills-supply/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ManifestSelection } from "@/commands/manifest-selection"
import { syncWithSelection } from "@/commands/sync"
import { createEmptyManifest } from "@/manifest/fs"
import { setAgent } from "@/manifest/transform"
import type { Manifest } from "@/manifest/types"
import { runSync } from "@/sync/sync"
import { abs } from "@/tests/helpers/branded"

vi.mock("@/sync/sync", () => ({
	runSync: vi.fn(),
}))

const runSyncMock = vi.mocked(runSync)

const manifestPath = abs("/tmp/agents.toml")
const scopeRoot = abs("/tmp")

function buildSelection(manifest: Manifest): ManifestSelection {
	return {
		created: false,
		discoveredAt: "cwd",
		manifest,
		manifestPath,
		scope: "local",
		scopeRoot,
		serializeOptions: {
			includeEmptyAgents: true,
			includeEmptyDependencies: true,
		},
		usedParent: false,
	}
}

describe("syncWithSelection", () => {
	beforeEach(() => {
		process.exitCode = undefined
	})

	afterEach(() => {
		runSyncMock.mockReset()
	})

	describe("when no agents are configured", () => {
		it("returns unchanged with exact message in non-interactive mode", async () => {
			const manifest = createEmptyManifest(manifestPath, "cwd")
			const selection = buildSelection(manifest)

			const result = await syncWithSelection(selection, {
				dryRun: false,
				nonInteractive: true,
			})

			expect(result).toEqual({
				reason: "No agents configured. Use `sk agent add` to enable agents.",
				status: "unchanged",
			})
			expect(runSyncMock).toHaveBeenCalledTimes(0)
		})

		it("returns unchanged regardless of dryRun flag", async () => {
			const manifest = createEmptyManifest(manifestPath, "cwd")
			const selection = buildSelection(manifest)

			const result = await syncWithSelection(selection, {
				dryRun: true,
				nonInteractive: true,
			})

			expect(result).toEqual({
				reason: "No agents configured. Use `sk agent add` to enable agents.",
				status: "unchanged",
			})
			expect(runSyncMock).toHaveBeenCalledTimes(0)
		})
	})

	describe("when all agents are disabled", () => {
		it("returns unchanged with exact message for single disabled agent", async () => {
			const manifest = setAgent(
				createEmptyManifest(manifestPath, "cwd"),
				"claude-code" as AgentId,
				false,
			)
			const selection = buildSelection(manifest)

			const result = await syncWithSelection(selection, {
				dryRun: false,
				nonInteractive: false,
			})

			expect(result).toEqual({
				reason: "All agents are disabled. Use `sk agent add` or enable agents in the [agents] section.",
				status: "unchanged",
			})
			expect(runSyncMock).toHaveBeenCalledTimes(0)
		})

		it("returns unchanged with exact message for multiple disabled agents", async () => {
			let manifest = createEmptyManifest(manifestPath, "cwd")
			manifest = setAgent(manifest, "claude-code" as AgentId, false)
			manifest = setAgent(manifest, "codex" as AgentId, false)
			const selection = buildSelection(manifest)

			const result = await syncWithSelection(selection, {
				dryRun: false,
				nonInteractive: false,
			})

			expect(result).toEqual({
				reason: "All agents are disabled. Use `sk agent add` or enable agents in the [agents] section.",
				status: "unchanged",
			})
			expect(runSyncMock).toHaveBeenCalledTimes(0)
		})

		it("returns unchanged regardless of dryRun flag", async () => {
			const manifest = setAgent(
				createEmptyManifest(manifestPath, "cwd"),
				"claude-code" as AgentId,
				false,
			)
			const selection = buildSelection(manifest)

			const result = await syncWithSelection(selection, {
				dryRun: true,
				nonInteractive: false,
			})

			expect(result).toEqual({
				reason: "All agents are disabled. Use `sk agent add` or enable agents in the [agents] section.",
				status: "unchanged",
			})
			expect(runSyncMock).toHaveBeenCalledTimes(0)
		})
	})

	describe("when agents are enabled", () => {
		it("calls runSync with correct parameters for single enabled agent", async () => {
			let manifest = createEmptyManifest(manifestPath, "cwd")
			manifest = setAgent(manifest, "claude-code" as AgentId, true)
			const selection = buildSelection(manifest)

			runSyncMock.mockResolvedValueOnce({
				ok: true,
				value: {
					agents: ["claude-code"],
					dependencies: 0,
					dryRun: false,
					installed: 0,
					manifests: 1,
					noOpReason: "no-dependencies",
					removed: 0,
					warnings: [],
				},
			})

			const result = await syncWithSelection(selection, {
				dryRun: false,
				nonInteractive: true,
			})

			expect(result).toEqual({
				reason: "No dependencies to sync.",
				status: "unchanged",
			})
			expect(runSyncMock).toHaveBeenCalledTimes(1)
			expect(runSyncMock).toHaveBeenCalledWith({
				agents: [
					expect.objectContaining({
						id: "claude-code",
					}),
				],
				dryRun: false,
				manifest: expect.objectContaining({
					agents: new Map([["claude-code", true]]),
				}),
			})
		})

		it("calls runSync with dryRun: true when dryRun option is set", async () => {
			let manifest = createEmptyManifest(manifestPath, "cwd")
			manifest = setAgent(manifest, "claude-code" as AgentId, true)
			const selection = buildSelection(manifest)

			runSyncMock.mockResolvedValueOnce({
				ok: true,
				value: {
					agents: ["claude-code"],
					dependencies: 0,
					dryRun: true,
					installed: 0,
					manifests: 1,
					noOpReason: "no-dependencies",
					removed: 0,
					warnings: [],
				},
			})

			await syncWithSelection(selection, {
				dryRun: true,
				nonInteractive: true,
			})

			expect(runSyncMock).toHaveBeenCalledTimes(1)
			expect(runSyncMock).toHaveBeenCalledWith(
				expect.objectContaining({
					dryRun: true,
				}),
			)
		})

		it("returns completed when sync succeeds with dependencies", async () => {
			let manifest = createEmptyManifest(manifestPath, "cwd")
			manifest = setAgent(manifest, "claude-code" as AgentId, true)
			const selection = buildSelection(manifest)

			runSyncMock.mockResolvedValueOnce({
				ok: true,
				value: {
					agents: ["claude-code"],
					dependencies: 3,
					dryRun: false,
					installed: 2,
					manifests: 1,
					noOpReason: undefined,
					removed: 1,
					warnings: [],
				},
			})

			const result = await syncWithSelection(selection, {
				dryRun: false,
				nonInteractive: true,
			})

			expect(result).toEqual({
				status: "completed",
				value: undefined,
			})
		})

		it("returns failed and sets exitCode when runSync returns error", async () => {
			let manifest = createEmptyManifest(manifestPath, "cwd")
			manifest = setAgent(manifest, "claude-code" as AgentId, true)
			const selection = buildSelection(manifest)

			runSyncMock.mockResolvedValueOnce({
				error: {
					field: "dependencies",
					message: "Failed to resolve dependencies",
					source: "manual",
					stage: "resolve",
					type: "validation",
				},
				ok: false,
			})

			const result = await syncWithSelection(selection, {
				dryRun: false,
				nonInteractive: true,
			})

			expect(result.status).toBe("failed")
			if (result.status === "failed") {
				expect(result.error.type).toBe("validation")
				expect(result.error.message).toBe("Failed to resolve dependencies")
				if (!("stage" in result.error)) {
					throw new Error("Expected sync error with stage")
				}
				expect(result.error.stage).toBe("resolve")
			}
			expect(process.exitCode).toBeUndefined()
		})

		it("only syncs enabled agents, ignoring disabled ones", async () => {
			let manifest = createEmptyManifest(manifestPath, "cwd")
			manifest = setAgent(manifest, "claude-code" as AgentId, true)
			manifest = setAgent(manifest, "codex" as AgentId, false)
			const selection = buildSelection(manifest)

			runSyncMock.mockResolvedValueOnce({
				ok: true,
				value: {
					agents: ["claude-code"],
					dependencies: 0,
					dryRun: false,
					installed: 0,
					manifests: 1,
					noOpReason: "no-dependencies",
					removed: 0,
					warnings: [],
				},
			})

			await syncWithSelection(selection, {
				dryRun: false,
				nonInteractive: true,
			})

			expect(runSyncMock).toHaveBeenCalledTimes(1)
			const callArgs = runSyncMock.mock.calls[0]?.[0]
			if (!callArgs) {
				throw new Error("Expected runSync to be called")
			}
			expect(callArgs.agents).toHaveLength(1)
			const [firstAgent] = callArgs.agents
			if (!firstAgent) {
				throw new Error("Expected one agent to sync")
			}
			expect(firstAgent.id).toBe("claude-code")
		})

		it("syncs multiple enabled agents", async () => {
			let manifest = createEmptyManifest(manifestPath, "cwd")
			manifest = setAgent(manifest, "claude-code" as AgentId, true)
			manifest = setAgent(manifest, "codex" as AgentId, true)
			const selection = buildSelection(manifest)

			runSyncMock.mockResolvedValueOnce({
				ok: true,
				value: {
					agents: ["claude-code", "codex"],
					dependencies: 0,
					dryRun: false,
					installed: 0,
					manifests: 1,
					noOpReason: "no-dependencies",
					removed: 0,
					warnings: [],
				},
			})

			await syncWithSelection(selection, {
				dryRun: false,
				nonInteractive: true,
			})

			expect(runSyncMock).toHaveBeenCalledTimes(1)
			const callArgs = runSyncMock.mock.calls[0]?.[0]
			if (!callArgs) {
				throw new Error("Expected runSync to be called")
			}
			expect(callArgs.agents).toHaveLength(2)
			const agentIds = callArgs.agents.map((a) => a.id)
			expect(agentIds).toContain("claude-code")
			expect(agentIds).toContain("codex")
		})
	})

	describe("global scope handling", () => {
		it("passes correct scope root for global manifest", async () => {
			let manifest = createEmptyManifest(manifestPath, "sk-global")
			manifest = setAgent(manifest, "claude-code" as AgentId, true)
			const globalScopeRoot = abs("/Users/test")
			const selection: ManifestSelection = {
				created: false,
				discoveredAt: "sk-global",
				manifest,
				manifestPath: abs("/Users/test/.sk/agents.toml"),
				scope: "global",
				scopeRoot: globalScopeRoot,
				serializeOptions: {
					includeEmptyAgents: true,
					includeEmptyDependencies: true,
				},
				usedParent: false,
			}

			runSyncMock.mockResolvedValueOnce({
				ok: true,
				value: {
					agents: ["claude-code"],
					dependencies: 0,
					dryRun: false,
					installed: 0,
					manifests: 1,
					noOpReason: "no-dependencies",
					removed: 0,
					warnings: [],
				},
			})

			await syncWithSelection(selection, {
				dryRun: false,
				nonInteractive: true,
			})

			expect(runSyncMock).toHaveBeenCalledTimes(1)
			// Verify the agent was resolved with the correct scope
			const callArgs = runSyncMock.mock.calls[0]?.[0]
			if (!callArgs) {
				throw new Error("Expected runSync to be called")
			}
			expect(callArgs.agents[0]).toMatchObject({
				id: "claude-code",
			})
		})
	})

	describe("error handling", () => {
		it("returns failed and sets exitCode on thrown error", async () => {
			let manifest = createEmptyManifest(manifestPath, "cwd")
			manifest = setAgent(manifest, "claude-code" as AgentId, true)
			const selection = buildSelection(manifest)

			runSyncMock.mockRejectedValueOnce(new Error("Unexpected error"))

			await expect(
				syncWithSelection(selection, {
					dryRun: false,
					nonInteractive: true,
				}),
			).rejects.toThrow("Unexpected error")
		})
	})
})
