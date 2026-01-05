import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@clack/prompts", () => ({
	isCancel: () => false,
	multiselect: vi.fn(),
	select: vi.fn(),
	text: vi.fn(),
}))

vi.mock("@/packages/auto-detect", () => ({
	autoDetectPackage: vi.fn(),
}))

import { multiselect, select, text } from "@clack/prompts"
import { resolveAutoDetectSpec, resolveRemoteMarketplaceSpec } from "@/commands/pkg/add"
import { autoDetectPackage } from "@/packages/auto-detect"

const multiselectMock = vi.mocked(multiselect)
const selectMock = vi.mocked(select)
const textMock = vi.mocked(text)
const autoDetectPackageMock = vi.mocked(autoDetectPackage)

beforeEach(() => {
	multiselectMock.mockReset()
	selectMock.mockReset()
	textMock.mockReset()
	autoDetectPackageMock.mockReset()
})

const baseOptions = { aliasOverride: undefined, path: undefined, ref: undefined }
const baseCommandOptions = {
	global: false,
	init: false,
	nonInteractive: true,
	sync: false,
}

function mockAutoDetect({
	detection,
	source = { slug: "owner/repo", type: "github" },
}: {
	detection: {
		method: string
		pluginName?: string
		marketplace?: { name: string; plugins: string[] }
	}
	source?: {
		type: "github" | "git" | "local"
		slug?: string
		url?: string
		path?: string
	}
}) {
	autoDetectPackageMock.mockResolvedValue({
		ok: true,
		value: {
			detection,
			source,
		},
	})
}

