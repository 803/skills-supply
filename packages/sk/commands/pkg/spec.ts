import path from "node:path"
import type { BaseError, Result } from "@skills-supply/core"
import { coerceGithubRef, coerceRemoteMarketplaceUrl } from "@skills-supply/core"
import type { DependencyDraft } from "@/manifest/types"

export interface AddOptions {
	tag?: string
	branch?: string
	rev?: string
	path?: string
	as?: string
}

export interface NormalizedAddOptions {
	aliasOverride?: string
	ref?: { tag: string } | { branch: string } | { rev: string }
	path?: string
}

type SpecError = BaseError & {
	type: "validation"
	field: string
	source: "manual"
}

export function buildPackageSpec(
	type: string,
	spec: string,
	options: NormalizedAddOptions,
): Result<DependencyDraft, SpecError> {
	const normalizedType = type.trim().toLowerCase()
	if (!normalizedType) {
		const message = "Package type is required."
		return {
			error: {
				field: "type",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const trimmedSpec = spec.trim()
	if (!trimmedSpec) {
		const message = "Package spec is required."
		return {
			error: {
				field: "spec",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const aliasOverride = options.aliasOverride
	const ref = options.ref
	const subPath = options.path

	switch (normalizedType) {
		case "claude-plugin":
		case "claude":
		case "plugin": {
			if (ref || options.path) {
				const message =
					"--tag/--branch/--rev/--path are not valid for Claude plugins."
				return {
					error: {
						field: "ref",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const atIndex = trimmedSpec.indexOf("@")
			if (atIndex <= 0 || atIndex === trimmedSpec.length - 1) {
				const message =
					'Claude plugin specs must be in the form "<plugin>@<marketplace>".'
				return {
					error: {
						field: "spec",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const plugin = trimmedSpec.slice(0, atIndex).trim()
			const marketplace = trimmedSpec.slice(atIndex + 1).trim()
			if (!plugin || !marketplace) {
				const message =
					'Claude plugin specs must be in the form "<plugin>@<marketplace>".'
				return {
					error: {
						field: "spec",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const alias = aliasOverride ?? plugin
			const declaration = {
				marketplace,
				plugin,
				type: "claude-plugin" as const,
			}
			return { ok: true, value: { alias, declaration } }
		}
		case "gh":
		case "github": {
			const alias = aliasOverride ?? deriveAliasFromGithub(trimmedSpec)
			if (!alias) {
				const message = "Unable to derive alias from GitHub spec."
				return {
					error: {
						field: "spec",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const declaration = {
				gh: trimmedSpec,
				...ref,
				...(subPath ? { path: subPath } : {}),
			}
			return { ok: true, value: { alias, declaration } }
		}
		case "git": {
			const alias = aliasOverride ?? deriveAliasFromGit(trimmedSpec)
			if (!alias) {
				const message = "Unable to derive alias from git URL."
				return {
					error: {
						field: "spec",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const declaration = {
				git: trimmedSpec,
				...ref,
				...(subPath ? { path: subPath } : {}),
			}
			return { ok: true, value: { alias, declaration } }
		}
		case "path":
		case "local": {
			if (ref) {
				const message = "--tag/--branch/--rev are not valid for local paths."
				return {
					error: {
						field: "ref",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			if (options.path) {
				const message = "--path is not valid for local packages."
				return {
					error: {
						field: "path",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const alias = aliasOverride ?? deriveAliasFromPath(trimmedSpec)
			if (!alias) {
				const message = "Unable to derive alias from local path."
				return {
					error: {
						field: "spec",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const declaration = { path: trimmedSpec }
			return { ok: true, value: { alias, declaration } }
		}
		case "registry": {
			if (ref || options.path) {
				const message =
					"--tag/--branch/--rev/--path are not valid for registry packages."
				return {
					error: {
						field: "ref",
						message,
						source: "manual",
						type: "validation",
					},
					ok: false,
				}
			}

			const registrySpec = parseRegistrySpec(trimmedSpec)
			if (!registrySpec.ok) {
				return registrySpec
			}
			const alias = aliasOverride ?? registrySpec.value.name
			return {
				ok: true,
				value: {
					alias,
					declaration: {
						registry: registrySpec.value.registry,
						version: registrySpec.value.version,
					},
				},
			}
		}
		default: {
			const message = `Unsupported package type: ${type}`
			return {
				error: {
					field: "type",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
	}
}

export function normalizeAddOptions(
	options: AddOptions,
): Result<NormalizedAddOptions, SpecError> {
	const aliasOverride = options.as?.trim()
	if (options.as !== undefined && !aliasOverride) {
		const message = "--as must not be empty."
		return {
			error: {
				field: "alias",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const ref = resolveRefOptions(options)
	if (!ref.ok) {
		return ref
	}
	const subPath = resolveSubPath(options)
	if (!subPath.ok) {
		return subPath
	}

	return {
		ok: true,
		value: {
			aliasOverride,
			path: subPath.value,
			ref: ref.value,
		},
	}
}

export function isAutoDetectUrl(input: string): boolean {
	const trimmed = input.trim().replace(/\/+$/, "")
	if (!trimmed) {
		return false
	}

	if (coerceRemoteMarketplaceUrl(trimmed)) {
		return true
	}

	if (
		path.isAbsolute(trimmed) ||
		trimmed.startsWith("./") ||
		trimmed.startsWith("../")
	) {
		return true
	}

	if (coerceGithubRef(trimmed)) {
		return true
	}

	// GitHub HTTPS (with or without .git suffix)
	if (/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(trimmed)) return true

	// git+ssh format (with or without .git suffix)
	if (/^git@[^:]+:.+/.test(trimmed)) return true

	// Any HTTPS URL ending in .git
	if (/^https:\/\/.+\.git$/.test(trimmed)) return true

	return false
}

function resolveRefOptions(
	options: AddOptions,
): Result<{ tag: string } | { branch: string } | { rev: string } | undefined, SpecError> {
	const tag = options.tag?.trim()
	const branch = options.branch?.trim()
	const rev = options.rev?.trim()

	const provided = [tag, branch, rev].filter(Boolean)
	if (provided.length > 1) {
		const message = "Only one of --tag, --branch, or --rev may be set."
		return {
			error: {
				field: "ref",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (options.tag !== undefined && !tag) {
		const message = "--tag must not be empty."
		return {
			error: {
				field: "ref",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
	if (options.branch !== undefined && !branch) {
		const message = "--branch must not be empty."
		return {
			error: {
				field: "ref",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}
	if (options.rev !== undefined && !rev) {
		const message = "--rev must not be empty."
		return {
			error: {
				field: "ref",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (tag) {
		return { ok: true, value: { tag } }
	}
	if (branch) {
		return { ok: true, value: { branch } }
	}
	if (rev) {
		return { ok: true, value: { rev } }
	}
	return { ok: true, value: undefined }
}

function resolveSubPath(options: AddOptions): Result<string | undefined, SpecError> {
	if (options.path === undefined) {
		return { ok: true, value: undefined }
	}

	const trimmed = options.path.trim()
	if (!trimmed) {
		const message = "--path must not be empty."
		return {
			error: {
				field: "path",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	return { ok: true, value: trimmed }
}

function parseRegistrySpec(
	spec: string,
): Result<{ name: string; registry: string; version: string }, SpecError> {
	const trimmed = spec.trim()
	const atIndex = trimmed.lastIndexOf("@")
	if (atIndex <= 0) {
		const message =
			"Registry packages must be in the form name@version or @org/name@version."
		return {
			error: {
				field: "spec",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	const name = trimmed.slice(0, atIndex)
	const version = trimmed.slice(atIndex + 1)
	if (!name || !version) {
		const message =
			"Registry packages must be in the form name@version or @org/name@version."
		return {
			error: {
				field: "spec",
				message,
				source: "manual",
				type: "validation",
			},
			ok: false,
		}
	}

	if (name.startsWith("@")) {
		const scoped = name.slice(1)
		const parts = scoped.split("/")
		if (parts.length !== 2 || !parts[0] || !parts[1]) {
			const message =
				"Registry packages must be in the form name@version or @org/name@version."
			return {
				error: {
					field: "spec",
					message,
					source: "manual",
					type: "validation",
				},
				ok: false,
			}
		}
		return {
			ok: true,
			value: {
				name: parts[1],
				registry: `@${parts[0]}/${parts[1]}`,
				version,
			},
		}
	}

	return { ok: true, value: { name, registry: name, version } }
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
