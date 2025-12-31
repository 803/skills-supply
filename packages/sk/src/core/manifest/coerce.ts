/**
 * Manifest Coercion
 *
 * Converts raw parsed TOML data into validated manifest types.
 * This is THE boundary where untyped data becomes type-safe.
 */

import path from "node:path"
import type {
	AbsolutePath,
	AgentId,
	Alias,
	GitRef,
	ManifestDiscoveredAt,
	ManifestOrigin,
	NonEmptyString,
} from "@/core/types/branded"
import {
	coerceAbsolutePath,
	coerceAlias,
	coerceGitRef,
	coerceGitUrl,
	coerceGithubRef,
	coerceNonEmpty,
} from "@/core/types/coerce"
import type {
	ClaudePluginDeclaration,
	DependencyDeclaration,
	GitPackageDeclaration,
	GithubPackageDeclaration,
	LocalPackageDeclaration,
	Manifest,
	ManifestExports,
	ManifestParseError,
	PackageMetadata,
	ValidatedClaudePluginDependency,
	ValidatedDependency,
	ValidatedGitDependency,
	ValidatedGithubDependency,
	ValidatedLocalDependency,
	ValidatedManifestExports,
	ValidatedPackageMetadata,
	ValidatedRegistryDependency,
} from "./types.js"

// =============================================================================
// RESULT TYPE
// =============================================================================

type CoerceResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: ManifestParseError }

// =============================================================================
// AGENT ID VALIDATION
// =============================================================================

const VALID_AGENT_IDS = new Set<AgentId>(["claude-code", "codex", "opencode"])

function isValidAgentId(id: string): id is AgentId {
	return VALID_AGENT_IDS.has(id as AgentId)
}

// =============================================================================
// DEPENDENCY COERCION
// =============================================================================

function isGithubDeclaration(
	decl: DependencyDeclaration,
): decl is GithubPackageDeclaration {
	return typeof decl === "object" && "gh" in decl
}

function isGitDeclaration(
	decl: DependencyDeclaration,
): decl is GitPackageDeclaration {
	return typeof decl === "object" && "git" in decl
}

function isLocalDeclaration(
	decl: DependencyDeclaration,
): decl is LocalPackageDeclaration {
	return (
		typeof decl === "object" &&
		"path" in decl &&
		!("gh" in decl) &&
		!("git" in decl) &&
		!("type" in decl)
	)
}

function isClaudePluginDeclaration(
	decl: DependencyDeclaration,
): decl is ClaudePluginDeclaration {
	return typeof decl === "object" && "type" in decl && decl.type === "claude-plugin"
}

/**
 * Parse a registry dependency string like "@org/name@1.0.0" or "name@1.0.0"
 */
function parseRegistryString(
	value: string,
	alias: string,
	sourcePath: AbsolutePath,
): CoerceResult<ValidatedRegistryDependency> {
	// Format: @org/name@version or name@version
	const atOrgMatch = value.match(/^@([^/]+)\/([^@]+)@(.+)$/)
	if (atOrgMatch) {
		const [, orgStr, nameStr, versionStr] = atOrgMatch
		const org = coerceNonEmpty(orgStr!)
		const name = coerceNonEmpty(nameStr!)
		const version = coerceNonEmpty(versionStr!)
		if (!org || !name || !version) {
			return {
				ok: false,
				error: {
					type: "coercion_failed",
					message: `Invalid registry dependency format: ${value}`,
					sourcePath,
					key: alias,
				},
			}
		}
		return { ok: true, value: { type: "registry", org, name, version } }
	}

	const simpleMatch = value.match(/^([^@]+)@(.+)$/)
	if (simpleMatch) {
		const [, nameStr, versionStr] = simpleMatch
		const name = coerceNonEmpty(nameStr!)
		const version = coerceNonEmpty(versionStr!)
		if (!name || !version) {
			return {
				ok: false,
				error: {
					type: "coercion_failed",
					message: `Invalid registry dependency format: ${value}`,
					sourcePath,
					key: alias,
				},
			}
		}
		return { ok: true, value: { type: "registry", name, version } }
	}

	return {
		ok: false,
		error: {
			type: "coercion_failed",
			message: `Invalid registry dependency format: ${value}. Expected @org/name@version or name@version`,
			sourcePath,
			key: alias,
		},
	}
}

