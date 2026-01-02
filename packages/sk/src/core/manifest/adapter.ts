import path from "node:path"
import type {
	ValidatedDependency as AgentsDependency,
	Exports as AgentsExports,
	ValidatedManifest as AgentsManifest,
	Package as AgentsPackage,
	ParseError,
} from "@skills-supply/agents-toml"
import type {
	ManifestParseError,
	ManifestParseResult,
	ValidatedDependency,
	ValidatedManifestExports,
	ValidatedPackageMetadata,
} from "@/src/core/manifest/types"
import type {
	AbsolutePath,
	AgentId,
	Alias,
	GitRef,
	ManifestDiscoveredAt,
	NonEmptyString,
} from "@/src/core/types/branded"
import {
	coerceAbsolutePath,
	coerceAlias,
	coerceGithubRef,
	coerceGitUrl,
	coerceNonEmpty,
} from "@/src/core/types/coerce"

type AdaptResult<T> = { ok: true; value: T } | { ok: false; error: ManifestParseError }

export function adaptParseError(
	error: ParseError,
	sourcePath: AbsolutePath,
): ManifestParseResult {
	const typeMap: Record<ParseError["type"], ManifestParseError["type"]> = {
		invalid_dependency: "invalid_dependency",
		invalid_manifest: "invalid_manifest",
		invalid_toml: "invalid_toml",
	}

	const message =
		error.type === "invalid_toml" ? `Invalid TOML: ${error.message}` : error.message
	const mappedType = typeMap[error.type] ?? "invalid_manifest"

	return {
		error: {
			message,
			sourcePath,
			type: mappedType,
		},
		ok: false,
	}
}

export function applyBrandedManifest(
	parsed: AgentsManifest,
	sourcePath: AbsolutePath,
	discoveredAt: ManifestDiscoveredAt,
): ManifestParseResult {
	const agents = new Map<AgentId, boolean>()
	for (const [id, enabled] of parsed.agents) {
		agents.set(id as AgentId, enabled)
	}

	const dependencies = new Map<Alias, ValidatedDependency>()
	for (const [alias, declaration] of parsed.dependencies) {
		const brandedAlias = coerceAlias(alias)
		if (!brandedAlias) {
			return failure(
				"coercion_failed",
				`Invalid alias: ${alias}. Aliases must not contain slashes, dots, or colons.`,
				sourcePath,
				alias,
			)
		}

		const depResult = adaptDependency(declaration, alias, sourcePath)
		if (!depResult.ok) {
			return depResult
		}

		dependencies.set(brandedAlias, depResult.value)
	}

	let validatedPackage: ValidatedPackageMetadata | undefined
	if (parsed.package) {
		const pkgResult = adaptPackage(parsed.package, sourcePath)
		if (!pkgResult.ok) {
			return pkgResult
		}
		validatedPackage = pkgResult.value
	}

	const exportsResult = adaptExports(parsed.exports, sourcePath)
	if (!exportsResult.ok) {
		return exportsResult
	}

	return {
		ok: true,
		value: {
			agents,
			dependencies,
			exports: exportsResult.value,
			origin: { discoveredAt, sourcePath },
			package: validatedPackage,
		},
	}
}

