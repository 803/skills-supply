import path from "node:path"
import type {
	ClaudePluginDeclaration,
	DependencyDeclaration,
	GithubPackageDeclaration,
	GitPackageDeclaration,
	LocalPackageDeclaration,
	Manifest,
} from "@/core/manifest/types"
import type {
	CanonicalPackage,
	ClaudePluginPackage,
	GitPackage,
	GitRef,
	PackageResolutionError,
	PackageResolutionResult,
	ResolveManifestPackagesResult,
} from "@/core/packages/types"

const REGISTRY_NAME = "skills.supply"

type RegistryAliasResult =
	| { ok: true; value: { name: string; org?: string } }
	| { ok: false; error: PackageResolutionError }

type RefResult =
	| { ok: true; value?: GitRef }
	| { ok: false; error: PackageResolutionError }

export function resolveManifestPackages(
	manifest: Manifest,
): ResolveManifestPackagesResult {
	const resolved: CanonicalPackage[] = []

	for (const [alias, declaration] of Object.entries(manifest.dependencies)) {
		const result = resolvePackageDeclaration(alias, declaration, manifest.sourcePath)
		if (!result.ok) {
			return result
		}

		resolved.push(result.value)
	}

	return { ok: true, value: resolved }
}

export function resolvePackageDeclaration(
	alias: string,
	declaration: DependencyDeclaration,
	sourcePath: string,
): PackageResolutionResult {
	if (!alias.trim()) {
		return failure(
			"invalid_alias",
			"Package alias cannot be empty.",
			alias,
			sourcePath,
		)
	}

	if (typeof declaration === "string") {
		return resolveRegistry(alias, declaration, sourcePath)
	}

	if ("gh" in declaration) {
		return resolveGithub(alias, declaration, sourcePath)
	}

	if ("git" in declaration) {
		return resolveGit(alias, declaration, sourcePath)
	}

	if ("path" in declaration) {
		return resolveLocal(alias, declaration, sourcePath)
	}

	if ("type" in declaration && declaration.type === "claude-plugin") {
		return resolveClaudePlugin(alias, declaration, sourcePath)
	}

	return failure(
		"invalid_value",
		`Package "${alias}" has an unsupported declaration.`,
		alias,
		sourcePath,
	)
}

function resolveRegistry(
	alias: string,
	version: string,
	sourcePath: string,
): PackageResolutionResult {
	const trimmed = version.trim()
	if (!trimmed) {
		return failure(
			"invalid_value",
			`Package "${alias}" version cannot be empty.`,
			alias,
			sourcePath,
		)
	}

	const registryName = parseRegistryAlias(alias, sourcePath)
	if (!registryName.ok) {
		return registryName
	}

	return {
		ok: true,
		value: {
			alias,
			name: registryName.value.name,
			org: registryName.value.org,
			registry: REGISTRY_NAME,
			type: "registry",
			version: trimmed,
		},
	}
}

function parseRegistryAlias(alias: string, sourcePath: string): RegistryAliasResult {
	if (alias.startsWith("@")) {
		const withoutAt = alias.slice(1)
		const [org, name, ...rest] = withoutAt.split("/")
		if (!org || !name || rest.length > 0) {
			return failure(
				"invalid_registry_name",
				`Registry package "${alias}" must be in the form @org/name.`,
				alias,
				sourcePath,
			)
		}

		return { ok: true, value: { name, org } }
	}

	if (alias.includes("/")) {
		return failure(
			"invalid_registry_name",
			`Registry package "${alias}" must not include '/'. Use @org/name for scoped packages.`,
			alias,
			sourcePath,
		)
	}

	return { ok: true, value: { name: alias } }
}

function resolveGithub(
	alias: string,
	declaration: GithubPackageDeclaration,
	sourcePath: string,
): PackageResolutionResult {
	const gh = declaration.gh.trim()
	if (!gh) {
		return failure(
			"invalid_value",
			`Package "${alias}" gh value cannot be empty.`,
			alias,
			sourcePath,
		)
	}

	const ref = resolveRef(declaration)
	if (!ref.ok) {
		return ref
	}

	if (declaration.path !== undefined && !declaration.path.trim()) {
		return failure(
			"invalid_value",
			`Package "${alias}" path cannot be empty.`,
			alias,
			sourcePath,
		)
	}

	return {
		ok: true,
		value: {
			alias,
			gh,
			path: declaration.path,
			ref: ref.value,
			type: "github",
		},
	}
}