function coerceGithubDependency(
	decl: GithubPackageDeclaration,
	alias: string,
	sourcePath: AbsolutePath,
): CoerceResult<ValidatedGithubDependency> {
	const gh = coerceGithubRef(decl.gh)
	if (!gh) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: `Invalid GitHub reference: ${decl.gh}. Expected owner/repo format.`,
				sourcePath,
				key: alias,
				field: "gh",
			},
		}
	}

	let ref: GitRef | undefined
	try {
		ref = coerceGitRef({ tag: decl.tag, branch: decl.branch, rev: decl.rev }) ?? undefined
	} catch (e) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: e instanceof Error ? e.message : "Invalid git ref",
				sourcePath,
				key: alias,
			},
		}
	}

	let validPath: NonEmptyString | undefined
	if (decl.path) {
		const coerced = coerceNonEmpty(decl.path)
		if (!coerced) {
			return {
				ok: false,
				error: {
					type: "coercion_failed",
					message: "path must be non-empty",
					sourcePath,
					key: alias,
					field: "path",
				},
			}
		}
		validPath = coerced
	}

	return {
		ok: true,
		value: {
			type: "github",
			gh,
			ref,
			path: validPath,
		},
	}
}

function coerceGitDependency(
	decl: GitPackageDeclaration,
	alias: string,
	sourcePath: AbsolutePath,
): CoerceResult<ValidatedGitDependency> {
	const url = coerceGitUrl(decl.git)
	if (!url) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: `Invalid git URL: ${decl.git}`,
				sourcePath,
				key: alias,
				field: "git",
			},
		}
	}

	let ref: GitRef | undefined
	try {
		ref = coerceGitRef({ tag: decl.tag, branch: decl.branch, rev: decl.rev }) ?? undefined
	} catch (e) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: e instanceof Error ? e.message : "Invalid git ref",
				sourcePath,
				key: alias,
			},
		}
	}

	let validPath: NonEmptyString | undefined
	if (decl.path) {
		const coerced = coerceNonEmpty(decl.path)
		if (!coerced) {
			return {
				ok: false,
				error: {
					type: "coercion_failed",
					message: "path must be non-empty",
					sourcePath,
					key: alias,
					field: "path",
				},
			}
		}
		validPath = coerced
	}

	return {
		ok: true,
		value: {
			type: "git",
			url,
			ref,
			path: validPath,
		},
	}
}

function coerceLocalDependency(
	decl: LocalPackageDeclaration,
	alias: string,
	sourcePath: AbsolutePath,
): CoerceResult<ValidatedLocalDependency> {
	// Resolve relative to manifest directory
	const manifestDir = path.dirname(sourcePath)
	const absolutePath = coerceAbsolutePath(decl.path, manifestDir)

	if (!absolutePath) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: `Invalid local path: ${decl.path}`,
				sourcePath,
				key: alias,
				field: "path",
			},
		}
	}

	return {
		ok: true,
		value: {
			type: "local",
			path: absolutePath,
		},
	}
}

function coerceClaudePluginDependency(
	decl: ClaudePluginDeclaration,
	alias: string,
	sourcePath: AbsolutePath,
): CoerceResult<ValidatedClaudePluginDependency> {
	const plugin = coerceNonEmpty(decl.plugin)
	if (!plugin) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: "plugin must be non-empty",
				sourcePath,
				key: alias,
				field: "plugin",
			},
		}
	}

	const marketplace = coerceGitUrl(decl.marketplace)
	if (!marketplace) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: `Invalid marketplace URL: ${decl.marketplace}`,
				sourcePath,
				key: alias,
				field: "marketplace",
			},
		}
	}

	return {
		ok: true,
		value: {
			type: "claude-plugin",
			plugin,
			marketplace,
		},
	}
}

/**
 * Coerce a raw dependency declaration to a validated dependency.
 */
export function coerceDependency(
	decl: DependencyDeclaration,
	alias: string,
	sourcePath: AbsolutePath,
): CoerceResult<ValidatedDependency> {
	if (typeof decl === "string") {
		return parseRegistryString(decl, alias, sourcePath)
	}

	if (isGithubDeclaration(decl)) {
		return coerceGithubDependency(decl, alias, sourcePath)
	}

	if (isGitDeclaration(decl)) {
		return coerceGitDependency(decl, alias, sourcePath)
	}

	if (isLocalDeclaration(decl)) {
		return coerceLocalDependency(decl, alias, sourcePath)
	}

	if (isClaudePluginDeclaration(decl)) {
		return coerceClaudePluginDependency(decl, alias, sourcePath)
	}

	return {
		ok: false,
		error: {
			type: "invalid_dependency",
			message: `Unknown dependency type`,
			sourcePath,
			key: alias,
		},
	}
}

