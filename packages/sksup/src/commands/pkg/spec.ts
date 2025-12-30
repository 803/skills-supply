import path from "node:path"
import type {
	DependencyDeclaration,
	GithubPackageDeclaration,
	GitPackageDeclaration,
	LocalPackageDeclaration,
} from "@/core/manifest/types"

export interface AddOptions {
	tag?: string
	branch?: string
	rev?: string
	path?: string
	as?: string
}

export interface PackageSpec {
	alias: string
	declaration: DependencyDeclaration
}

export function buildPackageSpec(
	type: string,
	spec: string,
	options: AddOptions,
): PackageSpec {
	const normalizedType = type.trim().toLowerCase()
	if (!normalizedType) {
		throw new Error("Package type is required.")
	}

	const trimmedSpec = spec.trim()
	if (!trimmedSpec) {
		throw new Error("Package spec is required.")
	}

	const aliasOverride = options.as?.trim()
	if (options.as !== undefined && !aliasOverride) {
		throw new Error("--as must not be empty.")
	}

	const ref = resolveRefOptions(options)
	const subPath = resolveSubPath(options)

	switch (normalizedType) {
		case "claude-plugin":
		case "claude":
		case "plugin": {
			if (ref || options.path) {
				throw new Error(
					"--tag/--branch/--rev/--path are not valid for Claude plugins.",
				)
			}

			const atIndex = trimmedSpec.indexOf("@")
			if (atIndex <= 0 || atIndex === trimmedSpec.length - 1) {
				throw new Error(
					'Claude plugin specs must be in the form "<plugin>@<marketplace>".',
				)
			}

			const plugin = trimmedSpec.slice(0, atIndex).trim()
			const marketplace = trimmedSpec.slice(atIndex + 1).trim()
			if (!plugin || !marketplace) {
				throw new Error(
					'Claude plugin specs must be in the form "<plugin>@<marketplace>".',
				)
			}

			const alias = aliasOverride ?? plugin
			const declaration = {
				marketplace,
				plugin,
				type: "claude-plugin" as const,
			}
			return { alias, declaration }
		}
		case "gh":
		case "github": {
			const alias = aliasOverride ?? deriveAliasFromGithub(trimmedSpec)
			if (!alias) {
				throw new Error("Unable to derive alias from GitHub spec.")
			}

			const declaration: GithubPackageDeclaration = {
				gh: trimmedSpec,
				...ref,
				...(subPath ? { path: subPath } : {}),
			}
			return { alias, declaration }
		}
		case "git": {
			const alias = aliasOverride ?? deriveAliasFromGit(trimmedSpec)
			if (!alias) {
				throw new Error("Unable to derive alias from git URL.")
			}

			const declaration: GitPackageDeclaration = {
				git: trimmedSpec,
				...ref,
				...(subPath ? { path: subPath } : {}),
			}
			return { alias, declaration }
		}
		case "path":
		case "local": {
			if (ref) {
				throw new Error("--tag/--branch/--rev are not valid for local paths.")
			}

			if (options.path) {
				throw new Error("--path is not valid for local packages.")
			}

			const alias = aliasOverride ?? deriveAliasFromPath(trimmedSpec)
			if (!alias) {
				throw new Error("Unable to derive alias from local path.")
			}

			const declaration: LocalPackageDeclaration = { path: trimmedSpec }
			return { alias, declaration }
		}
		case "registry": {
			if (ref || options.path) {
				throw new Error(
					"--tag/--branch/--rev/--path are not valid for registry packages.",
				)
			}

			const registrySpec = parseRegistrySpec(trimmedSpec)
			const alias = aliasOverride ?? registrySpec.name
			return { alias, declaration: registrySpec.version }
		}
		default:
			throw new Error(`Unsupported package type: ${type}`)
	}
}

function resolveRefOptions(
	options: AddOptions,
): { tag: string } | { branch: string } | { rev: string } | undefined {
	const tag = options.tag?.trim()
	const branch = options.branch?.trim()
	const rev = options.rev?.trim()

	const provided = [tag, branch, rev].filter(Boolean)
	if (provided.length > 1) {
		throw new Error("Only one of --tag, --branch, or --rev may be set.")
	}

	if (options.tag !== undefined && !tag) {
		throw new Error("--tag must not be empty.")
	}
	if (options.branch !== undefined && !branch) {
		throw new Error("--branch must not be empty.")
	}
	if (options.rev !== undefined && !rev) {
		throw new Error("--rev must not be empty.")
	}

	if (tag) {
		return { tag }
	}
	if (branch) {
		return { branch }
	}
	if (rev) {
		return { rev }
	}
	return undefined
}

function resolveSubPath(options: AddOptions): string | undefined {
	if (options.path === undefined) {
		return undefined
	}

	const trimmed = options.path.trim()
	if (!trimmed) {
		throw new Error("--path must not be empty.")
	}

	return trimmed
}

function parseRegistrySpec(spec: string): { name: string; version: string } {
	const trimmed = spec.trim()
	const atIndex = trimmed.lastIndexOf("@")
	if (atIndex <= 0) {
		throw new Error(
			"Registry packages must be in the form name@version or @org/name@version.",
		)
	}

	const name = trimmed.slice(0, atIndex)
	const version = trimmed.slice(atIndex + 1)
	if (!name || !version) {
		throw new Error(
			"Registry packages must be in the form name@version or @org/name@version.",
		)
	}

	return { name, version }
}

function deriveAliasFromGithub(spec: string): string {
	const trimmed = spec.trim()
	const parts = trimmed.split("/")
	const repo = parts[1] ?? ""
	return repo.replace(/\.git$/, "").trim()
}

function deriveAliasFromGit(spec: string): string {
	const trimmed = spec.trim()
	if (trimmed.startsWith("git@")) {
		const match = /^git@[^:]+:(.+)$/.exec(trimmed)
		if (!match?.[1]) {
			return ""
		}

		return path.posix.basename(match[1].replace(/\.git$/, ""))
	}

	try {
		const parsed = new URL(trimmed)
		const base = path.posix.basename(parsed.pathname.replace(/\.git$/, ""))
		return base
	} catch {
		return ""
	}
}

function deriveAliasFromPath(spec: string): string {
	return path.basename(spec.trim())
}
