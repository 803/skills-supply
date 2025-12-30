import { stringify } from "smol-toml"
import type {
	ClaudePluginDeclaration,
	DependencyDeclaration,
	GithubPackageDeclaration,
	GitPackageDeclaration,
	LocalPackageDeclaration,
	Manifest,
} from "@/core/manifest/types"

export function serializeManifest(manifest: Manifest): string {
	const output: Record<string, unknown> = {}

	if (manifest.package) {
		output.package = manifest.package
	}

	if (Object.keys(manifest.agents).length > 0) {
		output.agents = manifest.agents
	}

	if (Object.keys(manifest.dependencies).length > 0) {
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

function serializeDependencies(
	dependencies: Record<string, DependencyDeclaration>,
): Record<string, unknown> {
	const output: Record<string, unknown> = {}

	for (const [alias, declaration] of Object.entries(dependencies)) {
		output[alias] = serializeDependencyDeclaration(declaration)
	}

	return output
}

function serializeDependencyDeclaration(declaration: DependencyDeclaration): unknown {
	if (typeof declaration === "string") {
		return declaration
	}

	if ("type" in declaration && declaration.type === "claude-plugin") {
		return serializeClaudePlugin(declaration)
	}

	if ("gh" in declaration) {
		return serializeGithubPackage(declaration)
	}

	if ("git" in declaration) {
		return serializeGitPackage(declaration)
	}

	return serializeLocalPackage(declaration)
}

function serializeGithubPackage(
	declaration: GithubPackageDeclaration,
): Record<string, string> {
	return serializeRefPackage({ gh: declaration.gh }, declaration)
}

function serializeGitPackage(declaration: GitPackageDeclaration): Record<string, string> {
	return serializeRefPackage({ git: declaration.git }, declaration)
}

function serializeLocalPackage(
	declaration: LocalPackageDeclaration,
): Record<string, string> {
	return { path: declaration.path }
}

function serializeClaudePlugin(
	declaration: ClaudePluginDeclaration,
): Record<string, string> {
	return {
		marketplace: declaration.marketplace,
		plugin: declaration.plugin,
		type: declaration.type,
	}
}

function serializeRefPackage(
	base: Record<string, string>,
	declaration: GithubPackageDeclaration | GitPackageDeclaration,
): Record<string, string> {
	const output = { ...base }

	if (declaration.tag !== undefined) {
		output.tag = declaration.tag
	}

	if (declaration.branch !== undefined) {
		output.branch = declaration.branch
	}

	if (declaration.rev !== undefined) {
		output.rev = declaration.rev
	}

	if (declaration.path !== undefined) {
		output.path = declaration.path
	}

	return output
}