function adaptDependency(
	declaration: AgentsDependency,
	alias: string,
	sourcePath: AbsolutePath,
): AdaptResult<ValidatedDependency> {
	switch (declaration.type) {
		case "registry": {
			const name = coerceNonEmpty(declaration.name)
			if (!name) {
				return failure(
					"coercion_failed",
					`Invalid registry dependency name: ${declaration.name}`,
					sourcePath,
					alias,
					"name",
				)
			}
			const version = coerceNonEmpty(declaration.version)
			if (!version) {
				return failure(
					"coercion_failed",
					`Invalid registry dependency version: ${declaration.version}`,
					sourcePath,
					alias,
					"version",
				)
			}

			let org: NonEmptyString | undefined
			if (declaration.org) {
				const coercedOrg = coerceNonEmpty(declaration.org)
				if (!coercedOrg) {
					return failure(
						"coercion_failed",
						`Invalid registry dependency org: ${declaration.org}`,
						sourcePath,
						alias,
						"org",
					)
				}
				org = coercedOrg
			}

			return {
				ok: true,
				value: {
					name,
					org,
					type: "registry",
					version,
				},
			}
		}
		case "github": {
			const gh = coerceGithubRef(declaration.gh)
			if (!gh) {
				return failure(
					"coercion_failed",
					`Invalid GitHub reference: ${declaration.gh}. Expected owner/repo format.`,
					sourcePath,
					alias,
					"gh",
				)
			}

			const refResult = adaptGitRef(declaration.ref, alias, sourcePath)
			if (!refResult.ok) {
				return refResult
			}

			const validPath = coerceOptionalPath(declaration.path, alias, sourcePath)
			if (!validPath.ok) {
				return validPath
			}

			return {
				ok: true,
				value: {
					gh,
					path: validPath.value,
					ref: refResult.value,
					type: "github",
				},
			}
		}
		case "git": {
			const url = coerceGitUrl(declaration.url)
			if (!url) {
				return failure(
					"coercion_failed",
					`Invalid git URL: ${declaration.url}`,
					sourcePath,
					alias,
					"git",
				)
			}

			const refResult = adaptGitRef(declaration.ref, alias, sourcePath)
			if (!refResult.ok) {
				return refResult
			}

			const validPath = coerceOptionalPath(declaration.path, alias, sourcePath)
			if (!validPath.ok) {
				return validPath
			}

			return {
				ok: true,
				value: {
					path: validPath.value,
					ref: refResult.value,
					type: "git",
					url,
				},
			}
		}
		case "local": {
			const manifestDir = path.dirname(sourcePath)
			const absolutePath = coerceAbsolutePath(declaration.path, manifestDir)
			if (!absolutePath) {
				return failure(
					"coercion_failed",
					`Invalid local path: ${declaration.path}`,
					sourcePath,
					alias,
					"path",
				)
			}

			return {
				ok: true,
				value: {
					path: absolutePath,
					type: "local",
				},
			}
		}
		case "claude-plugin": {
			const plugin = coerceNonEmpty(declaration.plugin)
			if (!plugin) {
				return failure(
					"coercion_failed",
					"plugin must be non-empty",
					sourcePath,
					alias,
					"plugin",
				)
			}

			const marketplace =
				coerceGitUrl(declaration.marketplace) ??
				coerceGithubRef(declaration.marketplace)
			if (!marketplace) {
				return failure(
					"coercion_failed",
					`Invalid marketplace: ${declaration.marketplace}. Expected a git URL or owner/repo format.`,
					sourcePath,
					alias,
					"marketplace",
				)
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
	}
	return failure(
		"invalid_dependency",
		`Unknown dependency type: ${(declaration as { type?: string }).type ?? "unknown"}`,
		sourcePath,
		alias,
		"type",
	)
}

function adaptPackage(
	pkg: AgentsPackage,
	sourcePath: AbsolutePath,
): AdaptResult<ValidatedPackageMetadata> {
	const name = coerceNonEmpty(pkg.name)
	if (!name) {
		return failure(
			"coercion_failed",
			"package.name must be non-empty",
			sourcePath,
			undefined,
			"package.name",
		)
	}

	const version = coerceNonEmpty(pkg.version)
	if (!version) {
		return failure(
			"coercion_failed",
			"package.version must be non-empty",
			sourcePath,
			undefined,
			"package.version",
		)
	}

	let description: NonEmptyString | undefined
	if (pkg.description !== undefined) {
		const coerced = coerceNonEmpty(pkg.description)
		if (!coerced) {
			return failure(
				"coercion_failed",
				"package.description must be non-empty",
				sourcePath,
				undefined,
				"package.description",
			)
		}
		description = coerced
	}

	let license: NonEmptyString | undefined
	if (pkg.license !== undefined) {
		const coerced = coerceNonEmpty(pkg.license)
		if (!coerced) {
			return failure(
				"coercion_failed",
				"package.license must be non-empty",
				sourcePath,
				undefined,
				"package.license",
			)
		}
		license = coerced
	}

	let org: NonEmptyString | undefined
	if (pkg.org !== undefined) {
		const coerced = coerceNonEmpty(pkg.org)
		if (!coerced) {
			return failure(
				"coercion_failed",
				"package.org must be non-empty",
				sourcePath,
				undefined,
				"package.org",
			)
		}
		org = coerced
	}

	return {
		ok: true,
		value: {
			description,
			license,
			name,
			org,
			version,
		},
	}
}

function adaptExports(
	exportsValue: AgentsExports | undefined,
	sourcePath: AbsolutePath,
): AdaptResult<ValidatedManifestExports | undefined> {
	const skillsValue = exportsValue?.auto_discover?.skills
	if (skillsValue === undefined) {
		return { ok: true, value: undefined }
	}

	if (skillsValue === false) {
		return { ok: true, value: { auto_discover: { skills: false } } }
	}

	const skills = coerceNonEmpty(skillsValue)
	if (!skills) {
		return failure(
			"coercion_failed",
			"exports.auto_discover.skills must be non-empty or false",
			sourcePath,
			undefined,
			"exports.auto_discover.skills",
		)
	}

	return { ok: true, value: { auto_discover: { skills } } }
}

function adaptGitRef(
	ref: { type: "tag" | "branch" | "rev"; value: string } | undefined,
	alias: string,
	sourcePath: AbsolutePath,
): AdaptResult<GitRef | undefined> {
	if (!ref) {
		return { ok: true, value: undefined }
	}

	const value = coerceNonEmpty(ref.value)
	if (!value) {
		return failure(
			"coercion_failed",
			`Invalid ${ref.type} ref value`,
			sourcePath,
			alias,
			ref.type,
		)
	}

	return { ok: true, value: { type: ref.type, value } }
}

function coerceOptionalPath(
	rawPath: string | undefined,
	alias: string,
	sourcePath: AbsolutePath,
): AdaptResult<NonEmptyString | undefined> {
	if (rawPath === undefined) {
		return { ok: true, value: undefined }
	}

	const coerced = coerceNonEmpty(rawPath)
	if (!coerced) {
		return failure(
			"coercion_failed",
			"path must be non-empty",
			sourcePath,
			alias,
			"path",
		)
	}

	return { ok: true, value: coerced }
}

function failure(
	type: ManifestParseError["type"],
	message: string,
	sourcePath: AbsolutePath,
	key?: string,
	field?: string,
): AdaptResult<never> {
	return {
		error: {
			field,
			key,
			message,
			sourcePath,
			type,
		},
		ok: false,
	}
}