function resolveGit(
	alias: string,
	declaration: GitPackageDeclaration,
	sourcePath: string,
): PackageResolutionResult {
	const url = declaration.git.trim()
	if (!url) {
		return failure(
			"invalid_value",
			`Package "${alias}" git URL cannot be empty.`,
			alias,
			sourcePath,
		)
	}

	const normalized = normalizeGitUrl(url)
	if (!normalized) {
		return failure(
			"invalid_git_url",
			`Package "${alias}" git URL is not a valid git URL.`,
			alias,
			sourcePath,
		)
	}

	const ref = resolveRef(declaration)
	if (!ref.ok) {
		return ref
	}

	if (declaration.path !== undefined && !declaration.path.trim()) {
		return failure(
			"invalid_value",
			`Package "${alias}" path cannot be empty.`,
			alias,
			sourcePath,
		)
	}

	const value: GitPackage = {
		alias,
		normalizedUrl: normalized,
		path: declaration.path,
		ref: ref.value,
		type: "git",
		url,
	}

	return { ok: true, value }
}

function resolveClaudePlugin(
	alias: string,
	declaration: ClaudePluginDeclaration,
	sourcePath: string,
): PackageResolutionResult {
	const plugin = declaration.plugin.trim()
	if (!plugin) {
		return failure(
			"invalid_value",
			`Package "${alias}" plugin name cannot be empty.`,
			alias,
			sourcePath,
		)
	}

	const marketplace = declaration.marketplace.trim()
	if (!marketplace) {
		return failure(
			"invalid_value",
			`Package "${alias}" marketplace cannot be empty.`,
			alias,
			sourcePath,
		)
	}

	const value: ClaudePluginPackage = {
		alias,
		marketplace,
		plugin,
		sourcePath,
		type: "claude-plugin",
	}

	return { ok: true, value }
}

function resolveLocal(
	alias: string,
	declaration: LocalPackageDeclaration,
	sourcePath: string,
): PackageResolutionResult {
	if (!sourcePath.trim()) {
		return failure(
			"invalid_source_path",
			`Package "${alias}" source path cannot be empty.`,
			alias,
			sourcePath,
		)
	}

	const rawPath = declaration.path.trim()
	if (!rawPath) {
		return failure(
			"invalid_value",
			`Package "${alias}" path cannot be empty.`,
			alias,
			sourcePath,
		)
	}

	const baseDir = path.dirname(sourcePath)
	const absolutePath = path.resolve(baseDir, rawPath)

	return {
		ok: true,
		value: {
			absolutePath,
			alias,
			type: "local",
		},
	}
}

function resolveRef(
	declaration: GithubPackageDeclaration | GitPackageDeclaration,
): RefResult {
	if (declaration.tag !== undefined) {
		return { ok: true, value: { tag: declaration.tag } }
	}

	if (declaration.branch !== undefined) {
		return { ok: true, value: { branch: declaration.branch } }
	}

	if (declaration.rev !== undefined) {
		return { ok: true, value: { rev: declaration.rev } }
	}

	return { ok: true, value: undefined }
}

function normalizeGitUrl(url: string): string | null {
	if (url.startsWith("git@")) {
		const match = /^git@([^:]+):(.+)$/.exec(url)
		if (!match) {
			return null
		}

		const host = match[1]
		const repoPathRaw = match[2]
		if (!host || !repoPathRaw) {
			return null
		}

		const repoPath = trimGitSuffix(repoPathRaw)
		return `https://${host.toLowerCase()}/${repoPath}`
	}

	try {
		const parsed = new URL(url)
		const host = parsed.hostname.toLowerCase()
		const repoPath = trimGitSuffix(parsed.pathname)
		return `https://${host}/${repoPath}`
	} catch {
		return null
	}
}

function trimGitSuffix(input: string): string {
	const trimmed = input.replace(/^\//, "").replace(/\.git$/, "")
	return trimmed.replace(/\/$/, "")
}

function failure(
	type: PackageResolutionError["type"],
	message: string,
	alias: string,
	sourcePath: string,
): { ok: false; error: PackageResolutionError } {
	return {
		error: {
			alias,
			message,
			sourcePath,
			type,
		},
		ok: false,
	}
}
