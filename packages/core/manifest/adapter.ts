import path from "node:path"
import type {
	ValidatedDependency as AgentsDependency,
	ValidatedManifest as AgentsManifest,
} from "@skills-supply/agents-toml"
import type { AbsolutePath, AgentId, Alias, NonEmptyString } from "@/types/branded"
import {
	coerceAbsolutePath,
	coerceAbsolutePathDirect,
	coerceAgentId,
	coerceAlias,
	coerceGithubRef,
	coerceGitUrl,
	coerceNonEmpty,
	coerceRemoteMarketplaceUrl,
} from "@/types/coerce"
import type { ManifestInfo } from "@/types/content"
import type { GitRef, ValidatedDeclaration } from "@/types/declaration"
import type { Result } from "@/types/error"

export function adaptManifest(
	parsed: AgentsManifest,
	manifestPath: AbsolutePath,
): Result<ManifestInfo> {
	const agents = new Map<AgentId, boolean>()

	for (const [id, enabled] of parsed.agents) {
		const agentId = coerceAgentId(id)
		if (!agentId) {
			const message = `Unknown agent id: ${id}.`
			return {
				error: {
					field: "agent",
					message,
					path: manifestPath,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		agents.set(agentId, enabled)
	}

	const dependencies = new Map<Alias, ValidatedDeclaration>()
	for (const [alias, declaration] of parsed.dependencies) {
		const brandedAlias = coerceAlias(alias)
		if (!brandedAlias) {
			const message = `Invalid alias: ${alias}.`
			return {
				error: {
					field: "alias",
					message,
					path: manifestPath,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		const adapted = adaptDependency(declaration, alias, manifestPath)
		if (!adapted.ok) {
			return adapted
		}

		dependencies.set(brandedAlias, adapted.value)
	}

	let pkg: ManifestInfo["package"]
	if (parsed.package) {
		const name = coerceNonEmpty(parsed.package.name)
		if (!name) {
			const message = "Package name must be non-empty."
			return {
				error: {
					field: "package.name",
					message,
					path: manifestPath,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		const version = coerceNonEmpty(parsed.package.version)
		if (!version) {
			const message = "Package version must be non-empty."
			return {
				error: {
					field: "package.version",
					message,
					path: manifestPath,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}

		pkg = {
			name,
			version,
		}

		if (parsed.package.description !== undefined) {
			const description = coerceNonEmpty(parsed.package.description)
			if (!description) {
				const message = "Package description must be non-empty."
				return {
					error: {
						field: "package.description",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}
			pkg.description = description
		}

		if (parsed.package.license !== undefined) {
			const license = coerceNonEmpty(parsed.package.license)
			if (!license) {
				const message = "Package license must be non-empty."
				return {
					error: {
						field: "package.license",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}
			pkg.license = license
		}

		if (parsed.package.org !== undefined) {
			const org = coerceNonEmpty(parsed.package.org)
			if (!org) {
				const message = "Package org must be non-empty."
				return {
					error: {
						field: "package.org",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}
			pkg.org = org
		}
	}

	let exportsValue: ManifestInfo["exports"]
	if (parsed.exports?.auto_discover) {
		const skills = parsed.exports.auto_discover.skills
		if (skills === false) {
			exportsValue = { auto_discover: { skills } }
		} else if (typeof skills === "string") {
			const coerced = coerceNonEmpty(skills)
			if (!coerced) {
				const message =
					"auto_discover.skills must be a non-empty string or false."
				return {
					error: {
						field: "exports.auto_discover.skills",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}
			exportsValue = { auto_discover: { skills: coerced } }
		}
	}

	return {
		ok: true,
		value: {
			agents,
			dependencies,
			exports: exportsValue,
			package: pkg,
		},
	}
}

function adaptDependency(
	declaration: AgentsDependency,
	alias: string,
	manifestPath: AbsolutePath,
): Result<ValidatedDeclaration> {
	switch (declaration.type) {
		case "registry": {
			const name = coerceNonEmpty(declaration.name)
			if (!name) {
				const message = `Invalid registry dependency name: ${declaration.name}`
				return {
					error: {
						field: "dependencies.registry.name",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}
			const version = coerceNonEmpty(declaration.version)
			if (!version) {
				const message = `Invalid registry dependency version: ${declaration.version}`
				return {
					error: {
						field: "dependencies.registry.version",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}
			let org: NonEmptyString | undefined
			if (declaration.org) {
				const coercedOrg = coerceNonEmpty(declaration.org)
				if (!coercedOrg) {
					const message = `Invalid registry dependency org: ${declaration.org}`
					return {
						error: {
							field: "dependencies.registry.org",
							message,
							path: manifestPath,
							source: "manual",
							type: "validation",
						},
						ok: false,
					}
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
				const message = `Invalid GitHub reference: ${declaration.gh}.`
				return {
					error: {
						field: "dependencies.github.gh",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const ref = adaptGitRef(declaration.ref, manifestPath)
			if (!ref.ok) {
				return ref
			}

			const pathValue = adaptOptionalPath(declaration.path, manifestPath, alias)
			if (!pathValue.ok) {
				return pathValue
			}

			return {
				ok: true,
				value: {
					gh,
					path: pathValue.value,
					ref: ref.value,
					type: "github",
				},
			}
		}
		case "git": {
			const url = coerceGitUrl(declaration.url)
			if (!url) {
				const message = `Invalid git URL: ${declaration.url}.`
				return {
					error: {
						field: "dependencies.git.url",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const ref = adaptGitRef(declaration.ref, manifestPath)
			if (!ref.ok) {
				return ref
			}

			const pathValue = adaptOptionalPath(declaration.path, manifestPath, alias)
			if (!pathValue.ok) {
				return pathValue
			}

			return {
				ok: true,
				value: {
					path: pathValue.value,
					ref: ref.value,
					type: "git",
					url,
				},
			}
		}
		case "local": {
			const baseDir = path.dirname(manifestPath)
			const absolutePath = coerceAbsolutePath(declaration.path, baseDir)
			if (!absolutePath) {
				const message = `Invalid local path: ${declaration.path}.`
				return {
					error: {
						field: "dependencies.local.path",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			return { ok: true, value: { path: absolutePath, type: "local" } }
		}
		case "claude-plugin": {
			const plugin = coerceNonEmpty(declaration.plugin)
			if (!plugin) {
				const message = `Invalid plugin name: ${declaration.plugin}.`
				return {
					error: {
						field: "dependencies.claude-plugin.plugin",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const marketplace =
				coerceRemoteMarketplaceUrl(declaration.marketplace) ??
				coerceAbsolutePathDirect(declaration.marketplace) ??
				coerceGitUrl(declaration.marketplace) ??
				coerceGithubRef(declaration.marketplace)
			if (!marketplace) {
				const message = `Invalid marketplace: ${declaration.marketplace}.`
				return {
					error: {
						field: "dependencies.claude-plugin.marketplace",
						message,
						path: manifestPath,
						source: "manual",
						type: "validation",
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
	}
}

function adaptGitRef(
	ref: { type: "tag" | "branch" | "rev"; value: string } | undefined,
	manifestPath: AbsolutePath,
): Result<GitRef | undefined> {
	if (!ref) {
		return { ok: true, value: undefined }
	}

	const value = coerceNonEmpty(ref.value)
	if (!value) {
		const message = "Git ref value must be non-empty."
		return {
			error: {
				field: "dependencies.ref",
				message,
				path: manifestPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return { ok: true, value: { type: ref.type, value } }
}

function adaptOptionalPath(
	value: string | undefined,
	manifestPath: AbsolutePath,
	alias: string,
): Result<NonEmptyString | undefined> {
	if (value === undefined) {
		return { ok: true, value: undefined }
	}

	const coerced = coerceNonEmpty(value)
	if (!coerced) {
		const message = `Invalid path for ${alias}.`
		return {
			error: {
				field: "dependencies.path",
				message,
				path: manifestPath,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return { ok: true, value: coerced }
}