describe("resolveRemoteMarketplaceSpec", () => {
	it("fails when ref options are provided", async () => {
		const result = await resolveRemoteMarketplaceSpec(
			"https://example.com/marketplace.json",
			{ ...baseOptions, ref: { tag: "v1" } },
			baseCommandOptions,
		)

		expect(result.status).toBe("failed")
		if (result.status === "failed") {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("ref")
			}
		}
	})

	it("fails when a path option is provided", async () => {
		const result = await resolveRemoteMarketplaceSpec(
			"https://example.com/marketplace.json",
			{ ...baseOptions, path: "subdir" },
			baseCommandOptions,
		)

		expect(result.status).toBe("failed")
		if (result.status === "failed") {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("path")
			}
		}
	})

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
				expect(result.value).toEqual([
					{
						alias: "alpha",
						declaration: {
							marketplace: "https://example.com/marketplace.json",
							plugin: "alpha",
							type: "claude-plugin",
						},
					},
				])
			}
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	it("builds claude-plugin specs for multiple selections in interactive mode", async () => {
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
		multiselectMock.mockResolvedValue(["alpha", "beta"])

		try {
			const result = await resolveRemoteMarketplaceSpec(
				"https://example.com/marketplace.json",
				baseOptions,
				{ ...baseCommandOptions, nonInteractive: false },
			)

			expect(result.status).toBe("completed")
			if (result.status === "completed") {
				expect(result.value).toEqual([
					{
						alias: "alpha",
						declaration: {
							marketplace: "https://example.com/marketplace.json",
							plugin: "alpha",
							type: "claude-plugin",
						},
					},
					{
						alias: "beta",
						declaration: {
							marketplace: "https://example.com/marketplace.json",
							plugin: "beta",
							type: "claude-plugin",
						},
					},
				])
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

	it("fails when marketplace has no plugins", async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			text: async () =>
				JSON.stringify({
					name: "Empty Market",
					plugins: [],
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
					expect(result.error.message).toContain("no plugins")
				}
			}
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})

describe("resolveAutoDetectSpec (interactive plugin flows)", () => {
	const input = "https://github.com/owner/repo"

	it("fails in non-interactive mode for plugin-mismatch detection", async () => {
		mockAutoDetect({
			detection: {
				marketplace: { name: "Test Market", plugins: ["alpha"] },
				method: "plugin-mismatch",
				pluginName: "alpha",
			},
		})

		const result = await resolveAutoDetectSpec(input, baseOptions, baseCommandOptions)

		expect(result.status).toBe("failed")
		if (result.status === "failed") {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("marketplace")
			}
		}
	})

	it("builds claude-plugin specs when plugin-mismatch chooses marketplace", async () => {
		mockAutoDetect({
			detection: {
				marketplace: { name: "Test Market", plugins: ["alpha", "beta"] },
				method: "plugin-mismatch",
				pluginName: "alpha",
			},
		})
		selectMock.mockResolvedValue("marketplace")
		multiselectMock.mockResolvedValue(["alpha", "beta"])

		const result = await resolveAutoDetectSpec(input, baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("completed")
		if (result.status === "completed") {
			expect(result.value).toEqual([
				{
					alias: "alpha",
					declaration: {
						marketplace: "owner/repo",
						plugin: "alpha",
						type: "claude-plugin",
					},
				},
				{
					alias: "beta",
					declaration: {
						marketplace: "owner/repo",
						plugin: "beta",
						type: "claude-plugin",
					},
				},
			])
		}
	})

	it("builds a github package spec when plugin-mismatch chooses package", async () => {
		mockAutoDetect({
			detection: {
				marketplace: { name: "Test Market", plugins: ["alpha"] },
				method: "plugin-mismatch",
				pluginName: "alpha",
			},
		})
		selectMock.mockResolvedValue("package")

		const result = await resolveAutoDetectSpec(input, baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("completed")
		if (result.status === "completed") {
			expect(result.value).toEqual([
				{
					alias: "repo",
					declaration: { gh: "owner/repo" },
				},
			])
		}
	})

	it("builds a claude-plugin spec when plugin-mismatch chooses external marketplace", async () => {
		mockAutoDetect({
			detection: {
				marketplace: { name: "Test Market", plugins: ["alpha"] },
				method: "plugin-mismatch",
				pluginName: "gamma",
			},
		})
		selectMock.mockResolvedValue("external")
		textMock.mockResolvedValue("owner/marketplace")

		const result = await resolveAutoDetectSpec(input, baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("completed")
		if (result.status === "completed") {
			expect(result.value).toEqual([
				{
					alias: "gamma",
					declaration: {
						marketplace: "owner/marketplace",
						plugin: "gamma",
						type: "claude-plugin",
					},
				},
			])
		}
	})

	it("fails when plugin-mismatch external marketplace is empty", async () => {
		mockAutoDetect({
			detection: {
				marketplace: { name: "Test Market", plugins: ["alpha"] },
				method: "plugin-mismatch",
				pluginName: "gamma",
			},
		})
		selectMock.mockResolvedValue("external")
		textMock.mockResolvedValue("   ")

		const result = await resolveAutoDetectSpec(input, baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("failed")
		if (result.status === "failed") {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("marketplace")
			}
		}
	})

	it("builds a github package spec when plugin-only chooses package", async () => {
		mockAutoDetect({
			detection: { method: "plugin", pluginName: "alpha" },
		})
		selectMock.mockResolvedValue("package")

		const result = await resolveAutoDetectSpec(input, baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("completed")
		if (result.status === "completed") {
			expect(result.value).toEqual([
				{
					alias: "repo",
					declaration: { gh: "owner/repo" },
				},
			])
		}
	})

	it("builds a claude-plugin spec when plugin-only chooses marketplace", async () => {
		mockAutoDetect({
			detection: { method: "plugin", pluginName: "alpha" },
		})
		selectMock.mockResolvedValue("marketplace")
		textMock.mockResolvedValue("owner/marketplace")

		const result = await resolveAutoDetectSpec(input, baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("completed")
		if (result.status === "completed") {
			expect(result.value).toEqual([
				{
					alias: "alpha",
					declaration: {
						marketplace: "owner/marketplace",
						plugin: "alpha",
						type: "claude-plugin",
					},
				},
			])
		}
	})

	it("fails in non-interactive mode for plugin-only detection", async () => {
		mockAutoDetect({
			detection: { method: "plugin", pluginName: "alpha" },
		})

		const result = await resolveAutoDetectSpec(input, baseOptions, baseCommandOptions)

		expect(result.status).toBe("failed")
		if (result.status === "failed") {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("marketplace")
			}
		}
	})

	it("builds claude-plugin specs when marketplace-only detection selects plugins", async () => {
		mockAutoDetect({
			detection: {
				marketplace: { name: "Test Market", plugins: ["alpha", "beta"] },
				method: "marketplace",
			},
		})
		multiselectMock.mockResolvedValue(["beta"])

		const result = await resolveAutoDetectSpec(input, baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("completed")
		if (result.status === "completed") {
			expect(result.value).toEqual([
				{
					alias: "beta",
					declaration: {
						marketplace: "owner/repo",
						plugin: "beta",
						type: "claude-plugin",
					},
				},
			])
		}
	})

	it("fails in non-interactive mode for marketplace-only detection with multiple plugins", async () => {
		mockAutoDetect({
			detection: {
				marketplace: { name: "Test Market", plugins: ["alpha", "beta"] },
				method: "marketplace",
			},
		})

		const result = await resolveAutoDetectSpec(input, baseOptions, baseCommandOptions)

		expect(result.status).toBe("failed")
		if (result.status === "failed") {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("plugins")
			}
		}
	})

	it("builds a claude-plugin spec when plugin belongs to marketplace", async () => {
		mockAutoDetect({
			detection: { method: "claude-plugin", pluginName: "alpha" },
			source: { path: "/tmp/marketplace", type: "local" },
		})

		const result = await resolveAutoDetectSpec("/tmp/marketplace", baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("completed")
		if (result.status === "completed") {
			expect(result.value).toEqual([
				{
					alias: "alpha",
					declaration: {
						marketplace: "/tmp/marketplace",
						plugin: "alpha",
						type: "claude-plugin",
					},
				},
			])
		}
	})

	it("builds a github spec when a manifest is detected", async () => {
		mockAutoDetect({
			detection: { method: "manifest" },
		})

		const result = await resolveAutoDetectSpec(input, baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("completed")
		if (result.status === "completed") {
			expect(result.value).toEqual([
				{
					alias: "repo",
					declaration: { gh: "owner/repo" },
				},
			])
		}
	})

	it("builds a local spec when subdir detection is returned for a local path", async () => {
		mockAutoDetect({
			detection: { method: "subdir" },
			source: { path: "/tmp/skills", type: "local" },
		})

		const result = await resolveAutoDetectSpec("/tmp/skills", baseOptions, {
			...baseCommandOptions,
			nonInteractive: false,
		})

		expect(result.status).toBe("completed")
		if (result.status === "completed") {
			expect(result.value).toEqual([
				{
					alias: "skills",
					declaration: { path: "/tmp/skills" },
				},
			])
		}
	})
})
