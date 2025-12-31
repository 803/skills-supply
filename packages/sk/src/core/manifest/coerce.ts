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
	coerceGithubRef,
	coerceGitRef,
	coerceGitUrl,
	coerceNonEmpty,
} from "@/core/types/coerce"
import type {
	ClaudePluginDeclaration,
	DependencyDeclaration,
	GithubPackageDeclaration,
	GitPackageDeclaration,
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

type CoerceResult<T> = { ok: true; value: T } | { ok: false; error: ManifestParseError }

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

function isGitDeclaration(decl: DependencyDeclaration): decl is GitPackageDeclaration {
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
				error: {
					key: alias,
					message: `Invalid registry dependency format: ${value}`,
					sourcePath,
					type: "coercion_failed",
				},
				ok: false,
			}
		}
		return { ok: true, value: { name, org, type: "registry", version } }
	}

	const simpleMatch = value.match(/^([^@]+)@(.+)$/)
	if (simpleMatch) {
		const [, nameStr, versionStr] = simpleMatch
		const name = coerceNonEmpty(nameStr!)
		const version = coerceNonEmpty(versionStr!)
		if (!name || !version) {
			return {
				error: {
					key: alias,
					message: `Invalid registry dependency format: ${value}`,
					sourcePath,
					type: "coercion_failed",
				},
				ok: false,
			}
		}
		return { ok: true, value: { name, type: "registry", version } }
	}

	return {
		error: {
			key: alias,
			message: `Invalid registry dependency format: ${value}. Expected @org/name@version or name@version`,
			sourcePath,
			type: "coercion_failed",
		},
		ok: false,
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
			error: {
				field: "gh",
				key: alias,
				message: `Invalid GitHub reference: ${decl.gh}. Expected owner/repo format.`,
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
		}
	}

	let ref: GitRef | undefined
	try {
		ref =
			coerceGitRef({ branch: decl.branch, rev: decl.rev, tag: decl.tag }) ??
			undefined
	} catch (e) {
		return {
			error: {
				key: alias,
				message: e instanceof Error ? e.message : "Invalid git ref",
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
		}
	}

	let validPath: NonEmptyString | undefined
	if (decl.path !== undefined) {
		const coerced = coerceNonEmpty(decl.path)
		if (!coerced) {
			return {
				error: {
					field: "path",
					key: alias,
					message: "path must be non-empty",
					sourcePath,
					type: "coercion_failed",
				},
				ok: false,
			}
		}
		validPath = coerced
	}

	return {
		ok: true,
		value: {
			gh,
			path: validPath,
			ref,
			type: "github",
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
			error: {
				field: "git",
				key: alias,
				message: `Invalid git URL: ${decl.git}`,
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
		}
	}

	let ref: GitRef | undefined
	try {
		ref =
			coerceGitRef({ branch: decl.branch, rev: decl.rev, tag: decl.tag }) ??
			undefined
	} catch (e) {
		return {
			error: {
				key: alias,
				message: e instanceof Error ? e.message : "Invalid git ref",
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
		}
	}

	let validPath: NonEmptyString | undefined
	if (decl.path !== undefined) {
		const coerced = coerceNonEmpty(decl.path)
		if (!coerced) {
			return {
				error: {
					field: "path",
					key: alias,
					message: "path must be non-empty",
					sourcePath,
					type: "coercion_failed",
				},
				ok: false,
			}
		}
		validPath = coerced
	}

	return {
		ok: true,
		value: {
			path: validPath,
			ref,
			type: "git",
			url,
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
			error: {
				field: "path",
				key: alias,
				message: `Invalid local path: ${decl.path}`,
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			path: absolutePath,
			type: "local",
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
			error: {
				field: "plugin",
				key: alias,
				message: "plugin must be non-empty",
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
		}
	}

	const marketplace = coerceGitUrl(decl.marketplace)
	if (!marketplace) {
		return {
			error: {
				field: "marketplace",
				key: alias,
				message: `Invalid marketplace URL: ${decl.marketplace}`,
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			marketplace,
			plugin,
			type: "claude-plugin",
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
		error: {
			key: alias,
			message: `Unknown dependency type`,
			sourcePath,
			type: "invalid_dependency",
		},
		ok: false,
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
			error: {
				field: "package.name",
				message: "package.name must be non-empty",
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
		}
	}

	const version = coerceNonEmpty(pkg.version)
	if (!version) {
		return {
			error: {
				field: "package.version",
				message: "package.version must be non-empty",
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
		}
	}

	return {
		ok: true,
		value: {
			description: pkg.description
				? (coerceNonEmpty(pkg.description) ?? undefined)
				: undefined,
			license: pkg.license ? (coerceNonEmpty(pkg.license) ?? undefined) : undefined,
			name,
			org: pkg.org ? (coerceNonEmpty(pkg.org) ?? undefined) : undefined,
			version,
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
			error: {
				field: "exports.auto_discover.skills",
				message: "exports.auto_discover.skills must be non-empty or false",
				sourcePath,
				type: "coercion_failed",
			},
			ok: false,
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
	const origin: ManifestOrigin = { discoveredAt, sourcePath }

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
					error: {
						key: aliasStr,
						message: `Invalid alias: ${aliasStr}. Aliases must not contain slashes, dots, or colons.`,
						sourcePath,
						type: "coercion_failed",
					},
					ok: false,
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
			agents,
			dependencies,
			exports: validatedExports,
			origin,
			package: validatedPackage,
		},
	}
}
