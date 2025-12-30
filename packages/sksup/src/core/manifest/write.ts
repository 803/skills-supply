import { stringify } from "smol-toml"
import type {
	GithubPackageDeclaration,
	GitPackageDeclaration,
	LocalPackageDeclaration,
	Manifest,
	PackageDeclaration,
} from "@/core/manifest/types"

export function serializeManifest(manifest: Manifest): string {
	const output: Record<string, unknown> = {}

	if (Object.keys(manifest.agents).length > 0) {
		output.agents = manifest.agents
	}

	if (Object.keys(manifest.packages).length > 0) {
		output.packages = serializePackages(manifest.packages)
	}

	const toml = stringify(output)
	return toml.endsWith("\n") ? toml : `${toml}\n`
}

function serializePackages(
	packages: Record<string, PackageDeclaration>,
): Record<string, unknown> {
	const output: Record<string, unknown> = {}

	for (const [alias, declaration] of Object.entries(packages)) {
		output[alias] = serializePackageDeclaration(declaration)
	}

	return output
}

function serializePackageDeclaration(declaration: PackageDeclaration): unknown {
	if (typeof declaration === "string") {
		return declaration
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
