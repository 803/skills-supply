import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ManifestSelection } from "@/src/commands/manifest-selection"
import { syncWithSelection } from "@/src/commands/sync"
import { createEmptyManifest } from "@/src/core/manifest/fs"
import { setAgent } from "@/src/core/manifest/transform"
import type { Manifest } from "@/src/core/manifest/types"
import { runSync } from "@/src/core/sync/sync"
import type { AgentId } from "@/src/core/types/branded"
import { abs } from "@/tests/helpers/branded"

vi.mock("@/src/core/sync/sync", () => ({
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

	it("warns and no-ops when no agents are configured in non-interactive mode", async () => {
		const manifest = createEmptyManifest(manifestPath, "cwd")
		const selection = buildSelection(manifest)

		const result = await syncWithSelection(selection, {
			dryRun: false,
			nonInteractive: true,
		})

		expect(result.status).toBe("unchanged")
		if (result.status === "unchanged") {
			expect(result.reason).toContain("sk agent add")
		}
		expect(runSyncMock).not.toHaveBeenCalled()
	})

	it("warns and no-ops when all agents are disabled", async () => {
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

		expect(result.status).toBe("unchanged")
		if (result.status === "unchanged") {
			expect(result.reason).toContain("sk agent add")
		}
		expect(runSyncMock).not.toHaveBeenCalled()
	})
})