// =============================================================================
// PACKAGE METADATA COERCION
// =============================================================================

function coercePackageMetadata(
	pkg: PackageMetadata,
	sourcePath: AbsolutePath,
): CoerceResult<ValidatedPackageMetadata> {
	const name = coerceNonEmpty(pkg.name)
	if (!name) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: "package.name must be non-empty",
				sourcePath,
				field: "package.name",
			},
		}
	}

	const version = coerceNonEmpty(pkg.version)
	if (!version) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: "package.version must be non-empty",
				sourcePath,
				field: "package.version",
			},
		}
	}

	return {
		ok: true,
		value: {
			name,
			version,
			description: pkg.description ? coerceNonEmpty(pkg.description) ?? undefined : undefined,
			license: pkg.license ? coerceNonEmpty(pkg.license) ?? undefined : undefined,
			org: pkg.org ? coerceNonEmpty(pkg.org) ?? undefined : undefined,
		},
	}
}

// =============================================================================
// EXPORTS COERCION
// =============================================================================

function coerceExports(
	exports: ManifestExports,
	sourcePath: AbsolutePath,
): CoerceResult<ValidatedManifestExports> {
	const skills = exports.autoDiscover.skills
	if (skills === false) {
		return {
			ok: true,
			value: { autoDiscover: { skills: false } },
		}
	}

	const coercedSkills = coerceNonEmpty(skills)
	if (!coercedSkills) {
		return {
			ok: false,
			error: {
				type: "coercion_failed",
				message: "exports.auto_discover.skills must be non-empty or false",
				sourcePath,
				field: "exports.auto_discover.skills",
			},
		}
	}

	return {
		ok: true,
		value: { autoDiscover: { skills: coercedSkills } },
	}
}

// =============================================================================
// MAIN COERCION FUNCTION
// =============================================================================

export interface RawParsedManifest {
	package?: PackageMetadata
	agents?: Record<string, boolean>
	dependencies?: Record<string, DependencyDeclaration>
	exports?: ManifestExports
}

/**
 * Coerce a raw parsed manifest into a validated Manifest.
 * This is the main coercion function called at the parse boundary.
 */
export function coerceManifest(
	raw: RawParsedManifest,
	sourcePath: AbsolutePath,
	discoveredAt: ManifestDiscoveredAt,
): CoerceResult<Manifest> {
	const origin: ManifestOrigin = { sourcePath, discoveredAt }

	// Coerce agents
	const agents = new Map<AgentId, boolean>()
	if (raw.agents) {
		for (const [id, enabled] of Object.entries(raw.agents)) {
			if (isValidAgentId(id)) {
				agents.set(id, enabled)
			}
			// Silently ignore invalid agent IDs for forward compatibility
		}
	}

	// Coerce dependencies
	const dependencies = new Map<Alias, ValidatedDependency>()
	if (raw.dependencies) {
		for (const [aliasStr, decl] of Object.entries(raw.dependencies)) {
			const alias = coerceAlias(aliasStr)
			if (!alias) {
				return {
					ok: false,
					error: {
						type: "coercion_failed",
						message: `Invalid alias: ${aliasStr}. Aliases must not contain slashes, dots, or colons.`,
						sourcePath,
						key: aliasStr,
					},
				}
			}

			const depResult = coerceDependency(decl, aliasStr, sourcePath)
			if (!depResult.ok) {
				return depResult
			}

			dependencies.set(alias, depResult.value)
		}
	}

	// Coerce package metadata
	let validatedPackage: ValidatedPackageMetadata | undefined
	if (raw.package) {
		const pkgResult = coercePackageMetadata(raw.package, sourcePath)
		if (!pkgResult.ok) {
			return pkgResult
		}
		validatedPackage = pkgResult.value
	}

	// Coerce exports
	let validatedExports: ValidatedManifestExports | undefined
	if (raw.exports) {
		const exportsResult = coerceExports(raw.exports, sourcePath)
		if (!exportsResult.ok) {
			return exportsResult
		}
		validatedExports = exportsResult.value
	}

	return {
		ok: true,
		value: {
			package: validatedPackage,
			agents,
			dependencies,
			exports: validatedExports,
			origin,
		},
	}
}
