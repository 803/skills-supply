import { describe, expect, it, vi } from "vitest"
import { resolveRemoteMarketplaceSpec } from "@/commands/pkg/add"

const baseOptions = { aliasOverride: undefined, path: undefined, ref: undefined }
const baseCommandOptions = {
	global: false,
	init: false,
	nonInteractive: true,
	sync: false,
}

describe("resolveRemoteMarketplaceSpec", () => {
	it("builds a claude-plugin spec for a single-plugin marketplace", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			text: async () =>
				JSON.stringify({
					name: "Test Market",
					plugins: [{ name: "alpha", source: "plugins/alpha" }],
				}),
		}))
		const originalFetch = globalThis.fetch
		globalThis.fetch = fetchMock as unknown as typeof fetch

		try {
			const result = await resolveRemoteMarketplaceSpec(
				"https://example.com/marketplace.json",
				baseOptions,
				baseCommandOptions,
			)

			expect(result.status).toBe("completed")
			if (result.status === "completed") {
				expect(result.value).toEqual({
					alias: "alpha",
					declaration: {
						marketplace: "https://example.com/marketplace.json",
						plugin: "alpha",
						type: "claude-plugin",
					},
				})
			}
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it("fails in non-interactive mode when multiple plugins exist", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			text: async () =>
				JSON.stringify({
					name: "Test Market",
					plugins: [
						{ name: "alpha", source: "plugins/alpha" },
						{ name: "beta", source: "plugins/beta" },
					],
				}),
		}))
		const originalFetch = globalThis.fetch
		globalThis.fetch = fetchMock as unknown as typeof fetch

		try {
			const result = await resolveRemoteMarketplaceSpec(
				"https://example.com/marketplace.json",
				baseOptions,
				baseCommandOptions,
			)

			expect(result.status).toBe("failed")
			if (result.status === "failed") {
				expect(result.error.type).toBe("validation")
				if (result.error.type === "validation") {
					expect(result.error.field).toBe("plugins")
					expect(result.error.message).toContain("multiple plugins")
				}
			}
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})
