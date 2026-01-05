import { mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
	coerceAbsolutePathDirect,
	coerceGithubRef,
	coerceGitUrl,
	coerceRemoteMarketplaceUrl,
} from "@skills-supply/core"
import { describe, expect, it, vi } from "vitest"
import type { ResolvedAgent } from "@/agents/types"
import type { CanonicalPackage } from "@/packages/types"
import { resolveAgentPackages } from "@/sync/marketplace"
import { abs, alias, ghRef, nes } from "@/tests/helpers/branded"

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = path.join(tmpdir(), `sk-marketplace-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	try {
		return await fn(dir)
	} finally {
		await rm(dir, { force: true, recursive: true })
	}
}

function makeAgent(id: ResolvedAgent["id"]): ResolvedAgent {
	return {
		displayName: "Test Agent",
		id,
		rootPath: abs("/tmp/agent"),
		skillsPath: abs("/tmp/agent/skills"),
	}
}

function makePluginPackage(marketplace: string): CanonicalPackage {
	const resolved =
		coerceRemoteMarketplaceUrl(marketplace) ??
		coerceAbsolutePathDirect(marketplace) ??
		coerceGitUrl(marketplace) ??
		coerceGithubRef(marketplace)
	if (!resolved) {
		throw new Error(`Invalid marketplace for test: ${marketplace}`)
	}
	return {
		fetchStrategy: { mode: "clone", sparse: false },
		marketplace: resolved,
		origin: { alias: alias("plugin"), manifestPath: abs("/test/agents.toml") },
		plugin: nes("alpha"),
		type: "claude-plugin",
	}
}

function makeGithubPackage(): CanonicalPackage {
	return {
		fetchStrategy: { mode: "clone", sparse: false },
		gh: ghRef("org/repo"),
		origin: { alias: alias("pkg"), manifestPath: abs("/test/agents.toml") },
		path: undefined,
		ref: undefined,
		type: "github",
	}
}

async function setupMarketplace(dir: string): Promise<string> {
	const pluginDir = path.join(dir, ".claude-plugin")
	await mkdir(pluginDir, { recursive: true })
	await writeFile(
		path.join(pluginDir, "marketplace.json"),
		JSON.stringify({
			name: "Test Market",
			plugins: [{ name: "alpha", source: "plugins/alpha" }],
		}),
	)
	await mkdir(path.join(dir, "plugins", "alpha"), { recursive: true })
	return dir
}

describe("resolveAgentPackages", () => {
	it("resolves claude-plugin packages for non-claude agents", async () => {
		await withTempDir(async (dir) => {
			const marketplacePath = await setupMarketplace(dir)
			const result = await resolveAgentPackages({
				agent: makeAgent("codex"),
				dryRun: false,
				packages: [makePluginPackage(marketplacePath)],
				tempRoot: abs(dir),
			})

			expect(result.ok).toBe(true)
			if (!result.ok) {
				return
			}
			expect(result.value.warnings).toEqual([])
			expect(result.value.packages).toHaveLength(1)
			const resolved = result.value.packages[0]
			expect(resolved?.type).toBe("local")
			if (resolved && resolved.type === "local") {
				expect(String(resolved.absolutePath)).toContain("plugins/alpha")
			}
		})
	})

	it("returns warnings for claude-code dry runs", async () => {
		await withTempDir(async (dir) => {
			const marketplacePath = await setupMarketplace(dir)
			const result = await resolveAgentPackages({
				agent: makeAgent("claude-code"),
				dryRun: true,
				packages: [makePluginPackage(marketplacePath), makeGithubPackage()],
				tempRoot: abs(dir),
			})

			expect(result.ok).toBe(true)
			if (!result.ok) {
				return
			}
			expect(result.value.packages).toHaveLength(1)
			expect(result.value.packages[0]?.type).toBe("github")
			expect(result.value.warnings.join(" ")).toContain("alpha")
		})
	})

	it("fails when URL marketplaces resolve to local plugin sources", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			text: async () =>
				JSON.stringify({
					name: "Remote Market",
					plugins: [{ name: "alpha", source: "plugins/alpha" }],
				}),
		}))
		const originalFetch = globalThis.fetch
		globalThis.fetch = fetchMock as unknown as typeof fetch

		try {
			const result = await resolveAgentPackages({
				agent: makeAgent("codex"),
				dryRun: false,
				packages: [makePluginPackage("https://example.com/marketplace.json")],
				tempRoot: abs("/tmp"),
			})

			expect(result.ok).toBe(false)
			if (!result.ok) {
				expect(result.error.type).toBe("validation")
				if (result.error.type === "validation") {
					expect(result.error.field).toBe("source")
				}
			}
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})
