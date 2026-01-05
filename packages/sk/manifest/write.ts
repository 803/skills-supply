import type { GitRef, ValidatedDeclaration } from "@skills-supply/core"
import { stringify } from "smol-toml"
import type { Manifest } from "@/manifest/types"

export interface SerializeOptions {
	includeEmptyAgents?: boolean
	includeEmptyDependencies?: boolean
}

/**
 * Serialize a Manifest to TOML string.
 */
export function serializeManifest(
	manifest: Manifest,
	options: SerializeOptions = {},
): string {
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

	const autoDiscover = manifest.exports?.auto_discover
	if (autoDiscover) {
		output.exports = {
			auto_discover: {
				skills: autoDiscover.skills,
			},
		}
	}

	let toml = stringify(output).trimEnd()
	const extras: string[] = []

	if (options.includeEmptyAgents && manifest.agents.size === 0) {
		extras.push("[agents]")
	}

	if (options.includeEmptyDependencies && manifest.dependencies.size === 0) {
		extras.push("[dependencies]")
	}

	if (extras.length > 0) {
		if (toml.length > 0) {
			toml += "\n\n"
		}
		toml += extras.join("\n\n")
	}

	return toml.endsWith("\n") ? toml : `${toml}\n`
}

function serializePackageMetadata(
	pkg: NonNullable<Manifest["package"]>,
): Record<string, string> {
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
	dependencies: ReadonlyMap<string, ValidatedDeclaration>,
): Record<string, unknown> {
	const output: Record<string, unknown> = {}

	for (const [alias, dep] of dependencies) {
		output[alias] = serializeValidatedDependency(dep)
	}

	return output
}

function serializeValidatedDependency(dep: ValidatedDeclaration): unknown {
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

function serializeRegistryDependency(
	dep: Extract<ValidatedDeclaration, { type: "registry" }>,
): string {
	if (dep.org) {
		return `@${dep.org}/${dep.name}@${dep.version}`
	}
	return `${dep.name}@${dep.version}`
}

function serializeGithubDependency(
	dep: Extract<ValidatedDeclaration, { type: "github" }>,
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

function serializeGitDependency(
	dep: Extract<ValidatedDeclaration, { type: "git" }>,
): Record<string, string> {
	const output: Record<string, string> = { git: dep.url }

	if (dep.ref) {
		serializeGitRef(dep.ref, output)
	}

	if (dep.path) {
		output.path = dep.path
	}

	return output
}

function serializeLocalDependency(
	dep: Extract<ValidatedDeclaration, { type: "local" }>,
): Record<string, string> {
	return { path: dep.path }
}

function serializeClaudePluginDependency(
	dep: Extract<ValidatedDeclaration, { type: "claude-plugin" }>,
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
