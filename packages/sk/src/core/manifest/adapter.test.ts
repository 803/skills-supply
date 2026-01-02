import type {
	ValidatedDependency as AgentsDependency,
	ValidatedManifest as AgentsManifest,
} from "@skills-supply/agents-toml"
import { describe, expect, it } from "vitest"
import { applyBrandedManifest } from "@/src/core/manifest/adapter"
import type { AbsolutePath } from "@/src/core/types/branded"
import { alias } from "@/tests/helpers/branded"
import "@/tests/helpers/assertions"

describe("applyBrandedManifest", () => {
	it("resolves local dependency paths relative to the manifest directory", () => {
		const manifest: AgentsManifest = {
			agents: new Map(),
			dependencies: new Map<string, AgentsDependency>([
				["local", { path: "../skills", type: "local" }],
			]),
		}
		const sourcePath = "/projects/app/agents.toml" as AbsolutePath

		const result = applyBrandedManifest(manifest, sourcePath, "cwd")

		expect(result).toBeOk()
		if (result.ok) {
			const dep = result.value.dependencies.get(alias("local"))
			expect(dep?.type).toBe("local")
			if (dep?.type === "local") {
				expect(dep.path).toBe("/projects/skills")
			}
		}
	})

	it("keeps auto_discover exports when provided", () => {
		const manifest: AgentsManifest = {
			agents: new Map(),
			dependencies: new Map(),
			exports: { auto_discover: { skills: false } },
		}
		const sourcePath = "/projects/app/agents.toml" as AbsolutePath

		const result = applyBrandedManifest(manifest, sourcePath, "cwd")

		expect(result).toBeOk()
		if (result.ok) {
			expect(result.value.exports?.auto_discover.skills).toBe(false)
		}
	})
})
