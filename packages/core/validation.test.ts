import { describe, expect, it } from "vitest"
import { validateDeclaration } from "@/validation/declaration"

describe("validateDeclaration", () => {
	it("parses github shorthand", () => {
		const result = validateDeclaration("owner/repo")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				gh: "owner/repo",
				type: "github",
			})
		}
	})

	it("parses registry shorthand", () => {
		const result = validateDeclaration("my-pkg@1.2.3")

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				name: "my-pkg",
				type: "registry",
				version: "1.2.3",
			})
		}
	})

	it("parses github object with tag", () => {
		const result = validateDeclaration({ gh: "owner/repo", tag: "v1" })

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				gh: "owner/repo",
				path: undefined,
				ref: { type: "tag", value: "v1" },
				type: "github",
			})
		}
	})

	it("rejects multiple git refs", () => {
		const result = validateDeclaration({
			branch: "main",
			gh: "owner/repo",
			tag: "v1",
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("ref")
			}
		}
	})

	it("rejects registry object without version", () => {
		const result = validateDeclaration({ registry: "@org/pkg" })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("version")
			}
		}
	})

	it("rejects relative local path", () => {
		const result = validateDeclaration({ path: "./local" })

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("path")
			}
		}
	})

	it("accepts absolute local path", () => {
		const result = validateDeclaration({ path: "/tmp/local-skill" })

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				path: "/tmp/local-skill",
				type: "local",
			})
		}
	})

	it("parses git declaration with branch", () => {
		const result = validateDeclaration({
			branch: "main",
			git: "https://git.example.com/org/repo.git",
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				path: undefined,
				ref: { type: "branch", value: "main" },
				type: "git",
				url: "https://git.example.com/org/repo",
			})
		}
	})

	it("rejects invalid marketplace", () => {
		const result = validateDeclaration({
			marketplace: "not-a-url",
			plugin: "my-plugin",
			type: "claude-plugin",
		})

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe("validation")
			if (result.error.type === "validation") {
				expect(result.error.field).toBe("marketplace")
			}
		}
	})

	it("accepts remote marketplace URLs", () => {
		const result = validateDeclaration({
			marketplace: "https://example.com/marketplace.json",
			plugin: "my-plugin",
			type: "claude-plugin",
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				marketplace: "https://example.com/marketplace.json",
				plugin: "my-plugin",
				type: "claude-plugin",
			})
		}
	})

	it("accepts absolute path marketplaces", () => {
		const result = validateDeclaration({
			marketplace: "/tmp/marketplace",
			plugin: "my-plugin",
			type: "claude-plugin",
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.value).toEqual({
				marketplace: "/tmp/marketplace",
				plugin: "my-plugin",
				type: "claude-plugin",
			})
		}
	})

	it("accepts github and git URL marketplaces", () => {
		const githubResult = validateDeclaration({
			marketplace: "owner/repo",
			plugin: "my-plugin",
			type: "claude-plugin",
		})

		expect(githubResult.ok).toBe(true)
		if (githubResult.ok) {
			expect(githubResult.value).toEqual({
				marketplace: "owner/repo",
				plugin: "my-plugin",
				type: "claude-plugin",
			})
		}

		const gitResult = validateDeclaration({
			marketplace: "https://github.com/org/marketplace.git",
			plugin: "my-plugin",
			type: "claude-plugin",
		})

		expect(gitResult.ok).toBe(true)
		if (gitResult.ok) {
			expect(gitResult.value).toEqual({
				marketplace: "https://github.com/org/marketplace",
				plugin: "my-plugin",
				type: "claude-plugin",
			})
		}
	})
})
