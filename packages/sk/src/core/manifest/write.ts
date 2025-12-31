import { stringify } from "smol-toml"
import type {
	Manifest,
	ValidatedClaudePluginDependency,
	ValidatedDependency,
	ValidatedGitDependency,
	ValidatedGithubDependency,
	ValidatedLocalDependency,
	ValidatedPackageMetadata,
	ValidatedRegistryDependency,
} from "@/core/manifest/types"
import type { GitRef } from "@/core/types/branded"

/**
 * Serialize a Manifest to TOML string.
 */
export function serializeManifest(manifest: Manifest): string {
	const output: Record<string, unknown> = {}

	if (manifest.package) {
		output.package = serializePackageMetadata(manifest.package)
	}

	if (manifest.agents.size > 0) {
		output.agents = Object.fromEntries(manifest.agents)
	}

	if (manifest.dependencies.size > 0) {
		output.dependencies = serializeDependencies(manifest.dependencies)
	}

	if (manifest.exports) {
		output.exports = {
			auto_discover: {
				skills: manifest.exports.autoDiscover.skills,
			},
		}
	}

	const toml = stringify(output)
	return toml.endsWith("\n") ? toml : `${toml}\n`
}

function serializePackageMetadata(pkg: ValidatedPackageMetadata): Record<string, string> {
	const output: Record<string, string> = {
		name: pkg.name,
		version: pkg.version,
	}

	if (pkg.description) {
		output.description = pkg.description
	}

	if (pkg.license) {
		output.license = pkg.license
	}

	if (pkg.org) {
		output.org = pkg.org
	}

	return output
}

function serializeDependencies(
	dependencies: ReadonlyMap<string, ValidatedDependency>,
): Record<string, unknown> {
	const output: Record<string, unknown> = {}

	for (const [alias, dep] of dependencies) {
		output[alias] = serializeValidatedDependency(dep)
	}

	return output
}

function serializeValidatedDependency(dep: ValidatedDependency): unknown {
	switch (dep.type) {
		case "registry":
			return serializeRegistryDependency(dep)
		case "github":
			return serializeGithubDependency(dep)
		case "git":
			return serializeGitDependency(dep)
		case "local":
			return serializeLocalDependency(dep)
		case "claude-plugin":
			return serializeClaudePluginDependency(dep)
	}
}

function serializeRegistryDependency(dep: ValidatedRegistryDependency): string {
	if (dep.org) {
		return `@${dep.org}/${dep.name}@${dep.version}`
	}
	return `${dep.name}@${dep.version}`
}

function serializeGithubDependency(
	dep: ValidatedGithubDependency,
): Record<string, string> {
	const output: Record<string, string> = { gh: dep.gh }

	if (dep.ref) {
		serializeGitRef(dep.ref, output)
	}

	if (dep.path) {
		output.path = dep.path
	}

	return output
}

function serializeGitDependency(dep: ValidatedGitDependency): Record<string, string> {
	const output: Record<string, string> = { git: dep.url }

	if (dep.ref) {
		serializeGitRef(dep.ref, output)
	}

	if (dep.path) {
		output.path = dep.path
	}

	return output
}

function serializeLocalDependency(dep: ValidatedLocalDependency): Record<string, string> {
	return { path: dep.path }
}

function serializeClaudePluginDependency(
	dep: ValidatedClaudePluginDependency,
): Record<string, string> {
	return {
		marketplace: dep.marketplace,
		plugin: dep.plugin,
		type: "claude-plugin",
	}
}

function serializeGitRef(ref: GitRef, output: Record<string, string>): void {
	switch (ref.type) {
		case "tag":
			output.tag = ref.value
			break
		case "branch":
			output.branch = ref.value
			break
		case "rev":
			output.rev = ref.value
			break
	}
}
